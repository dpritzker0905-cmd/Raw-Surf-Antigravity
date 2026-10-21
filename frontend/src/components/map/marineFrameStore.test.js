import { createFrameStore, resolveTier, setKeyOf, TIERS } from './marineFrameStore';

const SIG = 'h16|dil1|conf0.75|trim1|wrap1|f32';
const fakePack = (cols = 181, rows = 81, sig = SIG) => ({
  bytes: new Uint8Array(cols * rows * 4), cols, rows, bounds: { west: -180, east: 180, south: -78, north: 82 }, isGlobal: true,
  validityHash: 'abcd1234', signature: sig, trimmed: true,
});
const vt = (k) => new Date(Date.UTC(2026, 9, 21, 0) + k * 3 * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');
const index = (n, unbuiltAt = []) => Array.from({ length: n }, (_, k) => (unbuiltAt.includes(k)
  ? { valid_time: vt(k), path: null, unbuilt: 'not_local' } : { valid_time: vt(k), path: `v1/gfs/marine/waves/global_mid/run/${k}.bin` }));

function storeWith({ tier = 'desktop', n = 10, unbuiltAt = [], clock } = {}) {
  let t = 1000;
  const store = createFrameStore({ tier, now: clock || (() => (t += 1)) });
  const set = store.ensureSet({ model: 'GFS', layer: 'waves', modelRunTime: '2026-10-21T00:00:00Z', signature: SIG });
  store.noteIndex(set.key, index(n, unbuiltAt));
  return { store, key: set.key };
}

describe('resolveTier', () => {
  it('desktop by default; handheld / weak / <=4 GB; constrained for Save-Data, slow links, <=2 GB or too few layers; webgl1', () => {
    expect(resolveTier({}, {})).toBe('desktop');
    expect(resolveTier({ handheld: true }, {})).toBe('handheld');
    expect(resolveTier({ weak: true }, {})).toBe('handheld');
    expect(resolveTier({ deviceMemoryGB: 4 }, {})).toBe('handheld');
    expect(resolveTier({ deviceMemoryGB: 2 }, {})).toBe('constrained');
    expect(resolveTier({ saveData: true }, {})).toBe('constrained');
    expect(resolveTier({ effectiveType: '3g' }, {})).toBe('constrained');
    expect(resolveTier({ maxArrayLayers: 100, frames: 115 }, {})).toBe('constrained');
    expect(resolveTier({ webgl2: false, handheld: true }, {})).toBe('webgl1');
  });
  it('window.__RAW_FRAME_STORE_TIER__ forces a known tier and ignores an unknown one', () => {
    expect(resolveTier({ handheld: true }, { __RAW_FRAME_STORE_TIER__: 'desktop' })).toBe('desktop');
    expect(resolveTier({}, { __RAW_FRAME_STORE_TIER__: 'turbo' })).toBe('desktop');
  });
});

describe('set keys', () => {
  it('key on the model run (the cycle) and the pack signature', () => {
    const a = setKeyOf({ model: 'gfs', layer: 'Waves', modelRunTime: '2026-10-21T00:00:00Z', signature: SIG });
    expect(a).toBe(`GFS/waves/world/2026-10-21T00:00:00Z/${SIG}`);
    expect(setKeyOf({ model: 'GFS', layer: 'waves', modelRunTime: '2026-10-21T06:00:00Z', signature: SIG })).not.toBe(a);
    expect(setKeyOf({ model: 'GFS', layer: 'waves', modelRunTime: '2026-10-21T00:00:00Z', signature: 'h10|dil1' })).not.toBe(a);
  });
});

describe('frame states', () => {
  it('an unbuilt index entry (path null) is a counted miss, never a neighbour', () => {
    const { store, key } = storeWith({ unbuiltAt: [3] });
    store.markInflight(key, vt(2)); store.putPacked(key, vt(2), fakePack());
    store.markInflight(key, vt(4)); store.putPacked(key, vt(4), fakePack());
    expect(store.lookup(key, vt(3))).toBeNull();
    expect(store.telemetry().misses.unbuilt_not_local).toBe(1);
    expect(store.markInflight(key, vt(3))).toBe(false); // nothing to fetch for it
    expect(store.lookup(key, vt(2))).not.toBeNull();
    expect(store.telemetry().hits).toBe(1);
  });

  it('absent -> inflight -> packed -> resident; lookup misses until packed', () => {
    const { store, key } = storeWith();
    expect(store.lookup(key, vt(0))).toBeNull();
    expect(store.markInflight(key, vt(0))).toBe(true);
    expect(store.markInflight(key, vt(0))).toBe(false); // already out
    expect(store.lookup(key, vt(0))).toBeNull();
    expect(store.putPacked(key, vt(0), fakePack())).toBe(true);
    expect(store.lookup(key, vt(0)).state).toBe('packed');
    expect(store.markResident(key, vt(0), 0, 60092)).toBe(true);
    expect(store.lookup(key, vt(0)).state).toBe('resident');
    expect(store.bytes().gpu).toBe(60092);
  });

  it('refuses a pack made under another signature (theme / kill switch changed while it was in flight)', () => {
    const { store, key } = storeWith();
    store.markInflight(key, vt(1));
    expect(store.putPacked(key, vt(1), fakePack(181, 81, 'h10|dil1|conf0.75|trim1|wrap1|f32'))).toBe(false);
    expect(store.entry(key, vt(1)).state).toBe('inflight');      // the caller decides: absent, or a terminal miss
    expect(store.telemetry().misses.signature).toBe(1);
    store.markUnpackable(key, vt(1), 'signature');
    expect(store.lookup(key, vt(1))).toBeNull();
    expect(store.markInflight(key, vt(1))).toBe(false);          // never fetched again for this set
    expect(store.telemetry().misses.unbuilt_signature).toBe(1);
  });

  it('the handheld tier drops the CPU copy once a frame is resident; desktop keeps it (context-loss recovery)', () => {
    for (const [tier, kept] of [['handheld', false], ['desktop', true]]) {
      const { store, key } = storeWith({ tier });
      store.markInflight(key, vt(0)); store.putPacked(key, vt(0), fakePack());
      store.markResident(key, vt(0), 0, 60092);
      expect(!!store.entry(key, vt(0)).packed).toBe(kept);
      expect(store.bytes().cpu).toBe(kept ? 181 * 81 * 4 : 0);
    }
  });

  it('trimRaw keeps raw RSWF bytes only for the window it is given', () => {
    const { store, key } = storeWith();
    for (const k of [0, 1, 2]) { store.markInflight(key, vt(k)); store.putPacked(key, vt(k), fakePack(), new ArrayBuffer(105329)); }
    store.trimRaw(key, [vt(1)]);
    expect([0, 1, 2].map((k) => !!store.entry(key, vt(k)).raw)).toEqual([false, true, false]);
    expect(store.bytes().cpu).toBe(3 * 181 * 81 * 4 + 105329);
  });
});

describe('budget', () => {
  it('evicts the least recently active OTHER set first, then LRU frames of the active set, never protected ones', () => {
    let t = 0; const clock = () => (t += 1);
    const store = createFrameStore({ tier: 'constrained', now: clock });
    const per = 181 * 81 * 4; // ~58.6 KB; the constrained CPU budget (6 MiB) holds ~107 such frames
    const mk = (model) => { const s = store.ensureSet({ model, layer: 'waves', modelRunTime: 'r', signature: SIG }); store.noteIndex(s.key, index(70)); return s.key; };
    const old = mk('ICON'); const act = mk('GFS');
    for (let k = 0; k < 60; k++) { store.markInflight(old, vt(k)); store.putPacked(old, vt(k), fakePack()); }
    for (let k = 0; k < 60; k++) { store.markInflight(act, vt(k)); store.putPacked(act, vt(k), fakePack()); }
    expect(store.bytes().cpu).toBe(120 * per);
    const evicted = store.enforceBudget(act, [vt(0), vt(1)]);
    expect(evicted.every(([k]) => k === old)).toBe(true);          // the other set paid first
    expect(store.bytes().cpu).toBeLessThanOrEqual(TIERS.constrained.cpuBytes);
  });

  it('with no other set to pay, the active set loses its least recently used frames, never protected ones', () => {
    let t = 0; const clock = () => (t += 1);
    const store = createFrameStore({ tier: 'constrained', now: clock });
    const s = store.ensureSet({ model: 'GFS', layer: 'waves', modelRunTime: 'r', signature: SIG });
    store.noteIndex(s.key, index(130));
    for (let k = 0; k < 120; k++) { store.markInflight(s.key, vt(k)); store.putPacked(s.key, vt(k), fakePack()); }
    const evicted = store.enforceBudget(s.key, [vt(0), vt(1)]);   // 0 and 1 are the OLDEST, so only the guard keeps them
    expect(evicted.length).toBeGreaterThan(0);
    expect(evicted.some(([, v]) => v === vt(0) || v === vt(1))).toBe(false);
    expect(evicted[0][1]).toBe(vt(2));                             // then strictly oldest first
    expect(store.bytes().cpu).toBeLessThanOrEqual(TIERS.constrained.cpuBytes);
    expect(store.entry(s.key, vt(0)).state).toBe('packed');
    expect(store.entry(s.key, vt(2)).state).toBe('absent');
  });

  it('retainOnly forgets sets of another run or signature and reports their GPU layers to free', () => {
    const { store, key } = storeWith();
    store.markInflight(key, vt(0)); store.putPacked(key, vt(0), fakePack()); store.markResident(key, vt(0), 7, 60092);
    const dropped = store.retainOnly((s) => s.signature === 'something else');
    expect(dropped).toEqual([[key, vt(0), 7]]);
    expect(store.sets.size).toBe(0);
    expect(store.bytes()).toEqual({ cpu: 0, gpu: 0 });
  });

  it('telemetry counts frames by state', () => {
    const { store, key } = storeWith({ n: 5, unbuiltAt: [4] });
    store.markInflight(key, vt(0)); store.putPacked(key, vt(0), fakePack()); store.markInflight(key, vt(1));
    const s = store.telemetry().sets[0];
    expect([s.absent, s.unbuilt, s.inflight, s.packed, s.resident]).toEqual([2, 1, 1, 1, 0]);
  });
});
