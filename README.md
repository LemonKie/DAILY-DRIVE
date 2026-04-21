# Daily Drive Proxy

A local HTTPS proxy for analyzing and filtering network traffic from specific Windows
applications. Built for personal use to understand what a third-party app is sending
over the network.

**This is a traffic analysis tool for learning purposes — not a distribution tool.**

---

## What It Does

Runs [mitmproxy](https://mitmproxy.org/) as a local proxy on `127.0.0.1:8080`,
intercepts HTTPS traffic, and applies two plain-text rule files:

| File | Purpose |
|---|---|
| `rules/block.txt` | Patterns to BLOCK — returns HTTP 403 to the app |
| `rules/allow.txt` | Hosts to explicitly trust — logged as ALLOWED, never blocked |

Everything else passes through and is logged as **UNMATCHED** — the list to review after
a session when deciding what to add to each rule file.

Each request is written to `logs/YYYY-MM-DD.log`:

```
2026-04-21 08:30:15 | BLOCKED   | content.overwolf.com | /monsdk/loader.js
2026-04-21 08:30:16 | ALLOWED   | itero.align.com | /app/api/scan
2026-04-21 08:30:17 | UNMATCHED | fonts.googleapis.com | /css2?family=Inter
```

After a session, `tools\share-log.ps1` strips private domains (Spotify, Discord, etc.)
and produces a clean summary file ready to paste into an AI chat or review manually.

---

## Install

> **Requires admin — run once.** The installer adds the mitmproxy CA certificate to the
> Windows Trusted Root store so HTTPS can be decrypted and inspected.

1. Install **Python 3.10+** from [python.org](https://python.org) — check "Add to PATH"
2. Open an **Administrator** PowerShell window in this folder
3. Run:

```powershell
.\install.ps1
```

The script will:
- Install `mitmproxy` via pip
- Run mitmdump briefly to generate the CA certificate
- Import that certificate into `Cert:\LocalMachine\Root`
- Create the `logs\` directory

You only need to do this once per machine (or after mitmproxy updates that rotate the CA).

---

## Daily Use

### Before launching the app you want to analyze

```
start-blocker.bat
```

This enables the Windows system proxy (`127.0.0.1:8080`) and starts mitmproxy with the
blocker addon. All HTTP/HTTPS traffic from the system is now intercepted and logged.

### When done

Press `Ctrl+C` in the blocker window. The system proxy is restored automatically.

If the window was closed unexpectedly (crash, force-close), run:

```
stop-blocker.bat
```

This kills any leftover `mitmdump.exe` process and disables the proxy.

---

## Dashboard

A web dashboard is available at `dashboard/`. Run `start-dashboard.bat` after starting
the blocker to view live stats, manage rules from a browser UI, and export session
reports. See [`dashboard/README.md`](dashboard/README.md) for details.

---

## Iterating on Rules

The workflow after a session:

1. Run `tools\share-log.ps1` in PowerShell
2. Open `logs\shareable-YYYY-MM-DD.txt`
3. Review **UNMATCHED** — anything suspicious or noisy? Add it to `rules\block.txt` or
   `rules\allow.txt`
4. Review **BLOCKED** — anything that shouldn't have been blocked? Add it to
   `rules\allow.txt`, or narrow the block rule to a more specific path
5. Restart the blocker and repeat

Or paste the shareable file into Claude (or another AI assistant) and ask for help
interpreting what you're seeing.

### Rule format

**`rules/block.txt`** — one rule per line, `#` comments, blank lines ignored:

```
# Block all paths on this host
analytics.example.com

# Block only URLs whose path starts with /monsdk/
content.example.com/monsdk/

# Wildcard: block all subdomains
*.tracking.example.com
```

**`rules/allow.txt`** — same format, host patterns only (no path component):

```
# Exact host
itero.align.com

# All subdomains
*.itero.com
```

> `content.overwolf.com` and `www.overwolf.com` are intentionally **not** in
> `allow.txt`. URL-path blocking handles them: `/monsdk/` paths are blocked, everything
> else falls through as UNMATCHED.

---

## Troubleshooting

### Cert install fails

- `install.ps1` **must** be run as Administrator
- To verify the cert is installed: open `certmgr.msc` →
  *Trusted Root Certification Authorities* → *Certificates* → look for **mitmproxy**
- To reinstall: delete the mitmproxy entry in certmgr, then re-run `install.ps1`
- If the mitmdump cert-generation step hangs, kill it manually and check whether
  `%USERPROFILE%\.mitmproxy\mitmproxy-ca-cert.cer` exists — if so, re-run the script

### Proxy stuck on after crash

If the blocker window closes unexpectedly, the system proxy stays on and all traffic
fails (nothing is listening on 8080).

**Fix:** run `stop-blocker.bat` — it kills `mitmdump.exe` and disables the proxy.

**Manual fix:** Settings → Network & Internet → Proxy → toggle **Use a proxy server** off.

Or from an admin prompt:
```
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings" /v ProxyEnable /t REG_DWORD /d 0 /f
```

### App shows "ad blocker detected"

The app detected a 403 where it expected a normal response. Either:

- The block rule is **too broad** — narrow it to a specific path prefix
- The blocked host is actually required for the app to function — add it to
  `rules\allow.txt`

Check today's log or the BLOCKED section of the shareable output to see what was hit.

### App won't connect at all

1. Confirm `start-blocker.bat` is running and shows no errors
2. Confirm the CA cert is in the Trusted Root store (see above)
3. Check for port conflicts: `netstat -an | findstr 8080`
4. Some apps pin their own certificates (HSTS / cert pinning) and will never trust a
   proxy CA — there is no workaround for those

---

## Notes

- Modifies **Windows system proxy** (HKCU registry) while running. No other system
  changes are made during normal use.
- `install.ps1` requires admin once for the cert import. `start-blocker.bat` and
  `stop-blocker.bat` do not need admin.
- Log files can grow large during long sessions — they are gitignored.
- The `%USERPROFILE%\.mitmproxy\` folder (CA private key) is never committed.
