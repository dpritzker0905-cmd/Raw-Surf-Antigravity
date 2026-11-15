// The registered A/B for the scrub-step re-render fix (docs/weather-program/log/2026-11-15-opus-scrub-render-census.md). Offline
// only. Runs scn_render_census.js SESSIONS times per arm, alternating ON / KILL from ONE profiling build, and judges the four gates.
//   AB_BASE=http://127.0.0.1:<spa of the profiling build> PORT=4298 OUT_DIR=<dir> node scn_scrub_render_ab.js
// Env: SESSIONS (3), KILLS (comma list of the window flags the KILL arm sets), plus everything scn_render_census.js reads.
if (process.env.AB_LIVE === '1') throw Error('scn_scrub_render_ab is offline only');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SESSIONS = +(process.env.SESSIONS || 3);
const KILLS = (process.env.KILLS || '__RAW_DISABLE_SLOT_URL_BAILOUT__,__RAW_DISABLE_DERIVED_SCRUBBING__').split(',').filter(Boolean);
const OUT_DIR = process.env.OUT_DIR || '.';
const arms = { on: {}, kill: Object.fromEntries(KILLS.map((k) => [k, true])) };
if (process.env.AA === '1') arms.on = arms.kill;   // A/A pair (Brief 3): both arms are the KILL arm
const runs = { on: [], kill: [] };
for (let s = 0; s < SESSIONS; s += 1) {
  for (const arm of ['on', 'kill']) {
    const out = path.join(OUT_DIR, `ab-${arm}-${s + 1}.json`);
    const log = execFileSync(process.execPath, [path.join(__dirname, 'scn_render_census.js')],
      { env: { ...process.env, OUT: out, FLAGS: JSON.stringify(arms[arm]) }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const r = JSON.parse(fs.readFileSync(out, 'utf8'));
    const head = log.split('\n').find((l) => l.startsWith('census')) || '';
    console.log(`${arm} #${s + 1}: ${head}${r.error ? ' ERROR ' + r.error : ''}`);
    runs[arm].push(r);
  }
}
const q = (a, p) => { const s = a.filter((x) => x != null).sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const sum = (arm) => {
  const steps = runs[arm].flatMap((r) => r.steps || []);
  const own = steps.map((s) => Object.entries(s).filter(([k]) => k !== '__commits' && k !== '__ab').reduce((t, [, e]) => t + e.selfMs, 0));
  const ab = steps.map((s) => s.__ab || {});
  return {
    steps: steps.length, ownMsP50: q(own, 0.5), commitsP50: q(steps.map((s) => s.__commits || 0), 0.5),
    inputP50: q(ab.map((a) => a.inputMs), 0.5), inputP95: q(ab.map((a) => a.inputMs), 0.95),
    shownP50: q(ab.map((a) => a.shownMs), 0.5), shownP95: q(ab.map((a) => a.shownMs), 0.95), held: ab.filter((a) => a.held).length, shownMissing: ab.filter((a) => !a.held && a.shownMs == null).length,
    blank: ab.reduce((t, a) => t + (a.blank || 0), 0), mislabel: ab.filter((a) => a.mislabel).length,
    labelsStuck: ab.filter((a) => !a.labelMoved).length, noEventTiming: ab.some((a) => a.noEventTiming),
  };
};
const on = sum('on'); const kill = sum('kill');
const g1 = on.ownMsP50 <= 0.5 * kill.ownMsP50;
const g2 = on.inputP95 <= 0.75 * kill.inputP95 && on.inputP50 <= kill.inputP50 + 5;
const g3 = on.shownP50 <= kill.shownP50 + 5 && on.shownP95 <= kill.shownP95 + 15 && on.blank === 0 && kill.blank === 0
  && on.mislabel === 0 && kill.mislabel === 0 && on.labelsStuck === 0 && kill.labelsStuck === 0;
const res = { at: new Date().toISOString(), sessions: SESSIONS, kills: KILLS, on, kill,
  gates: { g1_render: g1, g2_input: g2, g3_noHarm: g3 } };
fs.writeFileSync(path.join(OUT_DIR, 'ab-summary.json'), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
