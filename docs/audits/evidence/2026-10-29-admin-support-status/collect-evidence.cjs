const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert/strict');
const { execFileSync } = require('child_process');
const root = path.resolve(__dirname, '../../../..');
const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, name)));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const git = (...args) => execFileSync('git', args, { cwd: root }).toString().trim();
const source = 'frontend/src/components/admin/AdminSupportDashboard.js';
const entry = read('entry-hashes.json');
const checkpoint = entry.files.map(file => {
  const finalSha256 = sha256(fs.readFileSync(path.join(root, file.path)));
  if (file.path !== source) assert.equal(finalSha256, file.sha256, `Unexpected checkpoint drift: ${file.path}`);
  return { ...file, finalSha256, intendedChange: file.path === source };
});
const currentSource = fs.readFileSync(path.join(root, source), 'utf8');
const optionLine = /^[ \t]*<SelectItem value="waiting_internal">Waiting Internal<\/SelectItem>\r?\n/gm;
assert.equal([...currentSource.matchAll(optionLine)].length, 2);
const reconstructedEntry = currentSource.replace(optionLine, '')
  .replace('aria-label="Filter ticket status" className="w-40 bg-muted border-border"', 'aria-label="Filter ticket status" className="w-32 bg-muted border-border"')
  .replace('aria-label="Ticket status" className="w-40 h-8 text-xs bg-muted border-border"', 'aria-label="Ticket status" className="w-28 h-8 text-xs bg-muted border-border"');
assert.equal(sha256(Buffer.from(reconstructedEntry)), entry.files.find(file => file.path === source).sha256,
  'Runtime delta must be exactly two option lines and two trigger width changes');
const summarize = data => ({ startedAt: new Date(data.startTime).toISOString(), passed: data.numPassedTests, failed: data.numFailedTests, total: data.numTotalTests,
  suites: data.testResults.map(suite => ({ file: path.basename(suite.name), cases: suite.assertionResults.map(test => ({ name: test.fullName, status: test.status,
    ...(test.failureMessages.length ? { failure: test.failureMessages[0].replace(/\u001b\[[0-9;]*m/g, '').slice(0, 300) } : {}) })) })) });
const prior = summarize(read('recheck-raw.json'));
const baseline = summarize(read('baseline-raw.json'));
const final = summarize(read('final-raw.json'));
const metrics = read('metrics-recheck.json');
const list = read('list-recheck.json');
const status = read('status-contract.json');
const browser = read('browser-results.json');
const lint = read('lint-raw.json');
assert.equal(prior.passed, 70); assert.equal(prior.failed, 0);
assert.equal(baseline.passed, 2); assert.equal(baseline.total, 8);
assert.equal(final.passed, 78); assert.equal(final.failed, 0);
assert.equal(metrics.passed, 12); assert.equal(list.passed, 10); assert.equal(status.passed, 10);
assert.equal(browser.results.filter(test => test.passed && test.characterSet === 'UTF-8').length, 6);
assert.equal(lint.reduce((sum, file) => sum + file.errorCount + file.warningCount, 0), 0);
const runtimeChanges = git('diff', '--name-only', 'HEAD', '--', 'frontend/src', 'backend').split(/\r?\n/).filter(Boolean).sort();
assert.deepEqual(runtimeChanges, ['backend/routes/admin/support.py', source]);
const files = [source, 'backend/routes/admin/support.py',
  ...['test', 'pagination.test', 'metrics.test', 'samples.test', 'status.test'].map(name => `frontend/src/components/admin/AdminSupportDashboard.${name}.js`),
  ...fs.readdirSync(__dirname).filter(name => /\.(cjs|js|jsx|py)$/.test(name)).map(name => `docs/audits/evidence/2026-10-29-admin-support-status/${name}`)];
const result = { verifiedAt: new Date().toISOString(), branch: git('branch', '--show-current'), entryHead: git('rev-parse', 'HEAD'),
  entry: { at: entry.verifiedAt, matchedBeforeEdits: entry.files.length, checkpoint },
  priorRegression: prior, baseline, final,
  priorBackend: { metrics: { passed: metrics.passed, total: metrics.total }, list: { passed: list.passed, total: list.total } },
  statusContract: { passed: status.passed, total: status.total, statuses: status.existingStatuses, backendSourceUnchanged: true },
  browser: { engine: browser.engine, version: browser.browserVersion, passed: browser.results.length, characterSet: 'UTF-8',
    themes: ['light', 'dark', 'beach'], viewports: ['1440x1000', '390x844'], externalRequests: browser.results.reduce((sum, test) => sum + test.externalRequests, 0) },
  lint: lint.map(file => ({ path: path.relative(root, file.filePath).replace(/\\/g, '/'), errors: file.errorCount, warnings: file.warningCount })),
  runtimeChangedThisSlice: [source], exactlyTwoOptionLinesAdded: true, twoTriggerWidthsAdjusted: true, cumulativeRuntimeChanges: runtimeChanges,
  files: files.map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
  limits: ['Positive SQLite function/query/model persistence with offline dependencies, not mounted authentication or PostgreSQL',
    'Fictional browser transport and real shared controls/theme CSS; not real tickets, physical devices, cross-browser or AT qualification',
    'Status/SLA/backlog/reopen/delivery/ticket-number policies are unchanged',
    'No normal app/weather runtime, provider/security/live-data/paid/shared-migration/commit/push/merge/deployment actions'],
};
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ entryHashes: entry.files.length, prior: `${prior.passed}/${prior.total}`, ui: `${final.passed}/${final.total}`,
  priorMetrics: metrics.passed, priorList: list.passed, statusContract: status.passed, browser: browser.results.length, runtimeEditLocations: 4 }));
