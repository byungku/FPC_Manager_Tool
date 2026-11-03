# FPC Manager Tool – Web Edition

## [▶ 지문등록 웹 실행하기 (클릭)](https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/)

**https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/**

**웹브라우저는 크롬를 사용해야 합니다.**

- 처음 사용하는 PC는 브리지를 내려받아 실행하세요. 실행 중인 동안 웹에서 리더기를 사용할 수 있습니다.
  - **Windows**: [FPCBridge.exe 다운로드](https://github.com/byungku/FPC_Manager_Tool/raw/main/UBEnrollmentWeb/FPCBridge.exe)
  - **Mac**: [FPCBridge-mac.zip 다운로드](https://github.com/byungku/FPC_Manager_Tool/raw/main/UBEnrollmentWeb/FPCBridge-mac.zip) (Apple Silicon·Intel 공용)
- 위 파일 목록의 `index.html`을 누르면 소스 코드만 보입니다. GitHub는 HTML을 실행하지 않으므로 **위 실행 링크**를 이용하세요.

---

PC/SC 리더기로 지문카드에 지문을 등록하는 PC 툴 `UBEnrollmentManager`(WinForms)의 웹 버전입니다. 

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


### ABOUT
- 툴 이름과 버전 정보

