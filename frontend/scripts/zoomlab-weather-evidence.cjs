// Read-only, opt-in capture of public weather fields. Never saves headers, request queries,
// arbitrary JSON keys, private routes, or error messages. Body hashes identify exact responses.
const { createHash } = require('crypto');
const META = ['model', 'layer', 'provider', 'upstream_provider', 'source_dataset', 'model_run_time',
  'model_run_time_status', 'served_valid_time', 'valid_time', 'run_time', 'ingested_at', 'hour_offset',
  'is_estimated', 'rating_mode', 'frame_offset_hours', 'frame_substituted', 'product_id', 'coverage_scope'];
const FIELDS = ['lng', 'lat', 'u', 'v', 'speed', 'height', 'period', 'direction', 'isOcean', 'is_valid',
  'dirConfidence', 'dir_confidence', 'phys_speed'];
const LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && Object.hasOwn(o, k))
  .map(k => [k, o[k] === null || typeof o[k] === 'boolean' || (typeof o[k] === 'number' && Number.isFinite(o[k]))
    || (typeof o[k] === 'string' && o[k].length <= 180) ? o[k] : '[unsupported]']));
function attachWeatherEvidence(page, requestIdentity = () => null) {
  const state = { schema: 1, seen: 0, dropped: 0, cells: 0, framesSeen: 0, framesDropped: 0, errors: 0, responses: [] };
  const pending = new Set();
  function frame(raw) {
    state.framesSeen++;
    if (state.framesSeen > 64) { state.framesDropped++; return null; }
    const g = raw.grid || raw;
    const snap = { identity: pick(raw, META), gridIdentity: pick(g, META), ...pick(g, ['cols', 'rows']),
      bounds: pick(g.bounds, ['west', 'south', 'east', 'north']), complete: false, vectors: null };
    if (!Array.isArray(g.vectors)) { snap.reason = 'missing-vectors'; return snap; }
    snap.vectorCount = g.vectors.length;
    if (g.vectors.length > 100000 - state.cells) { snap.reason = 'vector-budget'; return snap; }
    snap.vectors = g.vectors.map(v => ({ ...pick(v, FIELDS), ...Object.fromEntries(LAYERS
      .filter(k => v && v[k] && typeof v[k] === 'object').map(k => [k, pick(v[k], FIELDS)])) }));
    state.cells += g.vectors.length; snap.complete = true;
    return snap;
  }
  async function capture(response, route) {
    const row = { id: ++state.seen, route, status: response.status(), atUTC: new Date().toISOString(),
      network: requestIdentity(response.request()), complete: false };
    if (state.responses.length >= 32) { state.dropped++; return; }
    state.responses.push(row);
    if (row.status !== 200) { row.reason = 'http-status'; return; }
    try {
      const body = await response.body();
      row.bytes = body.length;
      if (body.length > 16 * 1024 * 1024) { row.reason = 'body-budget'; return; }
      row.sha256 = createHash('sha256').update(body).digest('hex');
      const raw = JSON.parse(body.toString('utf8'));
      row.identity = pick(raw, META);
      const frames = Array.isArray(raw.frames) ? raw.frames : [raw];
      row.frameCount = frames.length;
      row.frames = frames.map(frame).filter(Boolean);
      row.complete = row.frames.length > 0 && row.frames.length === frames.length && row.frames.every(f => f.complete);
    } catch (_) { state.errors++; row.reason = 'body-unavailable-or-invalid'; }
  }
  const handler = response => {
    try {
      const url = new URL(response.url());
      if (url.origin !== 'https://raw-surf-antigravity.onrender.com' || url.username || url.password
          || response.request().method() !== 'GET') return;
      const route = { '/api/weather/grid': 'weather-grid', '/api/weather/grid_series': 'weather-grid-series',
        '/api/weather/grid-series': 'weather-grid-series' }[url.pathname];
      if (!route) return;
      const task = capture(response, route); pending.add(task); task.finally(() => pending.delete(task));
    } catch (_) { state.errors++; }
  };
  page.on('response', handler);
  return async () => { page.off('response', handler); await Promise.all([...pending]); return state; };
}
module.exports = { attachWeatherEvidence };
