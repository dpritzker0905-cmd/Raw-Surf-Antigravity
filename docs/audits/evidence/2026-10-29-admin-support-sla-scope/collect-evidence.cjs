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
const text = fs.readFileSync(path.join(root, source), 'utf8');
const helper = /^[ \t]*<p className="text-\[10px\] text-muted-foreground">Unresolved tickets created in last 30 days<\/p>\r?\n/gm;
assert.equal([...text.matchAll(helper)].length, 1);
assert.equal(sha256(Buffer.from(text.replace(helper, ''))), entry.files.find(file => file.path === source).sha256,
  'Source delta must be only the SLA scope helper paragraph');
const summarize = data => ({ startedAt: new Date(data.startTime).toISOString(), passed: data.numPassedTests, failed: data.numFailedTests, total: data.numTotalTests,
  suites: data.testResults.map(suite => ({ file: path.basename(suite.name), cases: suite.assertionResults.map(test => ({ name: test.fullName, status: test.status })) })) });
const recheck = summarize(read('recheck-raw.json'));
const final = summarize(read('final-raw.json'));
const baseline = read('baseline-sla-scope.json');
const scope = read('sla-scope-cases.json');
const metrics = read('metrics-recheck.json');
const status = read('status-contract.json');
const browser = read('browser-results.json');
const lint = read('lint-raw.json');
assert.equal(recheck.passed, 78); assert.equal(recheck.failed, 0);
assert.equal(final.passed, 78); assert.equal(final.failed, 0);
assert.equal(baseline.missingScopeText, true); assert.equal(baseline.listBadgeVisible, true);
assert.equal(scope.passed, 11); assert.equal(scope.total, 11);
assert.ok(scope.cases.every(test => test.beforeSha256 === test.afterSha256));
assert.equal(metrics.passed, 12); assert.equal(status.passed, 10);
assert.equal(browser.results.filter(test => test.passed && test.characterSet === 'UTF-8').length, 6);
assert.equal(lint.reduce((sum, file) => sum + file.errorCount + file.warningCount, 0), 0);
const runtimeChanges = git('diff', '--name-only', 'HEAD', '--', 'frontend/src', 'backend').split(/\r?\n/).filter(Boolean).sort();
assert.deepEqual(runtimeChanges, ['backend/routes/admin/support.py', source]);
const files = [source, 'backend/routes/admin/support.py',
  ...fs.readdirSync(__dirname).filter(name => /\.(cjs|js|jsx|py)$/.test(name)).map(name => `docs/audits/evidence/2026-10-29-admin-support-sla-scope/${name}`)];
const result = { verifiedAt: new Date().toISOString(), branch: git('branch', '--show-current'), entryHead: git('rev-parse', 'HEAD'),
  entry: { at: entry.verifiedAt, matchedBeforeEdits: entry.files.length, checkpoint }, recheck, final,
  browserBaseline: { missingScopeText: true, olderOverdueBadgeWithZeroCohortCard: true, evidence: 'baseline-sla-scope.json' },
  slaScope: { passed: scope.passed, total: scope.total, actualHandlers: scope.actualHandlersAndTicketModel, allFixtureTablesUnchanged: true },
  priorBackendRecheck: { metrics: { passed: metrics.passed, total: metrics.total }, status: { passed: status.passed, total: status.total } },
  browser: { engine: browser.engine, version: browser.browserVersion, passed: browser.results.length, characterSet: 'UTF-8',
    themes: ['light', 'dark', 'beach'], viewports: ['1440x1000', '390x844'], externalRequests: browser.results.reduce((sum, test) => sum + test.externalRequests, 0) },
  lint: lint.map(file => ({ path: path.relative(root, file.filePath).replace(/\\/g, '/'), errors: file.errorCount, warnings: file.warningCount })),
  runtimeChangedThisSlice: [source], exactlyOneHelperParagraphAdded: true, cumulativeRuntimeChanges: runtimeChanges,
  files: files.map(file => ({ path: file, sha256: sha256(fs.readFileSync(path.join(root, file))) })),
  limits: ['Clarifies existing cohort scope; no SLA calculation, reporting-period policy, lifecycle, backlog, query, or API change',
    'Actual handlers/models in disposable SQLite with UTC SLA-result adapter; not mounted API/auth/PostgreSQL or real tickets',
    'Browser uses fictional transport and actual component/primitives/theme CSS; no physical-device/cross-browser/AT acceptance',
    'No normal app/weather runtime, live/provider/security/paid/shared-migration/commit/push/merge/deployment actions'],
};
fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ entryHashes: entry.files.length, recheckUi: recheck.passed, finalUi: final.passed, slaScope: `${scope.passed}/${scope.total}`,
  priorMetrics: metrics.passed, priorStatus: status.passed, browser: browser.results.length, runtimeAddedLines: 1 }));
