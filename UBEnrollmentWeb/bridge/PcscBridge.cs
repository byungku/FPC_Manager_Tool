// UB PC/SC Bridge
// Exposes the local PC/SC (winscard.dll) stack to the FPC Manager web app over a
// WebSocket on localhost, and serves the web app's static files.
//
// Build: bridge\build.bat   (uses the csc.exe shipped with .NET Framework 4.x)
// Run:   PcscBridge.exe [--port 8765] [--web <dir>] [--allow-origin <origin>]... [--no-browser]
//
// Protocol (JSON text frames, one request -> one response):
//   { "id": 1, "cmd": "hello" }                          -> { "id":1, "ok":true, "name":..., "version":... }
//   { "id": 2, "cmd": "listReaders" }                    -> { "id":2, "ok":true, "readers":[...] }
//   { "id": 3, "cmd": "connect", "reader": "..." }       -> { "id":3, "ok":true, "atr":"3B..", "protocol":"T1" }
//   { "id": 4, "cmd": "transmit", "apdu": "00A40400.." } -> { "id":4, "ok":true, "rapdu":"..9000" }
//   { "id": 5, "cmd": "disconnect" }                     -> { "id":5, "ok":true }
//   errors                                               -> { "id":n, "ok":false, "error":"...", "code":"0x8010000C" }

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.WebSockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

[assembly: System.Reflection.AssemblyTitle("UB PC/SC Bridge")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace UBPcscBridge
{
    static class WinSCard
    {
        public const uint SCARD_SCOPE_SYSTEM = 2;
        public const uint SCARD_SHARE_SHARED = 2;
        public const uint SCARD_PROTOCOL_T0 = 1;
        public const uint SCARD_PROTOCOL_T1 = 2;
        public const uint SCARD_LEAVE_CARD = 0;
        public const uint SCARD_UNPOWER_CARD = 2;
        public const uint SCARD_ATTR_ATR_STRING = 0x00090303;

        public const int SCARD_E_NO_SERVICE = unchecked((int)0x8010001D);
        public const int SCARD_E_SERVICE_STOPPED = unchecked((int)0x8010001E);
        public const int SCARD_E_NO_READERS_AVAILABLE = unchecked((int)0x8010002E);
        public const int SCARD_E_INVALID_HANDLE = unchecked((int)0x80100003);

        [DllImport("winscard.dll")]
        public static extern int SCardEstablishContext(uint dwScope, IntPtr pvReserved1, IntPtr pvReserved2, out IntPtr phContext);

        [DllImport("winscard.dll")]
        public static extern int SCardReleaseContext(IntPtr hContext);

        [DllImport("winscard.dll", EntryPoint = "SCardListReadersW", CharSet = CharSet.Unicode)]
        public static extern int SCardListReaders(IntPtr hContext, string mszGroups, IntPtr mszReaders, ref int pcchReaders);

        [DllImport("winscard.dll", EntryPoint = "SCardConnectW", CharSet = CharSet.Unicode)]
        public static extern int SCardConnect(IntPtr hContext, string szReader, uint dwShareMode, uint dwPreferredProtocols, out IntPtr phCard, out uint pdwActiveProtocol);

        [DllImport("winscard.dll")]
        public static extern int SCardDisconnect(IntPtr hCard, uint dwDisposition);

        [DllImport("winscard.dll")]
        public static extern int SCardTransmit(IntPtr hCard, IntPtr pioSendPci, byte[] pbSendBuffer, int cbSendLength, IntPtr pioRecvPci, byte[] pbRecvBuffer, ref int pcbRecvLength);

        [DllImport("winscard.dll")]
        public static extern int SCardGetAttrib(IntPtr hCard, uint dwAttrId, byte[] pbAttr, ref int pcbAttrLen);

        static readonly Dictionary<int, string> names = new Dictionary<int, string>
        {
            { unchecked((int)0x80100001), "SCARD_F_INTERNAL_ERROR" },
            { unchecked((int)0x80100002), "SCARD_E_CANCELLED" },
            { unchecked((int)0x80100003), "SCARD_E_INVALID_HANDLE" },
            { unchecked((int)0x80100004), "SCARD_E_INVALID_PARAMETER" },
            { unchecked((int)0x80100008), "SCARD_E_INSUFFICIENT_BUFFER" },
            { unchecked((int)0x80100009), "SCARD_E_UNKNOWN_READER" },
            { unchecked((int)0x8010000A), "SCARD_E_TIMEOUT" },
            { unchecked((int)0x8010000B), "SCARD_E_SHARING_VIOLATION" },
            { unchecked((int)0x8010000C), "SCARD_E_NO_SMARTCARD" },
            { unchecked((int)0x8010000F), "SCARD_E_PROTO_MISMATCH" },
            { unchecked((int)0x80100016), "SCARD_E_NOT_TRANSACTED" },
            { unchecked((int)0x80100017), "SCARD_E_READER_UNAVAILABLE" },
            { unchecked((int)0x8010001D), "SCARD_E_NO_SERVICE" },
            { unchecked((int)0x8010001E), "SCARD_E_SERVICE_STOPPED" },
            { unchecked((int)0x8010002E), "SCARD_E_NO_READERS_AVAILABLE" },
            { unchecked((int)0x80100065), "SCARD_W_UNSUPPORTED_CARD" },
            { unchecked((int)0x80100066), "SCARD_W_UNRESPONSIVE_CARD" },
            { unchecked((int)0x80100067), "SCARD_W_UNPOWERED_CARD" },
            { unchecked((int)0x80100068), "SCARD_W_RESET_CARD" },
            { unchecked((int)0x80100069), "SCARD_W_REMOVED_CARD" },
        };

        public static string Name(int code)
        {
            string n;
            return names.TryGetValue(code, out n) ? n : "SCARD_ERROR";
        }
    }

    class SCardException : Exception
    {
        public int Code { get; private set; }

        public SCardException(string func, int code)
            : base(string.Format("{0} failed: {1} (0x{2:X8})", func, WinSCard.Name(code), code))
        {
            Code = code;
        }
    }

    // One PC/SC context + (at most) one card handle per WebSocket client.
    class CardSession : IDisposable
    {
        IntPtr context = IntPtr.Zero;
        IntPtr card = IntPtr.Zero;
        uint protocol;
        IntPtr pciT0;
        IntPtr pciT1;

        public CardSession()
        {
            pciT0 = MakePci(WinSCard.SCARD_PROTOCOL_T0);
            pciT1 = MakePci(WinSCard.SCARD_PROTOCOL_T1);
        }

        static IntPtr MakePci(uint proto)
        {
            // SCARD_IO_REQUEST { DWORD dwProtocol; DWORD cbPciLength; }
            IntPtr p = Marshal.AllocHGlobal(8);
            Marshal.WriteInt32(p, 0, (int)proto);
            Marshal.WriteInt32(p, 4, 8);
            return p;
        }

        void EnsureContext()
        {
            if (context != IntPtr.Zero)
                return;

            int ret = WinSCard.SCardEstablishContext(WinSCard.SCARD_SCOPE_SYSTEM, IntPtr.Zero, IntPtr.Zero, out context);
            if (ret != 0)
            {
                context = IntPtr.Zero;
                throw new SCardException("SCardEstablishContext", ret);
            }
        }

        void ResetContext()
        {
            DisconnectCard(WinSCard.SCARD_LEAVE_CARD);
            if (context != IntPtr.Zero)
            {
                WinSCard.SCardReleaseContext(context);
                context = IntPtr.Zero;
            }
        }

        public string[] ListReaders()
        {
            for (int attempt = 0; ; attempt++)
            {
                EnsureContext();

                int len = 0;
                int ret = WinSCard.SCardListReaders(context, null, IntPtr.Zero, ref len);
                if (ret == WinSCard.SCARD_E_NO_READERS_AVAILABLE)
                    return new string[0];
                if ((ret == WinSCard.SCARD_E_SERVICE_STOPPED || ret == WinSCard.SCARD_E_NO_SERVICE || ret == WinSCard.SCARD_E_INVALID_HANDLE) && attempt == 0)
                {
                    // Smart card service was restarted (e.g. last reader unplugged) - get a fresh context.
                    ResetContext();
                    continue;
                }
                if (ret != 0)
                    throw new SCardException("SCardListReaders", ret);

                IntPtr buf = Marshal.AllocHGlobal(len * 2);
                try
                {
                    ret = WinSCard.SCardListReaders(context, null, buf, ref len);
                    if (ret == WinSCard.SCARD_E_NO_READERS_AVAILABLE)
                        return new string[0];
                    if (ret != 0)
                        throw new SCardException("SCardListReaders", ret);

                    string multi = Marshal.PtrToStringUni(buf, len);
                    List<string> readers = new List<string>();
                    foreach (string r in multi.Split('\0'))
                    {
                        if (r.Length > 0)
                            readers.Add(r);
                    }
                    return readers.ToArray();
                }
                finally
                {
                    Marshal.FreeHGlobal(buf);
                }
            }
        }

        public string Connect(string reader, out string proto)
        {
            EnsureContext();
            DisconnectCard(WinSCard.SCARD_UNPOWER_CARD);

            int ret = WinSCard.SCardConnect(context, reader, WinSCard.SCARD_SHARE_SHARED,
                WinSCard.SCARD_PROTOCOL_T0 | WinSCard.SCARD_PROTOCOL_T1, out card, out protocol);
            if (ret != 0)
            {
                card = IntPtr.Zero;
                throw new SCardException("SCardConnect", ret);
            }

            proto = protocol == WinSCard.SCARD_PROTOCOL_T1 ? "T1" : (protocol == WinSCard.SCARD_PROTOCOL_T0 ? "T0" : protocol.ToString());

            byte[] atr = new byte[64];
            int atrLen = atr.Length;
            ret = WinSCard.SCardGetAttrib(card, WinSCard.SCARD_ATTR_ATR_STRING, atr, ref atrLen);
            if (ret != 0)
                return "";

            return Hex.From(atr, atrLen);
        }

        public byte[] Transmit(byte[] apdu)
        {
            if (card == IntPtr.Zero)
                throw new InvalidOperationException("Card not connected");

            byte[] recv = new byte[65538];
            int recvLen = recv.Length;
            IntPtr pci = protocol == WinSCard.SCARD_PROTOCOL_T1 ? pciT1 : pciT0;

            int ret = WinSCard.SCardTransmit(card, pci, apdu, apdu.Length, IntPtr.Zero, recv, ref recvLen);
            if (ret != 0)
                throw new SCardException("SCardTransmit", ret);

            byte[] result = new byte[recvLen];
            Array.Copy(recv, result, recvLen);
            return result;
        }

        public void DisconnectCard(uint disposition)
        {
            if (card != IntPtr.Zero)
            {
                WinSCard.SCardDisconnect(card, disposition);
                card = IntPtr.Zero;
            }
        }

        public void Dispose()
        {
            DisconnectCard(WinSCard.SCARD_UNPOWER_CARD);
            ResetContext();
            Marshal.FreeHGlobal(pciT0);
            Marshal.FreeHGlobal(pciT1);
        }
    }

    static class Hex
    {
        public static string From(byte[] data, int len)
        {
            StringBuilder sb = new StringBuilder(len * 2);
            for (int i = 0; i < len; i++)
                sb.Append(data[i].ToString("X2"));
            return sb.ToString();
        }

        public static byte[] To(string hex)
        {
            hex = hex.Replace(" ", "");
            if (hex.Length % 2 != 0)
                throw new FormatException("Odd hex length");

            byte[] b = new byte[hex.Length / 2];
            for (int i = 0; i < b.Length; i++)
                b[i] = Convert.ToByte(hex.Substring(i * 2, 2), 16);
            return b;
        }
    }

    class Program
    {
        const string VERSION = "1.2.0";
        const string HOSTED_URL = "https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/";

        static int port = 8765;
        static string webRoot;

        // Hosted copy of the web app (GitHub Pages). Allowed without any option.
        static readonly string[] builtInOrigins = { "https://byungku.github.io" };
        static readonly List<string> allowedOrigins = new List<string>(builtInOrigins);
        static readonly JavaScriptSerializer json = new JavaScriptSerializer();

        static readonly Dictionary<string, string> mimeTypes = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" },
            { ".htm", "text/html; charset=utf-8" },
            { ".js", "text/javascript; charset=utf-8" },
            { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json; charset=utf-8" },
            { ".png", "image/png" },
            { ".gif", "image/gif" },
            { ".jpg", "image/jpeg" },
            { ".svg", "image/svg+xml" },
            { ".ico", "image/x-icon" },
        };

        static int Main(string[] args)
        {
            bool openBrowser = true;
            string exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
            webRoot = Path.Combine(exeDir, "web");

            for (int i = 0; i < args.Length; i++)
            {
                string a = args[i];
                if (a == "--port" && i + 1 < args.Length) port = int.Parse(args[++i]);
                else if (a == "--web" && i + 1 < args.Length) webRoot = Path.GetFullPath(args[++i]);
                else if (a == "--allow-origin" && i + 1 < args.Length) allowedOrigins.Add(args[++i].TrimEnd('/'));
                else if (a == "--no-browser") openBrowser = false;
                else
                {
                    Console.WriteLine("Usage: PcscBridge.exe [--port 8765] [--web <dir>] [--allow-origin <origin>]... [--no-browser]");
                    return 1;
                }
            }

            // Extra allowed origins can also be listed (one per line) in allowed-origins.txt next to the exe.
            string originFile = Path.Combine(exeDir, "allowed-origins.txt");
            if (File.Exists(originFile))
            {
                foreach (string line in File.ReadAllLines(originFile))
                {
                    string o = line.Trim();
                    if (o.Length > 0 && !o.StartsWith("#"))
                        allowedOrigins.Add(o.TrimEnd('/'));
                }
            }

            HttpListener listener = StartListener();
            if (listener == null)
                return 2;

            string url = string.Format("http://localhost:{0}/", port);
            Console.WriteLine("UB PC/SC Bridge v{0}", VERSION);
            bool localWeb = Directory.Exists(webRoot) || HasEmbeddedWeb();
            Console.WriteLine("  Web app   : {0}", localWeb ? url : HOSTED_URL);
            Console.WriteLine("  WebSocket : ws://localhost:{0}/pcsc", port);
            Console.WriteLine("  Web files : {0}", Directory.Exists(webRoot) ? webRoot : (HasEmbeddedWeb() ? "built-in" : "none"));
            if (allowedOrigins.Count > 0)
                Console.WriteLine("  Allowed web origins: {0}", string.Join(", ", allowedOrigins));
            Console.WriteLine("Press Ctrl+C to stop.");
            Console.WriteLine();

            if (openBrowser)
            {
                // Open the locally served app (same machine, so no browser local-network restrictions).
                try { Process.Start(localWeb ? url : HOSTED_URL); } catch { }
            }

            while (true)
            {
                HttpListenerContext ctx;
                try
                {
                    ctx = listener.GetContext();
                }
                catch (HttpListenerException)
                {
                    break;
                }
                Task.Run(() => Handle(ctx));
            }
            return 0;
        }

        static HttpListener StartListener()
        {
            string[][] prefixSets =
            {
                new[] { string.Format("http://localhost:{0}/", port), string.Format("http://127.0.0.1:{0}/", port) },
                new[] { string.Format("http://localhost:{0}/", port) },
            };

            foreach (string[] prefixes in prefixSets)
            {
                HttpListener l = new HttpListener();
                foreach (string p in prefixes)
                    l.Prefixes.Add(p);
                try
                {
                    l.Start();
                    return l;
                }
                catch (HttpListenerException ex)
                {
                    l.Close();
                    if (prefixes.Length == 1)
                    {
                        Console.Error.WriteLine("Cannot listen on port {0}: {1}", port, ex.Message);
                        Console.Error.WriteLine("Is another bridge already running? Try --port <other>.");
                    }
                }
            }
            return null;
        }

        static bool IsOriginAllowed(string origin)
        {
            if (string.IsNullOrEmpty(origin) || origin == "null")
                return true; // non-browser client or file://

            if (allowedOrigins.Contains("*"))
                return true;

            Uri u;
            if (Uri.TryCreate(origin, UriKind.Absolute, out u))
            {
                if (u.Host == "localhost" || u.Host == "127.0.0.1" || u.Host == "[::1]")
                    return true;
            }

            return allowedOrigins.Contains(origin.TrimEnd('/'));
        }

        static async Task Handle(HttpListenerContext ctx)
        {
            try
            {
                if (ctx.Request.Url.AbsolutePath == "/pcsc")
                {
                    if (!ctx.Request.IsWebSocketRequest)
                    {
                        Reply(ctx, 400, "WebSocket required");
                        return;
                    }

                    string origin = ctx.Request.Headers["Origin"];
                    if (!IsOriginAllowed(origin))
                    {
                        Console.WriteLine("[{0:HH:mm:ss}] Rejected origin {1}", DateTime.Now, origin);
                        Reply(ctx, 403, "Origin not allowed: " + origin);
                        return;
                    }

                    HttpListenerWebSocketContext wsCtx = await ctx.AcceptWebSocketAsync(null);
                    await RunSession(wsCtx.WebSocket, origin);
                    return;
                }

                ServeStatic(ctx);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine("[{0:HH:mm:ss}] {1}", DateTime.Now, ex.Message);
                try { ctx.Response.Abort(); } catch { }
            }
        }

        static void Reply(HttpListenerContext ctx, int status, string text)
        {
            byte[] body = Encoding.UTF8.GetBytes(text);
            ctx.Response.StatusCode = status;
            ctx.Response.ContentType = "text/plain; charset=utf-8";
            ctx.Response.ContentLength64 = body.Length;
            ctx.Response.OutputStream.Write(body, 0, body.Length);
            ctx.Response.Close();
        }

        // Web files compiled into the exe by build.bat (logical names "web/<path>"),
        // so the exe works on its own when downloaded without the web folder.
        static bool HasEmbeddedWeb()
        {
            return System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceInfo("web/index.html") != null;
        }

        static byte[] ReadEmbedded(string rel)
        {
            using (Stream s = System.Reflection.Assembly.GetExecutingAssembly().GetManifestResourceStream("web/" + rel))
            {
                if (s == null)
                    return null;
                MemoryStream ms = new MemoryStream();
                s.CopyTo(ms);
                return ms.ToArray();
            }
        }

        static void ServeStatic(HttpListenerContext ctx)
        {
            string rel = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath).TrimStart('/');
            if (rel.Length == 0 || rel.EndsWith("/"))
                rel += "index.html";

            byte[] body = null;

            if (Directory.Exists(webRoot))
            {
                // A web folder next to the exe takes precedence (easy to update without rebuilding).
                string root = Path.GetFullPath(webRoot).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
                string full = Path.GetFullPath(Path.Combine(root, rel.Replace('/', Path.DirectorySeparatorChar)));
                if (full.StartsWith(root, StringComparison.OrdinalIgnoreCase) && File.Exists(full))
                    body = File.ReadAllBytes(full);
            }
            else if (!rel.Contains(".."))
            {
                body = ReadEmbedded(rel);
            }

            if (body == null)
            {
                Reply(ctx, 404, "Not found");
                return;
            }

            string mime;
            if (!mimeTypes.TryGetValue(Path.GetExtension(rel), out mime))
                mime = "application/octet-stream";

            ctx.Response.StatusCode = 200;
            ctx.Response.ContentType = mime;
            ctx.Response.Headers["Cache-Control"] = "no-cache";
            ctx.Response.ContentLength64 = body.Length;
            ctx.Response.OutputStream.Write(body, 0, body.Length);
            ctx.Response.Close();
        }

        static async Task RunSession(WebSocket ws, string origin)
        {
            Console.WriteLine("[{0:HH:mm:ss}] Client connected ({1})", DateTime.Now, string.IsNullOrEmpty(origin) ? "no origin" : origin);

            using (CardSession session = new CardSession())
            {
                byte[] buffer = new byte[16 * 1024];
                try
                {
                    while (ws.State == WebSocketState.Open)
                    {
                        MemoryStream msg = new MemoryStream();
                        WebSocketReceiveResult r;
                        do
                        {
                            r = await ws.ReceiveAsync(new ArraySegment<byte>(buffer), CancellationToken.None);
                            if (r.MessageType == WebSocketMessageType.Close)
                            {
                                await ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", CancellationToken.None);
                                return;
                            }
                            msg.Write(buffer, 0, r.Count);
                        } while (!r.EndOfMessage);

                        string reqText = Encoding.UTF8.GetString(msg.ToArray());
                        // PC/SC calls block (an enroll APDU waits for the finger), so run them off the I/O thread.
                        string respText = await Task.Run(() => Dispatch(session, reqText));

                        byte[] resp = Encoding.UTF8.GetBytes(respText);
                        await ws.SendAsync(new ArraySegment<byte>(resp), WebSocketMessageType.Text, true, CancellationToken.None);
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine("[{0:HH:mm:ss}] Session ended: {1}", DateTime.Now, ex.Message);
                }
            }

            Console.WriteLine("[{0:HH:mm:ss}] Client disconnected", DateTime.Now);
        }

        static string Dispatch(CardSession session, string reqText)
        {
            Dictionary<string, object> resp = new Dictionary<string, object>();
            object id = null;

            try
            {
                Dictionary<string, object> req = json.Deserialize<Dictionary<string, object>>(reqText);
                req.TryGetValue("id", out id);
                resp["id"] = id;

                object cmdObj;
                req.TryGetValue("cmd", out cmdObj);
                string cmd = cmdObj as string;

                switch (cmd)
                {
                    case "hello":
                        resp["name"] = "UB PC/SC Bridge";
                        resp["version"] = VERSION;
                        break;

                    case "listReaders":
                        resp["readers"] = session.ListReaders();
                        break;

                    case "connect":
                    {
                        string reader = (string)req["reader"];
                        string proto;
                        resp["atr"] = session.Connect(reader, out proto);
                        resp["protocol"] = proto;
                        Console.WriteLine("[{0:HH:mm:ss}] Connected: {1} ({2})", DateTime.Now, reader, proto);
                        break;
                    }

                    case "transmit":
                    {
                        byte[] rapdu = session.Transmit(Hex.To((string)req["apdu"]));
                        resp["rapdu"] = Hex.From(rapdu, rapdu.Length);
                        break;
                    }

                    case "disconnect":
                        session.DisconnectCard(WinSCard.SCARD_UNPOWER_CARD);
                        break;

                    default:
                        throw new ArgumentException("Unknown command: " + cmd);
                }

                resp["ok"] = true;
            }
            catch (SCardException ex)
            {
                resp["id"] = id;
                resp["ok"] = false;
                resp["error"] = ex.Message;
                resp["code"] = string.Format("0x{0:X8}", ex.Code);
            }
            catch (Exception ex)
            {
                resp["id"] = id;
                resp["ok"] = false;
                resp["error"] = ex.Message;
            }

            return json.Serialize(resp);
        }
    }
}
