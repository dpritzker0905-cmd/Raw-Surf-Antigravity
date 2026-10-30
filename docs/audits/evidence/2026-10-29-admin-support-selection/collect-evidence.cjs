const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../../..');
const git = (...args) => execFileSync('git', args, { cwd: root });
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const summarize = data => ({
  startedAt: new Date(data.startTime).toISOString(),
  passed: data.numPassedTests, failed: data.numFailedTests, total: data.numTotalTests,
  cases: data.testResults.flatMap(suite => suite.assertionResults.map(test => ({
    name: test.fullName, status: test.status,
    ...(test.failureMessages.length ? { failure: test.failureMessages[0].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 420) } : {}),
  }))),
});
const baselinePath = path.join(__dirname, 'baseline.json');
const rawBaseline = path.join(__dirname, 'baseline-raw.json');
if (fs.existsSync(baselinePath)) fs.renameSync(baselinePath, rawBaseline);
const baseline = JSON.parse(fs.readFileSync(rawBaseline));
const final = JSON.parse(fs.readFileSync(path.join(__dirname, 'final-raw.json')));
const lint = JSON.parse(fs.readFileSync(path.join(__dirname, 'lint-raw.json')));
const browser = JSON.parse(fs.readFileSync(path.join(__dirname, 'browser-results.json')));
assert.equal(final.numFailedTests, 0);
assert.equal(final.numPassedTests, 21);
assert.equal(lint.reduce((sum, file) => sum + file.errorCount + file.warningCount, 0), 0);
assert.equal(browser.results.filter(test => test.passed).length, 6);
const runtimeChanges = git('diff', '--name-only', 'HEAD', '--', 'frontend/src', 'backend').toString().trim().split(/\r?\n/).filter(Boolean);
assert.deepEqual(runtimeChanges, ['frontend/src/components/admin/AdminSupportDashboard.js']);
const protectedFiles = ['backend/routes/admin/support.py', 'frontend/src/lib/apiClient.js',
  'frontend/src/contexts/AuthContext.js', 'frontend/src/contexts/ThemeContext.js',
  'frontend/src/components/ui/button.jsx', 'frontend/src/components/ui/select.jsx',
  'docs/weather-program/STATE.md', 'docs/weather-program/ACTIONS.jsonl', 'docs/weather-program/SCOREBOARD.md'];
const protectedHashes = protectedFiles.map(file => {
  // Git compares the working file using its repository line-ending rules.
  const unchanged = git('diff', 'HEAD', '--', file).length === 0;
  assert.equal(unchanged, true, `${file} changed unexpectedly`);
  return { path: file, unchanged, workingSha256: sha256(fs.readFileSync(path.join(root, file))) };
});
const source = 'frontend/src/components/admin/AdminSupportDashboard.js';
const files = [source, 'frontend/src/components/admin/AdminSupportDashboard.test.js',
  ...fs.readdirSync(__dirname).filter(name => /\.(cjs|js|jsx)$/.test(name)).map(name => `docs/audits/evidence/2026-10-29-admin-support-selection/${name}`)];
const result = {
  verifiedAt: new Date().toISOString(), branch: git('branch', '--show-current').toString().trim(),
  entryHead: git('rev-parse', 'HEAD').toString().trim(),
  baseline: summarize(baseline), final: summarize(final),
  lint: lint.map(file => ({ file: path.relative(root, file.filePath).replace(/\\/g, '/'), errors: file.errorCount, warnings: file.warningCount })),
  browser: { engine: browser.engine, browserVersion: browser.browserVersion, passed: browser.results.length, themes: ['light', 'dark', 'beach'], viewports: ['1440x1000', '390x844'], themeCssVerified: true },
  trackedRuntimeChanges: runtimeChanges,
  originalSourceGitSha256: sha256(git('show', `HEAD:${source}`)),
  files: files.map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
  protectedHashes,
  limits: ['Transport uses fictional data; no authenticated full-app or live API qualification',
    'Chrome viewport emulation is not physical-device or cross-browser acceptance',
    'Reply storage/delivery, ticket list/filter/pagination, metrics and backend policies remain separate',
    'No commit, push, merge, deployment, shared migration, provider action or weather runtime change'],
};
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ baseline: { passed: result.baseline.passed, failed: result.baseline.failed, total: result.baseline.total },
  final: { passed: result.final.passed, failed: result.final.failed, total: result.final.total }, browser: result.browser.passed, runtimeChanges }));
