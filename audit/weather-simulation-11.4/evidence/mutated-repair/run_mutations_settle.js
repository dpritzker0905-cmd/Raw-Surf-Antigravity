/**
 * AUDIT — settle debounce mutation harness. Disposable worktree only.
 *
 * The debounce is NOT behaviour-preserving, so "output identical" cannot be the property. What
 * actually gates promotion is the SAFETY COUNTER (`pendingDeferrals` at rest). D8 is therefore the
 * mutation that matters most: if the counter can be made to lie while the suite stays green, the
 * metric the promotion decision rests on is itself unguarded.
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const WT = process.argv[2];
const SRC = path.join(WT, 'frontend/src/components/map/marineMaskShelter.js');
const PRISTINE = fs.readFileSync(SRC, 'utf8');

const MUTATIONS = [
  {
    id: 'D1', what: 'debounce becomes DEFAULT-ON (absent flag treated as 250 ms)',
    risk: 'the feature could become default by accident',
    from: `  const ms = typeof window !== 'undefined' ? Number(window.__RAW_MASK_SETTLE_DEBOUNCE_MS__) || 0 : 0;`,
    to:   `  const ms = typeof window !== 'undefined' ? Number(window.__RAW_MASK_SETTLE_DEBOUNCE_MS__) || 250 : 250;`,
  },
  {
    id: 'D2', what: 'pendingDeferrals is NEVER reset by a real classification',
    risk: 'a healthy map would look stuck',
    from: `  c.pendingDeferrals = 0;   // a real classification clears the backlog`,
    to:   `  /* reset removed by audit mutation D2 */`,
  },
  {
    id: 'D3', what: 'gate moved BEFORE the cheap guards (a refusal counts as a deferral)',
    risk: 'refusals inflate the deferral count and mask a real backlog',
    from: `  if (spanLon >= 10 || spanLon <= 0) return false;`,
    to:   `  if (spanLon >= 10 || spanLon <= 0) { _shelterSettleGate(1, 1); return false; }`,
  },
  {
    id: 'D4', what: 'markMaskViewportSettled becomes a NO-OP',
    risk: 'the settle signal is itself debounced -> can never converge (the 84c3fd60 bug)',
    from: `export function markMaskViewportSettled() { _lastShelterWorkAt = 0; }`,
    to:   `export function markMaskViewportSettled() { /* no-op by audit mutation D4 */ }`,
  },
  {
    id: 'D5', what: 'boundary flipped: `since >= ms` becomes `since > ms`',
    risk: 'off-by-one at the exact interval',
    from: `  if (since >= ms) { _lastShelterWorkAt = now; _shelterSettleDone(); return null; }   // settled: work`,
    to:   `  if (since > ms) { _lastShelterWorkAt = now; _shelterSettleDone(); return null; }   // settled: work`,
  },
  {
    id: 'D6', what: 'a DEFERRAL also clears pendingDeferrals (safety counter always reads 0)',
    risk: '⭐ THE SAFETY METRIC ALWAYS SAYS HEALTHY — this is the number the promotion gate reads',
    from: `    c.deferred = (c.deferred || 0) + 1;
    c.pendingDeferrals = (c.pendingDeferrals || 0) + 1;`,
    to:   `    c.deferred = (c.deferred || 0) + 1;
    c.pendingDeferrals = 0;`,
  },
  {
    id: 'D7', what: 'gate moved AFTER the downsample+readback (a deferral still pays canvas cost)',
    risk: 'the entire CPU win evaporates while the feature still looks enabled',
    from: `  const _deferred = _shelterSettleGate(nPx, mPerPx);
  if (_deferred) return _deferred;
  const ds = document.createElement('canvas');`,
    to:   `  const ds = document.createElement('canvas');
  const _deferred = _shelterSettleGate(nPx, mPerPx);
  if (_deferred) return _deferred;`,
  },
  {
    id: 'D8', what: 'maxPendingDeferrals never rises (peak backlog invisible)',
    risk: 'the "max 3 during motion" evidence could not be observed',
    from: `    c.maxPendingDeferrals = Math.max(c.maxPendingDeferrals || 0, c.pendingDeferrals);`,
    to:   `    c.maxPendingDeferrals = 0;`,
  },
  {
    id: 'D9', what: '_resetShelterCache no longer resets _lastShelterWorkAt',
    risk: 'settle state leaks between tests -> case order decides the result',
    from: `export function _resetShelterCache() { _shelterCache.clear(); _lastShelterWorkAt = 0; }`,
    to:   `export function _resetShelterCache() { _shelterCache.clear(); }`,
  },
];

const results = [];
for (const m of MUTATIONS) {
  if (!PRISTINE.includes(m.from)) { console.log(`${m.id}: ANCHOR-NOT-FOUND`); results.push({ ...m, verdict: 'ANCHOR-NOT-FOUND' }); continue; }
  fs.writeFileSync(SRC, PRISTINE.replace(m.from, m.to));
  let out = '';
  try {
    out = execSync('npx craco test --testPathPattern="marineMaskShelter" --watchAll=false 2>&1',
      { cwd: path.join(WT, 'frontend'), env: { ...process.env, CI: 'true' }, encoding: 'utf8', timeout: 600000 });
  } catch (e) { out = (e.stdout || '') + (e.stderr || ''); }
  const mm = out.match(/Tests:\s+(?:(\d+) failed,\s+)?(?:(\d+) passed,\s+)?(\d+) total/);
  const failed = mm ? Number(mm[1] || 0) : -1;
  const passed = mm ? Number(mm[2] || 0) : -1;
  const names = [...out.matchAll(/●\s+(?!Console)([^\n]+)/g)].map(x => x[1].trim()).filter((x, i, a) => a.indexOf(x) === i);
  const verdict = failed > 0 ? 'CAUGHT' : (failed === 0 ? 'SURVIVED' : 'SUITE-ERROR');
  results.push({ id: m.id, what: m.what, risk: m.risk, failed, passed, verdict, failingNames: names.slice(0, 4) });
  console.log(`${m.id}: ${verdict}  (failed=${failed} passed=${passed}) — ${m.what}`);
  if (verdict === 'SURVIVED') console.log(`      ⛔ UNPROTECTED: ${m.risk}`);
  fs.writeFileSync(SRC, PRISTINE);
}
fs.writeFileSync(path.join(__dirname, 'MUTATION_RESULTS_SETTLE.json'), JSON.stringify(results, null, 2));
fs.writeFileSync(SRC, PRISTINE);
const s = results.filter(r => r.verdict === 'SURVIVED');
console.log(`\n=== SURVIVING: ${s.length} of ${results.length} ===`);
s.forEach(x => console.log(`  ${x.id}: ${x.what}\n      ${x.risk}`));
