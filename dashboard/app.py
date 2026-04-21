"""
Flask dashboard for the daily-drive mitmproxy blocker.

Reads logs/YYYY-MM-DD.log (pipe-delimited, written by blocker.py) and exposes
a web UI + JSON API for live stats, history, rule editing, and report export.

Log line format:
    YYYY-MM-DD HH:MM:SS | STATUS    | host | /path

Run:
    python dashboard/app.py
"""

from __future__ import annotations

import json
import re
import socket
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Generator

from flask import Flask, Response, jsonify, render_template, request, stream_with_context

_ROOT = Path(__file__).parent.parent
_LOGS_DIR = _ROOT / "logs"
_RULES_DIR = _ROOT / "rules"

_DOMAIN_RE = re.compile(r"^[a-zA-Z0-9.\-_*]+$")

_PRIVACY_RE = [
    re.compile(p)
    for p in [
        r"(^|\.)spotify\.com$",
        r"^spclient\.wg\.spotify\.com$",
        r"(^|\.)discord\.com$",
        r"(^|\.)discordapp\.com$",
        r"^claude\.ai$",
        r"(^|\.)anthropic\.com$",
        r"^accounts\.google\.com$",
        r"^oauth2\.googleapis\.com$",
        r"^apis\.google\.com$",
    ]
]

# In-memory cache: path_str -> (mtime, entries)
_cache: dict[str, tuple[float, list[dict[str, str]]]] = {}

_WINDOW_CONFIGS: dict[str, dict[str, int]] = {
    "30m":   {"minutes": 30,   "bucket_secs": 10},
    "1h":    {"minutes": 60,   "bucket_secs": 30},
    "6h":    {"minutes": 360,  "bucket_secs": 300},
    "today": {"minutes": 1440, "bucket_secs": 900},
}


# ── Log parsing ───────────────────────────────────────────────────────────────

def _parse_log(path: Path) -> list[dict[str, str]]:
    """Stream-parse a pipe-delimited log file into entry dicts.

    Resilient to malformed lines; skips anything that doesn't have 4 fields.
    """
    entries: list[dict[str, str]] = []
    try:
        with path.open("r", encoding="utf-8", errors="replace") as fh:
            for raw in fh:
                parts = raw.split(" | ", 3)
                if len(parts) < 4:
                    continue
                ts, status, host, req_path = parts
                entries.append(
                    {
                        "ts": ts.strip(),
                        "verdict": status.strip(),
                        "host": host.strip(),
                        "path": req_path.rstrip("\n").strip(),
                    }
                )
    except FileNotFoundError:
        pass
    return entries


def _get_entries(log_path: Path) -> list[dict[str, str]]:
    """Return cached entries, re-parsing only when the file's mtime changes."""
    key = str(log_path)
    try:
        mtime = log_path.stat().st_mtime
    except FileNotFoundError:
        return []
    if key in _cache and _cache[key][0] == mtime:
        return _cache[key][1]
    entries = _parse_log(log_path)
    _cache[key] = (mtime, entries)
    return entries


def _log_for(for_date: date | None = None) -> Path:
    """Return the log file path for a given date (default: today)."""
    return _LOGS_DIR / f"{(for_date or date.today()).isoformat()}.log"


def _is_private(host: str) -> bool:
    return any(p.search(host) for p in _PRIVACY_RE)


def _rel_time(ts_str: str) -> str:
    """Convert 'YYYY-MM-DD HH:MM:SS' to a human-readable relative time string."""
    try:
        then = datetime.strptime(ts_str, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return ""
    delta = int((datetime.now() - then).total_seconds())
    if delta < 5:
        return "just now"
    if delta < 60:
        return f"{delta}s ago"
    if delta < 3600:
        return f"{delta // 60}m ago"
    return f"{delta // 3600}h ago"


# ── Stats computation ─────────────────────────────────────────────────────────

def _compute_stats(
    entries: list[dict[str, str]],
    privacy_filter: bool = False,
) -> dict[str, Any]:
    """Aggregate log entries into dashboard stats.

    Returns counters, top-20 tables, per-minute sparklines, and session metadata.
    """
    blocked: Counter[str] = Counter()
    allowed: Counter[str] = Counter()
    unmatched: Counter[str] = Counter()
    last_seen: dict[str, str] = {}

    now = datetime.now()
    cutoff_spark = now - timedelta(hours=1)

    spark_b: dict[int, int] = defaultdict(int)
    spark_a: dict[int, int] = defaultdict(int)
    spark_u: dict[int, int] = defaultdict(int)

    session_start = ""

    for e in entries:
        host = e["host"]
        if privacy_filter and _is_private(host):
            continue
        verdict = e["verdict"]
        ts = e["ts"]

        if not session_start:
            session_start = ts

        if verdict == "BLOCKED":
            blocked[host] += 1
        elif verdict == "ALLOWED":
            allowed[host] += 1
        else:
            unmatched[host] += 1
        last_seen[host] = ts

        try:
            then = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S")
            if then >= cutoff_spark:
                idx = min(int((then - cutoff_spark).total_seconds() // 60), 59)
                if verdict == "BLOCKED":
                    spark_b[idx] += 1
                elif verdict == "ALLOWED":
                    spark_a[idx] += 1
                else:
                    spark_u[idx] += 1
        except ValueError:
            pass

    total_b = sum(blocked.values())
    total_a = sum(allowed.values())
    total_u = sum(unmatched.values())
    total = total_b + total_a + total_u
    block_rate = round(100 * total_b / total, 1) if total else 0.0

    def top20(counter: Counter[str]) -> list[dict[str, Any]]:
        ct = sum(counter.values())
        return [
            {
                "host": h,
                "count": c,
                "pct": round(100 * c / ct, 1) if ct else 0.0,
                "last_seen": _rel_time(last_seen.get(h, "")),
            }
            for h, c in counter.most_common(20)
        ]

    b_spark = [spark_b.get(i, 0) for i in range(60)]
    a_spark = [spark_a.get(i, 0) for i in range(60)]
    u_spark = [spark_u.get(i, 0) for i in range(60)]
    br_spark = [
        round(100 * b_spark[i] / (b_spark[i] + a_spark[i] + u_spark[i]), 1)
        if (b_spark[i] + a_spark[i] + u_spark[i]) else 0.0
        for i in range(60)
    ]

    return {
        "blocked": total_b,
        "allowed": total_a,
        "unmatched": total_u,
        "block_rate": block_rate,
        "total": total,
        "top_blocked": top20(blocked),
        "top_allowed": top20(allowed),
        "top_unmatched": top20(unmatched),
        "sparklines": {
            "blocked": b_spark,
            "allowed": a_spark,
            "unmatched": u_spark,
            "block_rate": br_spark,
        },
        "last_hr_blocked": sum(b_spark),
        "last_hr_allowed": sum(a_spark),
        "last_hr_unmatched": sum(u_spark),
        "session_start": session_start,
        "generated_at": now.strftime("%Y-%m-%d %H:%M:%S"),
    }


def _compute_timeline(
    entries: list[dict[str, str]],
    window: str = "30m",
) -> dict[str, Any]:
    """Build time-series data for the traffic timeline chart."""
    cfg = _WINDOW_CONFIGS.get(window, _WINDOW_CONFIGS["30m"])
    minutes = cfg["minutes"]
    bucket_secs = cfg["bucket_secs"]

    now = datetime.now()
    cutoff = now - timedelta(minutes=minutes)
    total_buckets = (minutes * 60) // bucket_secs

    buckets: dict[int, dict[str, int]] = defaultdict(
        lambda: {"BLOCKED": 0, "ALLOWED": 0, "UNMATCHED": 0}
    )

    for e in entries:
        try:
            ts = datetime.strptime(e["ts"], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        if ts < cutoff:
            continue
        idx = int((ts - cutoff).total_seconds() // bucket_secs)
        if 0 <= idx < total_buckets:
            v = e["verdict"]
            if v in buckets[idx]:
                buckets[idx][v] += 1

    fmt = "%H:%M:%S" if bucket_secs < 300 else "%H:%M"
    labels, b_data, a_data, u_data = [], [], [], []
    for i in range(total_buckets):
        t = cutoff + timedelta(seconds=i * bucket_secs)
        labels.append(t.strftime(fmt))
        bkt = buckets.get(i, {})
        b_data.append(bkt.get("BLOCKED", 0))
        a_data.append(bkt.get("ALLOWED", 0))
        u_data.append(bkt.get("UNMATCHED", 0))

    return {"labels": labels, "blocked": b_data, "allowed": a_data, "unmatched": u_data}


def _compute_effectiveness(entries: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Compute block rate per minute for the last 60 minutes."""
    now = datetime.now()
    cutoff = now - timedelta(hours=1)
    minute_buckets: dict[int, dict[str, int]] = defaultdict(
        lambda: {"BLOCKED": 0, "TOTAL": 0}
    )

    for e in entries:
        try:
            ts = datetime.strptime(e["ts"], "%Y-%m-%d %H:%M:%S")
        except ValueError:
            continue
        if ts < cutoff:
            continue
        idx = int((ts - cutoff).total_seconds() // 60)
        if 0 <= idx < 60:
            minute_buckets[idx]["TOTAL"] += 1
            if e["verdict"] == "BLOCKED":
                minute_buckets[idx]["BLOCKED"] += 1

    bars = []
    for i in range(60):
        t = cutoff + timedelta(minutes=i)
        bkt = minute_buckets.get(i, {})
        total = bkt.get("TOTAL", 0)
        blocked = bkt.get("BLOCKED", 0)
        bars.append(
            {
                "label": t.strftime("%H:%M"),
                "rate": round(100 * blocked / total, 1) if total else 0.0,
                "total": total,
            }
        )
    return bars


def _check_blocker() -> bool:
    """Return True if mitmproxy is listening on 127.0.0.1:8080."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.1)
        return s.connect_ex(("127.0.0.1", 8080)) == 0


# ── Flask app ─────────────────────────────────────────────────────────────────

app = Flask(__name__, template_folder="templates", static_folder="static")


@app.route("/")
def live() -> str:
    return render_template("live.html", page="live")


@app.route("/history")
def history() -> str:
    return render_template("history.html", page="history")


@app.route("/report")
def report() -> str:
    return render_template("report.html", page="report", today=date.today().isoformat())


# ── API ───────────────────────────────────────────────────────────────────────

@app.route("/api/status")
def api_status() -> Response:
    return jsonify(
        {"blocker_running": _check_blocker(), "now": datetime.now().isoformat(timespec="seconds")}
    )


@app.route("/api/dates")
def api_dates() -> Response:
    dates = sorted(
        [p.stem for p in _LOGS_DIR.glob("*.log") if p.stem != ".gitkeep"],
        reverse=True,
    )
    return jsonify(dates)


@app.route("/api/stats")
def api_stats() -> Response:
    date_str = request.args.get("date", date.today().isoformat())
    try:
        for_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "invalid date"}), 400
    entries = _get_entries(_log_for(for_date))
    return jsonify(_compute_stats(entries))


@app.route("/api/timeline")
def api_timeline() -> Response:
    date_str = request.args.get("date", date.today().isoformat())
    window = request.args.get("window", "30m")
    if window not in _WINDOW_CONFIGS:
        return jsonify({"error": "invalid window"}), 400
    try:
        for_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "invalid date"}), 400
    entries = _get_entries(_log_for(for_date))
    return jsonify(_compute_timeline(entries, window))


@app.route("/api/effectiveness")
def api_effectiveness() -> Response:
    date_str = request.args.get("date", date.today().isoformat())
    try:
        for_date = date.fromisoformat(date_str)
    except ValueError:
        return jsonify({"error": "invalid date"}), 400
    entries = _get_entries(_log_for(for_date))
    return jsonify(_compute_effectiveness(entries))


@app.route("/api/stream")
def api_stream() -> Response:
    """SSE endpoint — pushes a full stats snapshot every 2 seconds."""

    def generate() -> Generator[str, None, None]:
        try:
            while True:
                entries = _get_entries(_log_for())
                payload = _compute_stats(entries)
                payload["blocker_running"] = _check_blocker()
                yield f"data: {json.dumps(payload)}\n\n"
                time.sleep(2)
        except GeneratorExit:
            pass

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@app.route("/api/rules/add", methods=["POST"])
def api_rules_add() -> Response:
    """Append a domain to block.txt or allow.txt with a timestamp comment."""
    data = request.get_json(force=True, silent=True) or {}
    domain = str(data.get("domain", "")).strip()
    verdict = str(data.get("verdict", "")).strip().lower()

    if not domain or not _DOMAIN_RE.match(domain):
        return jsonify({"error": "invalid domain"}), 400
    if verdict not in ("block", "allow"):
        return jsonify({"error": 'verdict must be "block" or "allow"'}), 400

    target = _RULES_DIR / ("block.txt" if verdict == "block" else "allow.txt")
    ts = datetime.now().strftime("%Y-%m-%d %H:%M")
    with target.open("a", encoding="utf-8") as fh:
        fh.write(f"\n# added from dashboard {ts}\n{domain}\n")

    return jsonify({"ok": True, "domain": domain, "verdict": verdict})


@app.route("/api/export", methods=["POST"])
def api_export() -> Response:
    """Generate and return a self-contained static HTML report as a download."""
    entries = _get_entries(_log_for())
    stats = _compute_stats(entries, privacy_filter=True)
    timeline = _compute_timeline(entries, "today")
    effectiveness = _compute_effectiveness(entries)

    html = render_template(
        "report_export.html",
        stats_json=json.dumps(stats),
        timeline_json=json.dumps(timeline),
        effectiveness_json=json.dumps(effectiveness),
        report_date=date.today().isoformat(),
        generated_at=datetime.now().strftime("%Y-%m-%d %H:%M"),
    )
    filename = f"report-{date.today().isoformat()}.html"
    return Response(
        html,
        mimetype="text/html",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, threaded=True, debug=False)
