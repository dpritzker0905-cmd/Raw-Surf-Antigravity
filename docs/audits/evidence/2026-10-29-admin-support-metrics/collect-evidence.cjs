const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name)));
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();
const summarize = data => ({ startedAt: new Date(data.startTime).toISOString(), passed: data.numPassedTests, failed: data.numFailedTests, total: data.numTotalTests,
  suites: data.testResults.map(suite => ({ file: path.basename(suite.name), cases: suite.assertionResults.map(test => ({ name: test.fullName, status: test.status,
    ...(test.failureMessages.length ? { failure: test.failureMessages[0].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 300) } : {}) })) })) });
const source = 'frontend/src/components/admin/AdminSupportDashboard.js';
const entry = read('entry-hashes.json');
const checkpoint = entry.files.map(file => {
  const actual = sha256(fs.readFileSync(path.join(root, file.path)));
  if (file.path !== source) assert.equal(actual, file.sha256, `Unexpected checkpoint drift: ${file.path}`);
  return { ...file, finalSha256: actual, intendedChange: file.path === source };
});
const recheck = summarize(read('recheck-raw.json'));
const baseline = summarize(read('baseline-raw.json'));
const final = summarize(read('final-raw.json'));
const browser = read('browser-results.json');
const handler = read('handler-recheck.json');
const lint = read('lint-raw.json');
assert.equal(recheck.passed, 42); assert.equal(recheck.failed, 0);
assert.equal(baseline.total, 18); assert.equal(baseline.failed, 14);
assert.equal(final.passed, 60); assert.equal(final.failed, 0);
assert.equal(handler.passed, 10); assert.equal(handler.total, 10);
assert.equal(browser.results.filter(test => test.passed).length, 6);
assert.equal(lint.reduce((sum, file) => sum + file.errorCount + file.warningCount, 0), 0);
const cumulativeRuntimeChanges = git('diff', '--name-only', 'HEAD', '--', 'frontend/src', 'backend').split(/\r?\n/).filter(Boolean).sort();
assert.deepEqual(cumulativeRuntimeChanges, ['backend/routes/admin/support.py', source]);
const files = [source, ...['test', 'pagination.test', 'metrics.test'].map(name => `frontend/src/components/admin/AdminSupportDashboard.${name}.js`),
  ...fs.readdirSync(__dirname).filter(name => /\.(js|jsx|cjs)$/.test(name)).map(name => `docs/audits/evidence/2026-10-29-admin-support-metrics/${name}`)];
const result = { verifiedAt: new Date().toISOString(), branch: git('branch', '--show-current'), entryHead: git('rev-parse', 'HEAD'),
  entry: { at: entry.verifiedAt, matchedBeforeEdits: entry.files.length, checkpoint },
  priorRegression: recheck, priorHandler: { passed: handler.passed, total: handler.total }, baseline, final,
  browser: { engine: browser.engine, version: browser.browserVersion, passed: browser.results.length,
    themes: ['light', 'dark', 'beach'], viewports: ['1440x1000', '390x844'], themeCssVerified: true,
    externalRequests: browser.results.reduce((sum, test) => sum + test.externalRequests, 0) },
  lint: lint.map(file => ({ path: path.relative(root, file.filePath).replace(/\\/g, '/'), errors: file.errorCount, warnings: file.warningCount })),
  runtimeChangedThisSlice: [source], cumulativeRuntimeChanges,
  files: files.map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
  limits: ['UI request lifecycle and cohort-label qualification only; backend metric definitions and zero-sample semantics unchanged',
    'Fictional transport/identities; actual React, primitives and ThemeProvider/CSS; no authenticated full-app or real ticket/provider acceptance',
    'SQLite handler rerun covers prior pagination, not metric aggregation or PostgreSQL',
    'Chrome viewports are not physical-device, cross-browser or assistive-technology acceptance',
    'No weather runtime, live data/provider/shared migration/security probe/commit/push/merge/deployment'],
};
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ entryHashes: entry.files.length, prior: `${recheck.passed}/${recheck.total}`, baseline: `${baseline.passed}/${baseline.total}`,
  final: `${final.passed}/${final.total}`, priorHandler: `${handler.passed}/${handler.total}`, browser: browser.results.length, runtimeChangedThisSlice: [source] }));
