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
 *     Outcomes: drawn (ms), superseded (a newer ask came first, as in a drag), timeout (nothing matched within 8 s).
 *   - LONG ANIMATION FRAMES: count, frames >= 200 ms, total blocking time, and the worst few with their top scripts' file
 *     name, function and invoker (no query strings, no page URL).
 *   - INP from web-vitals onINP, with attribution (event type, target selector, load state). FID is no longer reported.
 * Sent as ONE small beacon (<= 8 KB) when the page is hidden (visibilitychange / pagehide) with navigator.sendBeacon (a
 * low-priority request), or fetch keepalive + priority 'low' where sendBeacon is missing. Where the browser has fetchLater,
 * the current batch is also armed with it (re-armed at most every 2 s) so it still goes if the page is destroyed without a
 * hide event. Nothing is sent unless an endpoint is configured (REACT_APP_RUM_URL or window.__RAW_RUM_URL__); the record
 * is always readable at window.__RAW_RUM__ for instruments.
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
const PRESS_WINDOW_MS = 1000;
const TIMEOUT_MS = 8000;
const MAX_ROWS = 150;
const MAX_LOAF = 5;
const MAX_BYTES = 8192;
const ARM_EVERY_MS = 2000;

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

export function rumEndpoint() {
  return W().__RAW_RUM_URL__ || process.env.REACT_APP_RUM_URL || null;
}

function freshBatch() {
  return { rows: [], lost: { superseded: 0, timeout: 0 }, loaf: { n: 0, over200: 0, blockMs: 0, worst: [] }, dirty: false };
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

function record(p, ms) {
  const B = S.batch;
  if (B.rows.length >= MAX_ROWS) { B.lost.overflow = (B.lost.overflow || 0) + 1; return; }
  B.rows.push([FAMS.indexOf(p.fam), KINDS.indexOf(p.kind), Math.round(ms), p.zoom, p.model, p.layer, INPUTS.indexOf(p.input)]);
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
  const body = {
    v: 1, build: BUILD_VERSION, pid: S.pid, why: reason, t: Math.round(now()),
    dev: { coarse: !!(W().matchMedia && W().matchMedia('(pointer: coarse)').matches), cores: nav.hardwareConcurrency || null,
      mem: nav.deviceMemory || null, net: conn.effectiveType || null, saveData: conn.saveData === true },
    cols: ['fam', 'kind', 'ms', 'zoom', 'model', 'layer', 'input'], fams: FAMS, kinds: KINDS, inputs: INPUTS,
    p2f: B.rows, lost: B.lost, loaf: B.loaf, inp: S.inp,
  };
  let json = JSON.stringify(body);
  while (json.length > MAX_BYTES && body.p2f.length) {   // keep the newest rows under the cap
    body.p2f = body.p2f.slice(Math.ceil(body.p2f.length / 4));
    body.lost.trimmed = B.rows.length - body.p2f.length;
    json = JSON.stringify(body);
  }
  return { body, json };
}

function sendBeacon(url, json) {
  const nav = W().navigator || {};
  try {
    // text/plain is CORS-safelisted, so a cross-origin endpoint needs no preflight; the server parses the JSON body.
    if (typeof nav.sendBeacon === 'function' && nav.sendBeacon(url, new Blob([json], { type: 'text/plain;charset=UTF-8' }))) return 'beacon';
  } catch (e) { /* fall through */ }
  try {
    W().fetch(url, { method: 'POST', body: json, keepalive: true, priority: 'low', credentials: 'omit',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
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
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' } });
      S.armed = ctrl;
    } catch (e) { S.armed = null; /* quota exceeded or unsupported: the hide beacon still goes */ }
  }, ARM_EVERY_MS);
}

/** Sends (or, with no endpoint, only publishes) the batch collected since the last flush, then starts a new one. */
export function flushInstantTelemetry(reason = 'hidden') {
  if (!S) return null;
  if (!S.batch.dirty) return null;   // nothing new: no request
  const { body, json } = payload(reason);
  const url = rumEndpoint();
  if (S.armed) { try { S.armed.abort(); } catch (e) { /* ignore */ } S.armed = null; }
  if (S.armTimer) { clearTimeout(S.armTimer); S.armTimer = null; }
  const via = url ? sendBeacon(url, json) : null;
  S.sent += 1;
  S.batch = freshBatch();
  const R = W().__RAW_RUM__;
  if (R) { R.last = body; R.lastVia = via; R.lastBytes = json.length; R.sent = S.sent; }
  return { via, bytes: json.length, body };
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
  window.__RAW_RUM__ = { pid: S.pid, sampled: true, loaf, endpoint: !!rumEndpoint(), sent: 0, last: null,
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
