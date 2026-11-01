// GPU FRAMES BENCH: prefetch-policy simulator. Replays the visual lab's owner flows (frontend/scripts/visual-lab/lab.js FLOWS,
// read from that file so the two never drift) as wheel key presses against a model of the CDN, a worker decode pool and the GPU
// texture budget, and scores each policy: time to the EXACT frame per press and at settle, toggles, bytes (= CDN egress) and GPU MB.
// A pure model: no browser, no network, no backend. The per-frame costs come from bench.js runs (see the spec).
//   node frontend/scripts/gpu-frames-bench/prefetch_sim.js [--flows erratic,...] [--net desktop|4g|slow] [--press 40] [--seeds 20] [--json out.json]
'use strict';
const fs = require('fs');
const path = require('path');

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : dflt; };
const LAB = path.join(__dirname, '..', 'visual-lab', 'lab.js');
const src = fs.readFileSync(LAB, 'utf8');
// lab.js is a tracked file of this repo (trusted input); it runs on require, so its FLOWS literal is read as text.
const LAB_FLOWS = new Function(`return ${src.slice(src.indexOf('const FLOWS = {') + 'const FLOWS = '.length, src.indexOf('\n};\n', src.indexOf('const FLOWS = {')) + 2)}`)();

// ---- the world being simulated ----------------------------------------------------------------------------------------
// Two sessions the lab does not have, for the egress estimate: a glance (open, look at now, two short steps) and one model scrubbed
// a week ahead and back.
const FLOWS = { ...LAB_FLOWS,
  glance: { setup: { model: 'GFS', layers: ['waves'] }, view: [-80, 25, 3.5], steps: [['+3h', 3], ['+6h', 6]] },
  scrub_week: { setup: { model: 'GFS', layers: ['waves'] }, view: [-80, 25, 3.5], steps: [['+24h', 24], ['+72h', 72], ['+168h', 168], ['Home', 0]] },
};
const MODELS = ['GFS', 'ICON', 'EURO'];
const LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves', 'wind'];
// Product hours per model over the 14-day horizon: GFS / ICON (incl. the locked 14-day extension blend) 3-hourly; EURO 3-hourly
// to 144 h, then 6-hourly (ECMWF open data). A wheel hour shows the nearest product within +-3 h, as pickIndexFrame does.
const HOURS = {
  GFS: Array.from({ length: 113 }, (_, i) => i * 3),
  ICON: Array.from({ length: 113 }, (_, i) => i * 3),
  EURO: [...Array.from({ length: 49 }, (_, i) => i * 3), ...Array.from({ length: 32 }, (_, i) => 150 + i * 6)],
};
const WORLD_KB = 56;      // measured: real GFS/ICON/EURO world frames 55.3-56.7 KB gzipped
const REGION_KB = 15;     // regional frames (scrub-lag diagnosis: largest ~15 KB)
const LAYER_BYTES = 181 * 83 * 4; // RGBA8 texture layer
const NETS = {
  desktop: { bwBpms: 6250, ttfbMed: 50, ttfbSig: 0.5, decodeMs: 6 },   // 50 Mbit/s, CDN edge hit
  '4g': { bwBpms: 1000, ttfbMed: 120, ttfbSig: 0.6, decodeMs: 25 },    // 8 Mbit/s, phone CPU ~4x slower (bench cpu4 run)
  slow: { bwBpms: 200, ttfbMed: 300, ttfbSig: 0.5, decodeMs: 25 },     // 1.6 Mbit/s
  // MEASURED live 2026-10-21 (lead session, curl -D from the owner's PC to the weather-frames bucket): Cloudflare HIT 0.34 s,
  // cold MISS 0.71 s per frame request. The 50 ms desktop TTFB above is a generic edge figure; these are this owner's.
  cdn_hit: { bwBpms: 6250, ttfbMed: 340, ttfbSig: 0.25, decodeMs: 6 },
  cdn_cold: { bwBpms: 6250, ttfbMed: 710, ttfbSig: 0.25, decodeMs: 6 },
};
const FRAME_MS = 16.7;

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function lognorm(r, med, sig) { const u = Math.max(1e-9, r()); const v = r(); return med * Math.exp(sig * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); }
const nearestIdx = (hours, h) => { let b = 0; for (let i = 1; i < hours.length; i++) if (Math.abs(hours[i] - h) < Math.abs(hours[b] - h)) b = i; return b; };
const regionOf = (view) => (view[2] >= 6 ? `r${Math.round(view[0] / 20)}_${Math.round(view[1] / 20)}` : 'world');

// ---- flows -> a timeline of presses and switches -----------------------------------------------------------------------
// Each wheel move becomes the key presses lab.js's seek() sends (PageUp/PageDown = 24 h, arrows = 1 h), PRESS ms apart;
// after each flow step the lab dwells about 2 s (wait for the correct field + 1 s of screenshots).
function timeline(flow, pressMs) {
  const ev = []; let t = 0; let hour = 0; const st = { model: flow.setup.model, layer: flow.setup.layers.find((l) => l !== 'wind') || flow.setup.layers[0], view: flow.view };
  ev.push({ t, kind: 'load', ...st, hour });
  const seek = (to, label) => {
    const d = to - hour; const big = Math.floor(Math.abs(d) / 24); const small = Math.abs(d) % 24;
    if (to === 0) { t += pressMs; hour = 0; ev.push({ t, kind: 'press', hour, label, last: true }); return; }
    const n = big + small; let k = 0;
    for (let i = 0; i < big; i++) { t += pressMs; hour += Math.sign(d) * 24; ev.push({ t, kind: 'press', hour, label, last: ++k === n }); }
    for (let i = 0; i < small; i++) { t += pressMs; hour += Math.sign(d); ev.push({ t, kind: 'press', hour, label, last: ++k === n }); }
  };
  t = 9000;
  if (flow.setup.hour) { seek(flow.setup.hour, 'setup'); t += 6000; }
  for (const [label, act] of flow.steps) {
    if (typeof act === 'number') seek(act, label);
    else { t += 50; ev.push({ t, kind: 'switch', label, ...(act.layer ? { layer: act.layer } : {}), ...(act.model ? { model: act.model } : {}), ...(act.view ? { view: act.view } : {}), hour }); }
    t += 2000;
  }
  ev.push({ t: t + 1000, kind: 'end' });
  return ev;
}

// ---- policies -----------------------------------------------------------------------------------------------------------
// want(state) -> ordered list of frame keys to have resident, highest priority first. Keys: `${model}/${layer}/${region}/${idx}`.
const key = (m, l, r, i) => `${m}/${l}/${r}/${i}`;
function activeOrder(st, dir, limit) {
  const hrs = HOURS[st.model]; const c = nearestIdx(hrs, st.hour); const out = [];
  for (let d = 0; out.length < Math.min(limit, hrs.length); d++) {
    const a = c + (dir >= 0 ? d : -d); const b = c - (dir >= 0 ? d : -d);
    if (a >= 0 && a < hrs.length) out.push(key(st.model, st.layer, st.region, a));
    if (d > 0 && b >= 0 && b < hrs.length && out.length < limit) out.push(key(st.model, st.layer, st.region, b));
    if (d > hrs.length) break;
  }
  return out;
}
function warmOrder(st) {  // the CURRENT hour of every other model x layer (world), so a toggle is warm
  const out = [];
  for (const m of MODELS) for (const l of LAYERS) if (m !== st.model || l !== st.layer) out.push(key(m, l, 'world', nearestIdx(HOURS[m], st.settledHour)));
  return out;
}
function warmAdjacent(st) {  // one click away: the other layers of this model, the other models of this layer (world, current hour)
  const out = [];
  for (const l of LAYERS) if (l !== st.layer) out.push(key(st.model, l, 'world', nearestIdx(HOURS[st.model], st.settledHour)));
  for (const m of MODELS) if (m !== st.model) out.push(key(m, st.layer, 'world', nearestIdx(HOURS[m], st.settledHour)));
  return out;
}
// The gate: the rest of a set's series streams only once the user has stayed on that set 3 s or scrubbed it (st.committed).
const gated = (st, dir) => { const a = activeOrder(st, dir, 999); return [...a.slice(0, 17), ...warmAdjacent(st), ...(st.committed ? a.slice(17) : [])]; };
// Intent only: the rest of the series streams once the wheel has moved 4+ frames (12 h at 3-hourly) from where this set started
// (never on dwell alone), so a glance costs a window, not a series. Slow links (Save-Data or effectiveType 2g/3g): 3 in flight, a +-4 window, warm frames after the window.
const intent = (st, dir) => { const a = activeOrder(st, dir, 999); return [...a.slice(0, 17), ...warmAdjacent(st), ...(st.scrubbed ? a.slice(17) : [])]; };
const intentSlow = (st, dir) => { const a = activeOrder(st, dir, 999); return [...a.slice(0, 9), ...warmAdjacent(st), ...(st.scrubbed ? a.slice(9) : [])]; };
const POLICIES = {
  // #422 as it is (DARK today): the exact frame on demand plus a +-4-step window around the focus, 12 decoded frames kept (LRU).
  static_422: { inFlight: 4, gpuFrames: 12, want: (st, dir) => activeOrder(st, dir, 9), abortStale: true },
  // spec: the active set's WHOLE series nearest-first (direction-biased), then the current hour of the 14 other sets.
  spec_v0: { inFlight: 6, gpuFrames: 1100, want: (st, dir) => [...activeOrder(st, dir, 999).slice(0, 9), ...warmOrder(st), ...activeOrder(st, dir, 999).slice(9)] },
  // SPEC (refined): +-8 frames (+-24 h) of the active set first, then the 6 one-click-away sets' current hour, then the rest of the
  // active series once the set is committed (3 s on it, or a scrub). Desktop GPU budget ~64 MB, phone ~16 MB.
  spec_gated: { inFlight: 6, gpuFrames: 1100, want: gated },
  spec_intent: { inFlight: 6, gpuFrames: 1100, want: intent },
  spec_intent_mobile: { inFlight: 6, gpuFrames: 270, want: intent },
  spec_intent_slow: { inFlight: 3, gpuFrames: 270, want: intentSlow },
  spec_gated_mobile: { inFlight: 6, gpuFrames: 270, want: gated },
  // as first briefed, on a phone budget: active series + warm + ONE previous full set (GPU ~16 MB), LRU beyond.
  spec_mobile: { inFlight: 6, gpuFrames: 270, want: (st, dir) => [...activeOrder(st, dir, 999).slice(0, 9), ...warmOrder(st), ...activeOrder(st, dir, 999).slice(9)] },
  // active series only (no warm toggles): shows what the 14 warm frames buy.
  active_only: { inFlight: 6, gpuFrames: 1100, want: (st, dir) => activeOrder(st, dir, 999) },
  // the reverted June prewarm, CDN edition: every set's whole series at load.
  everything: { inFlight: 6, gpuFrames: 2000, want: (st, dir) => { const out = activeOrder(st, dir, 999); for (const m of MODELS) for (const l of LAYERS) for (let i = 0; i < HOURS[m].length; i++) out.push(key(m, l, 'world', i)); return out; } },
};

// ---- the simulation ---------------------------------------------------------------------------------------------------
function simulate(flowName, policyName, netName, pressMs, seed) {
  const flow = FLOWS[flowName]; const pol = POLICIES[policyName]; const net = NETS[netName]; const r = rng(seed);
  const ev = timeline(flow, pressMs); const end = ev[ev.length - 1].t;
  const resident = new Map();     // key -> last use time (GPU layers)
  const inflight = new Map();     // key -> { start, ttfbAt, bytes, got }
  const decodeQ = []; const workers = [0, 0];
  const st = { model: null, layer: null, region: 'world', hour: 0, settledHour: 0, committed: false, scrubbed: false, origin: 0 }; let setSince = 0; let dir = 1; let want = []; let lastMoveT = 0; let cursor = 0;
  const waiting = [];             // { key, t, kind, last }
  const res = { press: [], settle: [], toggle: [], view: [], bytes: 0, wastedBytes: 0, requests: 0, aborted: 0, peakGpuFrames: 0, approxMs: 0 };
  const bytesOf = (k) => (k.split('/')[2] === 'world' ? WORLD_KB : REGION_KB) * 1024;
  const wantKey = () => key(st.model, st.layer, st.region, nearestIdx(HOURS[st.model], st.hour));
  const recompute = () => {
    const seen = new Set(); want = pol.want(st, dir).filter((k) => (seen.has(k) ? false : (seen.add(k), true))); cursor = 0;
    if (pol.abortStale) { const keep = new Set(want); for (const [k, f] of inflight) if (!keep.has(k)) { inflight.delete(k); res.aborted++; res.wastedBytes += f.got; } }
  };
  let ei = 0;
  for (let t = 0; t <= end; t += 1) {
    while (ei < ev.length && ev[ei].t <= t) {
      const e = ev[ei++];
      if (e.kind === 'load') { Object.assign(st, { model: e.model, layer: e.layer, region: regionOf(e.view), hour: e.hour, settledHour: e.hour, committed: false, scrubbed: false, origin: e.hour }); setSince = t; recompute(); }
      if (e.kind === 'press') { dir = Math.sign(e.hour - st.hour) || dir; st.hour = e.hour; lastMoveT = t; st.committed = true; if (Math.abs(nearestIdx(HOURS[st.model], st.hour) - nearestIdx(HOURS[st.model], st.origin)) >= 4) st.scrubbed = true; recompute(); waiting.push({ key: wantKey(), t, kind: 'press', last: e.last }); }
      if (e.kind === 'switch') { if (e.model) st.model = e.model; if (e.layer) st.layer = e.layer; if (e.view) st.region = regionOf(e.view); if (e.model || e.layer || e.view) { st.committed = false; st.scrubbed = false; st.origin = st.hour; setSince = t; } recompute(); waiting.push({ key: wantKey(), t, kind: (e.model || e.layer) ? 'toggle' : 'view', last: true }); }
    }
    if (t - lastMoveT === 1000 && st.settledHour !== st.hour) { st.settledHour = st.hour; recompute(); }
    if (!st.committed && t - setSince >= 3000) { st.committed = true; recompute(); } // warm frames follow the hour after a 1 s rest
    // transfers: TTFB, then an equal share of the bandwidth
    const moving = [...inflight.values()].filter((f) => t >= f.ttfbAt);
    for (const f of moving) f.got += net.bwBpms / moving.length;
    for (const [k, f] of [...inflight]) if (f.got >= f.bytes) { inflight.delete(k); res.bytes += f.bytes; decodeQ.push(k); }
    for (let w = 0; w < workers.length; w++) if (workers[w] <= t && decodeQ.length) { const k = decodeQ.shift(); workers[w] = t + net.decodeMs; resident.set(k, t + net.decodeMs + 1); }
    // LRU budget: evict the least recently used layers beyond the policy's GPU frames, never one in the first 9 of `want`
    if (resident.size > pol.gpuFrames) {
      const protect = new Set(want.slice(0, 9));
      const lru = [...resident].filter(([k]) => !protect.has(k)).sort((a, b) => a[1] - b[1]);
      while (resident.size > pol.gpuFrames && lru.length) resident.delete(lru.shift()[0]);
      cursor = 0;
    }
    res.peakGpuFrames = Math.max(res.peakGpuFrames, resident.size);
    // start requests, highest priority first
    while (inflight.size < pol.inFlight && cursor < want.length) {
      const k = want[cursor];
      if (resident.has(k) || inflight.has(k) || decodeQ.includes(k)) { cursor++; continue; }
      inflight.set(k, { start: t, ttfbAt: t + lognorm(r, net.ttfbMed, net.ttfbSig), bytes: bytesOf(k), got: 0 }); res.requests++; cursor++;
    }
    // what is on screen: a waiting request is met when its key is resident and usable (resident time <= t)
    for (let i = waiting.length - 1; i >= 0; i--) {
      const w = waiting[i]; const at = resident.get(w.key);
      const superseded = w.kind === 'press' && waiting.some((x, j) => j > i);
      if (at !== undefined && at <= t) {
        const ms = Math.max(FRAME_MS, t - w.t + FRAME_MS); // drawn at the next frame
        if (w.kind === 'press') { res.press.push(ms); if (w.last) res.settle.push(ms); } else if (w.kind === 'toggle') res.toggle.push(ms); else res.view.push(ms);
        waiting.splice(i, 1);
      } else if (superseded && !w.last) { res.press.push(Infinity); waiting.splice(i, 1); } // the user moved on before it came
    }
    if (waiting.length) res.approxMs += 1;
    { const wk = wantKey(); if (resident.has(wk)) resident.set(wk, Math.max(resident.get(wk), t)); } // touch (LRU)
  }
  return res;
}

const pct = (a, p) => { const s = a.filter(Number.isFinite).sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))]) : null; };
function main() {
  const flows = (arg('flows', 'erratic,icon_waves_scrub,model_switch_future,layer_switch_future')).split(',');
  const nets = (arg('net', 'desktop,4g,slow')).split(',');
  const press = +arg('press', 40); const seeds = +arg('seeds', 10);
  const out = [];
  for (const net of nets) for (const pol of Object.keys(POLICIES)) {
    const agg = { press: [], settle: [], toggle: [], view: [], bytes: [], gpu: [], requests: [], missed: 0, presses: 0 };
    for (const f of flows) for (let s = 1; s <= seeds; s++) {
      const r = simulate(f, pol, net, press, s * 7919);
      agg.press.push(...r.press); agg.settle.push(...r.settle); agg.toggle.push(...r.toggle); agg.view.push(...r.view); agg.bytes.push(r.bytes); agg.gpu.push(r.peakGpuFrames); agg.requests.push(r.requests);
      agg.missed += r.press.filter((x) => !Number.isFinite(x)).length; agg.presses += r.press.length;
    }
    const instant = agg.press.filter((x) => x <= FRAME_MS + 0.01).length;
    const row = { net, policy: pol, pressInstantPct: +(100 * instant / Math.max(1, agg.presses)).toFixed(1), pressSkippedPct: +(100 * agg.missed / Math.max(1, agg.presses)).toFixed(1),
      settle: { p50: pct(agg.settle, 0.5), p95: pct(agg.settle, 0.95), max: pct(agg.settle, 1) }, toggle: { p50: pct(agg.toggle, 0.5), p95: pct(agg.toggle, 0.95), max: pct(agg.toggle, 1) }, view: { p50: pct(agg.view, 0.5), p95: pct(agg.view, 0.95) },
      mbPerFlow: +(agg.bytes.reduce((a, b) => a + b, 0) / agg.bytes.length / 1048576).toFixed(2), peakGpuMB: +(Math.max(...agg.gpu) * LAYER_BYTES / 1048576).toFixed(1),
      requestsPerFlow: Math.round(agg.requests.reduce((a, b) => a + b, 0) / agg.requests.length) };
    out.push(row);
    console.log(JSON.stringify(row));
  }
  if (arg('json', null)) fs.writeFileSync(arg('json'), JSON.stringify({ flows, nets, press, seeds, rows: out }, null, 1));
}
if (require.main === module) main();
module.exports = { simulate, timeline, FLOWS, POLICIES, HOURS };
