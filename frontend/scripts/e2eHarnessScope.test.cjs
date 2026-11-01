const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectScope } = require('./e2eHarnessScope.cjs');
const harness = ['.github/workflows/e2e-tests.yml', 'frontend/e2e/offlineWeather.js',
  'frontend/e2e/seededUiIsolation.js', 'frontend/scripts/offline-backend/weather_route.js',
  'frontend/scripts/offline-backend/route_lifecycle.js', 'frontend/scripts/syntheticCleanup.test.cjs',
  'frontend/scripts/e2eHarnessScope.cjs', 'frontend/scripts/e2eHarnessScope.test.cjs'];
const marked = { eventName: 'push', message: 'test: qualify harness [harness chromium] [skip render]' };
test('explicit marker plus exact complete harness diff selects only Desktop Chrome', () => {
  assert.deepEqual(selectScope({ ...marked, files: harness }), { project: 'Desktop Chrome', scope: 'harness-chromium' });
});
test('unmarked app and harness pushes preserve all normal projects', () => {
  for (const files of [harness, ['frontend/src/App.js']]) assert.deepEqual(
    selectScope({ eventName: 'push', message: 'normal change', files }), { project: '', scope: 'normal-regression' });
});
test('a marker quoted in the message body is not an opt-in', () => {
  assert.equal(selectScope({ ...marked, message: 'normal change\n\n[harness chromium]', files: harness }).project, '');
});
test('marked app, backend, tests, renamed-old paths and lookalikes refuse all browser execution', () => {
  for (const other of ['frontend/src/App.js','backend/server.py','frontend/e2e/marine-render-continuity.spec.js',
    'frontend/playwright.config.js','frontend/e2e/offlineWeather.js.extra','docs/weather-program/STATE.md']) {
    assert.throws(() => selectScope({ ...marked, files: [...harness, other] }), /refusing browser execution/);
  }
});
test('marked empty and unknown diffs fail closed', () => {
  for (const files of [[], undefined, null]) assert.throws(() => selectScope({ ...marked, files }), /refusing browser execution/);
});
test('dispatch keeps its explicit project or all-project selection even on a marked commit', () => {
  for (const project of ['', 'Desktop Chrome', 'Desktop Firefox', 'Desktop Safari', 'Mobile Safari']) {
    assert.deepEqual(selectScope({ ...marked, eventName: 'workflow_dispatch', project }), { project, scope: 'explicit-dispatch' });
  }
});
test('project output cannot inject another workflow output', () => {
  assert.throws(() => selectScope({ eventName: 'workflow_dispatch', project: 'Desktop Chrome\nscope=fake' }), /single line/);
});
test('unknown triggers do not silently choose browser coverage', () => {
  assert.throws(() => selectScope({ eventName: 'pull_request' }), /Unsupported/);
});


function runCli(event, { head = 'b'.repeat(40), checkout = head, files = harness } = {}) {
  const vm = require('node:vm'), fs = require('node:fs');
  const mod = { exports: {} }, writes = [], calls = [];
  const load = name => {
    if (name === 'node:fs') return { readFileSync: () => JSON.stringify(event),
      appendFileSync: (file, text) => writes.push({ file, text }) };
    if (name === 'node:path') return require(name);
    if (name === 'node:child_process') return { execFileSync: (command, args) => {
      assert.equal(command, 'git'); calls.push(args);
      if (args[0] === 'rev-parse') return checkout + '\n';
      assert.ok(args.includes('--no-renames')); assert.ok(args.includes('-z'));
      return files.join('\0') + '\0';
    } };
    throw new Error('Unexpected dependency');
  };
  load.main = mod;
  const code = fs.readFileSync(require.resolve('./e2eHarnessScope.cjs'), 'utf8');
  vm.runInNewContext(code, { require: load, module: mod, __dirname: '/repo/frontend/scripts',
    process: { env: { GITHUB_EVENT_NAME: event.inputs ? 'workflow_dispatch' : 'push',
      GITHUB_EVENT_PATH: '/event.json', GITHUB_SHA: head, GITHUB_OUTPUT: '/out', GITHUB_STEP_SUMMARY: '/summary' } },
    console: { log: () => {} } });
  return { writes, calls };
}
test('CLI verifies checkout and compares NUL-delimited paths without rename folding', () => {
  const result = runCli({ before: 'a'.repeat(40), head_commit: { message: marked.message } });
  assert.equal(result.calls.length, 2);
  assert.equal(result.writes[0].text, 'project=Desktop Chrome\nscope=harness-chromium\n');
});
test('CLI refuses a zero or unknown comparison base', () => {
  for (const before of ['0'.repeat(40), '', undefined]) assert.throws(
    () => runCli({ before, head_commit: { message: marked.message } }), /verifiable before\/head/);
});
test('CLI refuses an unrelated checked-out source before selecting browsers', () => {
  assert.throws(() => runCli({ before: 'a'.repeat(40), head_commit: { message: marked.message } },
    { checkout: 'c'.repeat(40) }), /checkout does not match/);
});
test('CLI dispatch does not infer the commit marker or invoke Git scope changes', () => {
  const result = runCli({ inputs: { project: 'Desktop Firefox' }, head_commit: { message: marked.message } });
  assert.equal(result.calls.length, 0);
  assert.equal(result.writes[0].text, 'project=Desktop Firefox\nscope=explicit-dispatch\n');
});

const diagnosticsHarness = [
  ".github/workflows/e2e-tests.yml",
  "frontend/e2e/offlineWeather.js",
  "frontend/e2e/requestRecorder.js",
  "frontend/scripts/offline-backend/ci_weather_backend.sh",
  "frontend/scripts/offline-backend/serve_synthetic.py",
  "frontend/scripts/offline-backend/weather_route.js",
  "frontend/scripts/offline-backend/series_diagnostics.cjs",
  "frontend/scripts/offline-backend/series_diagnostics.py",
  "frontend/scripts/offline-backend/test_series_diagnostics.py",
  "frontend/scripts/seriesDiagnostics.test.cjs",
  "frontend/scripts/e2eHarnessScope.cjs",
  "frontend/scripts/e2eHarnessScope.test.cjs"
];

test('marked complete correlated-logging diff selects only Desktop Chrome', () => {
  assert.equal(diagnosticsHarness.length, 12);
  assert.deepEqual(selectScope({ ...marked, files: diagnosticsHarness }),
    { project: 'Desktop Chrome', scope: 'harness-chromium' });
});
test('unmarked correlated logging retains the ordinary regression suite', () => {
  assert.deepEqual(selectScope({ eventName: 'push', message: 'normal change', files: diagnosticsHarness }),
    { project: '', scope: 'normal-regression' });
});
test('logging scope refuses weather code and diagnostic path lookalikes before browsers', () => {
  for (const path of ['backend/services/weather_pipeline/grid_series_helper.py',
    'frontend/scripts/offline-backend/series_diagnostics.py.extra',
    'frontend/src/App.js', 'docs/weather-program/STATE.md']) {
    assert.throws(() => selectScope({ ...marked, files: [...diagnosticsHarness, path] }), /refusing browser execution/);
  }
});
test('actual CLI selects Chrome for the exact correlated logging file set', () => {
  const result = runCli({ before: 'a'.repeat(40), head_commit: { message: marked.message } },
    { files: diagnosticsHarness });
  assert.equal(result.calls.length, 2);
  assert.equal(result.writes[0].text, 'project=Desktop Chrome\nscope=harness-chromium\n');
});
