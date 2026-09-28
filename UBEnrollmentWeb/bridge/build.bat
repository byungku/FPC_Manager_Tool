@echo off
rem Builds PcscBridge.exe with the C# compiler that ships with .NET Framework 4.x (no SDK needed).
rem The files in ..\web are embedded into the exe, so the exe works on its own after download.
setlocal EnableDelayedExpansion
set CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe
if not exist "%CSC%" set CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe
if not exist "%CSC%" (
  echo csc.exe not found. .NET Framework 4.5 or later is required.
  exit /b 1
)

pushd "%~dp0"
pushd ..\web
set "ROOT=%CD%\"
popd

rem Response file (overwritten each build) with one /resource per web file, logical name web/<relative path>
set "RSP=%TEMP%\pcscbridge_build.rsp"
> "%RSP%" echo /nologo /optimize+ /platform:anycpu /target:exe /out:..\PcscBridge.exe /r:System.Web.Extensions.dll
for /r "%ROOT%" %%f in (*) do (
  set "F=%%f"
  set "REL=!F:%ROOT%=!"
  set "NAME=!REL:\=/!"
  >> "%RSP%" echo /resource:"..\web\!REL!",web/!NAME!
)
"%CSC%" @"%RSP%" PcscBridge.cs
set RC=%ERRORLEVEL%
popd

if %RC% neq 0 (
  echo Build failed.
  exit /b %RC%
)
echo Built %~dp0..\PcscBridge.exe
