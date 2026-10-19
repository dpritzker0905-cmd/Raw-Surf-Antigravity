// Visual lab report: one self-contained HTML page (thumbnails inline). Read it beside the owner's own check of the map.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ms = (v) => (v == null ? '<span class="bad">never</span>' : v === 'n/a' ? '<span class="dim">n/a</span>' : `${v} ms`);
const verdict = (s) => {
  const bad = s.stale === 'STALE' || s.marineMs === null || s.windMs === null || s.marineSilent > 6 || s.windOffFrames > 30;
  return bad ? '<span class="pill bad">look</span>' : '<span class="pill ok">ok</span>';
};

function render(results) {
  const flows = results.flows.map((f) => {
    const rows = f.steps.map((s) => `
      <tr>
        <td>${verdict(s)}</td><td><b>${esc(s.label)}</b><br><span class="dim">${esc(s.expect.model)} ${esc(s.expect.layer)} +${esc(s.expect.hour)} h${s.expect.wind ? ' · wind' : ''}</span></td>
        <td>${ms(s.marineMs)}</td><td>${ms(s.windMs)}</td>
        <td>${s.marineSilent} <span class="dim">silent</span><br>${s.marineAdmitted} <span class="dim">labelled</span><br>${s.marineSameInstant || 0} <span class="dim">same instant</span>${s.windOffFrames ? `<br>${s.windOffFrames} <span class="dim">wind off</span>` : ''}</td>
        <td>${s.stale === 'STALE' ? '<span class="bad">STALE</span>' : 'ok'}<br><span class="dim">prev ${s.pixels.toPrev} · now ${s.pixels.toNow} · moved ${s.pixels.moved} · noise ${s.pixels.noise}</span></td>
        <td class="dim">${Object.entries(s.console).filter(([, v]) => v).map(([k, v]) => `${esc(k)} ${v}`).join('<br>') || '—'}</td>
        <td class="dim">${s.requests.n} req (${s.requests.series} series, ${s.requests.grid} grid, ${s.requests.wind} wind)${s.requests.dupes ? `<br><span class="bad">${s.requests.dupes} duplicate</span>` : ''}${s.requests.failed ? `<br><span class="bad">${s.requests.failed} failed</span>` : ''}</td>
        <td class="dim">gap ${s.pacing.maxGap} ms · LT ${s.pacing.ltMax} ms</td>
        <td><div class="shots"><figure><img alt="150 ms after the input" src="data:image/jpeg;base64,${s.shots.immediate}"><figcaption>150 ms</figcaption></figure>
          <figure><img alt="settled" src="data:image/jpeg;base64,${s.shots.settled}"><figcaption>settled</figcaption></figure></div>
          <div class="dim small">drawn: ${esc(s.end.mModel)} ${esc(s.end.mLayer)} +${esc(s.end.mHour)} h${s.end.wHour != null ? ` · wind +${esc(s.end.wHour)} h` : ''}<br>${esc(s.end.status) || 'no status line'}</div></td>
      </tr>`).join('');
    return `<section><h2>${esc(f.name)}</h2><p class="dim small">pressed after setup: ${esc((f.setupPressed || []).join(', '))}</p>${f.error ? `<p class="bad">Flow failed: ${esc(f.error)}</p>` : ''}
      <div class="scroll"><table><thead><tr><th></th><th>Step</th><th>Marine correct</th><th>Wind correct</th><th>Mismatch frames</th><th>Stale picture</th><th>Console</th><th>Network</th><th>Pacing</th><th>Screen</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
  }).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Visual lab</title>
<style>
:root{--bg:#f7f8fa;--fg:#1b1f24;--dim:#5c6670;--card:#fff;--line:#dfe3e8;--ok:#1a7f37;--bad:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--fg:#e6e9ee;--dim:#9aa4ae;--card:#171b21;--line:#2a3038;--ok:#4ac26b;--bad:#ff7b72}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;padding:16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:24px 0 8px}.dim{color:var(--dim)}.small{font-size:12px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:8px}
table{border-collapse:collapse;min-width:1100px;width:100%}th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
th{font-weight:600;font-size:12px;color:var(--dim)}.bad{color:var(--bad);font-weight:600}.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid}
.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.bad{color:var(--bad);border-color:var(--bad)}
.shots{display:flex;gap:6px}figure{margin:0}img{width:180px;border-radius:4px;border:1px solid var(--line);display:block}figcaption{font-size:11px;color:var(--dim)}
</style></head><body>
<h1>Visual lab</h1>
<p class="dim">${esc(results.env.live ? 'LIVE backend' : 'Offline harness (real backend over synthetic data)')} · ${esc(results.env.VIEW)} · injected latency series ${esc(results.env.LAT_SERIES)} ms / grid ${esc(results.env.LAT_GRID)} ms · ${esc(results.env.startedUtc)}</p>
<p class="dim small">"Marine/Wind correct" = time from the input to the first frame whose resident grid is the selected hour, layer and model. "Silent" = frames
where the drawn hour/layer/model differed from the selection with no status line saying so. "STALE" = the picture 150 ms after the input was
closer to the previous step's settled picture than to this step's (pixel mean difference; "moved" is how far the step changed the picture).</p>
${flows}</body></html>`;
}

module.exports = { render };
