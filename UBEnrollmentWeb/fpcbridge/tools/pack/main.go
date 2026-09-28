// pack builds FPCBridge-mac.zip with Unix execute permissions set on the entries,
// which a zip made on Windows would otherwise lose.
//
// Usage: go run ./tools/pack <out.zip> <arm64 binary> <intel binary>
package main

import (
	"archive/zip"
	"fmt"
	"io/fs"
	"os"
	"time"
)

// Double-clickable launcher. Must keep LF line endings.
const launcher = `#!/bin/bash
# Double-click to start FPCBridge (PC/SC bridge for the FPC Manager web app).
cd "$(dirname "$0")" || exit 1

# Files unpacked from a downloaded zip are quarantined by macOS; clear it for the bridge binaries.
xattr -d com.apple.quarantine FPCBridge-mac-arm64 FPCBridge-mac-intel 2>/dev/null

if [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = "1" ]; then
  exec ./FPCBridge-mac-arm64 "$@"
else
  exec ./FPCBridge-mac-intel "$@"
fi
`

const readme = `FPCBridge (Mac용) 사용법
========================

1. Mac에 PC/SC 카드 리더기를 연결합니다.
2. FPCBridge-mac.zip 압축을 풉니다. (다운로드 폴더에서 더블클릭)
3. FPCBridge.command 를 마우스 오른쪽 버튼(Control+클릭) -> [열기] -> [열기]
   - macOS 15 이상에서 차단되면: 시스템 설정 > 개인정보 보호 및 보안 에서
     FPCBridge.command 옆의 [그래도 열기]를 누른 뒤 다시 실행하세요.
   - 이 과정은 처음 한 번만 필요합니다. 다음부터는 더블클릭만 하면 됩니다.
4. 터미널 창이 열리며 브리지가 실행되고, 브라우저에 지문등록 화면
   (http://localhost:8765/)이 열립니다. GitHub 화면을 열어 두었다면 자동으로 연결됩니다.
5. 사용하는 동안 터미널 창을 닫지 마세요. 창을 닫으면 브리지가 종료됩니다.

FPCBridge-mac-arm64 : Apple Silicon (M1/M2/M3/M4...)
FPCBridge-mac-intel : Intel Mac
FPCBridge.command   : Mac 종류에 맞는 파일을 자동으로 실행
`

func main() {
	if len(os.Args) != 4 {
		fmt.Fprintln(os.Stderr, "usage: pack <out.zip> <arm64 binary> <intel binary>")
		os.Exit(2)
	}
	if err := run(os.Args[1], os.Args[2], os.Args[3]); err != nil {
		fmt.Fprintln(os.Stderr, "pack:", err)
		os.Exit(1)
	}
}

func run(out, arm64, intel string) error {
	f, err := os.Create(out)
	if err != nil {
		return err
	}
	defer f.Close()
	zw := zip.NewWriter(f)

	armData, err := os.ReadFile(arm64)
	if err != nil {
		return err
	}
	intelData, err := os.ReadFile(intel)
	if err != nil {
		return err
	}

	entries := []struct {
		name string
		mode fs.FileMode
		data []byte
	}{
		{"FPCBridge/FPCBridge.command", 0o755, []byte(launcher)},
		{"FPCBridge/FPCBridge-mac-arm64", 0o755, armData},
		{"FPCBridge/FPCBridge-mac-intel", 0o755, intelData},
		{"FPCBridge/README.txt", 0o644, []byte(readme)},
	}
	for _, e := range entries {
		h := &zip.FileHeader{Name: e.name, Method: zip.Deflate, Modified: time.Now()}
		h.SetMode(e.mode) // records Unix permissions (creator = Unix) in the entry
		w, err := zw.CreateHeader(h)
		if err != nil {
			return err
		}
		if _, err := w.Write(e.data); err != nil {
			return err
		}
	}
	return zw.Close()
}
