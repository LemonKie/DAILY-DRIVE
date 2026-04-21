@echo off
setlocal

echo.
echo [*] Killing mitmdump (if running)...
taskkill /F /IM mitmdump.exe >nul 2>&1
if %errorlevel% equ 0 (
    echo     Stopped.
) else (
    echo     Not running.
)

echo [*] Disabling system proxy...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1
echo [*] Done. Proxy restored.
echo.
