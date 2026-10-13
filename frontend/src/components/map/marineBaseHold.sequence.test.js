/**
 * THE HELD-BASE STATE MACHINE, enumerated (2026-10-02; the F-22 follow-up; marineStaleHour.js rules 5 and 6, the engine's `_captureCoarseBase`).
 *
 * The F-22 bridge fires only for a held 2-degree base for the selected hour, so what the engine KEEPS as its base decides whether the fix
 * acts. The base is the last coarse-global grid committed, per model | layer | rating-flavor slot (the §2d LRU), and every grid of a
 * slot used to replace the slot's base: a thin 8-degree series frame replaced the exact frame for the same data (offline phone replay).
 * This file drives the REAL `_captureCoarseBase` (the texture encoder stubbed) through the engine's TWO doors, written the way the engine writes them:
 *   commit  setWaveData's capture block: a same-key entry already in the LRU only retargets the displayed base; otherwise `_captureCoarseBase`;
 *   seed    the render loop's seed consume: `coarseBaseStaleForSeed(displayed base, seed)` and then `_captureCoarseBase`.
 * Both are pinned in source (WebGLMarineEngine.baseHold.test.js, WebGLMarineEngine.baseHourSync.test.js), so this transcription cannot drift quietly.
 * It enumerates EVERY sequence of three offers over 13 frame kinds x 2 doors, and every sequence of four commits, and checks each step against an oracle that
 * is written from the frames' own attributes (lattice, hour, run, model, layer, flavor, label), not from the rule's helpers:
 *
 *   P1. NEVER DEGRADE: an exact base is kept against a coarser frame (thin or 10-degree) of the same data (within 1.5 h + 1 min, the same run, or one unnamed),
 *       by either door: the slot keeps the very same frame, nothing is encoded or freed.
 *   P2. EVERYTHING ELSE REPLACES: a frame of another step, an equal or finer lattice, another run, or into a slot that holds nothing exact becomes the base,
 *       and a 2-degree SEED replaces a coarser displayed base of the same data (rule 6); the superseded set is freed exactly once.
 *   P3. IDENTITY ISOLATION: an offer never changes the slot of another model, layer or flavor.
 *   P4. THE DISPLAYED BASE follows the offer exactly (the LRU same-key retarget included).
 *   P5. TEETH: the rules are walked in thousands of the sequences, and with __RAW_DISABLE_BASE_HOLD__ on the same sweep finds both (a degraded base,
 *       a seed that never replaces a thin base): the positive control, the sweep can see the defect it guards.
 * The frames spell what the paths really carry: the exact frame's hour label differs from the thin frame's for one valid time (3-hourly range), the
 * same model run is spelled with microseconds on one frame and in whole seconds on another, the real thinned shape is 46 x 21 and the exact one 181 x 82,
 * and two hours sit on either side of the snapped step (16:30 inside it, 17:00 outside).
 */
import WebGLMarineEngine, { coarseBaseKey, coarseBaseLruKey } from './WebGLMarineEngine';
import { coarseBaseStaleForSeed } from './marineCommitGate';
import { isCoarseGlobalGrid } from './marineEngineDecisions';

const mockEncodes = { n: 0 };
jest.mock('./WebGLMarineTextureEncoder', () => ({
  ...jest.requireActual('./WebGLMarineTextureEncoder'),
  encodeMarineTexture: () => { mockEncodes.n++; return { u_waveTexture: { w: mockEncodes.n }, u_oceanMaskTexture: { m: mockEncodes.n } }; },
}));

const capture = WebGLMarineEngine.prototype._captureCoarseBase;
const lruEnabled = WebGLMarineEngine.prototype._coarseBaseLruEnabled;
const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const GL = { __fakeGl: true };
const ISO = { 15: '2026-10-07T15:00:00Z', 16: '2026-10-07T16:00:00Z', 16.5: '2026-10-07T16:30:00Z', 17: '2026-10-07T17:00:00Z', 18: '2026-10-07T18:00:00Z' };
const LATTICE = { exact: { cols: 181, rows: 82 }, thin: { cols: 46, rows: 21 }, ten: { cols: 37, rows: 17 } };     // 1.99, 7.83 and 9.73 degrees
const RUN = { A: '2026-10-01T06:00:00', B: '2026-10-01T12:00:00' };
const RANK = { exact: 0, thin: 1, ten: 2 };                                                                       // finer is lower
const HOUR_TOL = 1.5 + 1 / 60;                                                                                    // hours: the snapped step, 1.5 h + 1 min

/** A world frame with its test-only description in `__meta` (the engine never reads it). */
function frame(lattice, hour, { model = 'GFS', layer = 'waves', rated = false, run = null, spell = 's' } = {}) {
  const { cols, rows } = LATTICE[lattice];
  const label = (lattice === 'exact' ? 144 : 143) + Math.round(hour);              // one valid time wears another label on the thin frame
  return {
    bounds: WORLD, cols, rows, hourOffset: label, valid_time: ISO[hour], vectors: [{ lat: 0, lng: 0, speed: 1 }],
    __sourceModel: model, __componentLayer: layer, ratingMode: rated,
    ...(run ? { run_time: RUN[run] + (spell === 'us' ? '.123456Z' : 'Z') } : {}),
    __decimatedStride: lattice === 'thin' ? 4 : 0,
    __meta: {
      lattice, hour, run, model, layer, rated, label, dims: `${cols}x${rows}`, slot: `${model}|${layer}|${rated ? 'r1' : 'r0'}`,
      name: `${lattice}${hour}${model !== 'GFS' ? model : ''}${rated ? 'R' : ''}${run ? '@' + run + spell : ''}`,
    },
  };
}

const ALPHABET = [
  frame('exact', 15), frame('thin', 15), frame('thin', 16), frame('thin', 16.5), frame('thin', 17), frame('exact', 18), frame('thin', 18), frame('ten', 15),
  frame('thin', 15, { model: 'ICON' }), frame('thin', 15, { rated: true }),
  frame('exact', 15, { run: 'A', spell: 'us' }), frame('thin', 15, { run: 'A', spell: 's' }), frame('thin', 15, { run: 'B', spell: 's' }),
];

// ---- the oracle, from the frames' attributes alone -------------------------------------------------------------------------------------------
const sameData = (a, b) => Math.abs(a.hour - b.hour) <= HOUR_TOL && (a.run === null || b.run === null || a.run === b.run);
const keeps = (held, incoming) => !!held && RANK[held.lattice] === 0 && RANK[incoming.lattice] > 0 && sameData(held, incoming);
const keyOf = (m) => `${m.slot}|${m.dims}|${m.label}`;
const seedStale = (ptr, seed) => {
  if (!ptr) return true;
  if (ptr.model !== seed.model || ptr.layer !== seed.layer) return true;
  if (Math.abs(ptr.hour - seed.hour) > HOUR_TOL) return true;                        // another hour (F-21)
  return RANK[ptr.lattice] > 0 && RANK[seed.lattice] === 0 && ptr.rated === seed.rated && sameData(ptr, seed);   // a 2-degree seed over a coarser base of the same data (rule 6)
};

/** Applies one offer to the oracle's state; returns what it expects: { adopt: boolean, frees: 0 | 1, reason: 'discard' | 'hit' | 'keep' | 'adopt' }. */
function oracleOffer(st, f, door) {
  const m = f.__meta;
  if (door === 'seed') {
    if (!seedStale(st.ptr && st.ptr.__meta, m)) return { adopt: false, frees: 0, reason: 'discard' };    // the seed is discarded
  } else {
    const held = st.held.get(m.slot);
    if (held && keyOf(held.__meta) === keyOf(m)) { st.ptr = held; return { adopt: false, frees: 0, reason: 'hit' }; }     // the LRU same-key hit: the displayed base retargets
    if (st.ptr && keyOf(st.ptr.__meta) === keyOf(m)) return { adopt: false, frees: 0, reason: 'hit' };
  }
  const cur = st.held.get(m.slot) || null;
  if (keeps(cur && cur.__meta, m)) return { adopt: false, frees: 0, reason: 'keep' };                // rule 5
  st.held.set(m.slot, f);
  st.ptr = f;
  return { adopt: true, frees: cur ? 1 : 0, reason: 'adopt' };
}

// ---- the engine's two doors, as the engine writes them ---------------------------------------------------------------------------------------
function engineOffer(eng, f, door) {
  if (door === 'seed') {
    if (coarseBaseStaleForSeed(eng._coarseBaseData, f) && isCoarseGlobalGrid(f)) capture.call(eng, GL, f, coarseBaseKey(f));
    return;
  }
  const key = coarseBaseKey(f);
  const hit = eng._coarseBaseLruEnabled() && eng._coarseBaseLru ? [...eng._coarseBaseLru.values()].find((b) => b.__key === key) : null;
  if (hit) eng._coarseBaseData = hit;
  else if (!eng._coarseBaseData || eng._coarseBaseData.__key !== key) capture.call(eng, GL, f, key);
}

function makeEngine() {
  const frees = [];
  return {
    eng: { _coarseBaseLru: new Map(), _coarseBaseData: null, _landGeoJSON: null, _coarseBaseLruEnabled: lruEnabled, _freeCoarseBase: (gl, obj) => frees.push(obj) },
    frees,
  };
}

/** Runs one sequence of [frame, door] offers; returns the FIRST divergence from the oracle (null when the engine agrees at every step) and the oracle's tallies. */
function walk(seq) {
  const { eng, frees } = makeEngine();
  const st = { held: new Map(), ptr: null };
  const tally = { adopt: 0, keep: 0 };
  for (const [f, door] of seq) {
    const before = new Map(eng._coarseBaseLru);
    const encodes0 = mockEncodes.n, frees0 = frees.length;
    const cur = st.held.get(f.__meta.slot) || null;                                  // what the oracle holds in this slot BEFORE the offer
    const exp = oracleOffer(st, f, door);
    engineOffer(eng, f, door);
    const where = `${seq.map(([x, d]) => `${x.__meta.name}${d === 'seed' ? '(seed)' : ''}`).join(' > ')} @ ${f.__meta.name}${door === 'seed' ? '(seed)' : ''}`;
    if (exp.reason === 'adopt') tally.adopt++;
    if (exp.reason === 'keep') tally.keep++;
    const slot = eng._coarseBaseLru.get(coarseBaseLruKey(f));
    for (const [k, v] of before) if (k !== coarseBaseLruKey(f) && eng._coarseBaseLru.get(k) !== v) return { bad: `P3 another slot changed (${k}): ${where}`, tally };
    if (exp.adopt) {
      if (!slot || slot.waveGrid !== f) return { bad: `P2 frame not adopted: ${where}`, tally };
      if (frees.length - frees0 !== exp.frees) return { bad: `P2 ${frees.length - frees0} sets freed, wanted ${exp.frees}: ${where}`, tally };
    } else {
      if ((slot ? slot.waveGrid : null) !== cur) return { bad: `P1 the slot changed though the oracle keeps it (${exp.reason}): ${where}`, tally };
      if (mockEncodes.n !== encodes0 || frees.length !== frees0) return { bad: `P1 something was encoded or freed though nothing is adopted (${exp.reason}): ${where}`, tally };
    }
    const ptr = eng._coarseBaseData ? eng._coarseBaseData.waveGrid : null;
    if (ptr !== (st.ptr || null)) return { bad: `P4 the displayed base is not the oracle's: ${where}`, tally };
  }
  return { bad: null, tally };
}

function sweep() {
  const out = { n: 0, counts: { P1: 0, P2: 0, P3: 0, P4: 0 }, first: [], adopt: 0, keep: 0 };
  const record = (seq) => {
    const r = walk(seq);
    out.n++; out.adopt += r.tally.adopt; out.keep += r.tally.keep;
    if (r.bad) { out.counts[r.bad.slice(0, 2)]++; if (out.first.length < 4) out.first.push(r.bad); }
  };
  const doors = ['commit', 'seed'];
  const offers = [];
  for (const f of ALPHABET) for (const d of doors) offers.push([f, d]);
  for (const a of offers) for (const b of offers) for (const c of offers) record([a, b, c]);                      // 26^3 = 17,576 three-offer sequences, both doors
  for (const a of ALPHABET) for (const b of ALPHABET) for (const c of ALPHABET) for (const d of ALPHABET) record([[a, 'commit'], [b, 'commit'], [c, 'commit'], [d, 'commit']]);   // 13^4 = 28,561 four-commit sequences
  return out;
}

beforeEach(() => { window.__RAW_GPU__ = {}; });
afterEach(() => {
  delete window.__RAW_GPU__;
  delete window.__RAW_DISABLE_BASE_HOLD__;
  delete window.__MARINE_BASE_HOLD__;
});

describe('every sequence through the real _captureCoarseBase, by both doors', () => {
  it('P1-P4: an exact base is never degraded by a coarser frame of the same data, everything else replaces, a 2-degree seed replaces a coarser base, no other slot is touched', () => {
    const r = sweep();
    console.log(`\n=== BASE HOLD SWEEP: ${r.n} sequences: adoptions=${r.adopt} frames kept out=${r.keep} divergences P1=${r.counts.P1} P2=${r.counts.P2} P3=${r.counts.P3} P4=${r.counts.P4}${r.first.length ? '\n  ' + r.first.join('\n  ') : ''}`);
    expect({ counts: r.counts, first: r.first }).toEqual({ counts: { P1: 0, P2: 0, P3: 0, P4: 0 }, first: [] });
    expect(r.n).toBe(26 ** 3 + 13 ** 4);
    expect(r.keep).toBeGreaterThan(9700);                                  // P5: the keep rule is walked (floors are 80% of what this deterministic sweep measures: 12,241 and 129,606)
    expect(r.adopt).toBeGreaterThan(103000);
  }, 120000);

  it('POSITIVE CONTROL: with __RAW_DISABLE_BASE_HOLD__ on, the same sweep finds a degraded base and a seed that never replaces a thin base, thousands of times', () => {
    window.__RAW_DISABLE_BASE_HOLD__ = true;
    const r = sweep();
    console.log(`\n=== BASE HOLD SWEEP, rules OFF: ${r.n} sequences, divergences P1=${r.counts.P1} P2=${r.counts.P2} P3=${r.counts.P3} P4=${r.counts.P4}, e.g. ${r.first.slice(0, 2).join(' | ')}`);
    expect(r.counts.P1).toBeGreaterThan(7400);                             // a coarser frame replaced an exact base (rule 5 off): 9,296 sequences
    expect(r.counts.P2).toBeGreaterThan(1070);                             // a 2-degree seed was refused over a thin base (rule 6 off): 1,344 sequences
    expect(r.counts.P3).toBe(0);
  }, 120000);
});
