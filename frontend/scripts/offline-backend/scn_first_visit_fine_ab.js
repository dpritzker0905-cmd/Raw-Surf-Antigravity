// The registered A/B for the first-visit fine grid (docs/weather-program/log/2026-11-15-opus-first-visit-fine.md). Offline only.
// Runs scn_first_visit_fine.js per view (desktop, phone) x scenario (slow, drag, back) x SESSIONS, alternating ON / KILL (both
// kills set) from ONE build, and judges F1-F3 as registered. F4 is Jest.
//   AB_BASE=http://127.0.0.1:<spa> PORT=4298 OUT_DIR=<dir> node scn_first_visit_fine_ab.js
if (process.env.AB_LIVE === '1') throw Error('scn_first_visit_fine_ab is offline only');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSIONS = +(process.env.SESSIONS || 3);
const VIEWS = (process.env.VIEWS || 'desktop,phone').split(',');
const SCENS = (process.env.SCENS || 'slow,drag,back').split(',');
const OUT_DIR = process.env.OUT_DIR || '.';
const KILL = { __RAW_DISABLE_FINE_PREFETCH_NEXT__: true, __RAW_DISABLE_FINE_UPGRADE_REGIONAL__: true };
const runs = [];
for (const view of VIEWS) for (const scen of SCENS) for (let s = 0; s < SESSIONS; s += 1) {
  for (const arm of (s % 2 ? ['kill', 'on'] : ['on', 'kill'])) {
    const out = path.join(OUT_DIR, `fine-${view}-${scen}-${arm}-${s + 1}.json`);
    let log = '';
    try {
      log = execFileSync(process.execPath, [path.join(__dirname, 'scn_first_visit_fine.js')], { env: { ...process.env, VIEW: view, SCEN: scen, OUT: out,
        FLAGS: JSON.stringify(arm === 'kill' ? KILL : {}) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    } catch (e) { log = String(e.stdout || '') + ' FAILED ' + String(e.message).slice(0, 120); }
    const r = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { error: 'no output' };
    runs.push({ view, scen, arm, s, r });
    console.log(`${view} ${scen} ${arm} #${s + 1}: ${(log.split('\n').find((l) => l.startsWith('net ')) || '')}${r.error ? ' ERROR ' + r.error : ''}`);
  }
}
const q = (a, p) => { const x = a.filter((v) => v != null).sort((m, n) => m - n); return x.length ? x[Math.min(x.length - 1, Math.floor(p * x.length))] : null; };
const pick = (view, scen, arm) => runs.filter((x) => x.view === view && x.scen === scen && x.arm === arm).map((x) => x.r);
const res = { at: new Date().toISOString(), sessions: SESSIONS, views: {} };
let F1 = true; let F2 = true; let F3 = true;
for (const view of VIEWS) {
  const v = (res.views[view] = {});
  for (const arm of ['on', 'kill']) {
    const slow = pick(view, 'slow', arm);
    const fine = slow.flatMap((r) => (r.steps || []).slice(1).map((st) => st.summary.fineMs));
    const first = SCENS.flatMap((sc) => pick(view, sc, arm)).flatMap((r) => (r.steps || []).map((st) => st.summary.firstDrawMs));
    const all = SCENS.flatMap((sc) => pick(view, sc, arm));
    v[arm] = {
      fineP50: q(fine, 0.5), fineP95: q(fine, 0.95), fineNeverIn: fine.filter((x) => x == null).length, fineN: fine.length,
      firstDrawP50: q(first, 0.5), firstDrawP95: q(first, 0.95),
      stale: all.reduce((t, r) => t + (r.steps || []).reduce((u, st) => u + (st.summary.stale || 0), 0), 0),
      blank: all.reduce((t, r) => t + (r.steps || []).reduce((u, st) => u + st.ev.filter((e) => e.k === 'draw' && e.sig === 'none').length, 0), 0),
      net: Object.fromEntries(SCENS.map((sc) => [sc, pick(view, sc, arm).map((r) => r.net || {}).map((n) => ({ grid: n.grid, gridBytes: n.gridBytes, series: n.series, seriesBytes: n.seriesBytes }))])),
      mockGridMs: { p50: q(all.flatMap((r) => (r.net && r.net.gridMs) || []), 0.5), p95: q(all.flatMap((r) => (r.net && r.net.gridMs) || []), 0.95) },
    };
  }
  const on = v.on; const kill = v.kill;
  const f1 = on.fineP50 != null && (kill.fineP50 == null || on.fineP50 <= 0.5 * kill.fineP50) && (kill.fineP95 == null || (on.fineP95 != null && on.fineP95 <= kill.fineP95))
    && on.fineNeverIn <= kill.fineNeverIn;
  const sumBy = (arm, sc, f) => v[arm].net[sc].reduce((t, n) => t + (n[f] || 0), 0);
  const f2 = SCENS.every((sc) => {
    const extra = sc === 'drag' ? 0 : SESSIONS;   // at most one unused prefetch per session
    return sumBy('on', sc, 'grid') <= sumBy('kill', sc, 'grid') + extra && sumBy('on', sc, 'series') <= sumBy('kill', sc, 'series');
  });
  const f3 = on.firstDrawP50 != null && kill.firstDrawP50 != null && on.firstDrawP50 <= kill.firstDrawP50 + 5 && on.firstDrawP95 <= kill.firstDrawP95 + 15 && on.stale === 0 && on.blank === 0;
  v.gates = { F1: f1, F2: f2, F3: f3 };
  F1 = F1 && f1; F2 = F2 && f2; F3 = F3 && f3;
}
res.gates = { F1, F2, F3 };
fs.writeFileSync(path.join(OUT_DIR, 'fine-summary.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
