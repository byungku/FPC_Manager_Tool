@echo off
rem Starts the local PC/SC bridge and opens the FPC Manager web app.
cd /d "%~dp0"
if not exist PcscBridge.exe call bridge\build.bat || exit /b 1
PcscBridge.exe %*
