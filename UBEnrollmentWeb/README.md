# FPC Manager Tool – Web Edition

## [▶ 지문등록 웹 실행하기 (클릭)](https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/)

**https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/**

- 처음 사용하는 PC는 **[PcscBridge.exe 다운로드](https://github.com/byungku/FPC_Manager_Tool/raw/main/UBEnrollmentWeb/PcscBridge.exe)** 후 실행하세요. 실행 중인 동안 웹에서 리더기를 사용할 수 있습니다.
- 위 파일 목록의 `index.html`을 누르면 소스 코드만 보입니다. GitHub는 HTML을 실행하지 않으므로 **위 실행 링크**를 이용하세요.

---

PC/SC 리더기로 지문카드에 지문을 등록하는 PC 툴 `UBEnrollmentManager`(WinForms)의 웹 버전입니다. 원본의 기능과 APDU 흐름을 그대로 옮겼습니다.

## 사용 방법

### 1. 웹 주소로 사용 (권장)

1. PC에 PC/SC 리더기를 연결합니다.
2. **PcscBridge.exe**를 내려받아 더블클릭합니다.
   - 옵션 없이 실행하면 되고, 지문등록 웹이 브라우저에서 자동으로 열립니다.
   - "Windows에서 PC를 보호했습니다"가 나오면 **추가 정보 → 실행**을 누릅니다. (서명되지 않은 exe라서 나오는 경고입니다.)
   - **사용하는 동안 검은 콘솔 창을 닫지 마세요.** 이 창이 리더기와 브라우저를 연결합니다.
3. 웹 화면 왼쪽 아래가 **Bridge: online**이면 READER를 선택하고 **CONNECT**를 누릅니다.
   - Chrome이 "로컬 네트워크 액세스"를 물으면 **허용**을 누릅니다.
   - 브리지가 꺼져 있으면 화면 위쪽에 주황색 안내와 **PcscBridge.exe 다운로드 / 다시 연결** 버튼이 나옵니다. 브리지를 실행하면 3초 안에 자동으로 연결됩니다.

### 2. 폴더째 사용 (파일서버·로컬 PC)

`UBEnrollmentWeb` 폴더 안의 **PcscBridge.exe**를 더블클릭하면, 같은 폴더의 `web`을 제공하면서 `http://localhost:8765/`가 브라우저에서 열립니다. 파일서버(`\\서버\공유\...`)에 있는 exe를 바로 실행해도 됩니다.

### 브리지 실행 옵션

```
PcscBridge.exe [--port 8765] [--web <dir>] [--allow-origin <https://주소>] [--no-browser]
```

| 옵션 | 설명 |
| --- | --- |
| `--port` | 사용할 포트 (기본 8765) |
| `--web` | 제공할 웹 폴더 (기본: exe 옆의 `web`) |
| `--allow-origin` | 브리지 접속을 허용할 웹사이트 주소 추가 (여러 번 지정 가능) |
| `--no-browser` | 실행할 때 브라우저를 열지 않음 |

## 동작 구조

```
[사용자 PC]                                                    [인터넷]
 리더기 ─ PcscBridge.exe ─ ws://localhost:8765/pcsc ─ 브라우저 ── https://byungku.github.io/... (웹 화면)
```

- 브라우저는 보안상 PC/SC 리더기에 직접 접근할 수 없어서, 로컬 브리지(`PcscBridge.exe`)가 **리더기 목록 / 연결 / APDU 전송 / 연결 해제** 네 가지만 WebSocket으로 제공합니다.
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
├─ PcscBridge.exe        로컬 PC/SC 브리지 (v1.1.0)
├─ README.md
├─ start.bat             (구버전 실행 스크립트, 사용하지 않아도 됨)
├─ bridge/
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
- MATCH를 누르면 **CANCEL을 누를 때까지 계속 매칭**합니다.
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
4. `PcscBridge.exe`를 바꾼 경우에는 각 사용자가 exe를 **다시 내려받아야** 합니다.

## 브리지 다시 빌드하기

`bridge\PcscBridge.cs`를 수정한 경우 `bridge\build.bat`을 실행하면 `PcscBridge.exe`가 새로 만들어집니다. Windows에 기본으로 있는 .NET Framework 4.x 컴파일러를 사용하므로 별도 설치가 필요 없습니다.

## 주의사항

- 공개 저장소이므로 소스 코드와 기본 SCP02 키(`404142…4F`)를 누구나 볼 수 있습니다.
- 브리지는 허용된 웹사이트만 받아들입니다. `--allow-origin *`처럼 모든 사이트를 허용하면 다른 웹사이트도 카드에 APDU를 보낼 수 있으므로 사용하지 마세요.
