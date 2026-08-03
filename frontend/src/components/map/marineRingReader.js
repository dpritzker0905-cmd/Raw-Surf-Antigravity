/**
 * marineRingReader.js — THE CONSUMER. Reads the rings this app already ships and returns a VERDICT.
 *
 * WHY THIS EXISTS (2026-08-03). This app carries ~60 diagnostic globals and nine ring buffers. On
 * 2026-08-03 a single session's forensics produced five findings — and every one came from READING
 * those rings by hand for the first time. Nothing consumes them, so plausible-but-wrong attributions
 * survive until a human happens to look. The gap was never instrumentation. It was consumption.
 *
 * ★ IT IS A VERDICT ENGINE, NOT A DASHBOARD. A dashboard needs someone who already knows what to
 *   look for, and "nobody looked" is the entire failure mode. Every check below returns pass / fail /
 *   skip with THE NUMBER, never a colour.
 * ★ IT REFUSES. A check whose precondition is unmet returns `skip` with the reason — never a pass.
 *   An instrument that answers when it cannot know is worse than none (standing rule 16).
 * ★ IT IS PURE. `readRings(snapshot)` takes a plain object; `captureRings(win)` is the only impure
 *   part. That is what makes the pre-fix regression fixtures in the test file possible.
 *
 * EVERY CHECK IS DERIVED FROM A REAL DEFECT THIS SESSION — none are invented categories:
 *   C1 cardinality collapse   <- the telemetry ring was 495/500 ONE event type; everything else
 *                                evicted within ~17 s. This is the recognised meta-monitoring signal
 *                                ("reduced sample cardinality reflects loss of observability").
 *   C2 cross-instrument       <- `encodeDupCount: 2` beside 500 encode-ish events. Disagreement
 *                                between two counters of the same thing is the highest-yield check;
 *                                it is what actually caught things by hand.
 *   C3 zero-variance field    <- `coverage: "miss"` on every single response. A field with one
 *                                distinct value over many samples is dead, not informative.
 *   C4 poisoned identity key  <- `... || Date.now()` in a dedup key, with `productId: null`. A key
 *                                containing a clock, a null or an undefined cannot dedup.
 *   C5 named invariants       <- |lng| <= 180; len(vectors) == cols*rows; nonzero <= total.
 *
 * ⚠️ WHAT IT DOES NOT DO. It says WHICH INSTRUMENT DISAGREES WITH WHICH. It does not say why
 *    `clamp_resharpen` fires 19 times. It shortens symptom -> attribution; it does not replace the
 *    diagnosis. Today's real cost was chasing three wrong attributions, which is the leverage.
 *
 * Kill: window.__RAW_DISABLE_RING_READER__ = true  (captureRings returns null; readRings unaffected).
 */

export const RING_READER_VERSION = 1;

const PASS = 'pass';
const FAIL = 'fail';
const SKIP = 'skip';

// A ring dominated by one event type past this share has stopped being an instrument: at a fixed
// cap, the dominant type evicts every other signal. 0.80 is deliberately below the 0.99 observed —
// a ring at 80% is already losing the tail it exists to preserve.
export const DOMINANCE_LIMIT = 0.80;
// Below this many samples the share of the top type is not meaningful, so the check REFUSES.
export const MIN_SAMPLES_FOR_CARDINALITY = 25;
// Distinct values a field must show before "it never changes" is a claim rather than a small sample.
export const MIN_SAMPLES_FOR_VARIANCE = 20;
// ⛔ ABOVE THIS SHARE, EVERY OTHER TYPE IN THE RING IS AN UNDERCOUNT — not merely out-shouted.
// FIFO with no per-type quota means the loudest writer deletes the others, so once one type passes
// half the ring the remaining histogram is a floor, not a total.
export const UNDERCOUNT_LIMIT = 0.50;

/**
 * ⛔⛔ TWO OPPOSITE INSERTION ORDERS COEXIST IN THIS APP. A consumer that reads "the last N" one way
 * across both families silently reads the EVICTED-SURVIVOR END of half of them — and on a saturated
 * ring that is maximally misleading, because the oldest slots are exactly the ones the flood has not
 * reached yet. Verified in source at 7268dcfd; see the `reading-the-marine-diagnostic-rings` note.
 * Counting the WHOLE ring (what checkCardinality does) is order-agnostic and therefore safe; only
 * "recent window" reads need this table.
 */
export const RING_DIRECTION = {
  // unshift + pop  =>  [0] is NEWEST
  '__WEATHER_TELEMETRY__.logs': 'newest-first',
  '__MARINE_CACHE_DIAG__.log': 'newest-first',
  // push + shift   =>  at(-1) is NEWEST
  '__RAW_FORENSIC__.events': 'oldest-first',
  '__MARINE_CHURN__.log': 'oldest-first',
};

/** The recent window, reading the correct end. Unknown ring name => refuse rather than guess. */
export function recentFrom(arr, ringName, n = 10) {
  const dir = RING_DIRECTION[ringName];
  if (!dir) return { ok: false, reason: `unknown insertion order for '${ringName}' — refusing to guess an end`, items: [] };
  const a = arr || [];
  return { ok: true, dir, items: dir === 'newest-first' ? a.slice(0, n) : a.slice(-n) };
}

const v = (check, verdict, detail, numbers) => ({ check, verdict, detail, numbers: numbers || {} });

function shareOfTop(counts) {
  const vals = Object.values(counts);
  const total = vals.reduce((a, b) => a + b, 0);
  if (!total) return { total: 0, top: null, share: 0, types: 0 };
  let top = null, max = -1;
  for (const [k, n] of Object.entries(counts)) if (n > max) { max = n; top = k; }
  return { total, top, share: max / total, types: vals.length, topCount: max };
}

/** C1 — a capped ring whose event-type mix has collapsed onto one type. */
export function checkCardinality(ring) {
  const { name, counts, cap } = ring || {};
  const s = shareOfTop(counts || {});
  if (s.total < MIN_SAMPLES_FOR_CARDINALITY) {
    return v(`C1 cardinality:${name}`, SKIP,
      `only ${s.total} samples (< ${MIN_SAMPLES_FOR_CARDINALITY}) — refusing to judge a mix this small`,
      { total: s.total });
  }
  // AT CAP, THESE COUNTS ARE A FLOOR, NOT A TOTAL. `__RAW_FORENSIC__.summary()` computes counts by
  // LOOPING THE RING and has no monotonic counter, so at saturation its numbers silently become
  // undercounts that look exactly like totals. WeatherTelemetry has no per-type counter at all, so
  // its evictions are unrecoverable rather than merely truncated.
  const saturated = cap ? s.total >= cap : false;
  const nearCap = cap ? s.total >= cap * 0.9 : false;
  const numbers = { total: s.total, cap: cap || null, types: s.types, top: s.top,
                    topCount: s.topCount, topShare: +s.share.toFixed(4),
                    saturated, countsAreFloor: saturated };
  if (s.share >= DOMINANCE_LIMIT) {
    return v(`C1 cardinality:${name}`, FAIL,
      `'${s.top}' is ${(100 * s.share).toFixed(1)}% of ${s.total} entries` +
      (saturated ? ` and the ring is AT CAP (${cap}) — every other event type is being EVICTED, ` +
                   'and these per-type counts are a FLOOR, not a total'
                 : nearCap ? ` and the ring is near cap (${cap})` : '') +
      ` — only ${s.types} type(s) survive`, numbers);
  }
  if (s.share >= UNDERCOUNT_LIMIT) {
    return v(`C1 cardinality:${name}`, FAIL,
      `'${s.top}' is ${(100 * s.share).toFixed(1)}% of ${s.total} — past ${100 * UNDERCOUNT_LIMIT}% ` +
      'every OTHER type in this ring is an undercount, so any figure read from it is a floor',
      numbers);
  }
  return v(`C1 cardinality:${name}`, PASS,
    `${s.types} types, top '${s.top}' at ${(100 * s.share).toFixed(1)}%` +
    (saturated ? ' — but the ring is AT CAP, so counts are a floor' : ''), numbers);
}

/**
 * C2 — two counters that describe the same thing must agree within tolerance.
 * `pair` = { name, a, b, aLabel, bLabel, tolerance = 0, note }
 * A pair whose operands are not both numbers SKIPS: absence is not disagreement.
 */
export function checkCrossInstrument(pair) {
  const { name, a, b, aLabel, bLabel, tolerance = 0, note } = pair || {};
  if (typeof a !== 'number' || typeof b !== 'number') {
    return v(`C2 cross:${name}`, SKIP,
      `${aLabel}=${a} ${bLabel}=${b} — one side absent, so silence is not disagreement`, { a, b });
  }
  const delta = Math.abs(a - b);
  const numbers = { a, b, delta, tolerance };
  if (delta > tolerance) {
    return v(`C2 cross:${name}`, FAIL,
      `${aLabel}=${a} but ${bLabel}=${b} (delta ${delta} > tolerance ${tolerance})` +
      (note ? ` — ${note}` : '') +
      ' — two counters of the same thing disagree; at least one is measuring something else', numbers);
  }
  return v(`C2 cross:${name}`, PASS, `${aLabel}=${a} ≈ ${bLabel}=${b}`, numbers);
}

/** C3 — a field that has taken exactly one distinct value over many samples is dead, not stable. */
export function checkVariance(field) {
  const { name, values } = field || {};
  const arr = (values || []).filter((x) => x !== undefined);
  if (arr.length < MIN_SAMPLES_FOR_VARIANCE) {
    return v(`C3 variance:${name}`, SKIP,
      `only ${arr.length} samples (< ${MIN_SAMPLES_FOR_VARIANCE}) — one value proves nothing yet`,
      { samples: arr.length });
  }
  const distinct = new Set(arr.map((x) => JSON.stringify(x)));
  const numbers = { samples: arr.length, distinct: distinct.size,
                    only: distinct.size === 1 ? arr[0] : undefined };
  if (distinct.size === 1) {
    return v(`C3 variance:${name}`, FAIL,
      `${arr.length} samples, ONE distinct value (${JSON.stringify(arr[0])}) — the field carries no `
      + 'information; it is either constant by construction or broken', numbers);
  }
  return v(`C3 variance:${name}`, PASS, `${distinct.size} distinct values over ${arr.length}`, numbers);
}

// A 13-digit run is an epoch-ms timestamp; 10-digit is epoch-seconds. Either inside an identity key
// means the key cannot repeat, which means the guard it feeds cannot ever hold.
// ⚠️ NOT a \b-anchored regex. The first draft was /\b\d{10,13}\b/ and it could NOT match the very
// key that motivated this check — `GFS_waves_129_1785732807867` — because `_` is a WORD character,
// so there is no word boundary between `129_` and the timestamp. A detector blind to its own subject
// is the exact class this module exists to catch, and it was caught by the live fixture, not review.
// Splitting on non-digits is boundary-agnostic and cannot repeat that mistake.
export function clockSegment(key) {
  for (const seg of String(key).split(/[^0-9]+/)) {
    // epoch-seconds (10 digits) or epoch-ms (13); both begin 1 or 2 for any date this century.
    if ((seg.length === 10 || seg.length === 13) && /^[12]/.test(seg)) return seg;
  }
  return null;
}
const NULLISH_RE = /(^|[^a-z])(null|undefined|NaN)([^a-z]|$)/i;

/** C4 — an identity / dedup / cache key that cannot repeat. */
export function checkIdentityKey(entry) {
  const { name, key } = entry || {};
  if (key === undefined || key === null) {
    return v(`C4 key:${name}`, FAIL, 'the key itself is null/undefined — it can never match', { key });
  }
  const s = String(key);
  const clockSeg = clockSegment(s);
  const clock = clockSeg !== null;
  const nullish = NULLISH_RE.test(s);
  const numbers = { key: s.length > 160 ? `${s.slice(0, 160)}…` : s, clock, nullish };
  if (clock) {
    return v(`C4 key:${name}`, FAIL,
      `contains a CLOCK (${clockSeg}) — a key holding the current time differs on `
      + 'every evaluation, so the guard it feeds always passes', numbers);
  }
  if (nullish) {
    return v(`C4 key:${name}`, FAIL,
      'contains null/undefined/NaN — the absent field is not contributing identity, so unrelated '
      + 'states collide (or, with a fallback, never match)', numbers);
  }
  return v(`C4 key:${name}`, PASS, 'stable: no clock, no nullish segment', numbers);
}

/** C5 — named invariants. Each returns its own verdict so one failure cannot mask another. */
export function checkInvariants(state) {
  const out = [];
  const b = (state || {}).bounds;
  if (!b) {
    out.push(v('C5 lngRange', SKIP, 'no bounds in snapshot', {}));
  } else {
    const bad = ['west', 'east'].filter((k) => typeof b[k] === 'number' && Math.abs(b[k]) > 180);
    out.push(bad.length
      ? v('C5 lngRange', FAIL,
          `longitude outside [-180,180]: ${bad.map((k) => `${k}=${b[k]}`).join(', ')} — this is the `
          + 'antimeridian cliff (measured 33x bytes, 24x time past -180)', { bounds: b })
      : v('C5 lngRange', PASS, 'all longitudes within [-180,180]', { bounds: b }));
  }
  const g = (state || {}).grid;
  if (!g || typeof g.cols !== 'number' || typeof g.rows !== 'number' || typeof g.vec !== 'number') {
    out.push(v('C5 gridShape', SKIP, 'no cols/rows/vec in snapshot', {}));
  } else {
    const expect = g.cols * g.rows;
    out.push(g.vec === expect
      ? v('C5 gridShape', PASS, `vec ${g.vec} == cols*rows`, { cols: g.cols, rows: g.rows, vec: g.vec })
      : v('C5 gridShape', FAIL,
          `vec ${g.vec} != cols*rows ${expect} — every downstream transform assumes a full rectangle`,
          { cols: g.cols, rows: g.rows, vec: g.vec, expect }));
    if (typeof g.nonzero === 'number') {
      out.push(g.nonzero <= g.vec
        ? v('C5 nonzeroBound', PASS, `nonzero ${g.nonzero} <= vec ${g.vec}`, { nonzero: g.nonzero, vec: g.vec })
        : v('C5 nonzeroBound', FAIL, `nonzero ${g.nonzero} EXCEEDS vec ${g.vec}`, { nonzero: g.nonzero, vec: g.vec }));
    }
  }
  return out;
}

/**
 * THE READER. Pure: takes a snapshot, returns { verdicts, summary }.
 * snapshot = { rings: [{name, counts, cap}], pairs: [...], fields: [...], keys: [...], state: {...} }
 */
export function readRings(snapshot) {
  const s = snapshot || {};
  const verdicts = [
    ...(s.rings || []).map(checkCardinality),
    ...(s.pairs || []).map(checkCrossInstrument),
    ...(s.fields || []).map(checkVariance),
    ...(s.keys || []).map(checkIdentityKey),
    ...checkInvariants(s.state),
  ];
  const summary = verdicts.reduce((a, x) => { a[x.verdict] = (a[x.verdict] || 0) + 1; return a; },
                                  { pass: 0, fail: 0, skip: 0 });
  summary.failures = verdicts.filter((x) => x.verdict === FAIL).map((x) => x.check);
  return { version: RING_READER_VERSION, verdicts, summary };
}

/** The only impure part: lift the live rings off `win` into a snapshot `readRings` can judge. */
export function captureRings(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w || w.__RAW_DISABLE_RING_READER__ === true) return null;
  const countBy = (arr, f) => (arr || []).reduce((a, x) => {
    const k = f(x); if (k !== undefined && k !== null) a[k] = (a[k] || 0) + 1; return a; }, {});
  const tel = ((w.__WEATHER_TELEMETRY__ || {}).logs) || [];
  const forensic = ((w.__RAW_FORENSIC__ || {}).events) || [];
  const gpu = w.__RAW_GPU__ || {};
  const upload = w.__WEBGL_MARINE_UPLOAD_DIAG__ || {};
  const src = w.__MARINE_RENDER_SOURCE_DIAG__ || {};
  const layer = w.__WebGLMarineLayer_DIAG__ || {};
  const snaps = forensic.filter((e) => e.type === 'snap');
  return {
    rings: [
      // WeatherTelemetry keeps NO per-type counter — the ring is all there is, so eviction here is
      // unrecoverable. Counting the whole array is order-agnostic and therefore safe.
      { name: 'telemetry', counts: countBy(tel, (e) => e.type), cap: 500 },
      { name: 'forensic', counts: countBy(forensic, (e) => e.type), cap: 500 },
      // `__MARINE_CHURN__` increments counts BEFORE pushing and never decrements on eviction, so
      // `counts` is the TRUE total while `log` is only a sample of it. Quote counts, never log.length.
      { name: 'churn', counts: (w.__MARINE_CHURN__ || {}).counts
          || countBy(((w.__MARINE_CHURN__ || {}).log) || [], (e) => e.kind), cap: 150 },
    ],
    pairs: [
      { name: 'uploadCount', a: gpu.textureUploadCount, b: upload.uploadCount,
        aLabel: '__RAW_GPU__.textureUploadCount', bLabel: 'uploadDiag.uploadCount',
        tolerance: 8, note: 'both count marine texture uploads' },
    ],
    fields: [
      { name: 'snap.dims', values: snaps.map((e) => e.dims) },
      { name: 'snap.zoom', values: snaps.map((e) => e.zoom) },
    ],
    keys: [
      { name: 'uploadSignature', key: upload.uploadSignature || layer.lastUploadedGridSignature },
    ],
    state: {
      bounds: (() => { try { const bb = w.map && w.map.getBounds && w.map.getBounds();
        return bb ? { west: bb.getWest(), south: bb.getSouth(), east: bb.getEast(), north: bb.getNorth() } : null;
      } catch (e) { return null; } })(),
      grid: { cols: layer.gridCols, rows: layer.gridRows,
              vec: src.oceanMaskCount ?? layer.webglSourceVectorCount,
              nonzero: src.activeLayerNonzeroCount ?? src.nonzeroCount },
    },
  };
}

/** Convenience for a console: capture + read + one-line-per-verdict. Returns the report. */
export function reportRings(win) {
  const snap = captureRings(win);
  if (!snap) return { version: RING_READER_VERSION, verdicts: [], summary: { pass: 0, fail: 0, skip: 0, failures: [], disabled: true } };
  return readRings(snap);
}
