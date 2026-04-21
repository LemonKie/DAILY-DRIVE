"""
mitmproxy addon: URL blocker with host and path-level rule matching.

Rule files (in rules/ next to this script):
    block.txt  — patterns to BLOCK; matching requests get HTTP 403
    allow.txt  — host patterns to pass through unconditionally (logged as ALLOWED)

Every request is appended to logs/YYYY-MM-DD.log:
    TIMESTAMP | STATUS    | host | path

STATUS values:
    ALLOWED   — host matched a pattern in allow.txt (request passes through)
    BLOCKED   — matched a rule in block.txt (request gets HTTP 403)
    UNMATCHED — no rule matched (request passes through; review these)

Rule syntax (one per line, # for comments):
    analytics.example.com          -> block/allow all paths on that exact host
    content.example.com/monsdk/    -> block paths starting with /monsdk/ only
    *.tracking.example.com         -> wildcard: matches any subdomain
"""

from __future__ import annotations

import datetime
from pathlib import Path
from typing import Optional

from mitmproxy import ctx, http

_ROOT = Path(__file__).parent
_RULES_DIR = _ROOT / "rules"
_LOGS_DIR = _ROOT / "logs"


def _load_rules(path: Path) -> list[str]:
    """Return non-empty, non-comment lines from a rule file."""
    if not path.exists():
        return []
    rules: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line and not line.startswith("#"):
            rules.append(line)
    return rules


def _host_matches(pattern: str, host: str) -> bool:
    """Match a hostname against an exact pattern or *.domain wildcard.

    *.example.com matches sub.example.com but NOT example.com itself.
    Use example.com explicitly to match the bare domain.
    """
    if pattern.startswith("*."):
        return host.endswith("." + pattern[2:])
    return host == pattern


def _block_rule_matches(rule: str, host: str, path: str) -> bool:
    """Return True if a block rule applies to this (host, path) pair.

    Rules without '/' match any path on the host.
    Rules with '/' match only when the path starts with the rule's path component,
    so 'content.overwolf.com/monsdk/' blocks /monsdk/loader.js but not /cdn/file.js.
    """
    if "/" in rule:
        rule_host, rule_path = rule.split("/", 1)
        return _host_matches(rule_host, host) and path.startswith("/" + rule_path)
    return _host_matches(rule, host)


class URLBlocker:
    """mitmproxy addon: classify requests as ALLOWED / BLOCKED / UNMATCHED."""

    def __init__(self) -> None:
        self._block_rules: list[str] = []
        self._allow_patterns: list[str] = []
        self._log_path: Optional[Path] = None

    def running(self) -> None:
        """Load rules and open today's log file once mitmproxy is ready."""
        self._block_rules = _load_rules(_RULES_DIR / "block.txt")
        self._allow_patterns = _load_rules(_RULES_DIR / "allow.txt")
        _LOGS_DIR.mkdir(exist_ok=True)
        self._log_path = _LOGS_DIR / f"{datetime.date.today().isoformat()}.log"
        ctx.log.info(
            f"[blocker] {len(self._block_rules)} block rules, "
            f"{len(self._allow_patterns)} allow patterns — "
            f"logging to {self._log_path.name}"
        )

    def request(self, flow: http.HTTPFlow) -> None:
        """Intercept each request, apply rules, log the outcome."""
        host: str = flow.request.pretty_host
        path: str = flow.request.path or "/"

        # 1. Allowlist — pass through, log as ALLOWED
        for pattern in self._allow_patterns:
            if _host_matches(pattern, host):
                self._log("ALLOWED  ", host, path)
                return

        # 2. Block rules — return 403, log as BLOCKED
        for rule in self._block_rules:
            if _block_rule_matches(rule, host, path):
                flow.response = http.Response.make(
                    403,
                    b"Blocked by daily-drive proxy.",
                    {"Content-Type": "text/plain"},
                )
                self._log("BLOCKED  ", host, path)
                return

        # 3. No match — pass through, log as UNMATCHED for later review
        self._log("UNMATCHED", host, path)

    def _log(self, status: str, host: str, path: str) -> None:
        """Append one line to today's log file."""
        if self._log_path is None:
            return
        ts = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        line = f"{ts} | {status} | {host} | {path}\n"
        with self._log_path.open("a", encoding="utf-8") as fh:
            fh.write(line)


addons = [URLBlocker()]
