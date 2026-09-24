// Audit-only probe. Real request planner, page cache, frame conversion, and coverage code;
// network/provider boundary and truth telemetry are controlled. No app code changes.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../..');
const deps = path.join(root, 'frontend/node_modules');
const babel = require(path.join(deps, '@babel/core'));
const commonjs = require(path.join(deps, '@babel/plugin-transform-modules-commonjs'));
const src = path.join(root, 'frontend/src/components/map');
const records = [];
let surf = false;
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const COAST = { west: -81.2, south: 27.9, east: -79.95, north: 28.95 };
const WIDE = { west: -100, south: 0, east: -40, north: 50 };
const makeFrame = (hour, bounds = WORLD) => ({
  hour_offset: hour, cols: 2, rows: 2, bounds,
  provider: 'open-meteo', valid_time: new Date(Date.UTC(2026, 8, 20, hour)).toISOString(),
  vectors: [{ lat: 28, lng: -80, u: 0, v: -1, speed: 1 + hour / 100, direction: 0, period: 8 }],
});
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
global.window = { localStorage: { getItem: () => null }, dispatchEvent: () => {}, __MARINE_ENGINE__: {} };
global.fetch = async (url) => {
  records.push({ kind: 'grid_series', url });
  const params = new URL(url, 'https://audit.invalid').searchParams;
  const hours = params.get('hours').split(',').map(Number);
  return { ok: true, status: 200, json: async () => ({ frames: hours.map(h => makeFrame(h)) }) };
};
const gridFetch = async (bounds, hour, signal, snapped, layer = 'waves', model = 'GFS') => {
  records.push({ kind: 'grid', hour, bounds, model, layer });
  return { grid: { ...makeFrame(hour), hourOffset: hour, __sourceModel: model, __componentLayer: layer } };
};
const overrides = {
  apiClient: { API_BASE: '/api', BACKEND_URL: '' },
  backendWeatherServiceClient: {
    getSurfModeFlag: () => surf, fetchBackendMarineGrid: gridFetch,
    getSharedValidTime: (hour) => new Date(Date.UTC(2026, 8, 20, hour)).toISOString(),
  },
  backendCopernicusServiceClient: { fetchBackendCopernicusGrid: (b,h,s,sb,source,l) => gridFetch(b,h,s,sb,l,'EURO') },
  weatherTruthTracker: { buildTruthTag: () => null, recordTruthStage: () => {} },
};
const modules = new Map();
function load(filename) {
  filename = path.resolve(filename);
  if (modules.has(filename)) return modules.get(filename).exports;
  const m = new Module(filename, module);
  modules.set(filename, m);
  m.filename = filename;
  m.paths = [deps];
  m.require = function(spec) {
    const key = path.basename(spec, '.js');
    if (Object.hasOwn(overrides, key)) return overrides[key];
    if (spec.startsWith('.') || path.isAbsolute(spec)) return load(path.resolve(path.dirname(filename), spec + (path.extname(spec) ? '' : '.js')));
    return require(require.resolve(spec, { paths: [deps] }));
  };
  m._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    configFile: false, babelrc: false, plugins: [commonjs], filename,
  }).code, filename);
  return m.exports;
}
const variant = process.env.AUDIT_VARIANT || 'candidate';
const planner = load(variant === 'baseline' ? path.join(__dirname, 'variants/baseline.js') : path.join(src, 'marineGlobalPrewarm.js'));
const series = load(path.join(src, 'marineGridSeries.js'));
const cache = new Map();
planner.registerPrewarmDeps({
  isSiblingPrewarmEnabled: () => window.__MARINE_SIBLING_PREWARM__ !== false,
  getModelSafeMarine: (m,h,l) => cache.get(`${m}|${h}|${l}`),
  cacheMarineResult: (m,h,data,l) => cache.set(`${m}|${h}|${l}`, data),
});
const counts = (entries) => ({ grid: entries.filter(x => x.kind === 'grid').length, series: entries.filter(x => x.kind === 'grid_series').length });
(async () => {
  const hours = [0,3,6,9,12,15,18,21,24];
  for (const hour of hours) { planner.prewarmGlobalMarineGrid('GFS', hour, COAST, 'waves'); await flush(); }
  const stepped = counts(records);
  assert.deepEqual(stepped, { grid: variant === 'baseline' ? 9 : 1, series: 2 });
  assert.equal(window.__MARINE_ENGINE__._pendingCoarseBaseGrid.hourOffset, 0);
  const startRepeat = records.length;
  planner.prewarmGlobalMarineGrid('GFS', 24, COAST, 'waves'); await flush();
  assert.equal(records.length, startRepeat, 'same hour/cache is a healthy zero-request control');
  window.isScrubbingTimeline = true;
  planner.prewarmGlobalMarineGrid('GFS', 27, COAST, 'waves'); await flush();
  assert.equal(records.length, startRepeat, 'active-scrub gate is a healthy zero-request control');
  delete window.isScrubbingTimeline;
  planner.prewarmGlobalMarineGrid('GFS', 27, WIDE, 'waves'); await flush();
  assert.equal(records.length, startRepeat, 'wide viewport does not prewarm');
  const wide24 = series.getMarineSeriesFrame('GFS', 'waves', WIDE, 24);
  const coast24 = series.getMarineSeriesFrame('GFS', 'waves', COAST, 24);
  assert.equal(wide24.grid.hourOffset, 24);
  assert.equal(coast24.grid.hourOffset, 24, 'world series remains a coastal last-resort fallback');
  series._resetMarineSeriesForTest();
  global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ frames: [makeFrame(0)] }) });
  window.__RAW_DISABLE_HOUR0_FIRST__ = true;
  await series.ensureMarineSeries('GFS', 'waves', WORLD, 0, undefined, true);
  assert.equal(series.getMarineSeriesFrame('GFS', 'waves', WIDE, 0).grid.hourOffset, 0);
  assert.equal(series.getMarineSeriesFrame('GFS', 'waves', WIDE, 3), null, 'one h0 frame cannot truthfully satisfy h3');
  assert.equal(series.getMarineSeriesFrame('GFS', 'waves', WIDE, 1).grid.hourOffset, 0, 'documented ±1.5h nearest-frame control');
  series._resetMarineSeriesForTest();
  const output = {
    head: process.env.AUDIT_HEAD || 'unrecorded (set AUDIT_HEAD from git rev-parse HEAD)',
    variant,
    method: 'Real marineGlobalPrewarm + marineGridSeries + marineSeriesFrame + coverage; controlled provider/HTTP boundary, simple controller-cache seam and fixed target-time stub; no browser/GPU or byte/time claim. Jest suite separately exercises real controller cache and getSharedValidTime.',
    steppedHours: hours, steppedRequests: stepped,
    pendingBridgeSeedHourAfterLastStep: window.__MARINE_ENGINE__._pendingCoarseBaseGrid.hourOffset,
    warmWideAndCoastalFallbackHour: wide24.grid.hourOffset,
    controls: { sameHourRequests: 0, activeScrubRequests: 0, widePrewarmRequests: 0, staleH0AtH3: 'miss', h0AtH1: 'nearest frame h0' },
    requests: records,
  };
  fs.writeFileSync(path.join(__dirname, `${variant}-request-probe-results.json`), JSON.stringify(output, null, 2) + '\n');
  console.log(JSON.stringify(output, null, 2));
})().catch(e => { series._resetMarineSeriesForTest(); console.error(e); process.exitCode = 1; });
