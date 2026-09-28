@echo off
rem Builds FPCBridge for Windows and macOS (Apple Silicon + Intel) from this PC. Requires Go 1.27+.
rem Output: ..\FPCBridge.exe  and  ..\FPCBridge-mac.zip
setlocal
pushd "%~dp0"

set "GO=go"
where go >nul 2>nul || set "GO=%USERPROFILE%\tools\go\bin\go.exe"

rem Embed the current web app (webdist is generated; edit ..\web instead)
robocopy ..\web webdist /MIR /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto fail

set CGO_ENABLED=0

echo Building Windows (amd64)...
set GOOS=windows
set GOARCH=amd64
"%GO%" build -trimpath -ldflags "-s -w" -o ..\FPCBridge.exe . || goto fail

echo Building macOS (Apple Silicon)...
set GOOS=darwin
set GOARCH=arm64
"%GO%" build -trimpath -ldflags "-s -w" -o "%TEMP%\FPCBridge-mac-arm64" . || goto fail

echo Building macOS (Intel)...
set GOARCH=amd64
"%GO%" build -trimpath -ldflags "-s -w" -o "%TEMP%\FPCBridge-mac-intel" . || goto fail

echo Packaging FPCBridge-mac.zip...
set GOOS=
set GOARCH=
"%GO%" run ./tools/pack ..\FPCBridge-mac.zip "%TEMP%\FPCBridge-mac-arm64" "%TEMP%\FPCBridge-mac-intel" || goto fail

popd
echo Built ..\FPCBridge.exe and ..\FPCBridge-mac.zip
exit /b 0

:fail
popd
echo Build failed.
exit /b 1
