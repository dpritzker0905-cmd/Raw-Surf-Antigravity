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
        <td>${ms(s.marineMs)}${s.exactMs !== undefined ? `<br><span class="dim">exact</span> ${ms(s.exactMs)}` : ''}</td><td>${ms(s.windMs)}</td>
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
  return `<title>Map Scrub Lab</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Layout: one summary strip, then one table per flow; the table scrolls inside its card, the page never does. */
:root{--bg:#f5f7f8;--fg:#14202b;--dim:#56656f;--card:#ffffff;--line:#d9e1e6;--accent:#0b6e8a;--ok:#1a7f37;--bad:#b42318;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;--mono:ui-monospace,"SFMono-Regular",Consolas,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#0e1418;--fg:#e4ebef;--dim:#93a3ad;--card:#151d23;--line:#26323a;--accent:#5cc3df;--ok:#4ac26b;--bad:#ff7b72;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#0e1418;--fg:#e4ebef;--dim:#93a3ad;--card:#151d23;--line:#26323a;--accent:#5cc3df;--ok:#4ac26b;--bad:#ff7b72;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:14px/1.45 var(--sans);padding-block:16px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
h1{font-size:20px;margin:0 0 4px;text-wrap:balance}h2{font-size:16px;margin:24px 0 4px;color:var(--accent);font-family:var(--mono)}
p{max-width:75ch}.dim{color:var(--dim)}.small{font-size:12px}
.scroll{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:6px}
table{border-collapse:collapse;min-width:1100px;width:100%;font-variant-numeric:tabular-nums}th,td{border-bottom:1px solid var(--line);padding:8px;text-align:left;vertical-align:top}
th{font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--dim)}.bad{color:var(--bad);font-weight:600}
.pill{display:inline-block;padding:1px 8px;border-radius:99px;font-size:12px;border:1px solid}.pill.ok{color:var(--ok);border-color:var(--ok)}.pill.bad{color:var(--bad);border-color:var(--bad)}
.shots{display:flex;gap:6px;flex-wrap:wrap}figure{margin:0}img{width:180px;max-width:100%;border-radius:4px;border:1px solid var(--line);display:block}figcaption{font-size:11px;color:var(--dim)}
</style>
<h1>Map Scrub Lab</h1>
<p class="dim">${esc(results.env.live ? 'LIVE backend' : 'Offline harness (real backend over synthetic data)')} · ${esc(results.env.VIEW)} · injected latency series ${esc(results.env.LAT_SERIES)} ms / grid ${esc(results.env.LAT_GRID)} ms · ${esc(results.env.startedUtc)}</p>
<p class="dim small">"Marine/Wind correct" = time from the input to the first frame whose resident grid is the selected hour, layer and model. "Silent" = frames
where the drawn hour/layer/model differed from the selection with no status line saying so. "STALE" = the picture 150 ms after the input was
closer to the previous step's settled picture than to this step's (pixel mean difference; "moved" is how far the step changed the picture).</p>
${flows}`;
}

module.exports = { render };
