import { MARINE_CPU_PHASES, beginMarineCpuPhase, endMarineCpuPhase, timeMarineCpuPhase,
  measureMarineCpuPhase, snapshotMarineCpuPhases, marineCpuPhaseDelta } from './marineCpuPhaseTiming';
let now;
beforeEach(() => {
  now = 100;
  window.__RAW_GPU__ = {};
  jest.spyOn(performance, 'now').mockImplementation(() => now);
  jest.spyOn(document, 'hasFocus').mockReturnValue(true);
  jest.spyOn(document, 'hidden', 'get').mockReturnValue(false);
});
afterEach(() => {
  jest.restoreAllMocks(); delete window.__RAW_GPU__; delete window.__RAW_DISABLE_MARINE_PHASE_TIMING__;
});
const run = (phase, duration) => measureMarineCpuPhase(phase, () => { now += duration; });
const snap = () => snapshotMarineCpuPhases(window.__RAW_GPU__);
const baseline = () => { run('engineDraw', 1); return snap(); };

test('nested durations remain separate; snapshots copy scalars and histograms', () => {
  const before = baseline();
  measureMarineCpuPhase('customCallback', () => { now += 30; run('engineDraw', 4); now += 2; });
  const delta = marineCpuPhaseDelta(before, snap());
  expect(delta).toMatchObject({ overlappingPhases: true, gpuCompletionMeasured: false,
    phases: { customCallback: {calls: 1, totalDurationMs: 36, histogram: [0,0,0,1,0]},
      engineDraw: {calls: 1, totalDurationMs: 4, histogram: [1,0,0,0,0]} },
    callbackContexts: { visibleFocused: 1, visibleUnfocused: 0, hidden: 0, unknown: 0 } });
  expect(before.buckets.customCallback.calls).toBe(0);
  expect(before.buckets.engineDraw.histogram).toEqual([1,0,0,0,0]);
});
test.each([4,12,25,50,100])('duration %s goes in one bounded histogram bucket', duration => {
  const before = baseline(); run('maskUpload', duration);
  const histogram = marineCpuPhaseDelta(before, snap()).phases.maskUpload.histogram;
  expect(histogram.reduce((a,n)=>a+n,0)).toBe(1);
  expect(histogram[[4,12,25,50,100].indexOf(duration)]).toBe(1);
});
test('wrapper preserves receiver, arguments, returned identity and thrown identity', () => {
  const receiver = {}, value = {}, error = new Error('fixture');
  const wrapped = timeMarineCpuPhase('waveDataUpdate', function(arg) { expect(this).toBe(receiver); return arg; });
  expect(wrapped.call(receiver,value)).toBe(value);
  expect(() => timeMarineCpuPhase('waveDataUpdate', () => { now += 12; throw error; })()).toThrow(error);
  expect(snap().buckets.waveDataUpdate.calls).toBe(2);
});
test.each(['visibleUnfocused','hidden','unknown'])('callback context records %s without location or identity', name => {
  if (name === 'hidden') jest.spyOn(document,'hidden','get').mockReturnValue(true);
  else if (name === 'unknown') document.hasFocus.mockImplementation(() => { throw new Error('unavailable'); });
  else document.hasFocus.mockReturnValue(false);
  run('customCallback',1);
  expect(snap().contexts[name]).toBe(1);
});
test('unobserved and disabled instrumentation are unknown, not measured zero', () => {
  expect(snap()).toBeNull(); const before = baseline();
  window.__RAW_DISABLE_MARINE_PHASE_TIMING__ = true;
  run('customCallback',5); expect(snap()).toBeNull();
  expect(marineCpuPhaseDelta(before,snap())).toBeNull();
});
test('active operation at a boundary cannot produce a complete interval', () => {
  const before = baseline(), token = beginMarineCpuPhase('maskUpload');
  expect(snap()).toBeNull(); now += 50; endMarineCpuPhase(token);
  expect(marineCpuPhaseDelta(before,snap()).phases.maskUpload.totalDurationMs).toBe(50);
});
test.each(['clock throws','clock reverses','clock invalid'])('a failed timing sample (%s) invalidates the interval', mode => {
  const before = baseline();
  if (mode === 'clock throws') performance.now.mockImplementation(() => { throw new Error('clock unavailable'); });
  else if (mode === 'clock invalid') now = NaN;
  const token = beginMarineCpuPhase('engineDraw');
  if (mode === 'clock reverses') now -= 10;
  expect(() => endMarineCpuPhase(token)).not.toThrow();
  expect(marineCpuPhaseDelta(before,snap())).toBeNull();
});
test('replacement and decreasing counters stay unknown across the interval', () => {
  const before = baseline(); delete window.__RAW_GPU__.cpuPhaseTiming; baseline();
  expect(marineCpuPhaseDelta(before,snap())).toBeNull();
  const next = snap(); window.__RAW_GPU__.cpuPhaseTiming.buckets.engineDraw.totalDurationMs = 0;
  expect(marineCpuPhaseDelta(next,snap())).toBeNull();
});
test('measured zero activity remains zero in all fixed phase buckets', () => {
  const before = baseline(), delta = marineCpuPhaseDelta(before,snap());
  expect(Object.keys(delta.phases)).toEqual(MARINE_CPU_PHASES);
  expect(Object.values(delta.phases).every(b=>b.calls===0&&b.totalDurationMs===0)).toBe(true);
});
test('broken GPU diagnostic access cannot change the operation result', () => {
  Object.defineProperty(window.__RAW_GPU__,'cpuPhaseTiming',{configurable:true,get(){throw new Error('unavailable');}});
  expect(measureMarineCpuPhase('engineDraw',()=>42)).toBe(42);
  expect(snap()).toBeNull();
});
test('many calls retain fixed scalar buckets rather than a per-call history',()=>{
  baseline();for(let i=0;i<10000;i++)run('engineDraw',1);
  const state=window.__RAW_GPU__.cpuPhaseTiming;
  expect(Object.keys(state)).toEqual(['buckets','contexts','active','invalidSamples']);
  expect(Object.keys(state.buckets)).toHaveLength(MARINE_CPU_PHASES.length);
  expect(JSON.stringify(state).length).toBeLessThan(4000);
});
test('readonly diagnostics do not interrupt drawing or masquerade as measured zero',()=>{
  const before=baseline();Object.freeze(window.__RAW_GPU__.cpuPhaseTiming);
  expect(measureMarineCpuPhase('engineDraw',()=>42)).toBe(42);
  expect(snap()).toBeNull();expect(marineCpuPhaseDelta(before,snap())).toBeNull();
});
