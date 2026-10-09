/**
 * Wind bench: how results are shown. Pure string building, shared by the page and the Node runner.
 */

const { POSITIVE_CONTROL } = require('./matrix');

const configKey = (c) => `${c.view}/${c.theme}/${c.variant}`;
const pad = (s, n) => String(s).padStart(n);
const padR = (s, n) => String(s).padEnd(n);
const fmt = (x, dp) => (x == null || Number.isNaN(x) ? '-' : Number(x).toFixed(dp));

function variantsOf(results) {
  return [...new Set(results.map((r) => r.variant))];
}

const CELL_W = 34;
const cell = (r) => (r
  ? `${pad(fmt(r.ink, 0), 4)} ${pad(fmt(r.saturated, 3), 6)} ${pad(fmt(r.stormSlow, 2), 5)} ${pad(r.artifacts ? `${r.artifacts}/${r.artifactBlocks}` : '0', 5)} ${pad(fmt(r.msPerFrame, 1), 5)}`
  : pad('(not run)', 29));

/** One row per view x theme, one column group per variant. */
function formatTable(results, control) {
  const variants = variantsOf(results);
  const rows = [];
  const seen = new Set();
  results.forEach((r) => {
    const k = `${r.view}/${r.theme}`;
    if (!seen.has(k)) { seen.add(k); rows.push([r.view, r.theme]); }
  });
  const find = (view, theme, variant) => results.find((r) => r.view === view && r.theme === theme && r.variant === variant);
  const lines = [];
  lines.push(`${padR('view', 11)} ${padR('theme', 6)}` + variants.map((v) => ` | ${padR(v, CELL_W - 3)}`).join(''));
  lines.push(`${padR('', 18)}` + variants.map(() => ` | ${padR(' ink    sat st/sl   art    ms', CELL_W - 3)}`).join(''));
  lines.push('-'.repeat(18 + variants.length * CELL_W));
  rows.forEach(([view, theme]) => {
    lines.push(`${padR(view, 11)} ${padR(theme, 6)}` + variants.map((v) => ` | ${cell(find(view, theme, v))}`).join(''));
  });
  lines.push('');
  lines.push(...summaryLines(results, control));
  return lines.join('\n');
}

function summaryLines(results, control) {
  const out = [];
  variantsOf(results).forEach((v) => {
    const rs = results.filter((r) => r.variant === v);
    const flagged = rs.filter((r) => r.artifacts > 0);
    const ms = rs.map((r) => r.msPerFrame).filter((x) => x != null);
    const ink = rs.map((r) => r.ink).filter((x) => x != null);
    out.push(`${padR(v, 10)} artifacts ${pad(rs.reduce((a, r) => a + r.artifacts, 0), 3)} in ${flagged.length}/${rs.length} views`
      + ` · ink ${fmt(Math.min(...ink), 0)}-${fmt(Math.max(...ink), 0)}`
      + ` · ${fmt(Math.min(...ms), 1)}-${fmt(Math.max(...ms), 1)} ms/frame`);
  });
  out.push('columns: ink = mean trail max-RGB (0-255) · sat = share of pixels > 200 · st/sl = lit-pixel brightness, fastest over slowest non-calm 5-kn band on screen'
    + ' · art = significant non-calm clusters/blocks · ms = rAF interval');
  identicalVariantPairs(results).forEach(([a, b]) => out.push(
    `⚠ ${a} and ${b} rendered IDENTICALLY in every view: this engine reads none of the levers that tell them apart.`));
  if (control) out.push('', formatControl(control));
  return out;
}

/**
 * Variant pairs whose renders matched in every shared view. Runs are seeded per view and use a
 * virtual clock, so a lever the engine actually reads changes the numbers, and an ignored one
 * cannot (e.g. #281's kill switches on a tree from before #281).
 */
function identicalVariantPairs(results) {
  const variants = variantsOf(results);
  const sig = (r) => [r.ink, r.saturated, r.stormSlow, r.artifactBlocks, r.clusters].join('|');
  const pairs = [];
  variants.forEach((a, i) => variants.slice(i + 1).forEach((b) => {
    const shared = results.filter((r) => r.variant === a)
      .map((ra) => [ra, results.find((rb) => rb.variant === b && rb.view === ra.view && rb.theme === ra.theme)])
      .filter(([, rb]) => rb);
    if (shared.length && shared.every(([ra, rb]) => sig(ra) === sig(rb))) pairs.push([a, b]);
  }));
  return pairs;
}

const hitText = (h) => (h ? `${h.kind} ${h.blocks} blocks @ ${h.kn} kn (residual ${h.res})` : null);

function formatControl(control, def = POSITIVE_CONTROL) {
  const want = def.expect.map((e) => `${e.kind} ~${e.kn}±${def.tolKn} kn`).join(' + ');
  const blind = control.blindHits.map(hitText).filter(Boolean);
  const fixed = control.fixedHits.map(hitText).filter(Boolean);
  const head = `POSITIVE CONTROL (${def.theme} ${def.view}, expects ${want}): ${control.status}`;
  if (control.status === 'BLIND') {
    return `${head}\n  ${def.blindVariant} shows ${blind.length ? blind.join('; ') : 'none of it'}: the scanner cannot see the known defect, so this run proves nothing.`;
  }
  return `${head}\n  ${def.blindVariant} (must fail): ${blind.join('; ')}\n  ${def.fixedVariant} (must pass): ${fixed.length ? fixed.join('; ') : 'none of it'}`;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** A static contact sheet (no scripts): opens from disk or any static server. */
function contactSheetHtml(results, control, meta = {}) {
  const variants = variantsOf(results);
  const groups = new Map();
  results.forEach((r) => {
    const k = `${r.view} · ${r.theme}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });
  const figure = (r) => {
    const art = r.significant.filter((c) => !c.calm).map((c) => `${c.kind} ${c.blocks}@${c.kn}kn`).join(', ');
    const text = `${r.variant} · ink ${r.ink} · sat ${r.saturated} · storm/slow ${r.stormSlow ?? '-'} · artifacts ${r.artifacts}${art ? ` (${art})` : ''} · ${r.msPerFrame} ms`;
    return `<figure${r.artifacts ? ' class="flagged"' : ''}><img src="${r.shot}" alt="${esc(`${r.view} ${r.theme} ${text}`)}"><figcaption>${esc(text)}</figcaption></figure>`;
  };
  const rows = [...groups.entries()].map(([k, rs]) => `<section><h2>${esc(k)}</h2><div class="row">${
    variants.map((v) => rs.find((r) => r.variant === v)).filter(Boolean).map(figure).join('')}</div></section>`).join('\n');
  const metaLine = Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(' · ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wind bench contact sheet</title>
<style>
:root{--bg:#111317;--fg:#dde1e6;--muted:#9aa3ad;--line:#2a2f36;--flag:#ffb347}
@media (prefers-color-scheme:light){:root{--bg:#f6f7f9;--fg:#1d232a;--muted:#56606b;--line:#d5d9de;--flag:#a14a00}}
body{margin:0;background:var(--bg);color:var(--fg);font:13px/1.4 system-ui,sans-serif}
header{padding:12px 16px;border-bottom:1px solid var(--line)} h1{font-size:15px;margin:0 0 4px} .meta{color:var(--muted);margin:0}
pre{margin:0;padding:12px 16px;overflow-x:auto;font:12px/1.35 ui-monospace,Consolas,monospace}
section{padding:4px 16px} h2{font-size:12px;margin:8px 0 4px;color:var(--muted)} .row{display:flex;flex-wrap:wrap;gap:6px}
figure{margin:0;width:300px;border:2px solid transparent} figure.flagged{border-color:var(--flag)} figure img{width:300px;display:block}
figcaption{font-size:11px;line-height:1.25;color:var(--muted)}
</style></head><body>
<header><h1>Wind bench contact sheet</h1><p class="meta">${esc(metaLine)}</p></header>
<pre>${esc(formatTable(results, control))}</pre>
${rows}
</body></html>
`;
}

module.exports = { configKey, formatTable, formatControl, identicalVariantPairs, contactSheetHtml };
