// Audit-only: run the actual point diagnostic assignment and actual diagnostic functions.
// This isolates instrument behavior; it does not simulate point/renderer timing or verify pixels.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../..');
const deps = path.join(root, 'frontend/node_modules');
const babel = require(path.join(deps, '@babel/core'));
const commonjs = require(path.join(deps, '@babel/plugin-transform-modules-commonjs'));
const parser = require(path.join(deps, '@babel/parser'));
const traverse = require(path.join(deps, '@babel/traverse')).default;
const src = path.join(root, 'frontend/src/components/map');
global.window = {};
const stubs = {
  apiClient: { BACKEND_URL: '' },
  backendWeatherServiceClientCoverage: { getAvailableTilesFromManifest: () => [], PILOT_COVERAGE: {} },
};
const cache = new Map();
function load(filename) {
  if (cache.has(filename)) return cache.get(filename).exports;
  const m = new Module(filename, module); cache.set(filename, m);
  m.filename = filename; m.paths = [deps];
  m.require = function(spec) {
    if (Object.hasOwn(stubs, path.basename(spec))) return stubs[path.basename(spec)];
    if (spec.startsWith('.')) return load(path.resolve(path.dirname(filename), spec + '.js'));
    return require(require.resolve(spec, { paths: [deps] }));
  };
  m._compile(babel.transformSync(fs.readFileSync(filename, 'utf8'), { configFile: false, babelrc: false, plugins: [commonjs], filename }).code, filename);
  return m.exports;
}
const layer = load(path.join(src, 'WebGLMarineLayerDiag.js'));
const backend = load(path.join(src, 'backendWeatherServiceClientDiag.js'));
const hookPath = path.join(root, 'frontend/src/hooks/useExactPointFetch.js');
const hookSource = fs.readFileSync(hookPath, 'utf8');
const ast = parser.parse(hookSource, { sourceType: 'module', plugins: ['jsx'] });
const writes = [];
traverse(ast, { AssignmentExpression(p) {
  const lhs = p.node.left;
  if (lhs.type === 'MemberExpression' && lhs.object.name === 'window' && lhs.property.name === '__MARINE_POINT_DIAG__') writes.push(p.node);
} });
assert.equal(writes.length, 1, 'exactly one actual point diag assignment');
const names = ['window','pointLat','pointLng','activeModel','activeLayer','timeOffsetHours','targetTimestamp','effectiveExactPointResponse','selected','sourceStr'];
const pointWrite = new Function(...names, hookSource.slice(writes[0].start, writes[0].end));
pointWrite(window, 28.5, -80.5, 'GFS', 'waves', 3, '2026-09-20T03:00:00Z', { forecastDays: 14 }, {
  timeRangeStart: '2026-09-20T00:00:00Z', timeRangeEnd: '2026-10-04T00:00:00Z',
  hourIndex: 1, time: '2026-09-20T03:00:00Z', matchDiffMs: 0,
  wave_height: 2, wave_direction: 90, wave_period: 8,
}, 'exact_point_api');
const engine = { particleRes: 2, _waveData: {} };
const sig = { gridProvider: 'open-meteo', vectorsLength: 4, uploadSig: 'fixture' };
layer.updateWebGLMarineLayerDiag(engine, 'GFS', ['waves'], 3, sig);
assert.equal(Object.hasOwn(window.__MARINE_POINT_DIAG__, 'provider'), false);
assert.equal(window.__WebGLMarineLayer_DIAG__.infoboxHeatmapParity, false);
const baseline = window.__WebGLMarineLayer_DIAG__.infoboxHeatmapParity;
// Healthy positive and meaningful-negative controls distinguish an unwritten key from a dead comparator.
window.__MARINE_POINT_DIAG__.provider = 'open-meteo';
layer.updateWebGLMarineLayerDiag(engine, 'GFS', ['waves'], 3, sig);
assert.equal(window.__WebGLMarineLayer_DIAG__.infoboxHeatmapParity, true);
window.__MARINE_POINT_DIAG__.timeOffsetHours = 6;
layer.updateWebGLMarineLayerDiag(engine, 'GFS', ['waves'], 3, sig);
assert.equal(window.__WebGLMarineLayer_DIAG__.infoboxHeatmapParity, false);
const detail = { activeModel: 'GFS', activeLayer: 'waves', productId: 'same', validTime: '2026-09-20T03:00:00Z', timeOffsetHours: 3, renderable: true, cols: 2, rows: 2, vectorCount: 4 };
window.__FORECAST_TIMELINE_COVERAGE_DIAG__.pointProductId = 'same';
backend.updateProjectionDiag('marine', detail);
assert.equal(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.pointVisualParity, false);
const initialCarry = window.__FORECAST_TIMELINE_COVERAGE_DIAG__.pointVisualParity;
window.__FORECAST_TIMELINE_COVERAGE_DIAG__.pointVisualParity = true;
backend.updateProjectionDiag('marine', { ...detail, productId: 'different', validTime: '2026-09-21T00:00:00Z' });
assert.equal(window.__FORECAST_TIMELINE_COVERAGE_DIAG__.pointVisualParity, true);
const output = {
  head: process.env.AUDIT_HEAD || 'unrecorded',
  actualPointWriterLine: writes[0].loc.start.line,
  pointWriterHasProvider: false,
  infoboxHeatmapParity: { actualWriterMatchingOtherFields: baseline, supplyingMatchingProvider: true, changingHour: false },
  pointVisualParity: { matchingProductsAfterDefaultFalse: initialCarry, changedProductAndTimeAfterInjectedTrue: true },
  scope: 'Diagnostic truth only: no GPU/point service parity or live rendering divergence inferred; production code unchanged',
};
fs.writeFileSync(path.join(__dirname, 'parity-probe-results.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output, null, 2));
