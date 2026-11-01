// STALE-WINDOW A/B SUMMARY (2026-10-21, SWR_BACKOFF): reads the `stale` block of each run's lab.json (lab.js flows stale_world /
// stale_regional over serve_synthetic.py's stale window) and prints, per flow and arm, every run and the median of:
//   reasks/min   the client's re-asks of the view's /grid while the backend answered stale (as the BACKEND saw them)
//   ask lag      backend turned fresh -> the next ask reached it (ms)
//   fresh drawn  backend turned fresh -> the fresh grid (its cols) in the marine engine (ms)
//   after        asks after the first fresh answer (should be 0: a fresh commit ends the loop)
// Usage: node stale_summary.js A=<dir>,<dir>,... B=<dir>,... [C=...] [--json out.json]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const arms = args.filter((a) => /^[A-Za-z0-9_]+=/.test(a)).map((a) => { const [k, v] = a.split('='); return [k, v.split(',').filter(Boolean)]; });
const median = (xs) => { const s = xs.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b); if (!s.length) return null;
  const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

const out = {};
for (const [arm, dirs] of arms) {
  for (const dir of dirs) {
    const lab = JSON.parse(fs.readFileSync(path.join(dir, 'lab.json'), 'utf8'));
    for (const f of lab.flows) {
      const row = (f.steps || []).find((s) => s.stale);
      const st = row && row.stale;
      const k = `${f.name} (${st ? st.seconds : '?'} s stale)`;
      (out[k] = out[k] || {})[arm] = out[k][arm] || [];
      out[k][arm].push(st ? { dir: path.basename(dir), error: f.error || null, reasksPerMin: st.reasksPerMin, reasks: st.reasksWhileStale,
        staleSpanS: st.staleSpanMs != null ? +(st.staleSpanMs / 1000).toFixed(1) : null, staleAskAtS: st.staleAskAtS,
        askLagMs: st.freshAskLagMs, freshDrawnMs: st.freshDrawnMs, asksAfterFresh: st.asksAfterFresh, staleDrawn: st.staleDrawn,
        staleCols: st.staleCols, freshCols: st.freshCols, kills: lab.env.kills } : { dir: path.basename(dir), error: f.error || 'no stale step' });
    }
  }
}
for (const [k, byArm] of Object.entries(out)) {
  console.log(`\n== ${k}`);
  for (const [arm, runs] of Object.entries(byArm)) {
    for (const r of runs) {
      console.log(`  ${arm} ${r.dir.padEnd(14)} reasks/min ${String(r.reasksPerMin).padStart(6)} (${r.reasks} in ${r.staleSpanS} s)  ask lag ${String(r.askLagMs).padStart(6)} ms`
        + `  fresh drawn ${String(r.freshDrawnMs).padStart(6)} ms  after ${r.asksAfterFresh}  stale drawn ${r.staleDrawn}  cols ${r.staleCols}->${r.freshCols}`
        + `${r.error ? `  ERROR ${r.error}` : ''}`);
      console.log(`     asks at s: ${(r.staleAskAtS || []).join(', ')}`);
    }
    console.log(`  ${arm} median    reasks/min ${median(runs.map((r) => r.reasksPerMin))}  ask lag ${median(runs.map((r) => r.askLagMs))} ms`
      + `  fresh drawn ${median(runs.map((r) => r.freshDrawnMs))} ms`);
  }
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(out, null, 1));
