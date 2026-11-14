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
// Frozen proposal pins: refresh/review them for any newly qualified source or DEV floor change.
const BOOKINGS_STAGES = {
  "703": {
    "base": "f96fd835991a6a7efa4fb8300325082de7102f6e",
    "source": "7df56ab831d5d3afa5ef37074fa7be15b23dfb12",
    "dependency": null,
    "files": [
      ".github/workflows/ci.yml",
      "backend/routes/bookings/invite_lifecycle.py",
      "backend/tests/test_booking_invite_accept_consent.py",
      "backend/tests/test_booking_invite_read_contract.py",
      "backend/tests/test_ci_floor_staleness.py",
      "frontend/src/components/bookings/ScheduledTab.inviteConsent.test.js",
      "frontend/src/components/bookings/ScheduledTab.js",
      "frontend/src/hooks/useBookingsActions.balance.test.js",
      "frontend/src/hooks/useBookingsActions.invites.test.js",
      "frontend/src/hooks/useBookingsActions.js"
    ],
    "before": {
      ".github/workflows/ci.yml": "100644:53e4ee02eabfea9a6df5cfed0a5b1ff2ccaecdc9",
      "backend/routes/bookings/invite_lifecycle.py": "100644:633bd69292374270fb3fd79ebb6d109062ac0dc8",
      "backend/tests/test_booking_invite_accept_consent.py": null,
      "backend/tests/test_booking_invite_read_contract.py": null,
      "backend/tests/test_ci_floor_staleness.py": "100644:242df8615bbe50055bb2e5219547c6cde83f15fa",
      "frontend/src/components/Bookings.js": "100644:5f240404312c94f34f74e082ba0e17ea9e0fc5f1",
      "frontend/src/components/Bookings.liveSessionsLoadErrors.test.js": null,
      "frontend/src/components/bookings/ScheduledTab.inviteConsent.test.js": null,
      "frontend/src/components/bookings/ScheduledTab.js": "100644:daa74fff3a9f5d36e1e9949f69cd7820a6d91ce3",
      "frontend/src/hooks/useBookingsActions.balance.test.js": null,
      "frontend/src/hooks/useBookingsActions.invites.test.js": null,
      "frontend/src/hooks/useBookingsActions.js": "100644:fcbf27ae5700a7c388e359ff9f26783f41435c5f",
      "frontend/src/hooks/useBookingsLiveSessionsList.js": null
    },
    "after": {
      ".github/workflows/ci.yml": "100644:18767dca69ba354675382181bf89e246f8e4d28b",
      "backend/routes/bookings/invite_lifecycle.py": "100644:ce8d4491d23bee58ac05d4d92efcfcdbf3895fdc",
      "backend/tests/test_booking_invite_accept_consent.py": "100644:e2d1dc874f7ad600b252dd1e77bf4cd37721acf4",
      "backend/tests/test_booking_invite_read_contract.py": "100644:7ea294a453007dea5e582a02594104f688706e4c",
      "backend/tests/test_ci_floor_staleness.py": "100644:c9c5b239f66b42971d98d132eb291ec9c7af0c87",
      "frontend/src/components/Bookings.js": "100644:5f240404312c94f34f74e082ba0e17ea9e0fc5f1",
      "frontend/src/components/Bookings.liveSessionsLoadErrors.test.js": null,
      "frontend/src/components/bookings/ScheduledTab.inviteConsent.test.js": "100644:2735ed3f5f2b6fb49c7ab829d9cc31bdf985648d",
      "frontend/src/components/bookings/ScheduledTab.js": "100644:2570d30fb123ed4c9016c0b1aa6af4c9c8314acb",
      "frontend/src/hooks/useBookingsActions.balance.test.js": "100644:d3dd2ef5249654064866fea7cda75c9bcde363f8",
      "frontend/src/hooks/useBookingsActions.invites.test.js": "100644:69766c1bb5f54ccf90e68618237361c0bf241d79",
      "frontend/src/hooks/useBookingsActions.js": "100644:726410c86c0dc1f5af198d8152ba1eb740250bfa",
      "frontend/src/hooks/useBookingsLiveSessionsList.js": null
    }
  },
  "705": {
    "base": "f96fd835991a6a7efa4fb8300325082de7102f6e",
    "source": "39f288be6f3fcad51e5d772bc2a8f6b008947494",
    "dependency": "7df56ab831d5d3afa5ef37074fa7be15b23dfb12",
    "files": [
      "frontend/src/components/Bookings.js",
      "frontend/src/components/Bookings.liveSessionsLoadErrors.test.js",
      "frontend/src/hooks/useBookingsActions.js",
      "frontend/src/hooks/useBookingsLiveSessionsList.js"
    ],
    "before": {
      ".github/workflows/ci.yml": "100644:18767dca69ba354675382181bf89e246f8e4d28b",
      "backend/routes/bookings/invite_lifecycle.py": "100644:ce8d4491d23bee58ac05d4d92efcfcdbf3895fdc",
      "backend/tests/test_booking_invite_accept_consent.py": "100644:e2d1dc874f7ad600b252dd1e77bf4cd37721acf4",
      "backend/tests/test_booking_invite_read_contract.py": "100644:7ea294a453007dea5e582a02594104f688706e4c",
      "backend/tests/test_ci_floor_staleness.py": "100644:c9c5b239f66b42971d98d132eb291ec9c7af0c87",
      "frontend/src/components/Bookings.js": "100644:5f240404312c94f34f74e082ba0e17ea9e0fc5f1",
      "frontend/src/components/Bookings.liveSessionsLoadErrors.test.js": null,
      "frontend/src/components/bookings/ScheduledTab.inviteConsent.test.js": "100644:2735ed3f5f2b6fb49c7ab829d9cc31bdf985648d",
      "frontend/src/components/bookings/ScheduledTab.js": "100644:2570d30fb123ed4c9016c0b1aa6af4c9c8314acb",
      "frontend/src/hooks/useBookingsActions.balance.test.js": "100644:d3dd2ef5249654064866fea7cda75c9bcde363f8",
      "frontend/src/hooks/useBookingsActions.invites.test.js": "100644:69766c1bb5f54ccf90e68618237361c0bf241d79",
      "frontend/src/hooks/useBookingsActions.js": "100644:726410c86c0dc1f5af198d8152ba1eb740250bfa",
      "frontend/src/hooks/useBookingsLiveSessionsList.js": null
    },
    "after": {
      ".github/workflows/ci.yml": "100644:18767dca69ba354675382181bf89e246f8e4d28b",
      "backend/routes/bookings/invite_lifecycle.py": "100644:ce8d4491d23bee58ac05d4d92efcfcdbf3895fdc",
      "backend/tests/test_booking_invite_accept_consent.py": "100644:e2d1dc874f7ad600b252dd1e77bf4cd37721acf4",
      "backend/tests/test_booking_invite_read_contract.py": "100644:7ea294a453007dea5e582a02594104f688706e4c",
      "backend/tests/test_ci_floor_staleness.py": "100644:c9c5b239f66b42971d98d132eb291ec9c7af0c87",
      "frontend/src/components/Bookings.js": "100644:451476e52c9dc03d829486bbeb7aef9e11619722",
      "frontend/src/components/Bookings.liveSessionsLoadErrors.test.js": "100644:99b4aa90f270fab44c3830a4a32fa9cbd0311305",
      "frontend/src/components/bookings/ScheduledTab.inviteConsent.test.js": "100644:2735ed3f5f2b6fb49c7ab829d9cc31bdf985648d",
      "frontend/src/components/bookings/ScheduledTab.js": "100644:2570d30fb123ed4c9016c0b1aa6af4c9c8314acb",
      "frontend/src/hooks/useBookingsActions.balance.test.js": "100644:d3dd2ef5249654064866fea7cda75c9bcde363f8",
      "frontend/src/hooks/useBookingsActions.invites.test.js": "100644:69766c1bb5f54ccf90e68618237361c0bf241d79",
      "frontend/src/hooks/useBookingsActions.js": "100644:c902b6a6cbce8be7cb562fa4275cc2914d778225",
      "frontend/src/hooks/useBookingsLiveSessionsList.js": "100644:548e3d41c4ebd265f8047b2615cf1b509a9ecd7b"
    }
  }
};

const firstLine = message => String(message || '').split(/\r?\n/, 1)[0];
const refuseBookings = () => { throw new Error('Pinned Bookings integration gate rejected evidence; refusing browser execution'); };
function bookingsStage(message) {
  const line = firstLine(message);
  if (!line.includes('[bookings chromium')) return null;
  const tokens = line.match(/\[bookings chromium #(?:703|705)\]/g) || [];
  if (tokens.length !== 1 || line.includes('[harness chromium]')
    || line.replace(tokens[0], '').includes('[bookings chromium')) return refuseBookings();
  return tokens[0].includes('#703') ? '703' : '705';
}
function validateBookings(stage, files, evidence) {
  const pin = BOOKINGS_STAGES[stage];
  const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value) && !/^0+$/.test(value);
  if (!Array.isArray(files) || new Set(files).size !== files.length
    || files.length !== pin.files.length || files.some(file => !pin.files.includes(file))
    || !evidence || !sha(evidence.beforeSha) || !sha(evidence.headSha)
    || evidence.beforeSha === evidence.headSha || evidence.baseAncestor !== true
    || evidence.sourceAncestor !== true || (pin.dependency && evidence.dependencyAncestor !== true)) return refuseBookings();
  for (const [side, expected] of [['beforeEntries', pin.before], ['afterEntries', pin.after]]) {
    const actual = evidence[side];
    if (!actual || Object.keys(actual).length !== Object.keys(expected).length
      || Object.keys(expected).some(path => !Object.hasOwn(actual, path) || actual[path] !== expected[path])) return refuseBookings();
  }
  return { project: 'Desktop Chrome', scope: `bookings-chromium-${stage}` };
}

const marked = message => String(message || '').split(/\r?\n/, 1)[0].includes('[harness chromium]');
function selectScope({ eventName, message, files, project = '', bookings }) {
  if (/[\r\n]/.test(project)) throw new Error('Project selection must be a single line');
  if (eventName === 'workflow_dispatch') return { project, scope: 'explicit-dispatch' };
  if (eventName !== 'push') throw new Error('Unsupported E2E trigger');
  const stage = bookingsStage(message);
  if (stage) return validateBookings(stage, files, bookings);
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
  let files, bookings;
  const stage = eventName === 'push' ? bookingsStage(message) : null;
  if (eventName === 'push' && (marked(message) || stage)) {
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

    if (stage) {
      const pin = BOOKINGS_STAGES[stage];
      const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' });
      const ancestor = (older, newer) => {
        try { git(['merge-base', '--is-ancestor', older, newer]); return true; }
        catch (error) { if (error.status === 1) return false; throw error; }
      };
      const entries = ref => Object.fromEntries(Object.keys(pin.after).map(file => {
        const raw = git(['--literal-pathspecs', 'ls-tree', '-z', ref, '--', file]);
        if (!raw) return [file, null];
        const match = raw.match(/^(100644) blob ([a-f0-9]{40})\t([^\0]+)\0$/);
        if (!match || match[3] !== file) return refuseBookings();
        return [file, `${match[1]}:${match[2]}`];
      }));
      bookings = { beforeSha: before, headSha: head,
        baseAncestor: ancestor(pin.base, before) && ancestor(before, head),
        sourceAncestor: ancestor(pin.source, head),
        dependencyAncestor: pin.dependency ? ancestor(pin.dependency, before) : true,
        beforeEntries: entries(before), afterEntries: entries(head) };
    }
  }
  const selected = selectScope({ eventName, message, files, bookings, project: event.inputs?.project || '' });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `project=${selected.project}\nscope=${selected.scope}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `### E2E selection\n- Scope: ${selected.scope}\n- Project: ${selected.project || 'all normal projects'}\n`);
  console.log(JSON.stringify({ ...selected, changedFiles: files?.length }));
}
module.exports = { selectScope };
