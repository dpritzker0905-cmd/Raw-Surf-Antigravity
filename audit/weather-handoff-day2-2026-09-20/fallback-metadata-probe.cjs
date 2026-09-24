// Offline probe: execute saved d82032f5 baseline, PR22 source, and the installed decoder's actual
// parseMetaJson function with controlled provider promises. Never makes a network request.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const plain = source => source.replace(/^import[^\n]+\n/gm, '').replace(/export (?:var|const) /g, 'var ').replace(/export (async )?function /g, '$1function ');
const currentMap = read('audit/weather-handoff-day2-2026-09-20/snapshots/mapUtils.baseline-d82032f5.js');
const metadataStart = currentMap.indexOf('export var MODEL_METADATA_PROMISES');
const currentMetadata = currentMap.slice(metadataStart, currentMap.indexOf('/**', metadataStart));
const lib = read('frontend/node_modules/@openmeteo/weather-map-layer/dist/index.mjs');
const decoder = ['DOMAIN_META_REGEX', 'TIME_STEP_REGEX'].map(name => lib.match(new RegExp(`const ${name} = [^\n]+`))[0]).join('\n')
  + '\n' + lib.slice(lib.indexOf('const pad ='), lib.indexOf('\n};', lib.indexOf('const pad =')) + 3)
  + '\n' + lib.slice(lib.indexOf('const getModifiedAmount ='), lib.indexOf('let cachedClippingInput ='));
const variants = {
  current: { metadata: currentMetadata, protocol: read('audit/weather-handoff-day2-2026-09-20/snapshots/openMeteoProtocol.baseline-d82032f5.js'), transport: '' },
  pr22: {
    metadata: read('audit/weather-handoff-day2-2026-09-20/snapshots/openMeteoMetadata.pr22.js'),
    protocol: read('audit/weather-handoff-day2-2026-09-20/snapshots/openMeteoProtocol.pr22.js'),
    transport: read('audit/weather-handoff-day2-2026-09-20/snapshots/openMeteoTransport.pr22.js'),
  },
};
const model = 'ncep_gfswave025';
const legacy = `https://map-tiles.open-meteo.com/data_spatial/${model}/`;
const virtual = `om://${legacy}latest.json?time_step=valid_times_1&variable=wave_height&webgl_fallback=true`;
const manifest = {
  completed: true, reference_time: '2026-09-19T12:00:00Z',
  valid_times: ['2026-09-19T12:00:00Z', '2026-09-19T13:00:00Z'], variables: ['wave_height'],
  crs_wkt: 'provider-preserved-fixture', provider_extension: { preserved: true },
};
const bootstrap = () => ({ [model]: { variables: ['wave_height'], referenceTime: '2026-09-19T06:00:00Z', validTimes: ['2026-09-19T06:00:00Z', '2026-09-19T07:00:00Z'] } });
function scope(variant, fetch, cache) {
  const context = vm.createContext({ fetch, Response, Request, URL, URLSearchParams, MODEL_METADATA_CACHE: cache,
    setTimeout: () => 0, console: { warn() {}, error() {} },
    WeatherTelemetry: new Proxy({}, { get: () => () => {} }), MISSING_OM_RUNS: new Set(), MISSING_OM_TILES: new Set() });
  vm.runInContext(plain(variant.transport) + '\n' + plain(variant.metadata), context);
  const start = variant.protocol.indexOf('  const globalCtx =');
  const end = variant.protocol.indexOf("  import('@openmeteo/weather-map-layer')", start);
  assert(start >= 0 && end > start, 'actual interception block must be found');
  vm.runInContext(variant.protocol.slice(start, end), context);
  vm.runInContext(decoder + '\nglobalThis.decodeManifestUrl = parseMetaJson;', context);
  return context;
}
async function flush() { for (let i = 0; i < 16; i++) await Promise.resolve(); }
async function probe(variant) {
  const calls = [], pending = [], cache = bootstrap();
  let changed = 0;
  const context = scope(variant, input => { calls.push(String(input)); return new Promise(resolve => pending.push(resolve)); }, cache);
  let demandSettled = false, decoderSettled = false;
  const demand = context.fetchModelMetadata(model, cache, () => changed++).then(value => { demandSettled = true; return value; });
  const decoded = context.decodeManifestUrl(virtual).then(value => { decoderSettled = true; return value; });
  await flush();
  const beforeProvider = { demandSettled, decoderSettled, providerCalls: calls.length };
  for (const resolve of pending) resolve(new Response(JSON.stringify(manifest)));
  const [returnedMetadata, decodedUrl] = await Promise.all([demand, decoded]);
  await flush();
  const repeatedDecodedUrl = await context.decodeManifestUrl(virtual);
  const warmedManifest = await (await context.fetch(legacy + 'latest.json')).json();
  const invalidCache = {};
  const badContext = scope(variant, async () => new Response(JSON.stringify({ ...manifest, completed: false })), invalidCache);
  await badContext.fetchModelMetadata(model, invalidCache);
  await badContext.MODEL_METADATA_PROMISES[model];
  return { beforeProvider, requestedNetworkUrls: calls, returnedReferenceTime: returnedMetadata.referenceTime,
    eventualCacheReferenceTime: cache[model].referenceTime, decodedUrl, repeatedDecodedUrl, changed,
    warmManifestPreservesProviderExtension: warmedManifest.provider_extension?.preserved === true,
    incompleteManifestMarkedLive: badContext.LIVE_FETCHED_MODELS.has(model) };
}
(async () => {
  const current = await probe(variants.current), pr22 = await probe(variants.pr22);
  assert.equal(current.beforeProvider.demandSettled, true);
  assert.equal(pr22.beforeProvider.demandSettled, false);
  assert(current.decodedUrl.includes('/0600Z/2026-09-19T0700.om'));
  assert(pr22.decodedUrl.includes('/1200Z/2026-09-19T1300.om'));
  assert.equal(current.repeatedDecodedUrl, current.decodedUrl, 'decoder cache retains guessed cycle after live cache changes');
  assert.equal(current.incompleteManifestMarkedLive, true);
  assert.equal(pr22.incompleteManifestMarkedLive, false);
  assert.equal(pr22.warmManifestPreservesProviderExtension, true);
  assert(pr22.requestedNetworkUrls.every(url => url.startsWith('https://openmeteo.s3.amazonaws.com/')));
  assert.equal(current.changed, 1); assert.equal(pr22.changed, 1);
  console.log(JSON.stringify({ measuredAt: new Date().toISOString(), baseline: 'd82032f5', candidateSource: '2488c987 (PR22, included PR23)',
    decoderVersion: '0.0.19', caveat: 'Offline actual-source fixture. No network, GPU, browser or live failure attribution.', current, pr22 }, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
