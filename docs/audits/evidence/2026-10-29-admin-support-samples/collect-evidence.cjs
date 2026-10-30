const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name)));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();
const changed = ['backend/routes/admin/support.py', 'frontend/src/components/admin/AdminSupportDashboard.js'];
const entry = read('entry-hashes.json');
const checkpoint = entry.files.map(file => {
  const finalSha256 = sha256(fs.readFileSync(path.join(root, file.path)));
  if (!changed.includes(file.path)) assert.equal(finalSha256, file.sha256, `Unexpected checkpoint drift: ${file.path}`);
  return { ...file, finalSha256, intendedChange: changed.includes(file.path) };
});
const summarize = data => ({ startedAt: new Date(data.startTime).toISOString(), passed: data.numPassedTests, failed: data.numFailedTests, total: data.numTotalTests,
  suites: data.testResults.map(suite => ({ file: path.basename(suite.name), cases: suite.assertionResults.map(test => ({ name: test.fullName, status: test.status,
    ...(test.failureMessages.length ? { failure: test.failureMessages[0].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 300) } : {}) })) })) });
const recheck = summarize(read('recheck-raw.json'));
const baseline = summarize(read('baseline-raw.json'));
const final = summarize(read('final-raw.json'));
const backendBaseline = read('baseline-handler.json');
const backend = read('handler-results.json');
const list = read('list-recheck.json');
const finalList = read('final-list-handler.json');
const browser = read('browser-results.json');
const lint = read('lint-raw.json');
assert.equal(recheck.passed, 60); assert.equal(recheck.failed, 0);
assert.equal(baseline.passed, 4); assert.equal(baseline.total, 10);
assert.equal(final.passed, 70); assert.equal(final.failed, 0);
assert.equal(backend.passed, 12); assert.equal(backend.total, 12); assert.equal(backend.legacyAveragesPreserved, true);
assert.ok(backend.cases.every(test => test.readOnlyNineQueries));
assert.equal(list.passed, 10); assert.equal(finalList.passed, 10);
assert.equal(browser.results.filter(test => test.passed && test.characterSet === 'UTF-8').length, 6);
assert.equal(lint.reduce((sum, file) => sum + file.errorCount + file.warningCount, 0), 0);
const runtimeChanges = git('diff', '--name-only', 'HEAD', '--', 'frontend/src', 'backend').split(/\r?\n/).filter(Boolean).sort();
assert.deepEqual(runtimeChanges, changed);
const files = [...changed, ...['test', 'pagination.test', 'metrics.test', 'samples.test'].map(name => `frontend/src/components/admin/AdminSupportDashboard.${name}.js`),
  'backend/models/admin_ops.py', 'backend/models/enums.py', 'frontend/public/index.html',
  ...fs.readdirSync(__dirname).filter(name => /\.(cjs|js|jsx|py)$/.test(name)).map(name => `docs/audits/evidence/2026-10-29-admin-support-samples/${name}`)];
const result = { verifiedAt: new Date().toISOString(), branch: git('branch', '--show-current'), entryHead: git('rev-parse', 'HEAD'),
  entryHashCheck: { at: entry.verifiedAt, matchedBeforeEdits: entry.files.length, checkpoint },
  priorUiRecheck: recheck, priorListRecheck: { entryPassed: list.passed, finalPassed: finalList.passed, total: 10 },
  baselineUi: baseline, finalUi: final,
  backend: { baselinePassed: backendBaseline.passed, total: backend.total, finalPassed: backend.passed,
    legacyAveragesPreservedBeforeAndAfter: backendBaseline.legacyAveragesPreserved && backend.legacyAveragesPreserved,
    queryCount: 9, allQueriesReadOnly: backend.cases.every(test => test.readOnlyNineQueries) },
  browser: { engine: browser.engine, version: browser.browserVersion, passed: browser.results.length, characterSet: 'UTF-8',
    themes: ['light', 'dark', 'beach'], viewports: ['1440x1000', '390x844'], externalRequests: browser.results.reduce((sum, test) => sum + test.externalRequests, 0) },
  lint: lint.map(file => ({ path: path.relative(root, file.filePath).replace(/\\/g, '/'), errors: file.errorCount, warnings: file.warningCount })),
  runtimeChanges, files: files.map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
  limits: ['SQLite function/query/model qualification; not mounted authentication/API, PostgreSQL or live support data',
    'Existing created-at cohort, timestamp eligibility, status, SLA and legacy numeric fields remain unchanged',
    'Older backend responses without counts retain their old numeric display; accurate absence display requires the additive fields',
    'Fictional browser transport with actual React/primitives/theme CSS; viewport emulation is not physical/cross-browser/AT qualification',
    'No normal app/weather runtime, provider/security/shared-migration/live-data/commit/push/merge/deployment actions'],
};
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ entryHashes: entry.files.length, priorUi: `${recheck.passed}/${recheck.total}`, ui: `${final.passed}/${final.total}`,
  backend: `${backend.passed}/${backend.total}`, legacyAveragesPreserved: backend.legacyAveragesPreserved, queries: 9, list: finalList.passed, browser: browser.results.length }));
