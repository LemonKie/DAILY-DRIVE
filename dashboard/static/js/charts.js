'use strict';

// ── Color constants ────────────────────────────────────────────────────────
const C = {
  green:   '#22c55e',
  blue:    '#3b82f6',
  amber:   '#eab308',
  violet:  '#7c5cff',
  red:     '#ef4444',
  border:  '#26262e',
  surface: '#15151c',
  secondary:'#8b8b94',
};

const MONO = "'JetBrains Mono', ui-monospace, monospace";

// ── Chart instances ────────────────────────────────────────────────────────
let _timelineChart      = null;
let _effectivenessChart = null;
const _sparklines       = {};

// ── Public: init all charts on the live page ───────────────────────────────
function initCharts() {
  Chart.defaults.color       = C.secondary;
  Chart.defaults.borderColor = C.border;
  Chart.defaults.font.family = MONO;

  _sparklines.blocked   = _mkSparkline('spark-blocked',   C.green);
  _sparklines.allowed   = _mkSparkline('spark-allowed',   C.blue);
  _sparklines.unmatched = _mkSparkline('spark-unmatched', C.amber);
  _sparklines.rate      = _mkSparkline('spark-rate',      C.violet);

  _timelineChart      = _mkTimelineChart('chart-timeline');
  _effectivenessChart = _mkEffectivenessChart('chart-effectiveness');
}

// ── Public: factory for history page (returns the chart instance) ──────────
function initTimelineChart(canvasId) {
  return _mkTimelineChart(canvasId || 'chart-timeline');
}

// ── Public: update sparklines from SSE payload ─────────────────────────────
function updateSparklines(sparklines) {
  if (!sparklines) return;
  const map = {
    blocked:    _sparklines.blocked,
    allowed:    _sparklines.allowed,
    unmatched:  _sparklines.unmatched,
    block_rate: _sparklines.rate,
  };
  for (const [key, chart] of Object.entries(map)) {
    if (chart && sparklines[key]) {
      chart.data.datasets[0].data = sparklines[key];
      chart.update('none');
    }
  }
}

// ── Public: fetch and redraw the timeline ──────────────────────────────────
async function refreshTimeline(win, forDate) {
  const params = new URLSearchParams({ window: win || '30m' });
  if (forDate) params.set('date', forDate);
  try {
    const data = await fetch(`/api/timeline?${params}`).then(r => r.json());
    _applyTimeline(_timelineChart, data);
  } catch (err) {
    console.error('Timeline fetch failed:', err);
  }
}

// ── Public: fetch and redraw the effectiveness gauge ──────────────────────
async function refreshEffectiveness(forDate) {
  const params = forDate ? `?date=${forDate}` : '';
  try {
    const bars = await fetch(`/api/effectiveness${params}`).then(r => r.json());
    _applyEffectiveness(_effectivenessChart, bars);
    _updateEffectivenessInfo(bars);
  } catch (err) {
    console.error('Effectiveness fetch failed:', err);
  }
}

// ── Private helpers ────────────────────────────────────────────────────────
function _mkSparkline(id, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return null;
  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: Array(60).fill(''),
      datasets: [{
        data: Array(60).fill(0),
        borderColor: color,
        backgroundColor: color + '33',
        fill: true,
        borderWidth: 1.5,
        tension: 0.4,
        pointRadius: 0,
      }],
    },
    options: {
      responsive: false,
      animation: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: { x: { display: false }, y: { display: false, beginAtZero: true } },
    },
  });
}

function _mkTimelineChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const ds = (label, color) => ({
    label,
    data: [],
    borderColor: color,
    backgroundColor: color + '4d',
    fill: true,
    tension: 0.4,
    borderWidth: 2,
    pointRadius: 0,
    pointHoverRadius: 4,
  });

  return new Chart(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        ds('Blocked',   C.green),
        ds('Allowed',   C.blue),
        ds('Unmatched', C.amber),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 16,
            font: { family: MONO, size: 11 },
          },
        },
        tooltip: {
          backgroundColor: C.surface,
          borderColor: C.border,
          borderWidth: 1,
          titleFont: { family: MONO, size: 11 },
          bodyFont:  { family: MONO, size: 11 },
        },
      },
      scales: {
        x: {
          grid: { color: C.border },
          ticks: { maxTicksLimit: 8, font: { family: MONO, size: 10 } },
        },
        y: {
          grid: { color: C.border },
          ticks: { font: { family: MONO, size: 10 } },
          beginAtZero: true,
        },
      },
    },
  });
}

function _applyTimeline(chart, data) {
  if (!chart) return;
  chart.data.labels           = data.labels   || [];
  chart.data.datasets[0].data = data.blocked  || [];
  chart.data.datasets[1].data = data.allowed  || [];
  chart.data.datasets[2].data = data.unmatched|| [];
  chart.update('none');
}

function _mkEffectivenessChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  return new Chart(canvas, {
    type: 'bar',
    data: {
      labels: [],
      datasets: [{
        data: [],
        backgroundColor: [],
        borderRadius: 2,
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 200 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: C.surface,
          borderColor: C.border,
          borderWidth: 1,
          callbacks: { label: ctx => ` ${Number(ctx.raw).toFixed(1)}% block rate` },
          titleFont: { family: MONO, size: 11 },
          bodyFont:  { family: MONO, size: 11 },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 6, font: { size: 10, family: MONO } },
        },
        y: {
          min: 0, max: 100,
          grid: { color: C.border },
          ticks: { callback: v => v + '%', font: { size: 10, family: MONO } },
        },
      },
    },
  });
}

function _applyEffectiveness(chart, bars) {
  if (!chart || !bars) return;
  const colors = bars.map(b =>
    b.rate >= 80 ? C.green + '99' :
    b.rate >= 60 ? C.amber + '99' :
    b.total >  0 ? C.red   + '99' :
                   C.border
  );
  chart.data.labels                       = bars.map(b => b.label);
  chart.data.datasets[0].data             = bars.map(b => b.rate);
  chart.data.datasets[0].backgroundColor  = colors;
  chart.update('none');
}

function _updateEffectivenessInfo(bars) {
  const el = document.getElementById('effectiveness-info');
  if (!el || !bars) return;
  const total   = bars.reduce((s, b) => s + b.total, 0);
  const blocked = bars.reduce((s, b) => s + Math.round((b.rate / 100) * b.total), 0);
  el.textContent = total
    ? `${blocked.toLocaleString()} blocked of ${total.toLocaleString()} requests`
    : '';
}
