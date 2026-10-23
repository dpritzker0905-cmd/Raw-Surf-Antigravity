/**
 * instantTelemetry.js — FIELD TELEMETRY for the 'instant' contract (skills audit #3, 2026-10-23).
 *
 * The contract: from the key / drag / tap that asks for an hour, a layer or a model, to the frame for that ask on screen.
 * Tap/step p50 <= 50 ms and p95 <= 100 ms; fail > 200 ms (the INP "good" line). The offline harness measures it on one
 * machine; this measures it on real devices, on a small sample of page loads. An unsampled page records nothing.
 *
 * One sampled page records:
 *   - PRESS-TO-FRAME. The press is the input clock: capture-phase pointerdown / pointermove with a button held / keydown /
 *     wheel timeStamps, the same time origin as performance.now(). The ask is what MapPage reports (noteWeatherAsk). The
 *     frame is the next animation frame after the matching drawn publish (marineDrawnFrame's subscribe hooks, marine and
 *     wind). An ask with no input in the last second (autoplay, a restored state) is not a press and is not counted.
 *     Outcomes: drawn, superseded (a newer ask came first, as in a drag), timeout (nothing matched within 8 s). EVERY drawn
 *     press lands in a histogram per family x kind (HIST_EDGES); the newest MAX_ROWS also keep their zoom, model and layer.
 *   - LONG ANIMATION FRAMES: count, frames >= 200 ms, total blocking time, and the worst few with their top scripts' file
 *     name, function and invoker (no query strings, no page URL).
 *   - INP from web-vitals onINP, with attribution (event type, target selector, load state). FID is no longer reported.
 *
 * THE SINK is the existing, bounded, public POST /api/weather/client-diagnostics (MC-07: schema max-lengths, `details` <= 4096
 * bytes as Python's json.dumps writes it, one sanitized log line, a rotated log): event_type 'instant_rum', everything in
 * `details`. No new route. It is posted same-origin (Netlify proxies /api/* to the backend) once per page hide
 * (visibilitychange hidden / pagehide) with navigator.sendBeacon, a low-priority request, or fetch keepalive + priority 'low'
 * where sendBeacon is missing; an unchanged batch sends nothing. Where the browser has fetchLater, the current batch is also
 * armed with it (re-armed at most every 2 s) so it still goes if the page is destroyed without a hide event. Development
 * builds send nothing unless REACT_APP_RUM_URL or window.__RAW_RUM_URL__ names an endpoint; window.__RAW_RUM_URL__ = '' stops
 * sending in a production build. The record is always readable at window.__RAW_RUM__ for instruments.
 *
 * Sampling: REACT_APP_RUM_SAMPLE (default 0.1) per page load; localStorage '__RAW_RUM__' = 'true' / 'false' forces it in
 * this browser. Kill: window.__RAW_DISABLE_RUM__ = true. No user id, no location, no page URL: a random id per page load.
 */
import { BUILD_VERSION } from '../../buildVersion';
import { getMarineDrawn, getWindDrawn, subscribeMarineDrawn, subscribeWindDrawn } from './marineDrawnFrame';

const MARINE = ['waves', 'swell_1', 'swell_2', 'wind_waves'];
const FAMS = ['marine', 'wind'];
const KINDS = ['step', 'layer', 'model'];
const INPUTS = ['pointerdown', 'pointermove', 'keydown', 'wheel'];
// Histogram upper edges (ms): the contract's lines (50 / 100 / 200 / 500) plus a frame, two frames and the slow tail.
export const HIST_EDGES = [16, 33, 50, 100, 200, 500, 1000, 2000, 4000];
const PRESS_WINDOW_MS = 1000;
const TIMEOUT_MS = 8000;
const MAX_ROWS = 50;
const MAX_LOAF = 4;
const MAX_DETAILS = 3900;   // under the route's 4096-byte bound as Python measures it (see pySize)
const ARM_EVERY_MS = 2000;
const SINK = '/api/weather/client-diagnostics';

const W = () => (typeof window !== 'undefined' ? window : {});
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let S = null;   // the sampled page's state; null when the page is not sampled or telemetry is not installed

function sampleRate() {
  const v = Number(process.env.REACT_APP_RUM_SAMPLE);
  return process.env.REACT_APP_RUM_SAMPLE !== undefined && Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.1;
}

/** Whether this page load is in the sample. Decided by the caller once per page (installInstantTelemetry). */
export function rumSampled(random = Math.random) {
  if (W().__RAW_DISABLE_RUM__ === true) return false;
  try {
    const forced = W().localStorage && W().localStorage.getItem('__RAW_RUM__');
    if (forced === 'true') return true;
    if (forced === 'false') return false;
  } catch (e) { /* storage blocked: fall back to the dice */ }
  return random() < sampleRate();
}

/** Where a batch goes: the window override (even '' = nowhere), then the build's, then the sink in production builds. */
export function rumEndpoint() {
  const w = W().__RAW_RUM_URL__;
  if (typeof w === 'string') return w || null;
  if (process.env.REACT_APP_RUM_URL) return process.env.REACT_APP_RUM_URL;
  return process.env.NODE_ENV === 'production' ? SINK : null;
}

/**
 * The size the route's validator measures, as an upper bound: Python's json.dumps adds a space after every ',' and ':' and
 * (ensure_ascii) writes each non-ASCII UTF-16 unit as a 6-byte \uXXXX escape.
 */
export function pySize(json) {
  let n = json.length;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (c === 44 || c === 58) n += 1;
    else if (c > 127) n += 5;
  }
  return n;
}

function freshBatch() {
  return { rows: [], hist: {}, lost: { superseded: 0, timeout: 0 }, loaf: { n: 0, over200: 0, blockMs: 0, worst: [] }, dirty: false };
}

function zoomNow() {
  try {
    const m = W().__MAP_INSTANCE__;
    const z = m && typeof m.getZoom === 'function' ? m.getZoom() : null;
    return Number.isFinite(z) ? Math.round(z * 10) / 10 : null;
  } catch (e) { return null; }
}

function onInput(e) {
  if (!S || !e) return;
  if (e.type === 'pointermove' && !e.buttons) return;   // only a drag counts as a press while the pointer moves
  const t = Number.isFinite(e.timeStamp) && e.timeStamp <= now() + 1 ? e.timeStamp : now();   // an epoch-based clock: use now
  S.lastInput = { t, type: e.type };
}

function matches(p, d) {
  if (!d || d.hour !== p.hour) return false;
  if (p.fam === 'wind') return true;
  return d.layer === p.layer && (d.model || 'GFS') === p.model;
}

function binOf(ms) {
  const i = HIST_EDGES.findIndex((edge) => ms <= edge);
  return i < 0 ? HIST_EDGES.length : i;
}

function record(p, ms) {
  const B = S.batch;
  const k = `${p.fam}.${p.kind}`;
  const h = B.hist[k] || (B.hist[k] = new Array(HIST_EDGES.length + 1).fill(0));
  h[binOf(ms)] += 1;
  B.rows.push([FAMS.indexOf(p.fam), KINDS.indexOf(p.kind), Math.round(ms), p.zoom, p.model, p.layer, INPUTS.indexOf(p.input)]);
  if (B.rows.length > MAX_ROWS) B.rows.shift();   // the newest rows keep their detail; the histogram has them all
  B.dirty = true;
  arm();
}

function checkDrawn(fam) {
  const p = S && S.pending[fam];
  const d = S && S.drawn[fam];
  if (!p || !d || d.at < p.t0 || !matches(p, d)) return;
  clearTimeout(p.timer);
  S.pending[fam] = null;
  // ON SCREEN: the upload has happened; the frame shows at the next animation frame.
  const raf = W().requestAnimationFrame;
  if (typeof raf === 'function') raf(() => { if (S) record(p, now() - p.t0); });
  else record(p, d.at - p.t0);
}

function onDrawn(fam) {
  if (!S) return;
  const d = fam === 'marine' ? getMarineDrawn() : getWindDrawn();
  S.drawn[fam] = d ? { hour: d.hour, layer: d.layer, model: d.model, at: now() } : null;
  checkDrawn(fam);
}

/**
 * MapPage reports every change of what the weather map is asked to show. The first report is the boot state (no press);
 * an autoplay step is not a press; neither is an ask with no input in the last second.
 */
export function noteWeatherAsk({ model, layers, hour, playing } = {}) {
  if (!S) return;
  const list = Array.isArray(layers) ? layers : [];
  const ask = { model: model || null, marine: list.find((l) => MARINE.includes(l)) || null, wind: list.includes('wind'),
    hour: Number.isFinite(hour) ? hour : null };
  const prev = S.ask;
  S.ask = ask;
  if (!prev || playing) return;
  const kind = prev.model !== ask.model ? 'model'
    : (prev.marine !== ask.marine || prev.wind !== ask.wind) ? 'layer'
      : prev.hour !== ask.hour ? 'step' : null;
  if (!kind) return;
  const inp = S.lastInput;
  const t = now();
  if (!inp || t - inp.t > PRESS_WINDOW_MS) return;
  const zoom = zoomNow();
  for (const fam of FAMS) {
    const layer = fam === 'marine' ? ask.marine : (ask.wind ? 'wind' : null);
    if (!layer) continue;
    if (kind === 'layer' && (fam === 'marine' ? prev.marine === ask.marine : prev.wind === ask.wind)) continue;   // the other family's toggle
    if (kind === 'model' && fam === 'wind') continue;                                                            // wind keeps its own model
    const old = S.pending[fam];
    if (old) { clearTimeout(old.timer); S.batch.lost.superseded += 1; S.batch.dirty = true; }
    const p = { fam, kind, t0: inp.t, input: inp.type, model: ask.model, layer, hour: ask.hour, zoom, timer: null };
    p.timer = setTimeout(() => {
      if (S && S.pending[fam] === p) { S.pending[fam] = null; S.batch.lost.timeout += 1; S.batch.dirty = true; arm(); }
    }, TIMEOUT_MS);
    S.pending[fam] = p;
    checkDrawn(fam);   // the frame may already be up (a resident frame drawn before React's effect ran)
  }
}

function scriptOf(s) {
  const strip = (u) => String(u || '').split('?')[0].split('#')[0];
  let file = '';
  try { file = new URL(s.sourceURL).pathname.split('/').pop(); } catch (e) { file = ''; }
  return { f: file.slice(0, 60), fn: String(s.sourceFunctionName || '').slice(0, 40), inv: strip(s.invoker).slice(0, 60),
    d: Math.round(s.duration || 0) };
}

function noteLoaf(e) {
  if (!S) return;
  const L = S.batch.loaf;
  L.n += 1;
  L.blockMs += Math.round(e.blockingDuration || 0);
  if (e.duration >= 200) L.over200 += 1;
  const row = { d: Math.round(e.duration), b: Math.round(e.blockingDuration || 0), at: Math.round(e.startTime),
    s: Array.from(e.scripts || []).sort((a, b) => (b.duration || 0) - (a.duration || 0)).slice(0, 2).map(scriptOf) };
  L.worst.push(row);
  L.worst.sort((a, b) => b.d - a.d);
  if (L.worst.length > MAX_LOAF) L.worst.length = MAX_LOAF;
  S.batch.dirty = true;
}

function observeLoaf() {
  try {
    const PO = W().PerformanceObserver;
    if (!PO || !PO.supportedEntryTypes || !PO.supportedEntryTypes.includes('long-animation-frame')) return false;
    const po = new PO((list) => { list.getEntries().forEach(noteLoaf); });
    po.observe({ type: 'long-animation-frame', buffered: true });
    S.loafObserver = po;
    return true;
  } catch (e) { return false; }
}

function observeInp(loadVitals) {
  Promise.resolve().then(loadVitals).then((mod) => {
    if (!S || !mod || typeof mod.onINP !== 'function') return;
    mod.onINP((m) => {
      if (!S) return;
      const a = m.attribution || {};
      S.inp = { v: Math.round(m.value), r: m.rating || null, t: a.eventType || null, el: String(a.eventTarget || '').slice(0, 80),
        ls: a.loadState || null };
      S.batch.dirty = true;
    }, { reportAllChanges: true });
  }).catch(() => { /* web-vitals unavailable: INP stays null */ });
}

function payload(reason) {
  const B = S.batch;
  const nav = W().navigator || {};
  const conn = nav.connection || {};
  const details = {
    v: 1, build: BUILD_VERSION, why: reason, t: Math.round(now()),
    dev: { coarse: !!(W().matchMedia && W().matchMedia('(pointer: coarse)').matches), cores: nav.hardwareConcurrency || null,
      mem: nav.deviceMemory || null, net: conn.effectiveType || null, saveData: conn.saveData === true },
    edges: HIST_EDGES, hist: B.hist,
    cols: ['fam', 'kind', 'ms', 'zoom', 'model', 'layer', 'input'], fams: FAMS, kinds: KINDS, inputs: INPUTS,
    p2f: B.rows, lost: { ...B.lost }, loaf: { ...B.loaf, worst: B.loaf.worst.slice() }, inp: S.inp,
  };
  let size = pySize(JSON.stringify(details));
  while (size > MAX_DETAILS && (details.p2f.length || details.loaf.worst.length)) {   // drop detail, oldest first; never the counts
    if (details.p2f.length) details.p2f = details.p2f.slice(Math.ceil(details.p2f.length / 4));
    else details.loaf.worst.pop();
    details.lost.trimmed = B.rows.length - details.p2f.length;
    size = pySize(JSON.stringify(details));
  }
  const report = { timestamp: new Date().toISOString(), event_type: 'instant_rum', correlationId: S.pid, details };
  return { report, json: JSON.stringify(report), detailsBytes: size };
}

function sendBeacon(url, json) {
  const nav = W().navigator || {};
  try {
    // application/json: the route parses JSON only. Same-origin (the /api proxy), so no CORS preflight is involved.
    if (typeof nav.sendBeacon === 'function' && nav.sendBeacon(url, new Blob([json], { type: 'application/json' }))) return 'beacon';
  } catch (e) { /* fall through */ }
  try {
    W().fetch(url, { method: 'POST', body: json, keepalive: true, priority: 'low', headers: { 'Content-Type': 'application/json' } });
    return 'fetch';
  } catch (e) { return null; }
}

// fetchLater safety net: the current batch, sent by the browser if the page is destroyed without a hide event.
function arm() {
  if (!S || typeof W().fetchLater !== 'function' || !rumEndpoint() || S.armTimer) return;
  S.armTimer = setTimeout(() => {
    if (!S) return;
    S.armTimer = null;
    try {
      if (S.armed) S.armed.abort();
      const ctrl = new AbortController();
      W().fetchLater(rumEndpoint(), { method: 'POST', body: payload('destroyed').json, signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' } });
      S.armed = ctrl;
    } catch (e) { S.armed = null; /* quota exceeded or unsupported: the hide beacon still goes */ }
  }, ARM_EVERY_MS);
}

/** Sends (or, with no endpoint, only publishes) the batch collected since the last flush, then starts a new one. */
export function flushInstantTelemetry(reason = 'hidden') {
  if (!S || !S.batch.dirty) return null;   // nothing new: no request
  const { report, json, detailsBytes } = payload(reason);
  const url = rumEndpoint();
  if (S.armed) { try { S.armed.abort(); } catch (e) { /* ignore */ } S.armed = null; }
  if (S.armTimer) { clearTimeout(S.armTimer); S.armTimer = null; }
  const via = url ? sendBeacon(url, json) : null;
  S.sent += 1;
  S.batch = freshBatch();
  const R = W().__RAW_RUM__;
  if (R) { R.last = report; R.lastVia = via; R.lastBytes = detailsBytes; R.sent = S.sent; }
  return { via, detailsBytes, report };
}

/**
 * Once, at boot (index.js). Returns false (and installs nothing) on an unsampled page.
 * `loadVitals` is the web-vitals loader, injectable for tests.
 */
export function installInstantTelemetry({ sampled = rumSampled(), loadVitals = () => import('web-vitals/attribution') } = {}) {
  if (S || !sampled || typeof window === 'undefined' || W().__RAW_DISABLE_RUM__ === true) return false;
  S = { pid: Math.random().toString(16).slice(2, 10), lastInput: null, ask: null, pending: { marine: null, wind: null },
    drawn: { marine: null, wind: null }, batch: freshBatch(), inp: null, sent: 0, armed: null, armTimer: null, unsub: [],
    loafObserver: null };
  for (const type of INPUTS) window.addEventListener(type, onInput, { capture: true, passive: true });
  S.unsub.push(subscribeMarineDrawn(() => onDrawn('marine')), subscribeWindDrawn(() => onDrawn('wind')));
  const loaf = observeLoaf();
  observeInp(loadVitals);
  const onHide = () => { if (document.visibilityState === 'hidden') flushInstantTelemetry('hidden'); };
  const onPageHide = () => flushInstantTelemetry('pagehide');
  document.addEventListener('visibilitychange', onHide, { capture: true });
  window.addEventListener('pagehide', onPageHide, { capture: true });
  S.off = () => {
    for (const type of INPUTS) window.removeEventListener(type, onInput, { capture: true });
    document.removeEventListener('visibilitychange', onHide, { capture: true });
    window.removeEventListener('pagehide', onPageHide, { capture: true });
  };
  window.__RAW_RUM__ = { pid: S.pid, sampled: true, loaf, endpoint: rumEndpoint(), sent: 0, last: null,
    pending: () => (S ? S.batch : null) };
  return true;
}

export function _resetInstantTelemetryForTest() {
  if (S) {
    S.unsub.forEach((u) => { try { u(); } catch (e) { /* ignore */ } });
    Object.values(S.pending).forEach((p) => p && clearTimeout(p.timer));
    if (S.armTimer) clearTimeout(S.armTimer);
    if (S.loafObserver) { try { S.loafObserver.disconnect(); } catch (e) { /* ignore */ } }
    if (S.off) S.off();
  }
  S = null;
  if (typeof window !== 'undefined') delete window.__RAW_RUM__;
}
