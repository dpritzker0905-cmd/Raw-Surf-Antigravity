import { landMaskSlicingOn, landMaskSliceOpts, maskJobInFlight, startMaskJob } from './maskSliceScheduler';

// A fake canvas whose 1 px read is the "flush" the scheduler forces after recorded draws.
const fakeCanvas = () => {
  const getImageData = jest.fn();
  return { getContext: () => ({ getImageData }), getImageData };
};

function* steps(holder, canvas, n, log) {
  holder.canvas = canvas;
  yield 'baseCanvas';
  for (let i = 0; i < n; i++) { log.push(i); yield 1; }
  yield 'pass';
  return { painted: n };
}

describe('maskSliceScheduler', () => {
  beforeEach(() => { jest.useFakeTimers(); window.__RAW_GPU__ = {}; });
  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    delete window.__RAW_GPU__; delete window.__RAW_SLICED_LAND_MASK__; delete window.__RAW_LAND_MASK_SLICE_MS__;
  });

  test('the flag is opt-in: no opts (the old call) unless __RAW_SLICED_LAND_MASK__ === true', () => {
    expect(landMaskSlicingOn()).toBe(false);
    expect(landMaskSliceOpts(() => {})).toBeUndefined();
    window.__RAW_SLICED_LAND_MASK__ = 'yes';
    expect(landMaskSliceOpts(() => {})).toBeUndefined();
    window.__RAW_SLICED_LAND_MASK__ = true;
    const rerun = () => {};
    expect(landMaskSliceOpts(rerun)).toEqual({ sliced: true, rerun });
  });

  test('runs every step after the call returns, commits once with the result, then frees the slot', () => {
    const engine = {}; const holder = {}; const canvas = fakeCanvas(); const log = [];
    const commit = jest.fn(() => true); const onEnd = jest.fn();
    expect(startMaskJob(engine, { kind: 'regional', steps: steps(holder, canvas, 60, log), holder, isStale: () => false, commit, onEnd })).toBe(true);
    expect(log).toHaveLength(0);           // nothing ran inside the event's task
    expect(engine._maskJob).toBeTruthy();
    jest.runAllTimers();
    expect(log).toHaveLength(60);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith({ painted: 60 });
    expect(onEnd).toHaveBeenCalledWith('committed', false);
    expect(engine._maskJob).toBeNull();
    expect(canvas.getImageData).toHaveBeenCalled();   // recorded draws are flushed inside their own slice
    for (const c of canvas.getImageData.mock.calls) expect(c).toEqual([0, 0, 1, 1]);
    const s = window.__RAW_GPU__.maskSlicing;
    expect(s).toMatchObject({ scheduled: 1, committed: 1, stale: 0, failed: 0 });
    expect(s.latencyMs).toHaveLength(1);
  });

  test('a target replaced mid-job is never committed', () => {
    const engine = {}; const holder = {}; let stale = false; const log = [];
    const commit = jest.fn(() => true); const onEnd = jest.fn();
    let clock = 0; jest.spyOn(performance, 'now').mockImplementation(() => (clock += 1));   // every read 1 ms later
    window.__RAW_LAND_MASK_SLICE_MS__ = 1;   // so one step per slice
    startMaskJob(engine, { kind: 'overlay', steps: steps(holder, fakeCanvas(), 10, log), holder, isStale: () => stale, commit, onEnd });
    jest.advanceTimersToNextTimer(); jest.advanceTimersToNextTimer();
    stale = true;
    jest.runAllTimers();
    expect(commit).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledWith('stale', false);
    expect(log.length).toBeLessThan(10);
    expect(engine._maskJob).toBeNull();
    expect(window.__RAW_GPU__.maskSlicing.stale).toBe(1);
  });

  test('a second request while a job runs only marks it pending (one re-drive when it ends)', () => {
    const engine = {}; const holder = {}; const onEnd = jest.fn();
    expect(maskJobInFlight(engine)).toBe(false);
    startMaskJob(engine, { kind: 'regional', steps: steps(holder, fakeCanvas(), 3, []), holder, isStale: () => false, commit: () => true, onEnd });
    expect(maskJobInFlight(engine)).toBe(true);
    expect(maskJobInFlight(engine)).toBe(true);
    jest.runAllTimers();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith('committed', true);
    expect(window.__RAW_GPU__.maskSlicing.coalesced).toBe(2);
  });

  test('the slot is free during commit, so a regional commit can start the nested overlay job', () => {
    const engine = {}; const holder = {}; let nested = null;
    const commit = () => {
      const h2 = {};
      startMaskJob(engine, { kind: 'overlay', steps: steps(h2, fakeCanvas(), 2, []), holder: h2, isStale: () => false, commit: () => true });
      nested = engine._maskJob;
      return true;
    };
    startMaskJob(engine, { kind: 'regional', steps: steps(holder, fakeCanvas(), 2, []), holder, isStale: () => false, commit });
    jest.runAllTimers();
    expect(nested).toBeTruthy();
    expect(nested.kind).toBe('overlay');
    expect(window.__RAW_GPU__.maskSlicing.committed).toBe(2);
    expect(engine._maskJob).toBeNull();
  });

  test('a job requested while another runs is queued with its inputs, runs next, and the re-drive waits for the queue', () => {
    const engine = {}; const order = []; const onEnd1 = jest.fn(); const onEnd2 = jest.fn();
    const job = (name, onEnd) => { const h = {}; return { kind: name, holder: h, isStale: () => false, onEnd,
      steps: (function* () { h.canvas = fakeCanvas(); order.push(`${name}:start`); yield 'p'; order.push(`${name}:end`); return name; })(),
      commit: (r) => { order.push(`${r}:commit`); return true; } }; };
    startMaskJob(engine, job('regional', onEnd1));
    expect(maskJobInFlight(engine)).toBe(true);   // a map event during the regional job: pending
    startMaskJob(engine, job('overlay', onEnd2));  // the nested overlay, requested in the same event
    expect(engine._maskJobQueue).toHaveLength(1);
    jest.runAllTimers();
    expect(order).toEqual(['regional:start', 'regional:end', 'regional:commit', 'overlay:start', 'overlay:end', 'overlay:commit']);
    expect(onEnd1).toHaveBeenCalledWith('committed', false);   // pending moved to the queued job
    expect(onEnd2).toHaveBeenCalledWith('committed', true);
    expect(engine._maskJob).toBeNull();
  });

  test('a throwing step ends the job as failed and frees the slot', () => {
    const engine = {}; const onEnd = jest.fn();
    const bad = (function* () { yield 'x'; throw new Error('boom'); })();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    startMaskJob(engine, { kind: 'regional', steps: bad, holder: {}, isStale: () => false, commit: jest.fn(), onEnd });
    jest.runAllTimers();
    expect(onEnd).toHaveBeenCalledWith('failed', false);
    expect(engine._maskJob).toBeNull();
    console.warn.mockRestore();
  });
});
