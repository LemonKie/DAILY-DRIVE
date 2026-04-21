<#
.SYNOPSIS
    Strip private domains and summarize a blocker session log for sharing.

.DESCRIPTION
    Reads a daily log file (logs\YYYY-MM-DD.log), removes entries for personal
    domains (Spotify, Discord, Claude, Google accounts), then aggregates the
    remaining traffic into top-20 tables by outcome.

    Output: logs\shareable-YYYY-MM-DD.txt

.PARAMETER LogFile
    Full path to a specific log file. Defaults to today's log in logs\.

.EXAMPLE
    .\tools\share-log.ps1
    .\tools\share-log.ps1 -LogFile "C:\path\to\logs\2026-04-20.log"
#>

param(
    [string]$LogFile = ""
)

$ErrorActionPreference = "Stop"

$root    = Split-Path $PSScriptRoot -Parent
$logsDir = Join-Path $root "logs"

# ── Resolve log file ──────────────────────────────────────────────────────────
if (-not $LogFile) {
    $today   = Get-Date -Format "yyyy-MM-dd"
    $LogFile = Join-Path $logsDir "$today.log"
}

if (-not (Test-Path $LogFile)) {
    Write-Error "Log file not found: $LogFile"
    exit 1
}

# ── Privacy patterns to strip ────────────────────────────────────────────────
# Hosts matching any of these regex patterns are excluded from the output.
$privacyPatterns = @(
    # Spotify
    '(^|\.)spotify\.com$',
    '^spclient\.wg\.spotify\.com$',
    '^apresolve\.spotify\.com$',
    '^audio-akp-\w+\.pscdn\.co$',
    # Discord
    '(^|\.)discord\.com$',
    '(^|\.)discord\.gg$',
    '(^|\.)discordapp\.com$',
    '(^|\.)discordapp\.net$',
    # Claude / Anthropic
    '^claude\.ai$',
    '(^|\.)anthropic\.com$',
    # Google accounts / auth (not all of googleapis — just auth endpoints)
    '^accounts\.google\.com$',
    '^oauth2\.googleapis\.com$',
    '^apis\.google\.com$'
)

function Test-IsPrivate([string]$host) {
    foreach ($pat in $privacyPatterns) {
        if ($host -match $pat) { return $true }
    }
    return $false
}

# ── Parse log ────────────────────────────────────────────────────────────────
# Line format:  YYYY-MM-DD HH:MM:SS | STATUS    | host | path
$blocked   = @{}
$allowed   = @{}
$unmatched = @{}
$stripped  = 0
$malformed = 0

foreach ($line in (Get-Content $LogFile -Encoding UTF8)) {
    if ($line -notmatch '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}') { continue }

    $parts = $line -split '\s*\|\s*', 4
    if ($parts.Count -lt 4) {
        $malformed++
        continue
    }

    $status = $parts[1].Trim()
    $host   = $parts[2].Trim()
    $path   = $parts[3].Trim()

    if (Test-IsPrivate $host) {
        $stripped++
        continue
    }

    # Group by host+path so counts reflect unique URLs, not raw call volume
    $key = "${host}${path}"

    switch -Wildcard ($status) {
        "BLOCKED*"   { $blocked[$key]   = ($blocked[$key]   ?? 0) + 1 }
        "ALLOWED*"   { $allowed[$key]   = ($allowed[$key]   ?? 0) + 1 }
        "UNMATCHED*" { $unmatched[$key] = ($unmatched[$key] ?? 0) + 1 }
    }
}

# ── Format a top-N table ──────────────────────────────────────────────────────
function Format-TopN {
    param(
        [hashtable]$table,
        [string]$label,
        [int]$n = 20
    )
    $lines = @("=== Top $n $label ===")
    $sorted = $table.GetEnumerator() |
              Sort-Object Value -Descending |
              Select-Object -First $n
    if (-not $sorted) {
        $lines += "  (none)"
    }
    else {
        foreach ($e in $sorted) {
            $lines += "  {0,6}x  {1}" -f $e.Value, $e.Key
        }
    }
    return $lines
}

# ── Assemble output ───────────────────────────────────────────────────────────
$dateStr = [System.IO.Path]::GetFileNameWithoutExtension($LogFile)
$outFile = Join-Path $logsDir "shareable-$dateStr.txt"

$totalKept = $blocked.Count + $allowed.Count + $unmatched.Count

$output = [System.Collections.Generic.List[string]]::new()
$output.Add("Daily Drive Proxy — Session Summary")
$output.Add("=" * 60)
$output.Add("Log date  : $dateStr")
$output.Add("Generated : $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$output.Add("Entries stripped (privacy domains) : $stripped")
if ($malformed -gt 0) {
    $output.Add("Malformed lines skipped            : $malformed")
}
$output.Add("Unique URL keys kept               : $totalKept")
$output.Add("  BLOCKED   : $($blocked.Count)")
$output.Add("  ALLOWED   : $($allowed.Count)")
$output.Add("  UNMATCHED : $($unmatched.Count)")
$output.Add("")
$output.AddRange([string[]](Format-TopN -table $blocked   -label "BLOCKED"  ))
$output.Add("")
$output.AddRange([string[]](Format-TopN -table $allowed   -label "ALLOWED"  ))
$output.Add("")
$output.AddRange([string[]](Format-TopN -table $unmatched -label "UNMATCHED"))

$output | Out-File -FilePath $outFile -Encoding UTF8
Write-Host "Saved: $outFile"
