'use strict';

// ── State ──────────────────────────────────────────────────────────────────
let _currentWindow  = '30m';
let _sse            = null;
let _hasData        = false;

// ── Boot ───────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initCharts();          // from charts.js
  _connectSSE();
  _setupWindowSelector();

  // Charts refresh independently of SSE (they're larger payloads)
  refreshTimeline(_currentWindow);
  refreshEffectiveness();
  setInterval(() => refreshTimeline(_currentWindow), 30_000);
  setInterval(refreshEffectiveness, 60_000);
});

// ── SSE connection ─────────────────────────────────────────────────────────
function _connectSSE() {
  _sse = new EventSource('/api/stream');

  _sse.onopen = () => {
    // Connected — dot will update once first message arrives
  };

  _sse.onmessage = (evt) => {
    let data;
    try { data = JSON.parse(evt.data); } catch { return; }
    if (data.error) { console.warn('[SSE]', data.error); return; }

    _setNavDot(data.blocker_running);
    _updateHeader(data);
    _updateStatCards(data);
    updateSparklines(data.sparklines);  // charts.js

    if (!_hasData && data.total > 0) {
      _hasData = true;
      document.getElementById('empty-state').setAttribute('hidden', '');
      document.getElementById('dash-content').removeAttribute('hidden');
    } else if (!_hasData && data.total === 0) {
      // Still no data — keep empty state but update its text
      document.getElementById('empty-state').querySelector('.empty-title').textContent =
        'No log data yet';
    }

    if (_hasData) {
      _renderTable('table-blocked',   data.top_blocked,   false);
      _renderTable('table-allowed',   data.top_allowed,   false);
      _renderTable('table-unmatched', data.top_unmatched, true);
    }
  };

  _sse.onerror = () => {
    _setNavDot(false);
  };
}

// ── Nav status dot ─────────────────────────────────────────────────────────
function _setNavDot(running) {
  const dot = document.getElementById('nav-dot');
  if (!dot) return;
  dot.className = 'status-dot ' + (running ? 'dot-green' : 'dot-red');
  dot.title     = running
    ? 'Blocker running on :8080'
    : 'Blocker not detected on :8080 — run start-blocker.bat';
}

// ── Header meta row ────────────────────────────────────────────────────────
function _updateHeader(data) {
  _setEl('session-start', data.session_start || '—');
  _setEl('last-update',   data.generated_at  || '—');
}

// ── Stat cards ─────────────────────────────────────────────────────────────
function _updateStatCards(data) {
  _setEl('stat-blocked',       _fmt(data.blocked));
  _setEl('stat-allowed',       _fmt(data.allowed));
  _setEl('stat-unmatched',     _fmt(data.unmatched));
  _setEl('stat-rate',          (data.block_rate ?? 0) + '%');

  _setEl('stat-blocked-sub',   `last hr: ${_fmt(data.last_hr_blocked)}`);
  _setEl('stat-allowed-sub',   `last hr: ${_fmt(data.last_hr_allowed)}`);
  _setEl('stat-unmatched-sub', `last hr: ${_fmt(data.last_hr_unmatched)}`);
  _setEl('stat-rate-sub',      data.total ? `of ${_fmt(data.total)} requests` : '');
}

// ── Table rendering ────────────────────────────────────────────────────────
function _renderTable(tableId, rows, showActions) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;

  if (!rows || !rows.length) {
    const cols = showActions ? 5 : 4;
    tbody.innerHTML = `<tr><td colspan="${cols}" class="empty-cell">No data</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => {
    const host     = _esc(r.host);
    const hostAttr = _escAttr(r.host);
    const actions  = showActions
      ? `<td class="col-actions">
           <button class="btn-rule" title="Block ${host}"
             onclick="addRule('block','${hostAttr}',this)">🚫</button>
           <button class="btn-rule" title="Allow ${host}"
             onclick="addRule('allow','${hostAttr}',this)">✅</button>
         </td>`
      : '<td></td>';

    return `<tr>
      <td class="mono" title="${host}">${host}</td>
      <td class="col-num mono">${_fmt(r.count)}</td>
      <td class="col-num secondary">${r.pct}%</td>
      <td class="col-time">${_esc(r.last_seen)}</td>
      ${actions}
    </tr>`;
  }).join('');
}

// ── Window selector ────────────────────────────────────────────────────────
function _setupWindowSelector() {
  document.querySelectorAll('[data-window]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('[data-window]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _currentWindow = btn.dataset.window;
      refreshTimeline(_currentWindow);
    });
  });
}

// ── Utilities ──────────────────────────────────────────────────────────────
function _setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function _fmt(n) {
  return Number(n ?? 0).toLocaleString();
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function _escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
