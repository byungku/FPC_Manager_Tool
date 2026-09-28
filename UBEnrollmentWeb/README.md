# FPC Manager Tool – Web Edition

## [▶ 지문등록 웹 실행하기 (클릭)](https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/)

**https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/**

- 처음 사용하는 PC는 브리지를 내려받아 실행하세요. 실행 중인 동안 웹에서 리더기를 사용할 수 있습니다.
  - **Windows**: [FPCBridge.exe 다운로드](https://github.com/byungku/FPC_Manager_Tool/raw/main/UBEnrollmentWeb/FPCBridge.exe)
  - **Mac**: [FPCBridge-mac.zip 다운로드](https://github.com/byungku/FPC_Manager_Tool/raw/main/UBEnrollmentWeb/FPCBridge-mac.zip) (Apple Silicon·Intel 공용)
- 위 파일 목록의 `index.html`을 누르면 소스 코드만 보입니다. GitHub는 HTML을 실행하지 않으므로 **위 실행 링크**를 이용하세요.

---

PC/SC 리더기로 지문카드에 지문을 등록하는 PC 툴 `UBEnrollmentManager`(WinForms)의 웹 버전입니다. 원본의 기능과 APDU 흐름을 그대로 옮겼습니다.

## 사용 방법

### 1. FPCBridge 하나로 사용 (권장)

브리지 안에 웹 화면이 들어 있어서, **브리지 파일 하나만 있으면** 브라우저에 지문등록 화면(`http://localhost:8765/`)이 자동으로 열립니다.

**Windows**
1. PC에 PC/SC 리더기를 연결합니다.
2. **FPCBridge.exe**를 내려받아 더블클릭합니다.
   - "Windows에서 PC를 보호했습니다"가 나오면 **추가 정보 → 실행**을 누릅니다. (서명되지 않은 exe라서 나오는 경고입니다.)
   - **사용하는 동안 검은 콘솔 창을 닫지 마세요.** 이 창이 리더기와 브라우저를 연결합니다.
3. 화면 왼쪽 아래가 **Bridge: online**이면 READER를 선택하고 **CONNECT**를 누릅니다.

**Mac**
1. Mac에 PC/SC 리더기를 연결합니다.
2. **FPCBridge-mac.zip**을 내려받아 압축을 풉니다.
3. `FPCBridge` 폴더의 **FPCBridge.command**를 마우스 오른쪽 버튼(Control+클릭) → **열기** → **열기**를 누릅니다.
   - macOS 15 이상에서 차단되면 **시스템 설정 → 개인정보 보호 및 보안**에서 **그래도 열기**를 누른 뒤 다시 실행합니다.
   - 처음 한 번만 이렇게 하면 되고, 다음부터는 더블클릭으로 실행합니다.
   - Apple Silicon / Intel Mac에 맞는 파일을 자동으로 골라 실행합니다.
4. 터미널 창이 열리고 브라우저에 지문등록 화면이 열립니다. **사용하는 동안 터미널 창을 닫지 마세요.**

> 기존 `PcscBridge.exe`(Windows 전용)도 같은 방식으로 계속 사용할 수 있습니다. 두 브리지는 같은 포트(8765)를 쓰므로 **하나만 실행**하세요.

### 2. GitHub 사이트에서 시작하는 경우

- GitHub 사이트(`https://byungku.github.io/...`)의 주황색 안내에 **내 컴퓨터(Windows/Mac)에 맞는 FPCBridge 다운로드 버튼**이 나옵니다. 받아서 실행하면 열려 있던 GitHub 화면이 **자동으로 연결**되고 새 탭은 열리지 않습니다.
- Chrome이 GitHub 화면의 연결을 막아 4초 안에 연결되는 화면이 없으면, 작업 화면이 새 탭(`http://localhost:8765/`)으로 열립니다.
- GitHub 사이트 화면에서 바로 리더기를 쓰려면 Chrome 주소창 왼쪽 **사이트 정보 아이콘 → 사이트 설정 → 로컬 네트워크 액세스(또는 "이 기기의 앱")를 허용**해야 합니다. Chrome은 보안상 인터넷 사이트가 PC 안의 프로그램(localhost)에 접속하는 것을 기본으로 막기 때문입니다. 로컬 화면을 쓰면 이 설정이 필요 없습니다.

### 3. 폴더째 사용 (파일서버·로컬 PC)

`UBEnrollmentWeb` 폴더 안의 **FPCBridge.exe**(또는 PcscBridge.exe)를 더블클릭하면 같은 방식으로 `http://localhost:8765/`가 열립니다. 실행 파일 옆에 `web` 폴더가 있으면 그 폴더의 파일을 우선 사용합니다. 파일서버(`\\서버\공유\...`)에 있는 exe를 바로 실행해도 됩니다.

### 브리지 실행 옵션

```
FPCBridge.exe  [--port 8765] [--web <dir>] [--allow-origin <https://주소>] [--no-browser]
PcscBridge.exe [--port 8765] [--web <dir>] [--allow-origin <https://주소>] [--no-browser]
```

Mac에서는 터미널에서 `./FPCBridge.command --no-browser`처럼 같은 옵션을 붙여 실행할 수 있습니다.

| 옵션 | 설명 |
| --- | --- |
| `--port` | 사용할 포트 (기본 8765) |
| `--web` | 제공할 웹 폴더 (기본: exe 옆의 `web`) |
| `--allow-origin` | 브리지 접속을 허용할 웹사이트 주소 추가 (여러 번 지정 가능) |
| `--no-browser` | 실행할 때 브라우저를 열지 않음 |

## 동작 구조

```
[사용자 PC]                                                    [인터넷]
 리더기 ─ FPCBridge ─ ws://localhost:8765/pcsc ─ 브라우저 ── https://byungku.github.io/... (웹 화면)
```

- 브라우저는 보안상 PC/SC 리더기에 직접 접근할 수 없어서, 로컬 브리지(`FPCBridge` / `PcscBridge.exe`)가 **리더기 목록 / 연결 / APDU 전송 / 연결 해제** 네 가지만 WebSocket으로 제공합니다.
- 애플릿 선택, SCP02 인증, 등록, 매칭, 초기화, 삭제 등 **카드 로직은 모두 브라우저(JS)에서 실행**됩니다.
- 브리지는 아래 주소의 웹 화면만 접속을 허용하고, 그 밖의 사이트는 거부(403)합니다.
  - `localhost`, `127.0.0.1` (로컬 실행)
  - `https://byungku.github.io` (GitHub Pages, 기본 내장)
  - `--allow-origin` 옵션 또는 exe 옆 `allowed-origins.txt`(한 줄에 주소 하나)에 적은 주소
- 다른 주소의 브리지를 쓰려면 웹 주소 뒤에 `?bridge=ws://localhost:9000/pcsc`를 붙입니다.

## 폴더 구조

```
UBEnrollmentWeb/
├─ index.html            web/index.html 로 이동 (폴더 주소로 접속하거나 더블클릭할 때)
├─ FPCBridge.exe         Windows용 브리지 + 웹 화면 내장 (v2.0.0, Go)
├─ FPCBridge-mac.zip     Mac용 브리지 (Apple Silicon·Intel + FPCBridge.command 실행기)
├─ PcscBridge.exe        기존 Windows 전용 브리지 + 웹 화면 내장 (v1.2.1, C#)
├─ README.md
├─ start.bat             (구버전 실행 스크립트, 사용하지 않아도 됨)
├─ fpcbridge/            FPCBridge 소스 (Go)
│  ├─ main.go            HTTP/WebSocket 서버, 허용 주소 검사, 웹 화면 제공
│  ├─ websocket.go       WebSocket 최소 구현 (외부 라이브러리 없음)
│  ├─ pcsc.go            PC/SC 공통 로직
│  ├─ pcsc_windows.go    winscard.dll 호출
│  ├─ pcsc_darwin.go     macOS PCSC.framework 호출 (purego, cgo 불필요)
│  ├─ tools/pack/        Mac용 zip 생성 도구 (실행 권한 포함)
│  ├─ webdist/           빌드 때 web 폴더를 복사해 넣는 곳 (직접 수정하지 않음)
│  └─ build.bat          Windows·Mac 3종 빌드
├─ bridge/               PcscBridge 소스 (C#)
│  ├─ PcscBridge.cs      winscard.dll ↔ WebSocket 브리지 + 정적 웹 서버
│  └─ build.bat          .NET Framework 내장 csc.exe 로 빌드 (SDK 불필요)
└─ web/
   ├─ index.html, css/app.css, img/
   └─ js/
      ├─ crypto.js       DES/3DES + SCP02 (UBScp02.cs 이식)
      ├─ pcsc.js         브리지 WebSocket 클라이언트
      ├─ fpcard.js       ErrorCodes / UBApdu / UBFingerPrintCard 이식
      └─ app.js          Form1 / initForm / settingForm 화면 로직 이식
```

## 화면별 기능

### 상단 연결 영역
- READER 선택, 새로고침(⟳), **CONNECT / DISCONNECT**, **SETTING**, **INITIALIZE**(구버전 애플릿일 때만 표시)
- 오른쪽 상태 표시: **CARD**(연결) / **INIT**(초기화) / **ENROLL**(등록)
- 창이 좁으면 버튼이 READER 아래 줄로 내려갑니다.

### ENROLL (등록)
- 손가락 선택(1st / 2nd Finger)이 기본으로 표시됩니다.
- **ENROLL을 한 번 누르면 목표 횟수까지 자동으로 연속 등록**하고, 끝나면 "Enrollment Success" 메시지를 한 번 보여 줍니다.
  - 내부 옵션: Manual = 해제, Re-Touch = 체크 (화면에는 숨김)
- 지문 칸은 가운데 정렬되며, 칸 수(8/16)와 창 크기에 맞춰 **스크롤 없이** 자동으로 크기가 조정됩니다(최대 240 × 180).
- DELETE: 선택한 손가락의 템플릿 삭제

### MATCH (매칭)
- **카드 자동 감지**: MATCH 탭을 열어 두면 카드가 없어도 1초마다 리더기를 확인하고, 카드를 올리면 **자동으로 연결(CONNECT) → 매칭(MATCH)**을 시작합니다.
  - 리더기를 선택하지 않았으면 비접촉(Contactless) 리더기를 우선 사용합니다.
  - 매칭 중 카드를 떼면 오류 팝업 없이 연결이 해제되고, 다음 카드를 기다립니다.
  - 지문카드가 아니거나 읽기에 실패한 카드는 오류를 한 번만 보여 주고, **카드를 뗐다가 다시 올려야** 다시 시도합니다.
  - MATCH 버튼 아래에 현재 상태(카드 대기 / 매칭 중 등)가 표시됩니다.
  - MATCH 메뉴는 카드 연결 전에도 선택할 수 있습니다.
- MATCH를 누르면 **CANCEL을 누를 때까지 계속 매칭**합니다. (CANCEL 후에는 자동으로 다시 시작하지 않습니다.)
- 결과 팝업은 띄우지 않고, 가운데 지문 이미지로 결과를 1초간 보여 준 뒤 다음 매칭을 시작합니다.
  - 성공: 성공 이미지 / 실패·시간초과: 실패 이미지
  - 결과 상세(매칭 시간, 등록 상태)는 DEV 화면의 Card Log에 기록됩니다.
- Exception, Unsupport Command, 카드 연결 끊김은 매칭을 멈추고 팝업을 표시합니다.

### ABOUT
- 툴 이름과 버전 정보

### DEV (관리자 모드)
- **Ctrl + Shift + F11**을 누르면 왼쪽 메뉴에 DEV가 나타납니다. (새로고침하면 다시 숨겨집니다.)
- 컨트롤러 버전 / 애플릿 버전 / Block State 표시
- **Send APDU**(Enter로도 전송), **Sensor Self-Test**
- 손가락 선택 후 ENROLL / DELETE / MATCH
- **Repeat matching**: 기본 체크. MATCH DELAY(기본 1000 ms), MATCH COUNT(기본 50) 설정 후 통계 표시
  - 반복 매칭은 **DEV 화면의 MATCH 버튼에만** 적용되고, MATCH 탭은 항상 연속 단일 매칭으로 동작합니다.
- **Card Log**: 주고받은 APDU 전체 기록 (CLEAR로 초기화)

### SETTING (키 설정)
- ENC / MAC / DEK 키(각 32자리 16진수) 입력. 비워 두면 기본 키를 사용합니다.
- 키는 **브라우저별로 저장**됩니다(localStorage). 원본의 `textKEY.txt`는 사용하지 않습니다.

### 숨김 단축키
| 단축키 | 기능 |
| --- | --- |
| Ctrl + Shift + F11 | DEV 메뉴 표시 |
| Ctrl + Shift + F10 | MATCH 메뉴 표시 (기본으로 보이므로 영향 없음) |
| Ctrl + Shift + F9 | 손가락 선택 표시 (기본으로 보이므로 영향 없음) |

## 원본(WinForms) 대비 차이

| 항목 | 원본 | 웹 버전 |
| --- | --- | --- |
| 등록 | 한 번 터치마다 성공 팝업 | 목표 횟수까지 자동 연속 등록 |
| 매칭 (MATCH 탭) | 1회 매칭 후 결과 팝업 | CANCEL 전까지 연속 매칭, 결과는 이미지로 표시 |
| 반복 매칭 | 체크 해제가 기본, MATCH 탭에도 적용 | 체크가 기본, DEV 화면에만 적용 |
| 반복 매칭 중 CANCEL | 멈추지 않고 새로 시작되는 버그 | 정상적으로 멈춤 |
| 취소 처리 | `Thread.Abort()`로 스레드 중단 | 이미 보낸 APDU의 결과를 무시. 모든 APDU는 한 줄로 순서대로 전송 |
| 연결 해제 | 타이머 일부가 계속 동작 | 등록·매칭·초기화 타이머 모두 정지 |
| 키 저장 | exe 옆 `textKEY.txt` | 브라우저 localStorage |

SCP02 인증(INITIALIZE UPDATE + EXTERNAL AUTHENTICATE) 결과는 원본 `UBScp02.cs`와 **바이트 단위로 동일**함을 확인했습니다.

## 업데이트 방법 (GitHub)

1. GitHub에서 올릴 폴더로 들어가 **Add file → Upload files**를 누릅니다.
2. 바뀐 파일을 끌어다 놓고 **Commit changes**를 누릅니다.
   - `UBEnrollmentWeb` 폴더 안에서는 폴더 자체가 아니라 **내용물**을 올려야 폴더가 겹치지 않습니다.
3. 1~2분 뒤(Actions 탭에 ✅) 사이트에 반영되며, 사용자는 **Ctrl + F5**로 새로고침하면 됩니다.
4. 브리지(`FPCBridge.exe`, `FPCBridge-mac.zip`, `PcscBridge.exe`)를 바꾼 경우(웹 화면 수정 포함)에는 각 사용자가 브리지를 **다시 내려받아야** 합니다.
5. `fpcbridge\webdist` 폴더는 빌드용 복사본이라 GitHub에 올리지 않아도 됩니다.

## 브리지 다시 빌드하기

**`web` 폴더의 파일을 수정한 경우에도 반드시 다시 빌드**하세요. 웹 화면이 브리지 안에 들어가므로, 다시 빌드해야 브리지만 받은 사용자에게 반영됩니다.

| 브리지 | 빌드 방법 | 결과물 | 필요한 것 |
| --- | --- | --- | --- |
| FPCBridge | `fpcbridge\build.bat` | `FPCBridge.exe`, `FPCBridge-mac.zip` | Go 1.27 이상 (없으면 `%USERPROFILE%\tools\go`를 사용) |
| PcscBridge | `bridge\build.bat` | `PcscBridge.exe` | 없음 (Windows 내장 .NET Framework 4.x 컴파일러 사용) |

- FPCBridge는 Windows PC 한 대에서 **Windows용과 Mac용(Apple Silicon·Intel)을 모두** 만듭니다. Mac용 Apple Silicon 파일은 빌드할 때 자동으로 서명(ad-hoc)되어 M 시리즈 Mac에서도 실행됩니다.
- Mac용은 이 PC에서 실행해 볼 수 없으므로, 바꾼 뒤에는 Mac에서 한 번 실행해 확인하세요.

## 주의사항

- 공개 저장소이므로 소스 코드와 기본 SCP02 키(`404142…4F`)를 누구나 볼 수 있습니다.
- 브리지는 허용된 웹사이트만 받아들입니다. `--allow-origin *`처럼 모든 사이트를 허용하면 다른 웹사이트도 카드에 APDU를 보낼 수 있으므로 사용하지 마세요.
