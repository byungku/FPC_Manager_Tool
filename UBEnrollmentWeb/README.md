# FPC Manager Tool – Web Edition

## [▶ 지문등록 웹 실행하기 (클릭)](https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/)
▶ Run Fingerprint Enrollment Web App (Click)
https://byungku.github.io/FPC_Manager_Tool/UBEnrollmentWeb/web/

You must use the Google Chrome web browser.

If you are using this on a PC for the first time, please download and run the Bridge. You can use the reader on the web while the Bridge is running.

Windows: Download FPCBridge.exe

Mac: Download FPCBridge-mac.zip (Universal for Apple Silicon & Intel)

Clicking index.html in the file list above will only show the source code. Since GitHub does not render HTML directly, please use the Run link above.

This is the web version of the PC tool UBEnrollmentManager (WinForms) used for enrolling fingerprints onto a fingerprint card via a PC/SC reader.

How to Use
1. Using FPCBridge (Recommended)
The bridge contains the web interface built-in, so with just this single bridge file, the fingerprint enrollment page (http://localhost:8765/) will automatically open in your browser.

Windows

Connect the PC/SC reader to your PC.

Download and double-click FPCBridge.exe.

If the "Windows protected your PC" prompt appears, click More info → Run anyway. (This warning appears because the executable is unsigned.)

Do not close the black console window while in use. This window connects the reader to your browser.

When the bottom left of the screen shows Bridge: online, select the READER and click CONNECT.

Mac

Connect the PC/SC reader to your Mac.

Download and extract FPCBridge-mac.zip.

Right-click (or Control+click) FPCBridge.command inside the FPCBridge folder → Open → Open.

If it is blocked on macOS 15 or later, go to System Settings → Privacy & Security, click Open Anyway, and run it again.

This bypass is only required the first time; afterward, you can simply double-click to run it.

It will automatically choose the correct binary for your Apple Silicon or Intel Mac.

A Terminal window will open, and the fingerprint enrollment page will load in your browser. Do not close the Terminal window while in use.

The legacy PcscBridge.exe (Windows only) can still be used in the same manner. Since both bridges use the same port (8765), please run only one at a time.

ABOUT
You can also manually download and run the standalone PC fingerprint enrollment tool.

Download the PC tool from the following path: FPC_Manager_Tool / FPC_Manager_TOOL(PC).exe as shown below, and run it.
  
  <img width="929" height="307" alt="image" src="https://github.com/user-attachments/assets/5eef55bb-8923-455a-a2c8-b4969d066e7d" />


