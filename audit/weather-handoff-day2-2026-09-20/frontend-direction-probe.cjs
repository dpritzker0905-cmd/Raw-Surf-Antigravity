// Offline reproduction: load actual frontend functions, stub only external I/O/diagnostics.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../..');
const paths = ['frontend/src/components/map/backendWeatherServiceClientHelpers.js',
  'frontend/src/components/map/backendWeatherServiceClientPoint.js',
  'frontend/src/components/map/backendWeatherServiceClient.js',
  'frontend/src/components/map/useSpotRatings.js', 'frontend/src/components/map/surfRating.js'];
const sourcePath = p => p.includes('backendWeatherServiceClient')
  ? path.join(__dirname, 'snapshots', path.basename(p, '.js') + '.d82032f5.js') : path.join(root, p);
const read = p => fs.readFileSync(sourcePath(p), 'utf8');
const hash = p => crypto.createHash('sha256').update(fs.readFileSync(sourcePath(p))).digest('hex');
const sourceHashes = Object.fromEntries(paths.map(p => [p, hash(p)]));
const plain = text => text.replace(/^import[^\n]*\n/gm, '').replace(/export (async )?function /g, '$1function ').replace(/export const /g, 'const ');
const clock = Date.parse('2026-09-20T00:00:00Z');
const noop = () => {};
function context(provider) {
  const calls = [];
  const ctx = vm.createContext({ Date, Math, Map, AbortController, URL, URLSearchParams,
    window: {}, console: { log: noop, warn: noop, error: noop },
    recordTruthStage: noop, updateDiagnostics: noop, updateProjectionDiag: noop,
    arrayMax: values => Math.max(0, ...values), pointCache: new Map(), POINT_URL: 'https://fixture.invalid/point',
    getSharedValidTime: hour => new Date(clock + hour * 3600000).toISOString(),
    fetch: async url => {
      const query = new URL(url).searchParams;
      const hour = (Date.parse(query.get('valid_time')) - clock) / 3600000;
      const ask = { model: query.get('model'), layer: query.get('layer'), hour };
      calls.push(ask);
      const cell = provider ? provider(ask) : { height: 1, direction: 0 };
      return { ok: true, status: 200, json: async () => ({ point: { speed: cell.height,
        direction: cell.direction, period: 10, interpolation_method: 'bilinear_ocean_masked' } }) };
    },
  });
  vm.runInContext(plain(read(paths[0])) + '\n' + plain(read(paths[1])) + '\n' + plain(read(paths[4])), ctx);
  return { ctx, calls };
}
const vector = (height, direction, isOcean = true) => ({ speed: height, height, direction, period: 10,
  u: -height * Math.sin(direction * Math.PI / 180), v: -height * Math.cos(direction * Math.PI / 180), isOcean });
const summarize = v => ({ height: v.height, speed: v.speed, direction: v.direction,
  isOcean: v.isOcean, u: v.u, v: v.v, waves: v.waves && summarize(v.waves) });
async function main() {
  assert.match(process.argv[2] || '', /^[0-9a-f]{40}$/, 'pass current git HEAD as the sole argument');
  const { ctx } = context();
  const helperCases = [
    { label: 'equal opposite north/south', heights: [1, 1], directions: [0, 180], weights: [.5, .5] },
    { label: 'rotation of same cancellation', heights: [1, 1], directions: [90, 270], weights: [.5, .5] },
    { label: 'reachable 60/40 cancellation', heights: [2, 3], directions: [0, 180], weights: [.6, .4] },
    { label: 'wrap control', heights: [1, 1], directions: [350, 10], weights: [.5, .5] },
    { label: 'calm separate', heights: [0, 0], directions: [0, 180], weights: [.5, .5] },
  ].map(c => ({ ...c, result: ctx.blendDirection(c.heights, c.directions, c.weights) }));
  assert.equal(helperCases[0].result, 90);
  const sub = ctx.blendSubVector(vector(2, 0), vector(3, 180), .6, .4);
  const maskedSource = ctx.blendSubVector(vector(2, 0), vector(3, 180, false), .6, .4);
  const trend = ctx.extrapolateSubVector(vector(3, 0), vector(3, 0), vector(2, 180), .4, .6);
  assert.equal(sub.isOcean, true);
  assert(sub.speed > 0 && Math.hypot(sub.u, sub.v) > 2);
  const pointCases = [];
  for (const [label, hour, layer] of [['trend', 192, 'waves'], ['tail', 300, 'waves'], ['secondary', 24, 'swell_2']]) {
    const { ctx: pc, calls } = context(({ model, hour: at }) => {
      if (label === 'trend') return model === 'ICON' || at === 168
        ? { height: 3, direction: 0 } : { height: 2, direction: 180 };
      return model === 'GFS' ? { height: 2, direction: 0 } : { height: 3, direction: 180 };
    });
    const out = await pc.fetchBackendExactPoint(20, -120, hour, undefined, layer, 'ICON');
    const prefix = layer === 'swell_2' ? 'secondary_swell_wave' : 'wave';
    pointCases.push({ label, hour, layer, status: out.status, height: out.hourly[prefix + '_height'][0],
      direction: out.hourly[prefix + '_direction'][0], provider: out.provider,
      surf_height_m: out.surf_height_m ?? null, requested_provider_points: calls });
    assert.equal(out.status, 'exact_success');
    assert.equal(calls.some(call => call.model === 'ICON' && call.hour === hour), false);
  }
  const gridCases = [];
  for (const hour of [192, 300]) {
    const { ctx: gc } = context();
    const requests = [];
    const bounds = { west: -121, east: -119, south: 19, north: 21 };
    const fetchGrid = async (_bounds, at, _signal, _snapped, layer, model) => {
      requests.push({ model, hour: at, layer });
      const val = hour === 192 ? ((model === 'ICON' || at === 168) ? vector(3, 0) : vector(2, 180))
        : (model === 'GFS' ? vector(2, 0) : vector(3, 180));
      return { grid: { bounds, cols: 1, rows: 1, __oceanMaskCount: 1,
        vectors: [{ lat: 20, lng: -120, ...val, waves: val }] } };
    };
    const result = await gc.fetchBackendMarineGridIconExtended(bounds, hour, undefined, bounds, 'waves', fetchGrid);
    gridCases.push({ hour, vector: summarize(result.grid.vectors[0]), ratingMode: result.grid.ratingMode ?? null,
      renderable: result.grid.renderable, requested_provider_grids: requests });
    assert.equal(result.grid.vectors[0].isOcean, true);
  }
  const report = {
    parent_commit: process.argv[2],
    blend_source_origin: 'Frozen git-show d82032f5 snapshots; probe remains reproducible after the repair.',
    source_sha256: sourceHashes, network_requests: 0,
    method: 'Actual helper, full point fetch and extended grid helper loaded in VM; module imports replaced by diagnostic stubs; all fetch promises synthetic.',
    helperCases, subVector: summarize(sub), maskedSecondarySource: summarize(maskedSource),
    trendVector: summarize(trend), pointCases, gridCases,
    consumer_control: { null_surf_height_rating: ctx.computeSurfRating(null, 10, 2, 0, 90, 90),
      note: 'Mirrored point responses omit surf_height_m, and mirrored grids omit ratingMode; no direct evidence here of corrupted surf-rating glyphs.' },
  };
  assert.deepEqual(Object.fromEntries(paths.map(p => [p, hash(p)])), sourceHashes);
  fs.writeFileSync(path.join(__dirname, 'frontend-direction-results.json'), JSON.stringify(report, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ helperCases, pointCases, gridCases, consumer_control: report.consumer_control }, null, 2));
}
main().catch(err => { console.error(err); process.exitCode = 1; });
