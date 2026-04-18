// QA Companion Dashboard — app.js
// Polls qa-status.json every 2 seconds and updates the UI

const POLL_INTERVAL = 2000;
let previousStatus = null;

// ─── Utility ──────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

function timeAgo(isoStr) {
  if (!isoStr) return 'Never';
  const diff = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (diff < 5)   return 'just now';
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return new Date(isoStr).toLocaleTimeString();
}

function badgeClass(status) {
  switch ((status || '').toUpperCase()) {
    case 'PASS':    return 'badge-pass';
    case 'FAIL':    return 'badge-fail';
    case 'RUNNING': return 'badge-running';
    case 'SKIPPED': return 'badge-skip';
    default:        return 'badge-idle';
  }
}

function cardStatusClass(status) {
  switch ((status || '').toUpperCase()) {
    case 'PASS':    return 'status-pass';
    case 'FAIL':    return 'status-fail';
    case 'RUNNING': return 'status-running';
    default:        return '';
  }
}

function statusLabel(status) {
  switch ((status || '').toUpperCase()) {
    case 'PASS':    return '✅ PASS';
    case 'FAIL':    return '❌ FAIL';
    case 'RUNNING': return '⟳ RUNNING';
    case 'SKIPPED': return '⚠ SKIP';
    default:        return '— —';
  }
}

// ─── Overall Badge ─────────────────────────────────────────
function updateOverallBadge(data) {
  const badge = el('overall-badge');
  const status = data.overallStatus || 'IDLE';
  badge.className = `badge ${badgeClass(status)}`;
  badge.textContent = status === 'PASS' ? '✅ ALL PASSING'
                    : status === 'FAIL' ? '❌ ERRORS FOUND'
                    : status === 'RUNNING' ? '⟳ RUNNING'
                    : '● IDLE';
  el('last-run').textContent = data.lastRun ? `Last run: ${timeAgo(data.lastRun)}` : 'Waiting for first run...';

  // ─── Active Deploy Target Banner ───────────────────────────
  const envBanner = el('env-target-banner');
  if (envBanner) {
    const env    = data.activeEnv    || 'unknown';
    const branch = data.targetBranch || '?';
    const url    = data.targetFrontend || '—';
    const isProd = env === 'prod';
    envBanner.style.display = 'block';
    envBanner.className = isProd
      ? 'env-banner env-banner-prod'
      : 'env-banner env-banner-dev';
    envBanner.innerHTML = isProd
      ? `⚠️ <strong>PRODUCTION</strong> — branch: <code>${branch}</code> — <a href="${url}" target="_blank">${url}</a>`
      : `🛠 Testing <strong>DEV</strong> deploy — branch: <code>${branch}</code> — <a href="${url}" target="_blank">${url}</a>`;
  }
}

// ─── Changed File Banner ───────────────────────────────────
function updateChangedFile(data) {
  const banner = el('changed-file-banner');
  const txt    = el('changed-file-text');
  if (data.changedFile && data.changedFile !== 'null' && data.changedFile !== '') {
    banner.classList.remove('hidden');
    txt.textContent = data.changedFile;
  } else {
    banner.classList.add('hidden');
  }
}

// ─── Error List Builder ────────────────────────────────────
function buildErrorList(errors, containerId) {
  const container = el(containerId);
  container.innerHTML = '';
  if (!errors || errors.length === 0) return;

  // Show max 20 errors to avoid overflow
  const shown = errors.slice(0, 20);
  shown.forEach(err => {
    const item = document.createElement('div');
    item.className = `error-item ${err.severity === 'warning' ? 'warn-item' : ''}`;

    const loc  = err.file ? `${err.file}${err.line ? `:${err.line}` : ''}${err.column ? `:${err.column}` : ''}` : '';
    const rule = err.rule ? `[${err.rule}]` : '';

    item.innerHTML = `
      ${loc ? `<div class="error-location">${escHtml(loc)}</div>` : ''}
      <div class="error-message">${escHtml(err.message || '')}</div>
      ${rule ? `<div class="error-rule">${escHtml(rule)}</div>` : ''}
    `;
    container.appendChild(item);
  });

  if (errors.length > 20) {
    const more  = document.createElement('div');
    more.className = 'error-item';
    more.innerHTML = `<div class="error-rule">... and ${errors.length - 20} more</div>`;
    container.appendChild(more);
  }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Update ESLint Card ────────────────────────────────────
function updateESLint(check) {
  const card = el('card-eslint');
  card.className = `check-card ${cardStatusClass(check.status)}`;

  const badge = card.querySelector('.check-badge');
  badge.className = `check-badge badge ${badgeClass(check.status)}`;
  badge.textContent = statusLabel(check.status);

  el('eslint-errors').textContent   = check.errorCount   ?? '—';
  el('eslint-warnings').textContent = check.warningCount ?? '—';
  el('eslint-errors').className   = `metric-value ${check.errorCount   > 0 ? 'error-color' : 'pass-color'}`;
  el('eslint-warnings').className = `metric-value ${check.warningCount > 0 ? 'warn-color'  : 'muted-color'}`;

  buildErrorList(check.errors, 'eslint-error-list');
}

// ─── Update Ruff Card ──────────────────────────────────────
function updateRuff(check) {
  const card = el('card-ruff');
  card.className = `check-card ${cardStatusClass(check.status)}`;

  const badge = card.querySelector('.check-badge');
  badge.className = `check-badge badge ${badgeClass(check.status)}`;
  badge.textContent = statusLabel(check.status);

  el('ruff-errors').textContent = check.errorCount ?? '—';
  el('ruff-errors').className = `metric-value ${check.errorCount > 0 ? 'error-color' : 'pass-color'}`;

  buildErrorList(check.errors, 'ruff-error-list');
}

// ─── Update pytest Card ────────────────────────────────────
function updatePytest(check) {
  const card = el('card-pytest');
  card.className = `check-card ${cardStatusClass(check.status)}`;

  const badge = card.querySelector('.check-badge');
  badge.className = `check-badge badge ${badgeClass(check.status)}`;
  badge.textContent = statusLabel(check.status);

  el('pytest-passed').textContent = check.passed ?? '—';
  el('pytest-failed').textContent = check.failed ?? '—';
  el('pytest-passed').className = `metric-value ${check.passed > 0 ? 'pass-color' : 'muted-color'}`;
  el('pytest-failed').className = `metric-value ${check.failed > 0 ? 'error-color' : 'muted-color'}`;

  const outputEl = el('pytest-output');
  if (check.output && check.output.trim()) {
    outputEl.textContent = check.output.trim().slice(0, 2000);
    outputEl.style.display = 'block';
  } else if (check.status === 'SKIPPED') {
    outputEl.textContent = check.errors?.[0]?.message || 'Skipped';
    outputEl.style.display = 'block';
  } else {
    outputEl.style.display = 'none';
  }
}

// ─── Update History ────────────────────────────────────────
function updateHistory(history) {
  const list = el('history-list');
  if (!history || history.length === 0) {
    list.innerHTML = '<div class="history-empty">No runs yet — edit any file to trigger QA...</div>';
    return;
  }

  // Most recent first
  const items = [...history].reverse();
  list.innerHTML = '';
  items.forEach(item => {
    const div = document.createElement('div');
    div.className = 'history-item';
    const passClass = (item.overallStatus || '').toUpperCase() === 'PASS' ? 'pass' : 'fail';
    div.innerHTML = `
      <div class="history-dot ${passClass}"></div>
      <div class="history-time">${item.timestamp || ''}</div>
      <div class="history-file">${escHtml(item.changedFile || '(startup)')}</div>
      <div class="history-status ${passClass}">${(item.overallStatus || '').toUpperCase()}</div>
    `;
    list.appendChild(div);
  });
}

// ─── Main Render ───────────────────────────────────────────
function render(data) {
  updateOverallBadge(data);
  updateChangedFile(data);

  if (data.checks && data.checks.length > 0) {
    data.checks.forEach(check => {
      switch ((check.tool || '').toLowerCase()) {
        case 'eslint': updateESLint(check); break;
        case 'ruff':   updateRuff(check);   break;
        case 'pytest': updatePytest(check); break;
      }
    });
    // Remove skeleton class once we have real data
    document.querySelectorAll('.skeleton').forEach(c => c.classList.remove('skeleton'));
  }

  updateHistory(data.history);
}

// ─── Polling ───────────────────────────────────────────────
async function poll() {
  try {
    const res  = await fetch(`/qa-status.json?t=${Date.now()}`);
    if (!res.ok) return;
    const data = await res.json();

    // Only re-render if something changed
    const sig = JSON.stringify(data);
    if (sig !== previousStatus) {
      previousStatus = sig;
      render(data);
    }
  } catch (e) {
    // Silently fail — server might be starting
  }
}

// ─── Init ──────────────────────────────────────────────────
poll();
setInterval(poll, POLL_INTERVAL);
