/**
 * THE READER MUST REPRODUCE 2026-08-03's FINDINGS FROM THE RECORDED EVIDENCE.
 *
 * This is the only validation that means anything. A ring reader that cannot detect the defects a
 * human already found by hand is decoration. Every BEFORE fixture below is a VERBATIM live capture
 * from that session (build 6da4c16e, GFS/waves/h129, Florida–Gulf) — not an invented shape:
 *
 *   telemetry ring   texture_generated 495 + FPS_drop_detected 5, cap 500     -> C1 must FAIL
 *   forensic ring    230 across 10 types, cap 500                            -> C1 must PASS
 *   uploadSig        `GFS_waves_129_1785732807867` (the Date.now() fallback)  -> C4 must FAIL
 *   coverage         "miss" on every response                                -> C3 must FAIL
 *   emitted bbox     west=-199.3617                                          -> C5 must FAIL
 *
 * and the AFTER fixtures are the same quantities post-fix, which must pass. A check that fires on
 * both is worthless, so every BEFORE has its AFTER.
 */
import {
  DOMINANCE_LIMIT, MIN_SAMPLES_FOR_CARDINALITY, MIN_SAMPLES_FOR_VARIANCE, RING_DIRECTION,
  UNDERCOUNT_LIMIT, captureRings, checkCardinality, checkCrossInstrument, checkIdentityKey,
  checkInvariants, checkVariance, readRings, recentFrom,
} from './marineRingReader';

const fails = (r) => r.verdict === 'fail';
const passes = (r) => r.verdict === 'pass';
const skips = (r) => r.verdict === 'skip';

// ── C1: the ring saturation that blinded the diagnostics ──────────────────────────────────────
describe('C1 cardinality collapse — the telemetry ring at 99% one event', () => {
  const BEFORE = { name: 'telemetry', cap: 500,
    counts: { texture_generated: 495, FPS_drop_detected: 5 } };          // VERBATIM live capture
  const AFTER = { name: 'forensic', cap: 500,
    counts: { snap: 107, commit: 32, flavor_fastpath_miss: 31, mask_rebuild: 20,
              flavor_cache_fastpath: 18, inflight_skip: 9, commit_short_circuit: 5,
              reject_downgrade: 3, selfheal_accept: 1, encode_dup: 2 } };

  test('BEFORE: the saturated telemetry ring FAILS, and says the counts are a floor', () => {
    const r = checkCardinality(BEFORE);
    expect(fails(r)).toBe(true);
    expect(r.numbers.topShare).toBeGreaterThan(DOMINANCE_LIMIT);
    expect(r.numbers.saturated).toBe(true);
    expect(r.numbers.countsAreFloor).toBe(true);          // eviction => every other type undercounts
    expect(r.detail).toMatch(/EVICTED/);
  });

  test('AFTER / KNOWN-GOOD CONTROL: the healthy forensic ring PASSES', () => {
    const r = checkCardinality(AFTER);
    expect(passes(r)).toBe(true);
    expect(r.numbers.types).toBe(10);
    expect(r.numbers.saturated).toBe(false);
  });

  test('the 50% undercount threshold fires BEFORE outright dominance', () => {
    const r = checkCardinality({ name: 'x', cap: 500, counts: { a: 60, b: 20, c: 20 } });
    expect(fails(r)).toBe(true);                          // 0.60 — past UNDERCOUNT, below DOMINANCE
    expect(r.numbers.topShare).toBeGreaterThan(UNDERCOUNT_LIMIT);
    expect(r.numbers.topShare).toBeLessThan(DOMINANCE_LIMIT);
  });

  test('REFUSAL: too few samples SKIPS rather than passing', () => {
    const r = checkCardinality({ name: 'x', cap: 500, counts: { only: MIN_SAMPLES_FOR_CARDINALITY - 1 } });
    expect(skips(r)).toBe(true);
  });
});

// ── C2: the disagreement that actually caught things by hand ──────────────────────────────────
describe('C2 cross-instrument disagreement', () => {
  test('two counters of the same thing that disagree FAIL', () => {
    const r = checkCrossInstrument({ name: 'uploads', a: 131, b: 33,
      aLabel: 'gpu.textureUploadCount', bLabel: 'uploadDiag.uploadCount', tolerance: 8 });
    expect(fails(r)).toBe(true);
    expect(r.numbers.delta).toBe(98);
  });

  test('agreement inside tolerance PASSES', () => {
    expect(passes(checkCrossInstrument({ name: 'uploads', a: 131, b: 129,
      aLabel: 'a', bLabel: 'b', tolerance: 8 }))).toBe(true);
  });

  test('REFUSAL: one side absent SKIPS — silence is not disagreement', () => {
    expect(skips(checkCrossInstrument({ name: 'u', a: 131, b: undefined, aLabel: 'a', bLabel: 'b' }))).toBe(true);
  });
});

// ── C3: the field that said "miss" for everything ─────────────────────────────────────────────
describe('C3 zero-variance field — the `coverage` stamp that was always "miss"', () => {
  test('BEFORE: one distinct value over many samples FAILS as a dead field', () => {
    const r = checkVariance({ name: 'coverage', values: Array(40).fill('miss') });
    expect(fails(r)).toBe(true);
    expect(r.numbers.distinct).toBe(1);
    expect(r.numbers.samples).toBe(40);
  });

  test('AFTER: a field that genuinely varies PASSES', () => {
    const vals = Array.from({ length: 40 }, (_, i) => (i % 3 === 0 ? 'hit' : 'miss'));
    expect(passes(checkVariance({ name: 'coverage', values: vals }))).toBe(true);
  });

  test('REFUSAL: too few samples SKIPS — one value proves nothing yet', () => {
    expect(skips(checkVariance({ name: 'c', values: Array(MIN_SAMPLES_FOR_VARIANCE - 1).fill('miss') }))).toBe(true);
  });
});

// ── C4: the dedup key that could not dedup ────────────────────────────────────────────────────
describe('C4 poisoned identity key', () => {
  test('BEFORE: a key carrying Date.now() FAILS and names the clock', () => {
    const r = checkIdentityKey({ name: 'uploadSig', key: 'GFS_waves_129_1785732807867' });
    expect(fails(r)).toBe(true);
    expect(r.numbers.clock).toBe(true);
    expect(r.detail).toMatch(/CLOCK/);
  });

  test('BEFORE: a key carrying null FAILS', () => {
    const r = checkIdentityKey({ name: 'sig', key: 'GFS_waves_null_129' });
    expect(fails(r)).toBe(true);
    expect(r.numbers.nullish).toBe(true);
  });

  test('AFTER: the shipped content-identity key PASSES', () => {
    // the 52b27146 replacement: dims + vector count + hour + layer + model, no clock
    expect(passes(checkIdentityKey({ name: 'uploadSig', key: 'GFS_waves_129_11x13_143_' }))).toBe(true);
  });

  test('REFUSAL: an absent key SKIPS — it is "not sampled yet", not "broken"', () => {
    // A fresh page has no uploadSignature. Accusing there would make the reader cry wolf on every
    // load, which is how a monitor gets muted. A key that is PRESENT and poisoned still fails above.
    expect(skips(checkIdentityKey({ name: 'sig', key: null }))).toBe(true);
    expect(skips(checkIdentityKey({ name: 'sig', key: undefined }))).toBe(true);
  });
});

// ── C5: the invariants ────────────────────────────────────────────────────────────────────────
describe('C5 named invariants', () => {
  test('BEFORE: the antimeridian bbox the client actually emitted FAILS', () => {
    const out = checkInvariants({ bounds: { west: -199.3617, south: -27.5277, east: -16.032, north: 53.3496 } });
    const lng = out.find((x) => x.check === 'C5 lngRange');
    expect(fails(lng)).toBe(true);
    expect(lng.detail).toMatch(/antimeridian/);
  });

  test('AFTER: the canonical world box PASSES', () => {
    const out = checkInvariants({ bounds: { west: -180, south: -80, east: 180, north: 85 } });
    expect(passes(out.find((x) => x.check === 'C5 lngRange'))).toBe(true);
  });

  test('a non-rectangular grid FAILS the shape invariant', () => {
    const out = checkInvariants({ grid: { cols: 11, rows: 13, vec: 142, nonzero: 99 } });
    expect(fails(out.find((x) => x.check === 'C5 gridShape'))).toBe(true);
  });

  test('the live rectangular grid PASSES both shape and nonzero bound', () => {
    const out = checkInvariants({ grid: { cols: 11, rows: 13, vec: 143, nonzero: 99 } });
    expect(passes(out.find((x) => x.check === 'C5 gridShape'))).toBe(true);
    expect(passes(out.find((x) => x.check === 'C5 nonzeroBound'))).toBe(true);
  });
});

// ── ring insertion order: the recorded landmine ───────────────────────────────────────────────
describe('recentFrom respects the two OPPOSITE insertion orders', () => {
  const arr = [1, 2, 3, 4, 5];   // 1 inserted first
  test('newest-first rings read from the FRONT', () => {
    expect(recentFrom(arr, '__WEATHER_TELEMETRY__.logs', 2).items).toEqual([1, 2]);
  });
  test('oldest-first rings read from the BACK', () => {
    expect(recentFrom(arr, '__RAW_FORENSIC__.events', 2).items).toEqual([4, 5]);
  });
  test('REFUSAL: an unknown ring refuses rather than guessing an end', () => {
    const r = recentFrom(arr, '__SOME_NEW_RING__', 2);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/refusing to guess/);
  });
  test('every declared direction is one of the two known families', () => {
    for (const d of Object.values(RING_DIRECTION)) {
      expect(['newest-first', 'oldest-first']).toContain(d);
    }
  });
});

// ── THE WHOLE-SESSION REPLAY: the reader vs the 2026-08-03 evidence ───────────────────────────
describe('END TO END — the pre-fix session must produce failures, the post-fix one must not', () => {
  const BEFORE = {
    rings: [{ name: 'telemetry', cap: 500, counts: { texture_generated: 495, FPS_drop_detected: 5 } }],
    pairs: [{ name: 'uploads', a: 131, b: 33, aLabel: 'gpu', bLabel: 'diag', tolerance: 8 }],
    fields: [{ name: 'coverage', values: Array(40).fill('miss') }],
    keys: [{ name: 'uploadSig', key: 'GFS_waves_129_1785732807867' }],
    state: { bounds: { west: -199.3617, south: -27.5, east: -16.03, north: 53.35 },
             grid: { cols: 11, rows: 13, vec: 143, nonzero: 99 } },
  };
  const AFTER = {
    rings: [{ name: 'forensic', cap: 500,
              counts: { snap: 107, commit: 32, flavor_fastpath_miss: 31, mask_rebuild: 20,
                        flavor_cache_fastpath: 18, inflight_skip: 9, commit_short_circuit: 5,
                        reject_downgrade: 3, selfheal_accept: 1, encode_dup: 2 } }],
    pairs: [{ name: 'uploads', a: 131, b: 129, aLabel: 'gpu', bLabel: 'diag', tolerance: 8 }],
    fields: [{ name: 'dims', values: Array.from({ length: 40 }, (_, i) => `${11 + (i % 4)}x13`) }],
    keys: [{ name: 'uploadSig', key: 'GFS_waves_129_11x13_143_' }],
    state: { bounds: { west: -180, south: -80, east: 180, north: 85 },
             grid: { cols: 11, rows: 13, vec: 143, nonzero: 99 } },
  };

  test('BEFORE: the reader independently reproduces FIVE of the session findings', () => {
    const { summary, verdicts } = readRings(BEFORE);
    expect(summary.fail).toBe(5);
    expect(summary.failures.sort()).toEqual([
      'C1 cardinality:telemetry', 'C2 cross:uploads', 'C3 variance:coverage',
      'C4 key:uploadSig', 'C5 lngRange',
    ].sort());
    // and it must not have invented failures the session did not find
    expect(verdicts.filter((x) => x.verdict === 'fail').length).toBe(5);
  });

  test('AFTER: the same reader on the post-fix session finds NOTHING', () => {
    const { summary } = readRings(AFTER);
    expect(summary.fail).toBe(0);
    expect(summary.pass).toBeGreaterThan(4);
  });
});

// ── capture: impure edge ──────────────────────────────────────────────────────────────────────
describe('captureRings', () => {
  test('the kill switch returns null', () => {
    expect(captureRings({ __RAW_DISABLE_RING_READER__: true })).toBeNull();
  });
  test('an empty window yields a snapshot readRings can judge without throwing', () => {
    const snap = captureRings({});
    expect(snap).toBeTruthy();
    expect(() => readRings(snap)).not.toThrow();
  });
  test('churn prefers the monotonic `counts` over the evictable `log`', () => {
    const snap = captureRings({ __MARINE_CHURN__: { counts: { detach: 999 }, log: [{ kind: 'detach' }] } });
    const churn = snap.rings.find((r) => r.name === 'churn');
    expect(churn.counts.detach).toBe(999);      // counts survives eviction; log.length does not
  });
});

// ── the tick: the reader must be CALLED, and must not become the disease ──────────────────────
describe('ringReaderTick — a consumer that runs, quietly', () => {
  let warns;
  const mkWin = (over = {}) => ({
    __WEATHER_TELEMETRY__: { logs: [] }, __RAW_FORENSIC__: { events: [] },
    __RAW_GPU__: {}, __WEBGL_MARINE_UPLOAD_DIAG__: {}, ...over,
  });
  // A window whose telemetry ring is the 2026-08-03 saturated shape (495 of one type).
  const sickWin = () => mkWin({
    __WEATHER_TELEMETRY__: { logs: Array.from({ length: 500 }, (_, i) =>
      ({ type: i < 495 ? 'texture_generated' : 'FPS_drop_detected' })) },
  });
  beforeEach(() => {
    warns = [];
    jest.spyOn(console, 'warn').mockImplementation((...a) => warns.push(a));
    jest.resetModules();
  });
  afterEach(() => { console.warn.mockRestore(); });

  test('SILENT on a healthy window — the healthy state emits nothing', () => {
    const { ringReaderTick } = require('./marineRingReader');
    ringReaderTick(mkWin());
    expect(warns.length).toBe(0);
  });

  test('WARNS once on a saturated ring, and does NOT repeat within the rate limit', () => {
    const { ringReaderTick } = require('./marineRingReader');
    const w = sickWin();
    ringReaderTick(w);
    expect(warns.length).toBe(1);
    expect(String(warns[0][0])).toMatch(/RingReader/);
    ringReaderTick(w); ringReaderTick(w); ringReaderTick(w);
    expect(warns.length).toBe(1);           // THE NUMBER: a reader must not flood what it measures
  });

  test('the kill switch silences it entirely', () => {
    const { ringReaderTick } = require('./marineRingReader');
    const w = sickWin(); w.__RAW_DISABLE_RING_READER__ = true;
    expect(ringReaderTick(w)).toBeNull();
    expect(warns.length).toBe(0);
  });

  test('it NEVER writes to a ring — reading must not perturb what it reads', () => {
    const { ringReaderTick } = require('./marineRingReader');
    const w = sickWin();
    const before = JSON.stringify({ t: w.__WEATHER_TELEMETRY__.logs.length,
                                    f: w.__RAW_FORENSIC__.events.length, g: w.__RAW_GPU__ });
    ringReaderTick(w);
    expect(JSON.stringify({ t: w.__WEATHER_TELEMETRY__.logs.length,
                            f: w.__RAW_FORENSIC__.events.length, g: w.__RAW_GPU__ })).toBe(before);
  });

  test('a thrown reader is swallowed — it must never break the map', () => {
    const { ringReaderTick } = require('./marineRingReader');
    const hostile = { get __WEATHER_TELEMETRY__() { throw new Error('boom'); } };
    expect(() => ringReaderTick(hostile)).not.toThrow();
  });

  test('the rate limit gates BEFORE walking any ring — cost, not just noise', () => {
    // The claim in the source is "gates on the CLOCK BEFORE walking any ring, so it is safe from any
    // path". A warn-count assertion cannot see that: removing the early gate leaves the inner gate
    // holding, so the log stays quiet while every call still walks ~750 entries. This counts ACCESSES
    // to the ring instead, which is the only thing that can tell the two apart.
    const { ringReaderTick } = require('./marineRingReader');
    let reads = 0;
    const logs = Array.from({ length: 500 }, (_, i) =>
      ({ type: i < 495 ? 'texture_generated' : 'FPS_drop_detected' }));
    const w = {
      get __WEATHER_TELEMETRY__() { reads += 1; return { logs }; },
      __RAW_FORENSIC__: { events: [] }, __RAW_GPU__: {}, __WEBGL_MARINE_UPLOAD_DIAG__: {},
    };
    ringReaderTick(w);
    const afterFirst = reads;
    expect(afterFirst).toBeGreaterThan(0);        // assert the setup: the first tick really did read
    ringReaderTick(w); ringReaderTick(w); ringReaderTick(w);
    expect(reads).toBe(afterFirst);               // THE NUMBER: no further ring walks inside the gap
  });
});
