// Execute actual source functions against the generic-series response probe. No application edits.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const { createRequire } = require('module');
const root = path.resolve(__dirname, '../../../..');
const frontendRequire = createRequire(path.join(root, 'frontend/package.json'));
const babel = frontendRequire('@babel/core');
const backend = JSON.parse(fs.readFileSync(path.join(__dirname, 'series-anchor-backend.json'), 'utf8'));
function loadFunction(relative, name, scope) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const ast = babel.parseSync(source, { babelrc: false, configFile: false, sourceType: 'module' });
  const fn = ast.program.body.map(n => n.declaration || n).find(n => n.type === 'FunctionDeclaration' && n.id.name === name);
  assert(fn, name);
  const code = babel.transformSync(`export ${source.slice(fn.start, fn.end)}`, {
    babelrc: false, configFile: false,
    plugins: [frontendRequire.resolve('@babel/plugin-transform-modules-commonjs')],
  }).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, Date, ...scope });
  return module.exports[name];
}
const nearest = loadFunction('frontend/src/components/map/marineGridSeries.js', 'nearestFrameInEntry', {});
const mapper = loadFunction('frontend/src/components/map/marineSeriesFrame.js', 'frameToMarineData', {
  buildTruthTag: data => ({ productId: data.product_id, validTime: data.valid_time, run_time: data.run_time }),
  recordTruthStage() {}, window: {},
});
const noManifest = [], observed = [];
for (const entry of backend.cases) {
  const sharedTime = manifest => loadFunction('frontend/src/components/map/backendWeatherServiceClient.js', 'getSharedValidTime', {
    window: { __MOCK_DATE_NOW__: Date.parse(entry.now) }, getCachedManifest: () => manifest,
    latestTimeDiag: {}, fetchProductsManifest: () => { throw new Error('read-only lookup must not fetch'); },
  });
  const noManifestTime = sharedTime(null);
  const f18 = entry.response.frames.find(f => f.hour_offset === 18);
  const expected = noManifestTime(18, 'waves', 'GFS', { readOnly: true });
  noManifest.push({ now: entry.now, requestedHour: 18, requestedValidTime: expected,
    seriesBaseTime: entry.response.base_time, seriesValidTime: f18.valid_time,
    mismatchHours: (Date.parse(expected) - Date.parse(f18.valid_time)) / 3600000 });
  if (entry.now !== '2026-09-20T20:52:35Z') continue;
  const manifest = { products: ['2026-09-20T21:00:00Z', '2026-09-21T15:00:00Z'].map(valid_time_start => ({
    model: 'GFS', domain: 'marine', layer: 'waves', valid_time_start,
  })) };
  const requestedTime = sharedTime(manifest);
  const frames = new Map(entry.response.frames.map(f => [f.hour_offset, mapper(f, 'GFS', 'waves')]));
  for (const hour of [0, 1, 18]) {
    const selected = nearest({ frames, hours: [...frames.keys()] }, hour).frame;
    observed.push({ requestedHour: hour, requestedValidTime: requestedTime(hour, 'waves', 'GFS', { readOnly: true }),
      seriesHour: selected.hourOffset, selectedValidTime: selected.valid_time,
      gridValidTime: selected.grid.valid_time, wrapperProductId: selected.product_id,
      gridProductId: selected.grid.productId ?? selected.grid.product_id ?? null,
      modelRunTime: selected.model_run_time, legacyRunTime: selected.run_time });
  }
}
assert.deepStrictEqual(noManifest.map(c => c.mismatchHours), [0, 1, 1, 0]);
assert.strictEqual(observed[1].requestedValidTime, '2026-09-20T21:00:00.000Z');
assert.strictEqual(observed[1].selectedValidTime, '2026-09-20T20:00:00Z');
assert.strictEqual(observed[2].requestedValidTime, '2026-09-21T15:00:00.000Z');
assert.strictEqual(observed[2].selectedValidTime, '2026-09-21T14:00:00Z');
const result = { note: 'Actual shared-time resolver, series mapper and nearest-frame selector with controlled dependencies; no HTTP/GPU claim.',
  phaseControls: noManifest, observedClockFixture: observed };
fs.writeFileSync(path.join(__dirname, 'series-anchor-frontend.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
