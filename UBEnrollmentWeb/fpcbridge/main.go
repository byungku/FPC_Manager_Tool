// FPCBridge - cross-platform (Windows / macOS) PC/SC bridge for the FPC Manager web app.
//
// Exposes the local PC/SC stack over a WebSocket on localhost and serves the web app
// (from a "web" folder next to the executable, or from the copy embedded at build time).
// Protocol is identical to the older PcscBridge.exe, so the same web app works with both:
//
//	{ "id": 1, "cmd": "hello" }                          -> { "id":1, "ok":true, "name":..., "version":... }
//	{ "id": 2, "cmd": "listReaders" }                    -> { "id":2, "ok":true, "readers":[...] }
//	{ "id": 3, "cmd": "connect", "reader": "..." }       -> { "id":3, "ok":true, "atr":"3B..", "protocol":"T1" }
//	{ "id": 4, "cmd": "transmit", "apdu": "00A40400.." } -> { "id":4, "ok":true, "rapdu":"..9000" }
//	{ "id": 5, "cmd": "disconnect" }                     -> { "id":5, "ok":true }
//	errors                                               -> { "id":n, "ok":false, "error":"...", "code":"0x8010000C" }
//
// Usage: FPCBridge [--port 8765] [--web <dir>] [--allow-origin <origin>]... [--no-browser]
package main

import (
	"bufio"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"time"
)

const (
	appName       = "FPCBridge"
	version       = "2.0.0"
	hostedURL     = "https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/"
	browserWaitMs = 4000
)

// Hosted copy of the web app (GitHub Pages). Allowed without any option.
var builtInOrigins = []string{"https://byungku.github.io"}

//go:embed all:webdist
var embeddedWeb embed.FS

var (
	port           int
	webRoot        string
	allowedOrigins []string
	clientCount    atomic.Int64
	logger         = log.New(os.Stdout, "", 0)
)

type multiFlag []string

func (m *multiFlag) String() string     { return strings.Join(*m, ",") }
func (m *multiFlag) Set(v string) error { *m = append(*m, strings.TrimRight(v, "/")); return nil }

func main() {
	var extraOrigins multiFlag
	var noBrowser bool
	var webDir string

	flag.IntVar(&port, "port", 8765, "port to listen on")
	flag.StringVar(&webDir, "web", "", "web folder to serve (default: 'web' next to the executable, else built-in)")
	flag.Var(&extraOrigins, "allow-origin", "additional web origin allowed to use the bridge (repeatable)")
	flag.BoolVar(&noBrowser, "no-browser", false, "do not open the browser")
	flag.Parse()

	exeDir := "."
	if exe, err := os.Executable(); err == nil {
		exeDir = filepath.Dir(exe)
	}

	webRoot = webDir
	if webRoot == "" {
		webRoot = filepath.Join(exeDir, "web")
	}
	if !isDir(webRoot) {
		webRoot = "" // use embedded files
	}

	allowedOrigins = append(append([]string{}, builtInOrigins...), extraOrigins...)
	allowedOrigins = append(allowedOrigins, readOriginFile(filepath.Join(exeDir, "allowed-origins.txt"))...)

	listeners, err := listen(port)
	if err != nil {
		logger.Printf("Cannot listen on port %d: %v", port, err)
		logger.Printf("Is another bridge (FPCBridge / PcscBridge) already running? Close it or use --port <other>.")
		waitForEnterOnWindows()
		os.Exit(2)
	}

	localURL := fmt.Sprintf("http://localhost:%d/", port)
	webFiles := "built-in"
	if webRoot != "" {
		webFiles = webRoot
	}
	logger.Printf("%s v%s (%s/%s)", appName, version, runtime.GOOS, runtime.GOARCH)
	logger.Printf("  Web app   : %s", localURL)
	logger.Printf("  WebSocket : ws://localhost:%d/pcsc", port)
	logger.Printf("  Web files : %s", webFiles)
	logger.Printf("  Allowed web origins: %s", strings.Join(allowedOrigins, ", "))
	logger.Printf("Close this window (or press Ctrl+C) to stop.")
	logger.Println()

	mux := http.NewServeMux()
	mux.HandleFunc("/pcsc", handleWebSocket)
	mux.HandleFunc("/", handleStatic)
	srv := &http.Server{Handler: hostCheck(mux), ReadHeaderTimeout: 10 * time.Second}

	for _, l := range listeners {
		go func(l net.Listener) {
			if err := srv.Serve(l); err != nil && !errors.Is(err, http.ErrServerClosed) {
				logger.Printf("Server error: %v", err)
			}
		}(l)
	}

	if !noBrowser {
		go func() {
			// An already-open page (e.g. the GitHub page that offered the download) reconnects
			// within its 3 s retry interval; only open a new tab if nobody connects.
			time.Sleep(browserWaitMs * time.Millisecond)
			if clientCount.Load() > 0 {
				logf("A web page is already connected - not opening a new browser tab.")
				return
			}
			if err := openBrowser(localURL); err != nil {
				logf("Open %s in your browser (%v)", localURL, err)
			}
		}()
	}

	select {}
}

func logf(format string, args ...any) {
	logger.Printf("[%s] %s", time.Now().Format("15:04:05"), fmt.Sprintf(format, args...))
}

func isDir(p string) bool {
	st, err := os.Stat(p)
	return err == nil && st.IsDir()
}

func readOriginFile(p string) []string {
	f, err := os.Open(p)
	if err != nil {
		return nil
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		o := strings.TrimSpace(sc.Text())
		if o != "" && !strings.HasPrefix(o, "#") {
			out = append(out, strings.TrimRight(o, "/"))
		}
	}
	return out
}

// Listen on IPv4 and (if available) IPv6 loopback only - never on external interfaces.
func listen(port int) ([]net.Listener, error) {
	l4, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		return nil, err
	}
	ls := []net.Listener{l4}
	if l6, err := net.Listen("tcp", fmt.Sprintf("[::1]:%d", port)); err == nil {
		ls = append(ls, l6)
	}
	return ls, nil
}

// Reject requests whose Host is not a loopback name (DNS-rebinding protection).
func hostCheck(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		host := r.Host
		if h, _, err := net.SplitHostPort(host); err == nil {
			host = h
		}
		host = strings.Trim(host, "[]")
		if host != "localhost" && host != "127.0.0.1" && host != "::1" {
			http.Error(w, "Forbidden host", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func isOriginAllowed(origin string) bool {
	if origin == "" || origin == "null" {
		return true // non-browser client or file://
	}
	for _, o := range allowedOrigins {
		if o == "*" || o == strings.TrimRight(origin, "/") {
			return true
		}
	}
	if u, err := url.Parse(origin); err == nil {
		h := u.Hostname()
		if h == "localhost" || h == "127.0.0.1" || h == "::1" {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------- static files

var mimeTypes = map[string]string{
	".html": "text/html; charset=utf-8",
	".htm":  "text/html; charset=utf-8",
	".js":   "text/javascript; charset=utf-8",
	".css":  "text/css; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".png":  "image/png",
	".gif":  "image/gif",
	".jpg":  "image/jpeg",
	".svg":  "image/svg+xml",
	".ico":  "image/x-icon",
}

func handleStatic(w http.ResponseWriter, r *http.Request) {
	rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
	if rel == "" || strings.HasSuffix(r.URL.Path, "/") {
		rel = path.Join(rel, "index.html")
	}

	var body []byte
	var err error
	if webRoot != "" {
		// A web folder next to the executable takes precedence (easy to update without rebuilding).
		body, err = os.ReadFile(filepath.Join(webRoot, filepath.FromSlash(rel)))
	} else {
		body, err = fs.ReadFile(embeddedWeb, "webdist/"+rel)
	}
	if err != nil {
		http.Error(w, "Not found", http.StatusNotFound)
		return
	}

	mime, ok := mimeTypes[strings.ToLower(path.Ext(rel))]
	if !ok {
		mime = "application/octet-stream"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Cache-Control", "no-cache")
	w.Write(body)
}

// ---------------------------------------------------------------- WebSocket session

func handleWebSocket(w http.ResponseWriter, r *http.Request) {
	origin := r.Header.Get("Origin")
	if !isOriginAllowed(origin) {
		logf("Rejected origin %s", origin)
		http.Error(w, "Origin not allowed: "+origin, http.StatusForbidden)
		return
	}

	ws, err := upgradeWebSocket(w, r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	defer ws.Close()

	// Keep all PC/SC calls of this client on one OS thread.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	clientCount.Add(1)
	if origin == "" {
		origin = "no origin"
	}
	logf("Client connected (%s)", origin)

	session := newCardSession()
	defer session.Close()

	for {
		msg, err := ws.ReadMessage()
		if err != nil {
			break
		}
		if err := ws.WriteText(dispatch(session, msg)); err != nil {
			break
		}
	}
	logf("Client disconnected (%s)", origin)
}

func dispatch(s *cardSession, reqText []byte) []byte {
	resp := map[string]any{}
	var req map[string]any

	err := json.Unmarshal(reqText, &req)
	if err == nil {
		resp["id"] = req["id"]
		cmd, _ := req["cmd"].(string)
		switch cmd {
		case "hello":
			resp["name"] = appName
			resp["version"] = version
			resp["platform"] = runtime.GOOS
		case "listReaders":
			var readers []string
			readers, err = s.ListReaders()
			if readers == nil {
				readers = []string{}
			}
			resp["readers"] = readers
		case "connect":
			reader, _ := req["reader"].(string)
			var atr []byte
			var proto string
			atr, proto, err = s.Connect(reader)
			if err == nil {
				resp["atr"] = strings.ToUpper(hex.EncodeToString(atr))
				resp["protocol"] = proto
				logf("Connected: %s (%s)", reader, proto)
			}
		case "transmit":
			apduHex, _ := req["apdu"].(string)
			var apdu, rapdu []byte
			apdu, err = hex.DecodeString(strings.ReplaceAll(apduHex, " ", ""))
			if err == nil {
				rapdu, err = s.Transmit(apdu)
				resp["rapdu"] = strings.ToUpper(hex.EncodeToString(rapdu))
			}
		case "disconnect":
			s.Disconnect()
		default:
			err = fmt.Errorf("Unknown command: %s", cmd)
		}
	}

	if err != nil {
		resp["ok"] = false
		resp["error"] = err.Error()
		var se *scardError
		if errors.As(err, &se) {
			resp["code"] = fmt.Sprintf("0x%08X", uint32(se.code))
		}
	} else {
		resp["ok"] = true
	}

	out, _ := json.Marshal(resp)
	return out
}
