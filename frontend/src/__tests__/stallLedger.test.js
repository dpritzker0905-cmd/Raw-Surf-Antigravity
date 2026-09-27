/**
 * stallLedger — a measured stall must not be retried away (2026-09-26).
 *
 * After #78 the Chrome burst at Sebastian Inlet z12 stalled 22,058 ms and 30,415 ms, passed on the
 * third attempt, and the run read green as "1 flaky". The ledger carries an over-budget stall from one
 * attempt to the next so a later clean attempt cannot erase it, while attempts that fail before
 * sampling (infrastructure) never write and can still be rescued by a retry.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runKey, ledgerFile, readEarlierStalls, recordStall } = require('../../e2e/stallLedger');

let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stall-ledger-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const file = () => ledgerFile(dir, ['Desktop Chrome', 'marine-render-continuity.spec.js', 'burst', 'Sebastian z12']);

it('scopes a run by the CI run id and attempt', () => {
  expect(runKey({ GITHUB_RUN_ID: '36282276487', GITHUB_RUN_ATTEMPT: '1' })).toBe('36282276487-1');
  expect(runKey({})).toBe('local-0');
});

it('a stall recorded by attempt 0 is seen by attempts 1 and 2 of the same run', () => {
  expect(readEarlierStalls(file(), 'run-1')).toEqual([]);
  recordStall(file(), 'run-1', { attempt: 0, ms: 22058, label: 'burst:sebastian-z12' });
  expect(readEarlierStalls(file(), 'run-1')).toEqual([{ attempt: 0, ms: 22058, label: 'burst:sebastian-z12' }]);
  recordStall(file(), 'run-1', { attempt: 1, ms: 30415, label: 'burst:sebastian-z12' });
  expect(readEarlierStalls(file(), 'run-1').map((s) => s.ms)).toEqual([22058, 30415]);
});

it('a stale ledger from another run never fails this one', () => {
  recordStall(file(), 'run-1', { attempt: 0, ms: 22058 });
  expect(readEarlierStalls(file(), 'run-2')).toEqual([]);
});

it('tests and projects do not share a ledger', () => {
  const a = ledgerFile(dir, ['Desktop Chrome', 'spec', 'burst']);
  const b = ledgerFile(dir, ['Desktop Safari', 'spec', 'burst']);
  const c = ledgerFile(dir, ['Desktop Chrome', 'spec', 'toggles']);
  expect(new Set([a, b, c]).size).toBe(3);
  recordStall(a, 'run-1', { attempt: 0, ms: 5000 });
  expect(readEarlierStalls(b, 'run-1')).toEqual([]);
  expect(readEarlierStalls(c, 'run-1')).toEqual([]);
});

it('a missing or corrupt ledger reads as no earlier stall', () => {
  expect(readEarlierStalls(path.join(dir, 'nope.json'), 'run-1')).toEqual([]);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), '{not json');
  expect(readEarlierStalls(file(), 'run-1')).toEqual([]);
});

it('the spec records only APP stalls (over budget with frames offered) and fails a later attempt that saw one', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../e2e/marine-render-continuity.spec.js'), 'utf8');
  // Since 2026-09-27 the ledger records the same verdict the assertions use (continuityOracle.isAppStall):
  // a gap the browser offered no frames for is annotated, not recorded — see isAppStall's measurement.
  expect(src).toMatch(/if \(isAppStall\(worst, anatomy, GAP_BUDGET_MS\)\) \{\s*recordStall\(/);
  expect((src.match(/isAppStall\(worst, anatomy, GAP_BUDGET_MS\)/g) || []).length).toBe(3);
  expect((src.match(/const earlierStalls = reconcileStalls\(worst, anatomy\);/g) || []).length).toBe(2);
  expect((src.match(/expectNoEarlierStall\(earlierStalls\);/g) || []).length).toBe(2);
});
