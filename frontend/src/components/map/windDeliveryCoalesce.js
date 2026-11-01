/**
 * windDeliveryCoalesce.js — what the wind layer hands the engine per effect run (owner manual test 2026-10-25, dev build
 * d1653d4f; shared notes owner-manual-test-2026-10-25/FINDINGS.md).
 *
 * WHAT THE OWNER SAW. "setWindData triggered by effect: delivering 8 grid(s)" (and 10), maxWindSpeed flapping 26.43 <-> 27.87 kn,
 * the colour ramp rebuilt on each flap; and, after a model switch, EURO +68 h "Fetching wind (attempt 1/5)" + "Wind Cache Hit" ~8x.
 *
 * THE MECHANISM (WeatherEngine's commit choke + WebGLWindLayer's #14 delivery drain).
 *   - Every commit is pushed onto the delivery queue BEFORE React's setState. A cache hit returns the cached grid OBJECT, so React
 *     bails out of the render (same state) while the queue keeps a duplicate; base-first commits push a world then a clip.
 *   - The next real change runs the layer effect once, and it delivers EVERYTHING queued (up to 16): duplicates, world/clip pairs
 *     and grids of an hour or model already left behind. Each re-file recomputes the speed scale from the textures it leaves, so
 *     the scale (and the ramp) flips between the world's and the clip's maximum within one batch.
 *
 * THE FIX (each with a kill switch).
 *   - queueWindDelivery: a grid that IS the last one queued is not queued again (React bails out of it anyway).
 *     Kill: window.__RAW_DISABLE_WIND_REASK_DEDUPE__ = true.
 *   - coalesceWindDeliveries: per effect run, deliver at most the newest WORLD grid and the newest CLIP, only those that describe
 *     the same air as the final grid (the engine's own windGridsCompatible: model, hour, valid time), in commit order, ending with
 *     the final grid. #14's case (a world committed earlier in the same batch, then its clip) keeps both.
 *   - The speed scale is set ONCE per run, after the last grid (refreshWindSpeedScale), not after each.
 *     Kill (both): window.__RAW_DISABLE_WIND_DELIVERY_COALESCE__ = true.
 *   - Telemetry (window.__WIND_DELIVERY_COALESCE__) counts what each rule would remove in EITHER arm, so the off arm measures the
 *     mechanism and the on arm the effect.
 *
 * Pure except the opt-out reads and the telemetry object.
 */

const W = () => (typeof window !== 'undefined' ? window : {});
export const WIND_DELIVERY_QUEUE_MAX = 16;

export function windDeliveryTelemetry() {
  const w = W();
  if (!w.__WIND_DELIVERY_COALESCE__) {
    w.__WIND_DELIVERY_COALESCE__ = { pushes: 0, repeats: 0, runs: 0, queued: 0, delivered: 0, dupes: 0, stale: 0, superseded: 0, maxQueued: 0 };
  }
  return w.__WIND_DELIVERY_COALESCE__;
}

export const reaskDedupeOn = () => W().__RAW_DISABLE_WIND_REASK_DEDUPE__ !== true;
export const coalesceOn = () => W().__RAW_DISABLE_WIND_DELIVERY_COALESCE__ !== true;

/** Queue one commit for the layer's drain. Returns whether it was queued. `q` is the WeatherEngine choke's queue array. */
export function queueWindDelivery(q, grid) {
  const t = windDeliveryTelemetry();
  t.pushes += 1;
  const repeat = q.length > 0 && q[q.length - 1] === grid;
  if (repeat) t.repeats += 1;
  if (repeat && reaskDedupeOn()) return false;
  q.push(grid);
  if (q.length > WIND_DELIVERY_QUEUE_MAX) q.splice(0, q.length - WIND_DELIVERY_QUEUE_MAX); // never unbounded while inactive
  return true;
}

const span = (b) => (b ? (b.west > b.east ? (b.east + 360) - b.west : b.east - b.west) : 0);
const isWorld = (g) => span(g && g.bounds) >= 350;
const renderable = (g) => !!(g && g.vectors && g.vectors.length && g.renderable !== false);

/**
 * The grids to deliver this run, in commit order, ending with `data`. `queued` is the drained queue (commit order), `compatible`
 * the engine's windGridsCompatible. With the coalesce killed, today's list: every renderable queued grid, then `data` if it is not
 * last already.
 */
export function coalesceWindDeliveries(queued, data, compatible) {
  const t = windDeliveryTelemetry();
  t.runs += 1;
  const list = (queued || []).filter(renderable);
  if (!list.length || list[list.length - 1] !== data) list.push(data);
  t.queued += list.length; t.maxQueued = Math.max(t.maxQueued, list.length);
  // What the coalesce removes (counted in both arms): repeats of a grid already listed, grids of other air than `data`, and older
  // grids of a slot a newer compatible grid fills.
  const seen = new Set(); const lastBySlot = new Map(); const keep = [];
  list.forEach((g, i) => {
    if (seen.has(g)) { t.dupes += 1; return; }
    seen.add(g);
    if (g !== data && !(typeof compatible === 'function' && compatible(g, data))) { t.stale += 1; return; }
    const slot = isWorld(g) ? 'world' : 'clip';
    if (lastBySlot.has(slot)) t.superseded += 1;
    lastBySlot.set(slot, i);
  });
  const kept = new Set(lastBySlot.values());
  list.forEach((g, i) => { if (kept.has(i)) keep.push(g); });
  if (keep[keep.length - 1] !== data) keep.push(data);    // the final grid is always delivered, last
  const out = coalesceOn() ? keep : list;
  t.delivered += out.length;
  return out;
}

/**
 * The colour ramp's speed scale from what the engine holds (both textures), clamped [10, 80] kn: v3.16's rule, moved here so the
 * layer can set it ONCE per delivery run. Returns whether it changed (the ramp is then rebuilt on the next render).
 */
export function refreshWindSpeedScale(engine, gl) {
  if (!engine || !(engine._windData || engine._windFine)) return false;
  const dataMax = Math.max((engine._windData && engine._windData.maxSpeed) || 0, (engine._windFine && engine._windFine.maxSpeed) || 0) || 50;
  const next = Math.max(10, Math.min(dataMax, 80));
  if (next === engine._maxWindSpeed) return false;
  console.log('[WebGLWind] maxWindSpeed updated: ' + engine._maxWindSpeed + ' -> ' + next + ' kn (data max: ' + dataMax + ')');
  engine._maxWindSpeed = next;
  if (engine._colorRamp && gl) { gl.deleteTexture(engine._colorRamp); engine._colorRamp = null; }
  return true;
}
