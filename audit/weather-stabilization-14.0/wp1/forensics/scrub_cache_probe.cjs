// Executes the real hook's effect with controlled dependencies, not a copied state machine.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../../../..');
const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const babel = frontendRequire('@babel/core');
const sourcePath = path.join(root, 'frontend/src/components/map/useMarineOrchestratorScrubCache.js');
const mode = process.argv[2] || 'baseline';
assert(['baseline', 'current', 'disable_request', 'disable_frame', 'disable_temporal', 'ignore_engine'].includes(mode));
const source = mode === 'baseline'
  ? execFileSync('git', ['show', '91b90ae9:frontend/src/components/map/useMarineOrchestratorScrubCache.js'], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(sourcePath, 'utf8');
const transformed = babel.transformSync(source, {
  babelrc: false, configFile: false,
  plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')],
}).code;
const ref = current => ({ current });
const bounds = { west: -82, south: 26, east: -79, north: 30 };

function timelineModule(window) {
  const module = { exports: {} };
  let source = fs.readFileSync(path.join(root, 'frontend/src/components/map/marineTimelineCoverage.js'), 'utf8');
  if (mode === 'disable_temporal') source = source.replace(
    'const responseTimeMismatch = requested !== null && selected !== null && requested !== selected;',
    'const responseTimeMismatch = false;');
  if (mode === 'ignore_engine') source = source.replace(
    'const grid = win?.__MARINE_ENGINE__?._waveData?.waveGrid;', 'const grid = null;');
  const code = babel.transformSync(source, { babelrc: false, configFile: false,
    plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')] }).code;
  vm.runInNewContext(code, { module, exports: module.exports, window, Date });
  if (mode === 'disable_request') module.exports.publishMarineTimelineRequest = () => null;
  if (mode === 'disable_frame') module.exports.publishMarineTimelineFrame = () => null;
  return module.exports;
}

function run({ scrubbing, series }) {
  const window = { isScrubbingTimeline: scrubbing,
    __FORECAST_TIMELINE_COVERAGE_DIAG__: {
      timeOffsetHours: 18, selectedValidTime: '2026-09-21T15:00:00Z',
      requestedValidTime: '2026-09-21T15:00:00Z', coverage_status: 'full_coverage',
    } };
  const enqueued = [], committed = [], events = [];
  const coverageModule = { exports: {} };
  const coverageSource = babel.transformSync(fs.readFileSync(path.join(root,
    'frontend/src/components/map/marineWarmCoverage.js'), 'utf8'), {
    babelrc: false, configFile: false,
    plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  vm.runInNewContext(coverageSource, { module: coverageModule, exports: coverageModule.exports,
    window }, { filename: 'marineWarmCoverage.js' });
  const frame = series ? { hourOffset: 0, valid_time: '2026-09-20T21:00:00Z',
    grid: { __sourceModel: 'GFS', __componentLayer: 'waves', __renderable: true,
      vectors: [{ speed: 1, lat: 27, lng: -80 }], cols: 1, rows: 1, bounds } } : null;
  const mocks = {
    react: { useEffect: fn => fn() },
    './marineController': { getMarineHourlyCache: () => null, getModelSafeMarine: () => null },
    './backendWeatherServiceClient': { getBackendWeatherFlag: () => true,
      getBackendIconMarineFlag: () => false, getBackendCopernicusFlag: () => false,
      getSharedValidTime: () => '2026-09-20T21:00:00Z' },
    './marineControllerUtils': {},
    './marineGridHash': { computeGridContentHash: () => 123 },
    './useMarineOrchestratorDiag': { _marineDataSignature: data => 'signature-' + data.hourOffset },
    './marineGridSeries': { getMarineSeriesFrame: () => frame },
    './marineZoomThresholds': { MARINE_ZOOMED_OUT_MAX_ZOOM: 7 },
    './marineWarmCoverage': coverageModule.exports,
    './marineTimelineCoverage': timelineModule(window),
    './useMarineDataFetcherHelpers': { DISPLAY_ICON_MAX_HOURS: 336,
      DISPLAY_EURO_WAVES_MAX_HOURS: 336, DISPLAY_EURO_COMPONENT_MAX_HOURS: 336 },
  };
  const module = { exports: {} };
  vm.runInNewContext(transformed, { module, exports: module.exports,
    require: name => { assert(name in mocks, name); return mocks[name]; },
    window, Date, console: { log() {} } }, { filename: sourcePath });
  const timeOffsetRef = ref(18), previous = ref(18);
  module.exports.useMarineOrchestratorScrubCache({
    timeOffsetHours: 0,
    mapInstance: { getBounds: () => ({ getWest: () => bounds.west, getSouth: () => bounds.south,
      getEast: () => bounds.east, getNorth: () => bounds.north }), getZoom: () => 9 },
    activeMarineLayersRef: ref(true), prevTimeOffsetRef: previous, timeOffsetRef,
    activeModelRef: ref('GFS'), activeMarineLayerRef: ref('waves'),
    lastCommittedSigRef: ref('signature-18'), marineRevision: ref(1),
    marineFetchLocksRef: ref({ lastHash: 'old', lastTime: 1 }),
    setMarineData: data => committed.push(data.hourOffset),
    logPipelineEventHelper: name => events.push(name), getViewportHash: () => 'new-hour0',
    updateMarineGridRef: ref(() => {}), enqueueMarineUpdate: source => enqueued.push(source),
  });
  assert.strictEqual(timeOffsetRef.current, 0, 'single owner reaches the fetch ref');
  assert.strictEqual(previous.current, 0);
  const timeline = window.__FORECAST_TIMELINE_COVERAGE_DIAG__;
  assert.strictEqual(timeline.timeOffsetHours, mode === 'baseline' ? 18 : 0);
  if (mode !== 'baseline') {
    assert.strictEqual(timeline.selectedValidTime, series ? '2026-09-20T21:00:00Z' : '2026-09-21T15:00:00Z');
    assert.strictEqual(timeline.coverage_status, series ? 'full_coverage' : 'stale_time_mismatch');
  }
  if (series) assert.deepStrictEqual(committed, [0]);
  else assert.deepStrictEqual(enqueued, scrubbing ? [] : ['timeline_scrub_deferred']);
  return { scrubbing, series, ownerHour: timeOffsetRef.current, committedHours: committed,
    enqueued, events, timeline: window.__FORECAST_TIMELINE_COVERAGE_DIAG__ };
}

const cases = [];
for (const input of [{ scrubbing: false, series: false }, { scrubbing: true, series: false },
  { scrubbing: false, series: true }]) {
  try { cases.push({ pass: true, ...run(input) }); }
  catch (error) { cases.push({ pass: false, ...input, error: error.message }); }
}
if (mode !== 'baseline') {
  const window = { __MARINE_RENDER_HOUR_PARITY__: { renderedDataHour: 18 },
    __MARINE_ENGINE__: { _waveData: { waveGrid: { __sourceModel: 'GFS', __componentLayer: 'waves',
      valid_time: '2026-09-20T21:00:00Z', hourOffset: 0 } } },
    __FORECAST_TIMELINE_COVERAGE_DIAG__: { domain: 'marine', activeModel: 'GFS', activeLayer: 'waves',
      timeOffsetHours: 0, requestedValidTime: '2026-09-20T21:00:00Z', selectedValidTime: '2026-09-20T21:00:00Z',
      coverage_status: 'full_coverage' } };
  try {
    const result = timelineModule(window).reconcileMarineTimelineCoverage(window);
    assert.strictEqual(result.coverage_status, 'full_coverage');
    assert.strictEqual(result.renderVerified, true);
    cases.push({ case: 'accepted_engine_over_legacy', pass: true });
  } catch (error) { cases.push({ case: 'accepted_engine_over_legacy', pass: false, error: error.message }); }
}
const result = { mode, baselineRevision: '91b90ae9',
  note: 'Controlled dependency experiment against actual hook. Not a browser or network test. Mutations are in-memory only.',
  cases, passed: cases.filter(c => c.pass).length, failed: cases.filter(c => !c.pass).length };
fs.writeFileSync(path.join(__dirname, mode === 'baseline' ? 'scrub-cache-probe.json' : `scrub-cache-${mode}.json`), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.failed) process.exitCode = 1;
