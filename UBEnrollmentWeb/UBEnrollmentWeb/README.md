# FPC Manager Tool – Web Edition

This is the web version of the PC tool `UBEnrollmentManager` (WinForms). It enrolls fingerprints on fingerprint cards through a PC/SC reader and keeps the original tool's features and APDU flows.

## 구조

```
UBEnrollmentWeb/
├─ PcscBridge.exe        로컬 PC/SC 브리지 (bridge/build.bat 로 빌드)
├─ start.bat             브리지 실행 + 브라우저 열기
├─ bridge/
│  ├─ PcscBridge.cs      winscard.dll ↔ WebSocket 브리지 + 정적 웹 서버
│  └─ build.bat          .NET Framework 내장 csc.exe 로 빌드 (SDK 불필요)
└─ web/
   ├─ index.html, css/app.css
   └─ js/
      ├─ crypto.js       DES/3DES + SCP02 (UBScp02.cs 이식)
      ├─ pcsc.js         브리지 WebSocket 클라이언트
      ├─ fpcard.js       ErrorCodes / UBApdu / UBFingerPrintCard 이식
      └─ app.js          Form1 / initForm / settingForm UI 로직 이식
```

A browser cannot access PC/SC readers directly, so a small local bridge (`PcscBridge.exe`) exposes only four operations over `ws://localhost:8765/pcsc`: list readers, connect, transmit, and disconnect. All card logic runs in the browser: applet select, SCP02 authentication, enrollment, matching, initialization, and deletion.

## 실행

1. Run `start.bat`. It builds the bridge if needed, starts it, and opens `http://localhost:8765/` in the browser.
2. Pick a reader, click **CONNECT**, and use the tool the same way as the original.

Bridge options:

```
PcscBridge.exe [--port 8765] [--web <dir>] [--allow-origin https://your.server] [--no-browser]
```

### 웹 서버에 호스팅하는 경우

You can also host the contents of `web/` on a separate web server. Each user PC still needs `PcscBridge.exe` running.

- By default, only pages from `localhost`/`127.0.0.1` may connect to the bridge. Allow your server's origin with `--allow-origin https://fp.example.com`, or list it (one per line) in `allowed-origins.txt` next to `PcscBridge.exe`.
- To use a different bridge address, pass it in the page URL: `?bridge=ws://localhost:9000/pcsc`.
- Chrome may ask for permission when an HTTPS page connects to localhost (Local Network Access).

## 원본 대비 기능 매핑

| 원본 (WinForms) | 웹 |
| --- | --- |
| READER select / reload / CONNECT / DISCONNECT | 동일 |
| SETTING (ENC/MAC/DEK, `textKEY.txt`) | 동일 UI. Keys are saved in the browser's localStorage |
| INITIALIZE dialog (legacy applet only, 750 ms Continue polling) | 동일 |
| ENROLL tab: 16 tiles, Manual / Re-Touch, ENROLL/CANCEL, DELETE | 동일 |
| MATCH tab | 동일 |
| DEV tab: version status, Send APDU, Sensor Self-Test, repeat matching (delay/count), card log | 동일 |
| Hidden keys Ctrl+Shift+F11 (DEV) / F10 (MATCH) / F9 (finger select) | 동일 |
| SCP02 (INITIALIZE UPDATE + EXTERNAL AUTHENTICATE) | Output verified byte-for-byte against the original `UBScp02.cs` |

Differences:

- The original used `Thread.Abort()` for cancel. The web version cannot stop an APDU already in flight, so it ignores that APDU's result instead. All APDUs go through a single queue.
- The original had a bug in repeat-matching mode where pressing CANCEL started a new run instead of stopping. The web version stops correctly.
- On disconnect, the enroll, match, and init timers all stop.
