@echo off
rem Starts the local PC/SC bridge and opens the FPC Manager web app.
rem pushd (not cd) so this also works from a file-server share (\\server\share\...):
rem it maps the UNC path to a temporary drive letter.
pushd "%~dp0" || (echo Cannot open folder "%~dp0" & pause & exit /b 1)
if not exist PcscBridge.exe call bridge\build.bat || (popd & pause & exit /b 1)
PcscBridge.exe %*
if errorlevel 1 pause
popd
