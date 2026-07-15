// MARINE RESOLUTION WATCHDOG (2026-07-15) — instrument-to-catch for the stuck-coarse-global state.
//
// WHY: the user reports the marine heatmap/direction going coarse or "different with rating" on
// zoom-out. Full forensics (docs/runbooks/PROOF-2026-07-15-marine-direction-truth-and-resolution.md)
// proved the DATA is authoritative + faithful, and clean zoom paths re-sharpen correctly — the
// culprit is a STRESS-INDUCED "stuck coarse-global" resident (a tile far coarser than the backend
// tier ladder serves for the current viewport) that is NOT reproducible on demand. So we trap it in
// the wild: this watchdog silently records, on each marine commit, when the resident tile is coarser
// than the tier ladder expects for the current viewport. After the user next sees the artifact they
// run `window.__RAW_RES_WATCH__.report()` and the exact trigger (zoom, span, tile, model, time) is
// captured — turning the next occurrence into a proof-backed fix instead of a guess.
//
// Proven backend tier ladder (curl 2026-07-15, GFS/waves, centered FL): fine regional ≤ ~2.5° span
// (~0.23°/cell), global_mid 3–14° (~1.6–1.8°/cell), global_coarse ≥ ~15–20° (9.73°/cell). "Adequate"
// = resident cell no coarser than that. This module is PURE decision + a bounded ring buffer; it
// makes NO rendering/behavior change. Silent by default (no console noise); opt-in warns via
// `window.__RAW_RES_WATCH_WARN__ = true`. Disable entirely: `window.__RAW_DISABLE_RES_WATCH__ = true`.

// Expected MAX acceptable cell size (degrees) for a given viewport span — the backend tier ladder.
// Deliberately LENIENT: `global_mid` (~1.8°/cell) is a LEGITIMATE tier at any coastal/mid viewport
// (fine regional only serves when the viewport fits a fine tile's bbox, so mid-where-fine-might-fit
// is NOT an anomaly — flagging it produced false positives at z8 in live testing). The one
// unambiguous defect is a coarse-GLOBAL-class cell (~9.73°) resident where mid/fine should serve.
export function expectedMaxCellDeg(spanDeg) {
  if (!(spanDeg > 0)) return Infinity;      // unknown span → never flag
  if (spanDeg < 15) return 2.5;             // mid (~1.8°) or finer expected below the global-span cutoff
  return Infinity;                           // coarse-global (9.73°) is CORRECT once genuinely wide (≥15°)
}

// Pure verdict: is the resident cell adequate for the viewport span? The only anomaly is a
// coarse-global-class cell (> 2.5°, i.e. the 9.73° global tile) at a coastal/mid viewport (<15°) —
// the exact stuck state behind the wrong coastal direction (nearest cell 70–190 km offshore).
export function evaluateResidentAdequacy(opts) {
  const o = opts || {};
  const spanDeg = Number(o.spanDeg);
  const cellDeg = Number(o.cellDeg);
  if (!(spanDeg > 0) || !(cellDeg > 0)) return { adequate: true, reason: 'insufficient_data' };
  const expected = expectedMaxCellDeg(spanDeg);
  if (cellDeg > expected) {
    return { adequate: false, reason: 'coarse_global_at_coastal_zoom', cellDeg, spanDeg, expectedMaxCellDeg: expected };
  }
  return { adequate: true, reason: 'ok', cellDeg, spanDeg, expectedMaxCellDeg: expected };
}

function round2(x) { return (typeof x === 'number' && isFinite(x)) ? Math.round(x * 100) / 100 : x; }

// Record one commit sample into the ring buffer. Returns the verdict (or null if disabled/failed).
// Never throws — the caller is on the commit path and must not be broken by a diagnostic.
export function recordResolutionSample(sample, win) {
  const w = win || (typeof window !== 'undefined' ? window : undefined);
  if (!w || w.__RAW_DISABLE_RES_WATCH__ === true) return null;
  try {
    const verdict = evaluateResidentAdequacy(sample || {});
    const store = w.__RAW_RES_WATCH__ = w.__RAW_RES_WATCH__ || {
      log: [], counts: {}, commits: 0, anomalies: 0, lastWarnAt: 0, _lastReason: null,
      report() {
        return { commits: this.commits, anomalies: this.anomalies, counts: { ...this.counts }, recent: this.log.slice(-20) };
      },
      reset() { this.log = []; this.counts = {}; this.commits = 0; this.anomalies = 0; this._lastReason = null; },
    };
    store.commits++;
    if (!verdict.adequate && verdict.reason !== 'insufficient_data') {
      store.anomalies++;
      store.counts[verdict.reason] = (store.counts[verdict.reason] || 0) + 1;
      const entry = {
        t: new Date().toISOString(), reason: verdict.reason, phase: sample.phase,
        z: sample.z, spanDeg: round2(sample.spanDeg), cellDeg: round2(sample.cellDeg),
        expectedMaxCellDeg: verdict.expectedMaxCellDeg, cols: sample.cols, scope: sample.scope,
        model: sample.model, layer: sample.layer, productId: sample.productId,
      };
      store.log.push(entry);
      if (store.log.length > 50) store.log.shift();
      const now = Date.now();
      // Opt-in, throttled (once/10 s, or immediately on a NEW anomaly type) so it never spams.
      if (w.__RAW_RES_WATCH_WARN__ === true && (now - store.lastWarnAt > 10000 || store._lastReason !== verdict.reason)) {
        store.lastWarnAt = now;
        // eslint-disable-next-line no-console
        console.warn('[RES-WATCH] resident coarser than tier ladder:', verdict.reason, entry);
      }
      store._lastReason = verdict.reason;
    } else {
      store._lastReason = null;
    }
    return verdict;
  } catch (e) {
    return null;
  }
}
