@echo off
setlocal

set "ROOT=%~dp0"

echo [*] Installing dashboard dependencies...
python -m pip install -r "%ROOT%dashboard\requirements.txt" --quiet

echo [*] Opening browser...
start "" http://localhost:5000

echo [*] Starting dashboard server (Ctrl+C to stop)
echo.
cd /d "%ROOT%dashboard"
python app.py
