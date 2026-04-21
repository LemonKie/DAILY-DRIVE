@echo off
setlocal

set "ROOT=%~dp0"
set "PORT=8080"
set "PROXY=127.0.0.1:%PORT%"

echo.
echo [*] Enabling system proxy: %PROXY%
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyServer /t REG_SZ  /d "%PROXY%" /f >nul 2>&1
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 1          /f >nul 2>&1

echo [*] Starting blocker on port %PORT% — press Ctrl+C to stop
echo.

mitmdump -p %PORT% -s "%ROOT%blocker.py" --quiet

echo.
echo [*] Disabling system proxy...
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f >nul 2>&1
echo [*] Done. Proxy restored.
echo.
