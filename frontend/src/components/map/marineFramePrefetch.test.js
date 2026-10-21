import { CAP, CAP_SLOW, createIntent, createPrefetcher, nearestFirst, planWant, WINDOW } from './marineFramePrefetch';
import { createFrameStore } from './marineFrameStore';

const SIG = 'h10|dil1|conf0.75|trim1|wrap1|f32';
const vt = (k) => `T${String(k).padStart(3, '0')}`;
const series = (n) => Array.from({ length: n }, (_, k) => vt(k));
const flush = () => new Promise((r) => setTimeout(r, 0));
const fakePack = () => ({ bytes: new Uint8Array(16), cols: 2, rows: 2, bounds: {}, isGlobal: false, validityHash: 'x', signature: SIG, trimmed: false });

describe('nearestFirst', () => {
  it('starts at the cursor, then alternates, the scrub direction first', () => {
    expect(nearestFirst(10, 5, 1)).toEqual([5, 6, 4, 7, 3, 8, 2, 9, 1, 0]);
    expect(nearestFirst(10, 5, -1)).toEqual([5, 4, 6, 3, 7, 2, 8, 1, 9, 0]);
    expect(nearestFirst(5, 0, 1, 2)).toEqual([0, 1, 2]);
    expect(nearestFirst(0, 3)).toEqual([]);
  });
});

describe('planWant (the intent-gated policy the simulator scored)', () => {
  const active = { key: 'A', validTimes: series(40) };
  const warm = [{ key: 'B', validTime: vt(9) }, { key: 'C', validTime: vt(9) }];

  it('(a) the +-8 window nearest-first, then (b) the one-click-away sets, and NOTHING else before intent', () => {
    const plan = planWant({ active, cursor: 10, dir: 1, warm });
    expect(plan.slice(0, 3)).toEqual([{ key: 'A', validTime: vt(10) }, { key: 'A', validTime: vt(11) }, { key: 'A', validTime: vt(9) }]);
    expect(plan.filter((p) => p.key === 'A')).toHaveLength(2 * WINDOW + 1);
    expect(plan.slice(2 * WINDOW + 1)).toEqual(warm);
  });

  it('(c) the rest of the series streams once the gate is open, nearest-first, with no duplicates', () => {
    const plan = planWant({ active, cursor: 10, dir: -1, warm, expanded: true });
    const a = plan.filter((p) => p.key === 'A').map((p) => p.validTime);
    expect(a).toHaveLength(40);
    expect(new Set(a).size).toBe(40);
    expect(plan.findIndex((p) => p.key === 'B')).toBe(2 * WINDOW + 1); // warm still right after the window
    expect(a[a.length - 1]).toBe(vt(39));                              // the farthest frame last
  });

  it('(e) never plans an unbuilt entry, of the active set or a warm one', () => {
    const plan = planWant({ active: { ...active, built: (v) => v !== vt(11) }, cursor: 10, warm: [{ key: 'B', validTime: vt(9), built: false }], expanded: true });
    expect(plan.some((p) => p.validTime === vt(11) && p.key === 'A')).toBe(false);
    expect(plan.some((p) => p.key === 'B')).toBe(false);
  });

  it('slow links: +-4; a tier without full series never expands', () => {
    expect(planWant({ active, cursor: 10, slow: true }).filter((p) => p.key === 'A')).toHaveLength(9);
    expect(planWant({ active, cursor: 10, expanded: true, full: false })).toHaveLength(2 * WINDOW + 1);
  });
});

describe('createIntent', () => {
  it('opens after the wheel moves 4 frames from the set origin, closes on a switch, tracks direction', () => {
    const it2 = createIntent();
    it2.switchTo('A', 10);
    it2.press(11); it2.press(12); it2.press(13);
    expect(it2.state()).toMatchObject({ expanded: false, dir: 1 });
    it2.press(14);
    expect(it2.state().expanded).toBe(true);
    it2.switchTo('B', 14);
    expect(it2.state()).toMatchObject({ key: 'B', expanded: false });
    it2.press(12);
    expect(it2.state()).toMatchObject({ dir: -1, expanded: false });
    it2.press(10);
    expect(it2.state().expanded).toBe(true);
  });
});

function rig({ n = 30, unbuiltAt = [], fetchImpl, decode } = {}) {
  const store = createFrameStore({ tier: 'desktop' });
  const mkSet = (model) => {
    const s = store.ensureSet({ model, layer: 'waves', modelRunTime: 'r', signature: SIG });
    store.noteIndex(s.key, series(n).map((v, k) => (unbuiltAt.includes(k) ? { valid_time: v, path: null, unbuilt: 'refused' } : { valid_time: v, path: `${model}/${v}.bin` })));
    return s.key;
  };
  const calls = [];
  const fetchFrame = fetchImpl || ((path, signal) => new Promise((resolve) => { calls.push({ path, signal, resolve }); }));
  const packed = [];
  const stale = [];
  const pf = createPrefetcher({ store, fetchFrame, decodeAndPack: decode || (() => fakePack()), schedule: (fn) => fn(),
    onPacked: (k, v) => packed.push([k, v]), onStale: (k) => stale.push(k) });
  return { store, mkSet, pf, calls, packed, stale };
}

describe('createPrefetcher', () => {
  it('fetches nothing before the first marine draw, then at most CAP at a time', async () => {
    const { mkSet, pf, calls } = rig();
    const A = mkSet('GFS');
    pf.replan(planWant({ active: { key: A, validTimes: series(30) }, cursor: 5 }), A);
    expect(calls).toHaveLength(0);
    pf.open();
    expect(calls).toHaveLength(CAP);
    expect(calls[0].path).toBe(`GFS/${vt(5)}.bin`);                   // the cursor's frame first
  });

  it('slow links: CAP_SLOW in flight', () => {
    const { mkSet, pf, calls } = rig();
    const A = mkSet('GFS');
    pf.open();
    pf.replan(planWant({ active: { key: A, validTimes: series(30) }, cursor: 5, slow: true }), A, { slow: true });
    expect(calls).toHaveLength(CAP_SLOW);
  });

  it('a landed frame is packed, stored and handed to the GPU; the next one starts', async () => {
    const { store, mkSet, pf, calls, packed } = rig();
    const A = mkSet('GFS');
    pf.open();
    pf.replan(planWant({ active: { key: A, validTimes: series(30) }, cursor: 5 }), A);
    calls[0].resolve({ buffer: new ArrayBuffer(8), wire: 100 });
    await flush();
    expect(packed).toEqual([[A, vt(5)]]);
    expect(store.entry(A, vt(5)).state).toBe('packed');
    expect(calls).toHaveLength(CAP + 1);
    expect(pf.telemetry()).toMatchObject({ landed: 1, bytes: 100 });
  });

  it('on a toggle, the old set\'s requests outside the new top 2 x CAP are aborted; the active set\'s never are', async () => {
    const { store, mkSet, pf, calls } = rig();
    const A = mkSet('GFS'); const B = mkSet('ICON');
    pf.open();
    pf.replan(planWant({ active: { key: A, validTimes: series(30) }, cursor: 5 }), A);
    const firstSix = calls.slice(0, CAP);
    // Toggle to B (a 30-frame series): A's cursor frame is a warm frame, but it sits at plan position 17, after B's 17-frame
    // window, outside the top 2 x CAP = 12, so it is aborted with the rest.
    pf.replan(planWant({ active: { key: B, validTimes: series(30) }, cursor: 5, warm: [{ key: A, validTime: vt(5) }] }), B);
    expect(firstSix.filter((c) => c.signal && c.signal.aborted)).toHaveLength(CAP);
    expect(store.entry(A, vt(5)).state).toBe('absent');
    expect(pf.telemetry().aborted).toBe(CAP);
    // Re-planning the SAME active set never ABORTS its requests as stale (the series is fetched anyway); a big jump only
    // PREEMPTS the lowest-priority ones so the new cursor's first two frames start at once.
    const inB = calls.slice(CAP).filter((c) => c.path.startsWith('ICON/'));
    pf.replan(planWant({ active: { key: B, validTimes: series(30) }, cursor: 25 }), B);
    expect(pf.telemetry()).toMatchObject({ aborted: CAP, preempted: 2 });
    expect(inB.filter((c) => c.signal.aborted)).toHaveLength(2);
    expect(calls.slice(-2).map((c) => c.path)).toEqual([`ICON/${vt(25)}.bin`, `ICON/${vt(26)}.bin`]);
  });

  it('a big jump preempts the farthest in-flight frames so the frame now on screen starts at once', () => {
    const { store, mkSet, pf, calls } = rig({ n: 60 });
    const A = mkSet('GFS');
    pf.open();
    pf.replan(planWant({ active: { key: A, validTimes: series(60) }, cursor: 5 }), A);
    expect(calls).toHaveLength(CAP);
    pf.replan(planWant({ active: { key: A, validTimes: series(60) }, cursor: 40 }), A);
    expect(store.entry(A, vt(40)).state).toBe('inflight');
    expect(store.entry(A, vt(41)).state).toBe('inflight');
    expect(pf.inflightCount()).toBe(CAP);
    expect(pf.telemetry().preempted).toBe(2);
    // No preemption when the head is already covered.
    pf.replan(planWant({ active: { key: A, validTimes: series(60) }, cursor: 40 }), A);
    expect(pf.telemetry().preempted).toBe(2);
  });

  it('a warm frame inside the new top 2 x CAP keeps its request', () => {
    const { store, mkSet, pf, calls } = rig();
    const A = mkSet('GFS'); const B = mkSet('ICON');
    pf.open();
    pf.replan(planWant({ active: { key: A, validTimes: series(30) }, cursor: 5 }), A);
    // B's series is 3 frames, so A's warm frame lands at plan position 3, inside the top 12.
    pf.replan(planWant({ active: { key: B, validTimes: series(3) }, cursor: 1, warm: [{ key: A, validTime: vt(5) }] }), B);
    expect(calls[0].signal.aborted).toBe(false);
    expect(store.entry(A, vt(5)).state).toBe('inflight');
    expect(pf.telemetry().aborted).toBe(CAP - 1);
  });

  it('never requests an unbuilt entry (path null): /grid serves that hour', () => {
    const { mkSet, pf, calls } = rig({ unbuiltAt: [5, 6] });
    const A = mkSet('GFS');
    pf.open();
    pf.replan(planWant({ active: { key: A, validTimes: series(30) }, cursor: 5 }), A);
    expect(calls.some((c) => c.path.endsWith(`${vt(5)}.bin`) || c.path.endsWith(`${vt(6)}.bin`))).toBe(false);
  });

  it('a 404 re-pins (retention removed the run) and the frame goes back to absent', async () => {
    const { store, mkSet, pf, calls, stale } = rig();
    const A = mkSet('GFS');
    pf.open();
    pf.replan(planWant({ active: { key: A, validTimes: series(3) }, cursor: 0 }), A);
    calls[0].resolve({ error: 'http_404', status: 404 });
    await flush();
    expect(stale).toEqual([A]);
    expect(pf.telemetry()).toMatchObject({ errors: 1, stale: 1 });
    expect(['absent', 'inflight']).toContain(store.entry(A, vt(0)).state);
  });

  it('a frame the packer declines becomes a terminal miss: it is never re-fetched', async () => {
    let n = 0;
    const { store, mkSet, pf } = rig({ fetchImpl: () => { n += 1; return Promise.resolve({ buffer: new ArrayBuffer(4), wire: 4 }); }, decode: () => null });
    const A = mkSet('GFS');
    pf.open();
    pf.replan(planWant({ active: { key: A, validTimes: series(2) }, cursor: 0 }), A);
    await flush(); await flush();
    const first = n;
    pf.replan(planWant({ active: { key: A, validTimes: series(2) }, cursor: 0 }), A);
    await flush();
    expect(n).toBe(first);
    expect(store.lookup(A, vt(0))).toBeNull();
    expect(store.entry(A, vt(0)).unbuilt).toBe('unpackable');
    expect(pf.telemetry().packFail).toBe(2);
  });
});
