/** Opt-in qualification scope; normal application regression selection is unchanged. */
const ALLOWED = new Set([
  '.github/workflows/e2e-tests.yml',
  // Exact test-only CI corrections; production backend and weather paths stay excluded.
  '.github/workflows/ci.yml',
  'backend/tests/test_ci_floor_staleness.py',
  'backend/tests/test_guardian_level_gates.py',
  'frontend/e2e/offlineWeather.js',
  'frontend/e2e/seededUiIsolation.js',
  'frontend/scripts/seededUiIsolation.test.cjs',
  'frontend/scripts/offline-backend/weather_route.js',
  'frontend/scripts/offlineWeatherRoute.test.cjs',
  'frontend/scripts/offline-backend/route_lifecycle.js',
  'frontend/scripts/syntheticCleanup.test.cjs',
  'frontend/scripts/e2eHarnessScope.cjs',
  'frontend/scripts/e2eHarnessScope.test.cjs',
  // Exact synthetic-diagnostics files; never allow a directory or production weather path.
  'frontend/e2e/requestRecorder.js',
  'frontend/scripts/offline-backend/ci_weather_backend.sh',
  'frontend/scripts/offline-backend/serve_synthetic.py',
  'frontend/scripts/offline-backend/series_diagnostics.cjs',
  'frontend/scripts/offline-backend/series_diagnostics.py',
  'frontend/scripts/offline-backend/test_series_diagnostics.py',
  'frontend/scripts/offline-backend/connection_diagnostics.py',
  'frontend/scripts/offline-backend/test_connection_diagnostics.py',
  'frontend/scripts/seriesDiagnostics.test.cjs',
]);
const marked = message => String(message || '').split(/\r?\n/, 1)[0].includes('[harness chromium]');
function selectScope({ eventName, message, files, project = '' }) {
  if (/[\r\n]/.test(project)) throw new Error('Project selection must be a single line');
  if (eventName === 'workflow_dispatch') return { project, scope: 'explicit-dispatch' };
  if (eventName !== 'push') throw new Error('Unsupported E2E trigger');
  if (!marked(message)) return { project: '', scope: 'normal-regression' };
  if (!Array.isArray(files) || !files.length || files.some(file => !ALLOWED.has(file))) {
    throw new Error('Marked harness qualification requires a nonempty exact harness-only diff; refusing browser execution');
  }
  return { project: 'Desktop Chrome', scope: 'harness-chromium' };
}
if (require.main === module) {
  const fs = require('node:fs');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const eventName = process.env.GITHUB_EVENT_NAME;
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const message = event.head_commit?.message || '';
  let files;
  if (eventName === 'push' && marked(message)) {
    const before = event.before, head = process.env.GITHUB_SHA;
    if (![before, head].every(sha => /^[a-f0-9]{40}$/i.test(sha || '') && !/^0+$/.test(sha))) {
      throw new Error('Marked harness qualification requires verifiable before/head commits');
    }
    const cwd = path.resolve(__dirname, '../..');
    if (execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim() !== head) {
      throw new Error('E2E checkout does not match the source under qualification');
    }
    files = execFileSync('git', ['diff', '--no-renames', '--name-only', '-z', before, head, '--'],
      { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
  }
  const selected = selectScope({ eventName, message, files, project: event.inputs?.project || '' });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `project=${selected.project}\nscope=${selected.scope}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### E2E selection\n- Scope: ${selected.scope}\n- Project: ${selected.project || 'all normal projects'}\n`);
  console.log(JSON.stringify({ ...selected, changedFiles: files?.length }));
}
module.exports = { selectScope };
