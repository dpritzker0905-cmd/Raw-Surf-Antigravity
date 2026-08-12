/**
 * AUDIT 11.4 — mutation round 2. Targets the TWO star-marked cache tests directly.
 *
 * Round 1 showed M2 (cache stores the PRE-close mask) SURVIVED. The suspected mechanism is not
 * the fixture (refuted: close moves 2 px on NARROW) but the harness: `run()` returns
 * `ds: created[0]`, and `created` accumulates across run() calls within a test — so the second
 * run's pixels are never read. If that is right, then a cache that returns OUTRIGHT GARBAGE on a
 * hit will also survive.
 *
 * M8/M9 are the falsification test. If they survive, the star tests cannot see a hit at all.
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const WT = process.argv[2];
const SRC = path.join(WT, 'frontend/src/components/map/marineMaskShelter.js');
const PRISTINE = fs.readFileSync(SRC, 'utf8');

const HIT_BLOCK = `    sheltered = _hit.sheltered;
    count = _hit.count;`;

const MUTATIONS = [
  {
    id: 'M8',
    what: 'a HIT returns an ALL-OPEN (all-zero) mask — the stamp would paint nothing',
    kills: 'any assertion that a hit renders the same pixels as a miss',
    from: HIT_BLOCK,
    to: `    sheltered = new Uint8Array(_hit.sheltered.length);
    count = _hit.count;`,
  },
  {
    id: 'M9',
    what: 'a HIT returns an ALL-SHELTERED mask — the stamp would grey the entire tile',
    kills: 'any assertion that a hit renders the same pixels as a miss',
    from: HIT_BLOCK,
    to: `    sheltered = _hit.sheltered.map(() => 1);
    count = _hit.count;`,
  },
  {
    id: 'M10',
    what: 'a HIT returns a mask with EVERY BYTE FLIPPED',
    kills: 'any assertion that a hit renders the same pixels as a miss',
    from: HIT_BLOCK,
    to: `    sheltered = _hit.sheltered.map((v) => (v ? 0 : 1));
    count = _hit.count;`,
  },
];

const results = [];
for (const m of MUTATIONS) {
  if (!PRISTINE.includes(m.from)) {
    results.push({ ...m, verdict: 'ANCHOR-NOT-FOUND' });
    console.log(`${m.id}: ANCHOR-NOT-FOUND`);
    continue;
  }
  fs.writeFileSync(SRC, PRISTINE.replace(m.from, m.to));
  let out = '';
  try {
    out = execSync('npx craco test --testPathPattern="marineMaskShelter.wrapper" --watchAll=false 2>&1',
      { cwd: path.join(WT, 'frontend'), env: { ...process.env, CI: 'true' }, encoding: 'utf8', timeout: 600000 });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const mm = out.match(/Tests:\s+(?:(\d+) failed,\s+)?(?:(\d+) passed,\s+)?(\d+) total/);
  const failed = mm ? Number(mm[1] || 0) : -1;
  const passed = mm ? Number(mm[2] || 0) : -1;
  const failingNames = [...out.matchAll(/●\s+(?!Console)([^\n]+)/g)].map((x) => x[1].trim())
    .filter((x, i, a) => a.indexOf(x) === i);
  const verdict = failed > 0 ? 'CAUGHT' : (failed === 0 ? 'SURVIVED' : 'SUITE-ERROR');
  results.push({ id: m.id, what: m.what, kills: m.kills, failed, passed, verdict, failingNames });
  console.log(`${m.id}: ${verdict}  (failed=${failed} passed=${passed}) — ${m.what}`);
  if (failingNames.length) failingNames.slice(0, 5).forEach((n) => console.log(`      caught by: ${n}`));
  fs.writeFileSync(SRC, PRISTINE);
}
fs.writeFileSync(path.join(__dirname, 'MUTATION_RESULTS_ROUND2.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(SRC, PRISTINE);
