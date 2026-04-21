# iTero Blocker — Dashboard

A local web dashboard for the mitmproxy-based ad blocker. Visualises live traffic,
lets you manage rules without touching text files, and exports polished session reports
for portfolio documentation.

> **Screenshot placeholder** — run a session, then add a screenshot here.

---

## Quick start

Start the blocker first (`start-blocker.bat`), then in a second terminal:

```
start-dashboard.bat
```

The browser opens automatically at [http://localhost:5000](http://localhost:5000).

Or manually:

```
cd dashboard
pip install -r requirements.txt
python app.py
```

---

## Pages

### `/` — Live Dashboard

The primary view. Updates every 2 seconds via Server-Sent Events.

- **Status dot** (top-left): green = mitmproxy detected on `:8080`, red = not running
- **Stat cards**: Blocked / Allowed / Unmatched totals for today, plus last-hour counts
  and a 60-minute sparkline on each card
- **Block effectiveness**: bar chart, one bar per minute for the last hour. Green ≥ 80%,
  amber 60–80%, red < 60%
- **Traffic timeline**: Blocked / Allowed / Unmatched line chart. Use the window selector
  (30m / 1h / 6h / Today) to zoom out
- **Top-20 tables**: one table per verdict. The Unmatched table has 🚫 / ✅ buttons for
  adding rules without restarting anything

### `/history` — Past sessions

Browse any previous session log. Click a date in the sidebar to load that day's data.
No live updates; no rule editor (historical data is read-only).

### `/report` — Export static HTML

Generates a self-contained `report-YYYY-MM-DD.html` file suitable for portfolio
documentation or sharing. Privacy domains (Spotify, Discord, Claude, Google accounts)
are automatically stripped.

The downloaded file has no server dependency — open it in any browser, offline.

---

## Rule editor

Each row in the **Top Unmatched** table has two buttons:

| Button | Action |
|--------|--------|
| 🚫 Block | Appends the domain to `rules/block.txt` |
| ✅ Allow  | Appends the domain to `rules/allow.txt` |

After clicking, a toast appears confirming the action. **The blocker does not hot-reload
rules** — press `Ctrl+C` in the blocker window and re-run `start-blocker.bat` to apply.

---

## Static report export

Use case: you've run a session, want to document what Overwolf was phoning home to, and
need to include it in a blog post, writeup, or LinkedIn post.

1. Open `/report` in the dashboard
2. Click **Download report-YYYY-MM-DD.html**
3. Open the downloaded file — it's fully self-contained (Chart.js loaded from CDN)
4. Screenshot or embed directly

The export includes stats, charts, and top-20 tables, with privacy domains stripped.

---

## Troubleshooting

### Port 5000 already in use

Another process (e.g., AirPlay on macOS, another Flask app) is using 5000. Edit
`dashboard/app.py` — change the port in the last line:

```python
app.run(host='127.0.0.1', port=5001, ...)
```

And update `start-dashboard.bat` accordingly.

### Blocker shows as "not detected" (red dot)

- Make sure `start-blocker.bat` is running in a separate window
- mitmproxy listens on `:8080` — the dashboard checks that port via TCP
- If mitmproxy is on a different port, the dot will always be red (cosmetic only —
  the dashboard still works)

### Empty data / "No log data yet"

- The dashboard reads `logs/YYYY-MM-DD.log` for today's date
- If the blocker hasn't made any connections yet, the file may not exist or be empty
- Launch iTero (or whichever app you're analysing) and navigate around — entries
  should appear within a few seconds

### Rules not taking effect after adding from dashboard

The blocker reads `rules/block.txt` and `rules/allow.txt` once at startup.
After editing rules (via dashboard buttons or manually), restart the blocker:

```
Ctrl+C  →  start-blocker.bat
```
