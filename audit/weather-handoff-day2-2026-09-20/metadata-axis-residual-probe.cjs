// Offline review probe. Actual app metadata/axis helpers + installed decoder; no network.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../..');
const babel = require(path.join(root, 'frontend/node_modules/@babel/core'));
function loadApp(relative) {
  const filename = path.join(root, relative);
  const compiled = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    configFile: false, babelrc: false,
    plugins: [require(path.join(root, 'frontend/node_modules/@babel/plugin-transform-modules-commonjs'))],
  }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded._compile(compiled, filename);
  return loaded.exports;
}
const { fetchModelMetadata, LIVE_FETCHED_MODELS } = loadApp('frontend/src/components/map/openMeteoMetadata.js');
const { closestAxisIndex } = loadApp('frontend/src/components/map/modelHorizons.js');
const { normalizeUrl } = require(path.join(root, 'frontend/node_modules/@openmeteo/weather-map-layer'));
const model = 'ncep_gfswave025';
const bootstrap = { variables: ['wave_height'], referenceTime: '2026-09-20T06:00:00Z',
  validTimes: ['06', '09', '12', '15'].map(h => `2026-09-20T${h}:00:00Z`) };
const provider = { completed: true, reference_time: '2026-09-20T12:00:00Z',
  variables: ['wave_height'], valid_times: ['12', '15', '18', '21'].map(h => `2026-09-20T${h}:00:00Z`) };
const cache = { [model]: bootstrap };
const target = Date.parse('2026-09-20T15:00:00Z');
let fetches = 0;
global.fetch = async () => {
  if (++fetches === 1) throw new Error('first metadata transport unavailable');
  return new Response(JSON.stringify(provider));
};
const realTimeout = global.setTimeout;
global.setTimeout = (...args) => realTimeout(...args).unref();
(async () => {
  const returned = await fetchModelMetadata(model, cache);
  const chosenIndex = closestAxisIndex(cache[model].validTimes, target);
  const correctIndex = closestAxisIndex(provider.valid_times, target);
  const url = `om://https://map-tiles.open-meteo.com/data_spatial/${model}/latest.json?time_step=valid_times_${chosenIndex}&variable=wave_height`;
  const decoded = await normalizeUrl(url);
  assert.equal(returned, bootstrap);
  assert.equal(LIVE_FETCHED_MODELS.has(model), false);
  assert.equal(chosenIndex, 3);
  assert.equal(correctIndex, 1);
  assert(decoded.includes('/1200Z/2026-09-20T2100.om'));
  const result = { source: 'current metadata repair before consuming-hook follow-up', targetTime: new Date(target).toISOString(),
    chosenIndex, correctIndex, decoded, providerRunIsReal: true, wrongTimeOffsetHours: 6, fetches,
    limitation: 'Actual helpers and decoder. Hook admission is source-traced; this is not a mounted-hook or pixel test.' };
  fs.writeFileSync(path.join(__dirname, 'metadata-axis-residual-results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
