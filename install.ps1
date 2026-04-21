#Requires -RunAsAdministrator
<#
.SYNOPSIS
    First-time setup: install mitmproxy, generate the CA certificate, trust it system-wide.

.DESCRIPTION
    Run once as Administrator. Makes exactly two changes to your system:
      1. Installs the mitmproxy CA certificate into Cert:\LocalMachine\Root
      2. Creates the logs\ directory next to this script

    All other changes (proxy settings) are made only while start-blocker.bat is running.

.NOTES
    Requires Python 3.10+ on PATH. Run from a PowerShell prompt opened as Administrator.
#>

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Write-Step([string]$msg) {
    Write-Host "`n[*] $msg" -ForegroundColor Cyan
}

function Write-OK([string]$msg) {
    Write-Host "    OK  $msg" -ForegroundColor Green
}

function Write-Fail([string]$msg) {
    Write-Host "    ERR $msg" -ForegroundColor Red
}

# ── 1. Python ─────────────────────────────────────────────────────────────────
Write-Step "Checking Python..."
try {
    $pyVer = & python --version 2>&1
    Write-OK $pyVer
}
catch {
    Write-Fail "Python not found on PATH."
    Write-Host "    Install Python 3.10+ from https://python.org and check 'Add to PATH'." -ForegroundColor Yellow
    exit 1
}

# ── 2. Install / upgrade mitmproxy ───────────────────────────────────────────
Write-Step "Installing mitmproxy (this may take a minute)..."
try {
    & python -m pip install --upgrade "mitmproxy>=10" --quiet
    $mtVer = & mitmdump --version 2>&1 | Select-Object -First 1
    Write-OK $mtVer
}
catch {
    Write-Fail "pip install failed: $_"
    exit 1
}

# ── 3. Generate mitmproxy CA certificate ─────────────────────────────────────
Write-Step "Generating mitmproxy CA certificate..."

$certDir  = Join-Path $env:USERPROFILE ".mitmproxy"
$certFile = Join-Path $certDir "mitmproxy-ca-cert.cer"

if (-not (Test-Path $certFile)) {
    Write-Host "    Running mitmdump briefly to create cert..." -ForegroundColor DarkGray
    try {
        # Start mitmdump on a throwaway port; it creates the CA on first run then we kill it
        $proc = Start-Process `
            -FilePath "mitmdump" `
            -ArgumentList @("-p", "19999", "--quiet") `
            -PassThru `
            -WindowStyle Hidden
        Start-Sleep -Seconds 3
        if (-not $proc.HasExited) {
            $proc.Kill()
            $proc.WaitForExit(3000) | Out-Null
        }
    }
    catch {
        Write-Fail "Could not start mitmdump to generate cert: $_"
        exit 1
    }
}

if (-not (Test-Path $certFile)) {
    Write-Fail "CA cert not found at: $certFile"
    Write-Host "    Try running manually:  mitmdump -p 19999 --quiet" -ForegroundColor Yellow
    Write-Host "    Then re-run install.ps1." -ForegroundColor Yellow
    exit 1
}

Write-OK "CA cert at $certFile"

# ── 4. Import cert into Windows Trusted Root store ───────────────────────────
Write-Step "Importing CA cert into Cert:\LocalMachine\Root..."
try {
    $store = [System.Security.Cryptography.X509Certificates.X509Store]::new(
        [System.Security.Cryptography.X509Certificates.StoreName]::Root,
        [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine
    )
    $store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certFile)

    # Skip if already installed (match by thumbprint)
    $existing = $store.Certificates | Where-Object { $_.Thumbprint -eq $cert.Thumbprint }
    if ($existing) {
        Write-OK "Already installed: $($cert.Subject)"
    }
    else {
        $store.Add($cert)
        Write-OK "Installed: $($cert.Subject)"
    }
    $store.Close()
}
catch {
    Write-Fail "Cert import failed: $_"
    Write-Host "    Make sure this PowerShell prompt was opened as Administrator." -ForegroundColor Yellow
    exit 1
}

# ── 5. Create logs directory ─────────────────────────────────────────────────
Write-Step "Creating logs\ directory..."
$logsDir = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
Write-OK $logsDir

# ── Done ─────────────────────────────────────────────────────────────────────
Write-Host "`n[OK] Install complete. Run start-blocker.bat to begin a session.`n" -ForegroundColor Green
