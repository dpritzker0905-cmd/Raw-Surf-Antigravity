// PR D (2026-10-26): the prefetch replan a toggle or a wheel step asks for runs AFTER the next paint, once for a burst, from the
// cursor current when it runs; killed, inline as before (windFramePrefetch.noteWind / replanSoon).
const mockPaint = [];
const mockPrefetcher = { replan: jest.fn(), open: jest.fn(), telemetry: () => ({}) };
const mockIndex = { frames: [0, 3, 6].map((h) => ({ valid_time: new Date(Date.UTC(2026, 9, 26, h)).toISOString(), path: `f${h}.bin` })) };
jest.mock('./afterNextPaint', () => ({ afterNextPaintCb: (fn) => { mockPaint.push(fn); } }));
jest.mock('./marineFramePrefetch', () => ({
  createPrefetcher: () => mockPrefetcher, WINDOW_SLOW: 6,
  nearestFirst: (n) => Array.from({ length: n }, (_, i) => i),
}));
jest.mock('./marineFrameStore', () => ({ resolveTier: () => 'desktop' }));
jest.mock('./deviceTier', () => ({ isHandheldDevice: () => false, isWeakDevice: () => false }));
jest.mock('./windLane', () => ({ windLaneDisabled: () => false }));
jest.mock('./windStaticFrames', () => ({
  WIND_SET_KEY: 'GFS/wind/wind/global_mid', fetchWindFrame: jest.fn(), hasRaw: () => false, laneVerdict: () => ({}),
  readLanePointer: () => Promise.resolve(null), windIndex: () => Promise.resolve(mockIndex), windIndexSync: () => mockIndex,
  windStaticEnabled: () => true,
}));

const { noteWind, startWindPrefetch, _resetWindPrefetchForTest } = require('./windFramePrefetch');
const H = 3600000;
const T0 = Date.UTC(2026, 9, 26, 0);

beforeEach(() => {
  _resetWindPrefetchForTest();
  mockPaint.length = 0;
  mockPrefetcher.replan.mockClear();
  window.matchMedia = () => ({ matches: false });
  startWindPrefetch();
});
afterEach(() => { _resetWindPrefetchForTest(); delete window.__RAW_DISABLE_WIND_PREFETCH_REPLAN_AFTER_PAINT__; });

test('a burst of wheel steps plans nothing inside the steps, then once after the paint, from the newest cursor', () => {
  noteWind({ cursorMs: T0 + 1 * H });
  noteWind({ cursorMs: T0 + 2 * H });
  noteWind({ cursorMs: T0 + 6 * H });
  expect(mockPrefetcher.replan).not.toHaveBeenCalled();
  expect(mockPaint).toHaveLength(1);
  mockPaint.shift()();
  expect(mockPrefetcher.replan).toHaveBeenCalledTimes(1);
  const [plan] = mockPrefetcher.replan.mock.calls[0];
  expect(plan.length).toBe(3);
  noteWind({ cursorMs: T0 });                                   // the next step schedules a fresh one
  expect(mockPaint).toHaveLength(1);
});

test('killed: the replan runs inline in the step, as before', () => {
  window.__RAW_DISABLE_WIND_PREFETCH_REPLAN_AFTER_PAINT__ = true;
  noteWind({ cursorMs: T0 + 1 * H });
  expect(mockPrefetcher.replan).toHaveBeenCalledTimes(1);
  expect(mockPaint).toHaveLength(0);
});
