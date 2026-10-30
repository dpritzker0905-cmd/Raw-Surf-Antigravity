const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../../..');
const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name)));
const summary = data => ({
  startedAt: new Date(data.startTime).toISOString(), passed: data.numPassedTests, failed: data.numFailedTests, total: data.numTotalTests,
  suites: data.testResults.map(suite => ({ file: path.basename(suite.name), cases: suite.assertionResults.map(test => ({
    name: test.fullName, status: test.status,
    ...(test.failureMessages.length ? { failure: test.failureMessages[0].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 300) } : {}),
  })) })),
});
const entry = read('entry-hashes.json');
const intentional = new Set(['frontend/src/components/admin/AdminSupportDashboard.js', 'backend/routes/admin/support.py']);
const priorCheckpointReadback = entry.files.map(file => {
  const actual = sha256(fs.readFileSync(path.join(root, file.path)));
  if (!intentional.has(file.path)) assert.equal(actual, file.sha256, `Unintended prior checkpoint drift: ${file.path}`);
  return { path: file.path, entrySha256: file.sha256, finalSha256: actual, changed: actual !== file.sha256, intendedRuntimeChange: intentional.has(file.path) };
});
const recheck = summary(read('recheck-selection-raw.json'));
const baseline = summary(read('baseline-raw.json'));
const final = summary(read('final-raw.json'));
const entryBrowser = read('recheck-browser-results.json');
const browser = read('browser-results.json');
const handler = read('handler-results.json');
const handlerBaseline = read('baseline-handler.json');
const lint = read('lint-raw.json');
assert.equal(recheck.passed, 21); assert.equal(recheck.failed, 0);
assert.equal(entryBrowser.results.filter(test => test.passed).length, 6);
assert.equal(final.passed, 42); assert.equal(final.failed, 0);
assert.equal(handler.passed, handler.total); assert.equal(handler.total, 10);
assert.equal(browser.results.filter(test => test.passed).length, 6);
assert.equal(lint.reduce((sum, file) => sum + file.errorCount + file.warningCount, 0), 0);
const changed = git('diff', '--name-only', 'HEAD', '--', 'frontend/src', 'backend').split(/\r?\n/).filter(Boolean).sort();
assert.deepEqual(changed, [...intentional].sort());
const backendDiff = git('diff', '--numstat', '--', 'backend/routes/admin/support.py');
assert.ok(backendDiff.startsWith('1\t1\t'), 'Backend change must stay one added/replaced line');
const sources = [...intentional, 'frontend/src/components/admin/AdminSupportDashboard.test.js',
  'frontend/src/components/admin/AdminSupportDashboard.pagination.test.js',
  ...fs.readdirSync(__dirname).filter(name => /\.(cjs|js|jsx|py)$/.test(name)).map(name => `docs/audits/evidence/2026-10-29-admin-support-pagination/${name}`)];
const result = {
  verifiedAt: new Date().toISOString(), branch: git('branch', '--show-current'), entryHead: git('rev-parse', 'HEAD'),
  entryHashCheck: { files: entry.files.length, allMatchedBeforeEdits: entry.allMatched, priorCheckpointReadback },
  priorRepairRecheck: { regression: recheck, browserPassed: entryBrowser.results.length },
  paginationBaseline: baseline, finalRegression: final,
  handler: { baselinePassed: handlerBaseline.passed, baselineTotal: handlerBaseline.total, finalPassed: handler.passed, finalTotal: handler.total,
    fixtureDataUnchanged: handler.cases.find(test => test.name.includes('preserve every fixture row')) },
  browser: { engine: browser.engine, version: browser.browserVersion, passed: browser.results.length, themes: ['light', 'dark', 'beach'],
    viewports: ['1440x1000', '390x844'], themeCssVerified: true, externalRequests: browser.results.reduce((sum, test) => sum + test.externalRequests, 0) },
  lint: lint.map(file => ({ path: path.relative(root, file.filePath).replace(/\\/g, '/'), errors: file.errorCount, warnings: file.warningCount })),
  runtimeChanges: changed,
  files: sources.map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
  limits: ['SQLite function-level route/model execution with offline dependency seams; not mounted API, PostgreSQL or provider qualification',
    'Browser fixture uses fictional transport and actual React/UI/theme code; not full-app authentication or real tickets',
    'Viewport emulation is not physical-device/cross-browser/assistive-technology acceptance',
    'Offset pages can shift as the dataset changes; no cursor or transaction-snapshot contract is introduced',
    'No weather runtime, deployment, provider call, shared migration, live data change, commit, push or merge'],
};
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ recheck: `${recheck.passed}/${recheck.total}`, paginationBaseline: `${baseline.passed}/${baseline.total}`, final: `${final.passed}/${final.total}`,
  handler: `${handler.passed}/${handler.total}`, browser: browser.results.length, runtimeChanges: changed }));
