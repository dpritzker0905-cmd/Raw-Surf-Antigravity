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


const socketDiagnosticHarness = ['frontend/e2e/seededUiIsolation.js',
  'frontend/scripts/seededUiIsolation.test.cjs',
  'frontend/scripts/e2eHarnessScope.cjs', 'frontend/scripts/e2eHarnessScope.test.cjs'];

test('exact socket-diagnostic integration selects Chrome in selector and CLI; normal coverage stays unchanged', () => {
  assert.deepEqual(selectScope({ ...marked, files: socketDiagnosticHarness }),
    { project: 'Desktop Chrome', scope: 'harness-chromium' });
  const cli = runCli({ before: 'a'.repeat(40), head_commit: { message: marked.message } },
    { files: socketDiagnosticHarness });
  assert.equal(cli.writes[0].text, 'project=Desktop Chrome\nscope=harness-chromium\n');
  assert.deepEqual(selectScope({ eventName: 'push', message: 'normal socket diagnostics', files: socketDiagnosticHarness }),
    { project: '', scope: 'normal-regression' });
});

test('socket-diagnostic opt-in refuses test-path lookalikes and mixed production paths', () => {
  for (const path of ['frontend/scripts/seededUiIsolation.test.cjs.extra',
    'frontend/scripts/seededUiIsolation.test.js', 'frontend/src/App.js',
    'backend/services/weather_pipeline/grid_series_helper.py', 'docs/weather-program/STATE.md']) {
    assert.throws(() => selectScope({ ...marked, files: [...socketDiagnosticHarness, path] }), /refusing browser execution/);
  }
});

const connectionDiagnosticHarness = ['.github/workflows/e2e-tests.yml',
  'frontend/scripts/offline-backend/serve_synthetic.py',
  'frontend/scripts/offline-backend/connection_diagnostics.py',
  'frontend/scripts/offline-backend/test_connection_diagnostics.py',
  'frontend/scripts/e2eHarnessScope.cjs', 'frontend/scripts/e2eHarnessScope.test.cjs'];

test('exact connection-logging integration chooses Chromium in selector and actual CLI', () => {
  assert.deepEqual(selectScope({ ...marked, files: connectionDiagnosticHarness }),
    { project: 'Desktop Chrome', scope: 'harness-chromium' });
  const cli = runCli({ before: 'a'.repeat(40), head_commit: { message: marked.message } },
    { files: connectionDiagnosticHarness });
  assert.equal(cli.writes[0].text, 'project=Desktop Chrome\nscope=harness-chromium\n');
});

test('unmarked connection logging preserves normal browser selection', () => {
  assert.deepEqual(selectScope({ eventName: 'push', message: 'normal logging', files: connectionDiagnosticHarness }),
    { project: '', scope: 'normal-regression' });
});

test('connection-logging marker refuses lookalikes, folders and mixed application or weather paths', () => {
  for (const other of ['frontend/scripts/offline-backend/connection_diagnostics.py.extra',
    'frontend/scripts/offline-backend/test_connection_diagnostics.js',
    'frontend/scripts/offline-backend/', 'frontend/src/App.js',
    'backend/services/weather_pipeline/grid_resolver.py', 'docs/weather-program/STATE.md']) {
    assert.throws(() => selectScope({ ...marked, files: [...connectionDiagnosticHarness, other] }), /refusing browser execution/);
  }
});

const ciCorrectionHarness = ['.github/workflows/ci.yml',
  'backend/tests/test_ci_floor_staleness.py', 'backend/tests/test_guardian_level_gates.py',
  'frontend/scripts/e2eHarnessScope.cjs', 'frontend/scripts/e2eHarnessScope.test.cjs'];

test('exact test-only CI correction selects Chromium while unmarked selection stays normal', () => {
  assert.deepEqual(selectScope({ ...marked, files: ciCorrectionHarness }),
    { project: 'Desktop Chrome', scope: 'harness-chromium' });
  const cli = runCli({ before: 'a'.repeat(40), head_commit: { message: marked.message } },
    { files: ciCorrectionHarness });
  assert.equal(cli.writes[0].text, 'project=Desktop Chrome\nscope=harness-chromium\n');
  assert.deepEqual(selectScope({ eventName: 'push', message: 'normal CI correction', files: ciCorrectionHarness }),
    { project: '', scope: 'normal-regression' });
});

test('CI correction opt-in refuses metadata lookalikes and actual guardian or weather runtime changes', () => {
  for (const other of ['.github/workflows/ci.yml.extra', 'backend/tests/test_guardian_level_gates.py.extra',
    'backend/tests/', 'backend/routes/auth_pkg/auth.py', 'backend/services/guardian_levels.py',
    'backend/services/weather_pipeline/grid_resolver.py', 'frontend/src/App.js']) {
    assert.throws(() => selectScope({ ...marked, files: [...ciCorrectionHarness, other] }), /refusing browser execution/);
  }
});

// Expected entry snapshots independently captured from the pinned Git trees.
const bookingsFixtures = {
  "703": {
    "beforeSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "headSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "baseAncestor": true,
    "sourceAncestor": true,
    "dependencyAncestor": true,
    "beforeEntries": {
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
    "afterEntries": {
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
    "beforeSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "headSha": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "baseAncestor": true,
    "sourceAncestor": true,
    "dependencyAncestor": true,
    "beforeEntries": {
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
    "afterEntries": {
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
const bookingsFiles = {
  "703": [
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
  "705": [
    "frontend/src/components/Bookings.js",
    "frontend/src/components/Bookings.liveSessionsLoadErrors.test.js",
    "frontend/src/hooks/useBookingsActions.js",
    "frontend/src/hooks/useBookingsLiveSessionsList.js"
  ]
};

function bookingsInput(stage) {
  return { eventName: 'push', message: `integrate [bookings chromium #${stage}]`,
    files: [...bookingsFiles[stage]], bookings: structuredClone(bookingsFixtures[stage]) };
}
for (const stage of ['703', '705']) {
  test(`Bookings ${stage}: exact pinned stage selects Chrome`, () => {
    assert.deepEqual(selectScope(bookingsInput(stage)),
      { project: 'Desktop Chrome', scope: `bookings-chromium-${stage}` });
  });
  test(`Bookings ${stage}: absent or wrong evidence refuses instead of normal browsers`, () => {
    for (const field of ['beforeSha', 'headSha', 'baseAncestor', 'sourceAncestor', 'dependencyAncestor',
      'beforeEntries', 'afterEntries']) {
      if (field === 'dependencyAncestor' && stage === '703') continue;
      const input = bookingsInput(stage); delete input.bookings[field];
      assert.throws(() => selectScope(input), /refusing browser execution/);
    }
  });
  test(`Bookings ${stage}: expanded, missing, duplicate and lookalike paths refuse`, () => {
    for (const files of [[], bookingsFiles[stage].slice(1), [...bookingsFiles[stage], bookingsFiles[stage][0]],
      [...bookingsFiles[stage], 'frontend/src/App.js'], [...bookingsFiles[stage], 'docs/weather-program/STATE.md'],
      [...bookingsFiles[stage], 'frontend/scripts/e2eHarnessScope.cjs'],
      bookingsFiles[stage].map((p, i) => i === 0 ? p + '.extra' : p)]) {
      assert.throws(() => selectScope({ ...bookingsInput(stage), files }), /refusing browser execution/);
    }
  });
  test(`Bookings ${stage}: changed blob, deleted dependency and mode changes refuse`, () => {
    for (const side of ['beforeEntries', 'afterEntries']) {
      for (const value of [null, '100644:' + 'f'.repeat(40), '120000:' + 'f'.repeat(40)]) {
        const input = bookingsInput(stage);
        const path = 'frontend/src/hooks/useBookingsActions.js'; input.bookings[side][path] = value;
        assert.throws(() => selectScope(input), /refusing browser execution/);
      }
    }
  });
  test(`Bookings ${stage}: missing expected absence and unexpected metadata refuse`, () => {
    const missing = bookingsInput(stage); delete missing.bookings.afterEntries[bookingsFiles[stage][0]];
    assert.throws(() => selectScope(missing), /refusing browser execution/);
    const extra = bookingsInput(stage); extra.bookings.afterEntries['frontend/src/App.js'] = null;
    assert.throws(() => selectScope(extra), /refusing browser execution/);
  });
}
test('Bookings marker cannot accidentally widen or fall back to Safari', () => {
  for (const message of ['integrate [bookings chromium #999]', 'integrate [bookings chromium]',
    'integrate [bookings chromium #703] [bookings chromium #705]',
    'integrate [harness chromium] [bookings chromium #703]']) {
    assert.throws(() => selectScope({ ...bookingsInput('703'), message }), /refusing browser execution/);
  }
});
test('unmarked Bookings app push preserves ordinary regression; body quote is not opt-in', () => {
  for (const message of ['normal Bookings change', 'normal\n[bookings chromium #703]']) {
    assert.deepEqual(selectScope({ ...bookingsInput('703'), message }), { project: '', scope: 'normal-regression' });
  }
});
test('dispatch keeps its explicit selection without evaluating a Bookings marker', () => {
  assert.deepEqual(selectScope({ ...bookingsInput('703'), eventName: 'workflow_dispatch',
    project: 'Desktop Firefox', bookings: null }), { project: 'Desktop Firefox', scope: 'explicit-dispatch' });
});
test('705 never accepts the cumulative thirteen-path diff or extra CI changes', () => {
  assert.throws(() => selectScope({ ...bookingsInput('705'), files: Object.keys(bookingsFixtures['705'].afterEntries) }), /refusing browser execution/);
  assert.throws(() => selectScope({ ...bookingsInput('705'), files: [...bookingsFiles['705'], '.github/workflows/ci.yml'] }), /refusing browser execution/);
});


// Exercise the actual CLI bootstrap; only filesystem/Git process boundaries are synthetic.
function runBookingsCli(stage, options = {}) {
  const vm = require('node:vm'), fs = require('node:fs');
  const input = bookingsInput(stage), fixture = input.bookings;
  const writes = [], calls = [], mod = { exports: {} };
  const message = options.message || input.message;
  const event = { before: options.before || fixture.beforeSha, head_commit: { message } };
  const load = name => {
    if (name === 'node:fs') return { readFileSync: () => JSON.stringify(event),
      appendFileSync: (file, text) => writes.push({ file, text }) };
    if (name === 'node:path') return require(name);
    if (name === 'node:child_process') return { execFileSync: (command, args) => {
      assert.equal(command, 'git'); calls.push(args);
      if (args[0] === 'rev-parse') return (options.checkout || fixture.headSha) + '\n';
      if (args[0] === 'diff') {
        assert.ok(args.includes('--no-renames')); assert.ok(args.includes('-z'));
        return (options.files || input.files).join('\0') + '\0';
      }
      if (args[0] === 'merge-base') {
        assert.equal(args[1], '--is-ancestor');
        const source = stage === '703' ? '7df56ab831d5d3afa5ef37074fa7be15b23dfb12' : '39f288be6f3fcad51e5d772bc2a8f6b008947494';
        const target = options.rejectAncestor;
        if (options.gitError || target === 'all' || (target === 'source' && args[2] === source)
          || (target === 'dependency' && stage === '705' && args[2] === '7df56ab831d5d3afa5ef37074fa7be15b23dfb12')) {
          const error = new Error('Synthetic ancestry refusal'); error.status = options.gitError ? 128 : 1; throw error;
        }
        return '';
      }
      assert.equal(args[0], '--literal-pathspecs'); assert.equal(args[1], 'ls-tree');
      assert.equal(args[2], '-z'); assert.equal(args[4], '--');
      const side = args[3] === fixture.beforeSha ? 'beforeEntries' : 'afterEntries';
      const path = args[5]; let entry = fixture[side][path];
      if (options.badBlob && path === 'frontend/src/hooks/useBookingsActions.js' && side === 'afterEntries') entry = '100644:' + 'f'.repeat(40);
      if (options.badMode && path === 'frontend/src/hooks/useBookingsActions.js') entry = '120000:' + 'f'.repeat(40);
      if (!entry) return '';
      const [mode, blob] = entry.split(':'); return `${mode} blob ${blob}\t${path}\0`;
    } };
    throw new Error('Unexpected dependency');
  };
  load.main = mod;
  let error;
  try {
    vm.runInNewContext(fs.readFileSync(require.resolve('./e2eHarnessScope.cjs'), 'utf8'), {
      require: load, module: mod, __dirname: '/repo/frontend/scripts',
      process: { env: { GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_PATH: '/event',
        GITHUB_SHA: fixture.headSha, GITHUB_OUTPUT: '/out', GITHUB_STEP_SUMMARY: '/summary' } },
      console: { log: () => {} },
    });
  } catch (caught) { error = caught; }
  return { error, writes, calls };
}
for (const stage of ['703', '705']) {
  test(`Bookings ${stage}: actual bootstrap selects Chrome after Git path, mode, blob and ancestry proof`, () => {
    const result = runBookingsCli(stage);
    assert.equal(result.error, undefined);
    assert.equal(result.writes[0].text, `project=Desktop Chrome\nscope=bookings-chromium-${stage}\n`);
    assert.equal(result.calls.filter(a => a[0] === '--literal-pathspecs').length, 26);
    assert.equal(result.calls.filter(a => a[0] === 'merge-base').length, stage === '703' ? 3 : 4);
  });
  test(`Bookings ${stage}: invalid CLI proof produces zero outputs or summaries`, () => {
    for (const options of [{ badBlob: true }, { badMode: true }, { rejectAncestor: 'all' },
      { rejectAncestor: 'source' }, { gitError: true }, { checkout: 'c'.repeat(40) },
      { before: '0'.repeat(40) }, { files: [...bookingsFiles[stage], 'frontend/src/App.js'] },
      { message: 'integrate [bookings chromium #999]' }]) {
      const result = runBookingsCli(stage, options);
      assert.ok(result.error, JSON.stringify(options));
      assert.deepEqual(result.writes, [], JSON.stringify(options));
    }
  });
}
test('705 actual bootstrap cannot run before its pinned703 dependency', () => {
  const result = runBookingsCli('705', { rejectAncestor: 'dependency' });
  assert.match(result.error.message, /refusing browser execution/); assert.deepEqual(result.writes, []);
});
