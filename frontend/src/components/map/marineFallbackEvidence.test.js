import { sampleMarineFallback, marineFallbackReceipt } from './marineFallbackEvidence';

const engine = {};
function fixture() {
  const gpu = { layer: { n: 100 }, textureUploadCount: 19, droppedFrameCounter: 4,
    frameTimeHistogram: [200, 10, 3, 1, 0], privatePayload: { latitude: 99, token: 'synthetic-not-a-credential' } };
  const start = sampleMarineFallback(null, { now: 1000, fps: 3, gpu, engine });
  return { gpu, start };
}
function next(previous, gpu, overrides = {}) {
  return sampleMarineFallback(previous, { now: 2000, fps: 7, gpu, engine, ...overrides });
}

test('reports interval changes, including CPU-duration bucket counts, without claiming GPU completion', () => {
  const { gpu, start } = fixture();
  gpu.layer.n += 7; gpu.textureUploadCount += 2; gpu.droppedFrameCounter += 3;
  gpu.frameTimeHistogram = [202, 12, 5, 2, 0];
  const receipt = marineFallbackReceipt(next(start, gpu));
  expect(receipt.deltas).toEqual({ nativeCallbacks: 7, textureUploads: 2, slowCpuCalls: 3,
    cpuCallHistogram: [2, 2, 2, 1, 0] });
  expect(receipt).toMatchObject({ observedIntervalMs: 1000, lowFpsWindows: 2,
    intervalCountersContinuous: true, gpuCompletionMeasured: false, fps: { first: 3, last: 7, min: 3, max: 7 } });
});

test('copies mutable histogram counters instead of retaining the native counter array', () => {
  const { gpu, start } = fixture();
  gpu.frameTimeHistogram[0] += 8;
  expect(marineFallbackReceipt(next(start, gpu)).deltas.cpuCallHistogram).toEqual([8, 0, 0, 0, 0]);
  expect(start.first.cpuCallHistogram[0]).toBe(200);
});

test('measured zero activity remains zero', () => {
  const { gpu, start } = fixture();
  expect(marineFallbackReceipt(next(start, gpu)).deltas).toEqual({ nativeCallbacks: 0,
    textureUploads: 0, slowCpuCalls: 0, cpuCallHistogram: [0, 0, 0, 0, 0] });
});

test('absent counters remain unknown while an available native counter remains usable', () => {
  const gpu = { layer: { n: 0 } };
  const first = sampleMarineFallback(null, { now: 0, fps: 1, gpu, engine });
  gpu.layer.n = 1;
  expect(marineFallbackReceipt(next(first, gpu)).deltas).toEqual({ nativeCallbacks: 1,
    textureUploads: null, slowCpuCalls: null, cpuCallHistogram: null });
});

test.each([undefined, null, NaN, Infinity, -1, 1.5, '0', Number.MAX_SAFE_INTEGER + 1])(
  'invalid cumulative upload count %s is unknown, never coerced to zero', value => {
    const { gpu } = fixture(); gpu.textureUploadCount = value;
    const start = sampleMarineFallback(null, { now: 0, fps: 1, gpu, engine });
    expect(marineFallbackReceipt(next(start, gpu)).deltas.textureUploads).toBeNull();
  });

test.each([[0, 0], [0, 0, 0, 0, -1], [0, 0, 0, 0, NaN], new Array(5)])('malformed histogram %j is unknown', histogram => {
  const { gpu } = fixture(); gpu.frameTimeHistogram = histogram;
  const start = sampleMarineFallback(null, { now: 0, fps: 1, gpu, engine });
  expect(marineFallbackReceipt(next(start, gpu)).deltas.cpuCallHistogram).toBeNull();
});

test.each(['native', 'uploads', 'slow', 'histogram', 'engine', 'gpu', 'clock', 'missing'])('%s discontinuity invalidates interval evidence', kind => {
  const { gpu, start } = fixture(); let source = gpu; const overrides = {};
  if (kind === 'native') gpu.layer.n = 0;
  if (kind === 'uploads') gpu.textureUploadCount = 0;
  if (kind === 'slow') gpu.droppedFrameCounter = 0;
  if (kind === 'histogram') gpu.frameTimeHistogram[1] = 0;
  if (kind === 'engine') overrides.engine = {};
  if (kind === 'gpu') source = { ...gpu };
  if (kind === 'clock') overrides.now = 500;
  if (kind === 'missing') delete gpu.textureUploadCount;
  const changed = next(start, source, overrides);
  // Even if a reset counter rebounds above the first value, continuity remains broken.
  source.textureUploadCount = 1000;
  const receipt = marineFallbackReceipt(next(changed, source, { ...overrides, now: 3000 }));
  expect(receipt.intervalCountersContinuous).toBe(false);
  expect(Object.values(receipt.deltas).every(value => value === null)).toBe(true);
});

test('new streak starts fresh rather than retaining invalid or older cumulative evidence', () => {
  const { gpu } = fixture(); gpu.layer.n = 0;
  const fresh = sampleMarineFallback(null, { now: 5000, fps: 2, gpu, engine });
  gpu.layer.n = 3;
  expect(marineFallbackReceipt(next(fresh, gpu, { now: 6000 })).deltas.nativeCallbacks).toBe(3);
});

test('receipts contain only fixed allowlisted counters, never resident data or object identities', () => {
  const { gpu, start } = fixture();
  const json = JSON.stringify(marineFallbackReceipt(next(start, gpu)));
  expect(json).not.toMatch(/privatePayload|latitude|token|synthetic|engine|"gpu":/);
  expect(json.length).toBeLessThan(1000);
});

test('throwing diagnostic access is contained and yields no receipt', () => {
  const gpu = new Proxy({}, { get: () => { throw new Error('disposed diagnostic'); } });
  expect(sampleMarineFallback(null, { now: 0, fps: 1, gpu, engine })).toBeNull();
  expect(marineFallbackReceipt(null)).toBeNull();
});
