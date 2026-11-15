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
const SCENS = (process.env.SCENS || 'slow,slow1,drag,back,browse').split(',');   // slow1 = slow at a 1 s dwell (20:22Z)
const OUT_DIR = process.env.OUT_DIR || '.';
const STEPS_SLOW = 6; const STEPS_BACK = 9;   // settled hours per session: slow 6; back 6 forward + 3 back
// Arms (20:22Z): none = both kills; R = the prefetch killed; PR = neither. R is scored vs none, P as PR vs R.
const ARMS = { none: { __RAW_DISABLE_FINE_PREFETCH_NEXT__: true, __RAW_DISABLE_FINE_UPGRADE_REGIONAL__: true }, R: { __RAW_DISABLE_FINE_PREFETCH_NEXT__: true }, PR: {} };
const runs = [];
for (const view of VIEWS) for (const scen of SCENS) for (let s = 0; s < SESSIONS; s += 1) {
  const order = ['none', 'R', 'PR']; for (const arm of order.slice(s % 3).concat(order.slice(0, s % 3))) {
    const out = path.join(OUT_DIR, `fine-${view}-${scen}-${arm}-${s + 1}.json`);
    let log = '';
    try {
      log = execFileSync(process.execPath, [path.join(__dirname, 'scn_first_visit_fine.js')], { env: { ...process.env, VIEW: view, SCEN: scen === 'slow1' ? 'slow' : scen,
        DWELL: scen === 'slow1' ? '1000' : (process.env.DWELL || '3000'), OUT: out, FLAGS: JSON.stringify(ARMS[arm]) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    } catch (e) { log = String(e.stdout || '') + ' FAILED ' + String(e.message).slice(0, 120); }
    const r = fs.existsSync(out) ? JSON.parse(fs.readFileSync(out, 'utf8')) : { error: 'no output' };
    runs.push({ view, scen, arm, s, r });
    console.log(`${view} ${scen} ${arm} #${s + 1}: ${(log.split('\n').find((l) => l.startsWith('net ')) || '')}${r.error ? ' ERROR ' + r.error : ''}`);
  }
}
const q = (a, p) => { const x = a.filter((v) => v != null).sort((m, n) => m - n); return x.length ? x[Math.min(x.length - 1, Math.floor(p * x.length))] : null; };
const pick = (view, scen, arm) => runs.filter((x) => x.view === view && x.scen === scen && x.arm === arm).map((x) => x.r);
const res = { at: new Date().toISOString(), sessions: SESSIONS, views: {} };
const sumNet = (view, sc, arm, f) => pick(view, sc, arm).reduce((t, r) => t + ((r.net && r.net[f]) || 0), 0);
const allGate = { R: { F1: true, F2: true, F3: true }, P: { F1: true, F2: true, F3: true } };
for (const view of VIEWS) {
  const v = (res.views[view] = { arms: {} });
  for (const arm of Object.keys(ARMS)) {
    const fine = pick(view, 'slow', arm).flatMap((r) => (r.steps || []).slice(1).map((st) => st.summary.fineMs));
    const keyScens = SCENS.filter((sc) => sc !== 'browse');
    const first = keyScens.flatMap((sc) => pick(view, sc, arm)).flatMap((r) => (r.steps || []).map((st) => st.summary.firstDrawMs));
    const all = SCENS.flatMap((sc) => pick(view, sc, arm));
    v.arms[arm] = {
      fineP50: q(fine, 0.5), fineP95: q(fine, 0.95), fineShown: fine.filter((x) => x != null).length, fineN: fine.length,
      firstDrawP50: q(first, 0.5), firstDrawP95: q(first, 0.95),
      stale: all.reduce((t, r) => t + (r.steps || []).reduce((u, st) => u + (st.summary.stale || 0), 0), 0),
      blank: all.reduce((t, r) => t + (r.steps || []).reduce((u, st) => u + st.ev.filter((e) => e.k === 'draw' && e.sig === 'none').length, 0), 0),
      net: Object.fromEntries(SCENS.map((sc) => [sc, { grid: sumNet(view, sc, arm, 'grid'), gridBytes: sumNet(view, sc, arm, 'gridBytes'),
        series: sumNet(view, sc, arm, 'series'), seriesBytes: sumNet(view, sc, arm, 'seriesBytes') }])),
      mockGridMs: { p50: q(all.flatMap((r) => (r.net && r.net.gridMs) || []), 0.5), p95: q(all.flatMap((r) => (r.net && r.net.gridMs) || []), 0.95) },
    };
  }
  const A = v.arms; const n = (arm, sc, f) => (A[arm].net[sc] ? A[arm].net[sc][f] : 0);
  const settled = SESSIONS * (STEPS_SLOW + STEPS_BACK);   // R: at most one fine /grid per settled hour
  const R = {
    F1: A.R.fineShown > A.none.fineShown,
    F2: n('R', 'drag', 'grid') <= n('none', 'drag', 'grid')
      && (n('R', 'slow', 'grid') + n('R', 'back', 'grid')) <= (n('none', 'slow', 'grid') + n('none', 'back', 'grid')) + settled
      && SCENS.every((sc) => n('R', sc, 'series') <= n('none', sc, 'series')) && n('R', 'browse', 'grid') <= n('none', 'browse', 'grid'),
    F3: A.R.firstDrawP50 <= A.none.firstDrawP50 + 5 && A.R.firstDrawP95 <= A.none.firstDrawP95 + 15 && A.R.stale === 0 && A.R.blank === 0,
  };
  const P = {
    F1: A.PR.fineP50 != null && (A.R.fineP50 == null || A.PR.fineP50 <= 0.5 * A.R.fineP50)
      && (A.R.fineP95 == null || (A.PR.fineP95 != null && A.PR.fineP95 <= A.R.fineP95)) && A.PR.fineShown >= A.R.fineShown,
    F2: n('PR', 'drag', 'grid') <= n('R', 'drag', 'grid') && n('PR', 'slow', 'grid') <= n('R', 'slow', 'grid') + SESSIONS
      && n('PR', 'back', 'grid') <= n('R', 'back', 'grid') + SESSIONS && n('PR', 'slow1', 'grid') <= n('R', 'slow1', 'grid')
      && SCENS.every((sc) => n('PR', sc, 'series') <= n('R', sc, 'series'))
      && n('PR', 'browse', 'grid') === n('R', 'browse', 'grid') && n('R', 'browse', 'grid') === n('none', 'browse', 'grid'),
    F3: A.PR.firstDrawP50 <= A.R.firstDrawP50 + 5 && A.PR.firstDrawP95 <= A.R.firstDrawP95 + 15 && A.PR.stale === 0 && A.PR.blank === 0,
  };
  v.gates = { R, P };
  for (const g of ['F1', 'F2', 'F3']) { allGate.R[g] = allGate.R[g] && R[g]; allGate.P[g] = allGate.P[g] && P[g]; }
}
res.gates = allGate;
fs.writeFileSync(path.join(OUT_DIR, 'fine-summary.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
