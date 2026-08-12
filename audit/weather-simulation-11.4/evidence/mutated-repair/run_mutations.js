/**
 * AUDIT 11.4 — mutation harness (audit-only, runs in a DISPOSABLE worktree).
 *
 * For each mutation: apply the smallest possible edit to the repaired source, run the
 * wrapper suite, record the verdict, then restore the file byte-for-byte.
 *
 * A mutation that leaves the suite GREEN is an UNPROTECTED behaviour — the headline result.
 */
const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const WT = process.argv[2];
const SRC = path.join(WT, 'frontend/src/components/map/marineMaskShelter.js');
const PRISTINE = fs.readFileSync(SRC, 'utf8');

const MUTATIONS = [
  {
    id: 'M1',
    what: 'cache never STORES (set becomes a no-op) — every call recomputes',
    kills: 'the redundancy elimination itself',
    from: `function _shelterCacheSet(key, sheltered, count) {
  _shelterCache.set(key, { sheltered, count });`,
    to: `function _shelterCacheSet(key, sheltered, count) {
  if (key) return;
  _shelterCache.set(key, { sheltered, count });`,
  },
  {
    id: 'M2',
    what: 'cache stores the PRE-CLOSE mask (close applied after the store)',
    kills: 'the POST-close correctness property — a hit would leak a raw mask',
    from: `    if (count) _closeShelteredMask(sheltered, dsW, dsH);
    if (_key !== null) _shelterCacheSet(_key, sheltered, count);`,
    to: `    if (_key !== null) _shelterCacheSet(_key, new Uint8Array(sheltered), count);
    if (count) _closeShelteredMask(sheltered, dsW, dsH);`,
  },
  {
    id: 'M3',
    what: 'drop nPx from the cache key',
    kills: 'key completeness — same pixels at a different gap would collide',
    from: '_key = `${(_h >>> 0).toString(36)}:${nPx}:${dsW}x${dsH}`;',
    to: '_key = `${(_h >>> 0).toString(36)}:${dsW}x${dsH}`;',
  },
  {
    id: 'M4',
    what: 'drop the downsample dimensions from the cache key',
    kills: 'key completeness — a differently-shaped mask could collide',
    from: '_key = `${(_h >>> 0).toString(36)}:${nPx}:${dsW}x${dsH}`;',
    to: '_key = `${(_h >>> 0).toString(36)}:${nPx}`;',
  },
  {
    id: 'M5',
    what: 'kill switch ignored (cache always on)',
    kills: 'the documented rollback lever',
    from: `  const _cacheOn = !(typeof window !== 'undefined' && window.__RAW_DISABLE_SHELTER_CACHE__ === true);`,
    to: `  const _cacheOn = true;`,
  },
  {
    id: 'M6',
    what: 'LRU eviction removed (unbounded cache growth)',
    kills: 'the memory bound — 512 KB per entry, unbounded',
    from: `  while (_shelterCache.size > _SHELTER_CACHE_CAP) {
    _shelterCache.delete(_shelterCache.keys().next().value);   // evict least-recently-used
  }`,
    to: `  /* eviction removed by audit mutation M6 */`,
  },
  {
    id: 'M7',
    what: 'hash only the FIRST 1000 pixels instead of the whole field',
    kills: 'key sensitivity — distant changes become invisible to the key',
    from: 'for (let i = 0; i < size; i++) { _h ^= water[i]; _h = Math.imul(_h, 0x01000193); }',
    to: 'for (let i = 0; i < Math.min(size, 1000); i++) { _h ^= water[i]; _h = Math.imul(_h, 0x01000193); }',
  },
];

const results = [];
for (const m of MUTATIONS) {
  if (!PRISTINE.includes(m.from)) {
    results.push({ ...m, verdict: 'ANCHOR-NOT-FOUND', detail: 'mutation could not be applied' });
    continue;
  }
  fs.writeFileSync(SRC, PRISTINE.replace(m.from, m.to));
  let out = '';
  let failed = 0, passed = 0, suiteError = false;
  try {
    out = execSync(
      'npx craco test --testPathPattern="marineMaskShelter.wrapper" --watchAll=false 2>&1',
      { cwd: path.join(WT, 'frontend'), env: { ...process.env, CI: 'true' }, encoding: 'utf8', timeout: 600000 }
    );
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  const mm = out.match(/Tests:\s+(?:(\d+) failed,\s+)?(?:(\d+) passed,\s+)?(\d+) total/);
  if (mm) { failed = Number(mm[1] || 0); passed = Number(mm[2] || 0); }
  else suiteError = true;
  const failingNames = [...out.matchAll(/●\s+(?!Console)([^\n]+)/g)]
    .map((x) => x[1].trim())
    .filter((x, i, a) => a.indexOf(x) === i && !/Console/.test(x));
  results.push({
    id: m.id, what: m.what, kills: m.kills,
    failed, passed, suiteError,
    verdict: suiteError ? 'SUITE-ERROR' : (failed > 0 ? 'CAUGHT' : 'SURVIVED'),
    failingNames: failingNames.slice(0, 8),
  });
  fs.writeFileSync(SRC, PRISTINE);
  console.log(`${m.id}: ${results[results.length - 1].verdict}  (failed=${failed} passed=${passed}) — ${m.what}`);
}

fs.writeFileSync(path.join(__dirname, 'MUTATION_RESULTS.json'), JSON.stringify(results, null, 2));
const survived = results.filter((r) => r.verdict === 'SURVIVED');
console.log('\n=== SURVIVING MUTANTS (unprotected behaviour): ' + survived.length + ' ===');
survived.forEach((s) => console.log(`  ${s.id}: ${s.what}\n      unprotected: ${s.kills}`));
// restore
fs.writeFileSync(SRC, PRISTINE);
