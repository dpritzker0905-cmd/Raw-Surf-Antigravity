const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name)));
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();
const source = 'backend/routes/admin/support.py';
const entry = read('entry-hashes.json');
entry.files = Object.fromEntries(Object.entries(entry.files).map(([path, value]) => [path, typeof value === "string" ? value : value.sha256]));
const checkpoint = Object.entries(entry.files).map(([file, sha256]) => {
  const finalSha256 = hash(fs.readFileSync(path.join(root, file)));
  if (file !== source) assert.equal(finalSha256, sha256, `Checkpoint changed: ${file}`);
  return { path: file, sha256, finalSha256, intendedChange: file === source };
});
const text = fs.readFileSync(path.join(root, source), 'utf8');
const clearOnUpdate = /        elif request.status != "closed":\r?\n            updates\["resolved_at"\] = None\r?\n/;
const clearOnReply = /                resolved_at=None,\r?\n/;
assert.equal([...text.matchAll(new RegExp(clearOnUpdate.source, 'g'))].length, 1);
assert.equal([...text.matchAll(new RegExp(clearOnReply.source, 'g'))].length, 1);
assert.equal(hash(Buffer.from(text.replace(clearOnUpdate, '').replace(clearOnReply, ''))), entry.files[source], 'Only the three intended lines may change');
const ui = read('recheck-raw.json');
const baseline = read('baseline-reopen.json');
const lifecycle = read('reopen-results.json');
const metricsEntry = read('metrics-recheck.json');
const metricsFinal = read('metrics-final.json');
const status = read('status-contract.json');
const scope = read('sla-scope-cases.json');
const browser = read('browser-results.json');
assert.equal(ui.numPassedTests, 78); assert.equal(ui.numFailedTests, 0);
assert.equal(baseline.passed, 10); assert.equal(baseline.total, 26);
assert.equal(lifecycle.passed, 26); assert.equal(lifecycle.total, 26);
assert.ok(lifecycle.cases.every(test => test.allUnrelatedColumnsAndRowsPreserved && test.messagePersistenceCorrect));
assert.equal(metricsEntry.passed, 12); assert.equal(metricsFinal.passed, 12);
assert.equal(status.passed, 10); assert.equal(scope.passed, 11);
assert.equal(browser.results.length, 6);
assert.ok(browser.results.every(test => test.passed && test.characterSet === 'UTF-8' && !test.externalRequests && !test.pageErrors && !test.horizontalOverflow));
const python = 'C:/Users/David/App/raw-surf/backend/.venv/Scripts/python.exe';
execFileSync(python, ['-m', 'flake8', source, path.join(__dirname, 'verify-reopen.py'), '--select', 'E9,F63,F7,F82'], { cwd: root });
execFileSync(python, ['-B', '-c', "from pathlib import Path; [compile(Path(f).read_text(encoding='utf-8'),f,'exec') for f in ['backend/routes/admin/support.py','docs/audits/evidence/2026-10-29-admin-support-reopen/verify-reopen.py']]"], { cwd: root });
git('diff', '--check');
const runtimeChanges = git('diff', '--name-only', 'HEAD', '--', 'frontend/src', 'backend').split(/\r?\n/).sort();
assert.deepEqual(runtimeChanges, [source, 'frontend/src/components/admin/AdminSupportDashboard.js']);
const files = [source, 'frontend/src/components/admin/AdminSupportDashboard.js',
  ...fs.readdirSync(__dirname).filter(name => /\.(cjs|js|jsx|py)$/.test(name)).map(name => `docs/audits/evidence/2026-10-29-admin-support-reopen/${name}`)];
const result = { verifiedAt: new Date().toISOString(), head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'),
  entryHashes: checkpoint.length, checkpoint, exactlyThreeBackendLinesAdded: true, frontendUnchangedThisSlice: true,
  uiRecheck: { passed: ui.numPassedTests, total: ui.numTotalTests, failed: ui.numFailedTests, startedAt: new Date(ui.startTime).toISOString(),
    suites: ui.testResults.map(suite => ({ file: path.basename(suite.name), passed: suite.numPassingTests })) },
  baseline: { passed: baseline.passed, total: baseline.total, failingCases: baseline.cases.filter(test => !test.passed).map(test => test.name) },
  lifecycle: { passed: lifecycle.passed, total: lifecycle.total, cases: lifecycle.cases.map(test => ({ name: test.name, passed: test.passed })) },
  priorContracts: { metricsEntry: metricsEntry.passed, metricsFinal: metricsFinal.passed, status: status.passed, slaScope: scope.passed },
  browser: { passed: browser.results.length, browserVersion: browser.browserVersion, themeDeviceCases: browser.results.map(test => `${test.theme}/${test.device}`),
    actualUiWithFictionalTransport: true, externalRequests: 0, pageErrors: 0, horizontalOverflow: false, characterSet: 'UTF-8' },
  quality: { narrowFlake8: 'pass E9,F63,F7,F82', pythonSyntax: 'pass', whitespace: 'pass' }, cumulativeRuntimeChanges: runtimeChanges,
  files: files.map(file => ({ path: file, sha256: hash(fs.readFileSync(path.join(root, file))) })),
  limits: ['Forward lifecycle consistency only; no historical cleanup or change to metrics query/eligibility',
    'Existing Closed, internal-note, later-reply, re-resolution and priority/SLA behavior retained',
    'Actual function/model/SQL against disposable SQLite, fresh-session persistence; no mounted auth/PostgreSQL/concurrency/live data qualification',
    'Chrome verifies prior frontend repairs with fictional transport; does not provide mounted UI-to-backend lifecycle proof',
    'No app/env/weather runtime, shared migration, provider/security/paid/commit/push/merge/deploy actions'] };
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ entryHashes: checkpoint.length, protectedFiles: checkpoint.length - 1, ui: ui.numPassedTests,
  baseline: `${baseline.passed}/${baseline.total}`, lifecycle: `${lifecycle.passed}/${lifecycle.total}`, metrics: metricsFinal.passed,
  status: status.passed, slaScope: scope.passed, browser: browser.results.length, backendLinesAdded: 3 }));
