'use strict';

// ── Public: called from inline onclick attributes in live.html ─────────────
async function addRule(verdict, domain, btn) {
  const row = btn?.closest('tr');

  try {
    const resp = await fetch('/api/rules/add', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ verdict, domain }),
    });

    const data = await resp.json();

    if (!resp.ok || data.error) {
      showToast(`Could not add rule: ${data.error || resp.statusText}`, 'error');
      return;
    }

    const list = verdict === 'block' ? 'blocklist' : 'allowlist';
    showToast(
      `Added ${domain} to ${list}. Restart blocker to apply.`,
      'success'
    );

    if (row) {
      row.classList.add('row-dimmed');
      row.querySelectorAll('button').forEach(b => (b.disabled = true));
    }
  } catch {
    showToast('Network error — dashboard server unreachable.', 'error');
  }
}

// ── Toast notification ─────────────────────────────────────────────────────
function showToast(message, type) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className   = `toast toast-${type || 'success'}`;
  toast.textContent = message;
  container.appendChild(toast);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
  });

  const DURATION = 4500;
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, DURATION);
}
