/**
 * The regional bundle warm-up (D3 path 2): MapPage's mount warms the z7-9 bundle of the first view the map settles on inside a pilot
 * box, so a cold Waves click there finds its detailed frame on the CDN already decoded.
 */
import { pilotBoxForView, prewarmRegionalForCamera, _resetRegionalPrewarmForTest } from './staticRegionalPrewarm';
import { _setRegionalCodecForTest, regionalTelemetry } from './staticRegional';
import * as SF from './staticFrames';

jest.mock('./staticFrames', () => ({
  getPinnedIndex: jest.fn(), loadFrameVectors: jest.fn(), staticFramesBase: jest.fn(() => 'https://cdn.test/'),
  staticFramesEnabled: jest.fn(() => true), staticSetEnabled: jest.fn(() => true),
}));

const H = 3600000;
const COCOA_Z9 = { west: -80.95, south: 27.9, east: -79.95, north: 28.6 };   // inside florida_east_coast (-85, 24, -79, 31)
const FLORIDA_Z7 = { west: -88.5, south: 22.5, east: -74.5, north: 33.5 };   // the default opening view: wider than the box
const fakeMap = (bounds, { moving = false } = {}) => {
  const handlers = {};
  const m = {
    b: bounds, moving,
    loaded: () => true, isMoving: () => m.moving,
    on: (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); }, off: (ev, fn) => { handlers[ev] = (handlers[ev] || []).filter((f) => f !== fn); },
    fire: (ev) => (handlers[ev] || []).slice().forEach((fn) => fn()),
    handlers,
    getBounds: () => ({ getWest: () => m.b.west, getSouth: () => m.b.south, getEast: () => m.b.east, getNorth: () => m.b.north }),
  };
  return m;
};
const hour0 = () => new Date(Math.round(Date.now() / H) * H).toISOString().replace('.000Z', 'Z');
const INDEX = () => ({ path: 'v1/i.json', frames: [{ valid_time: hour0(), path: 'v1/b.bin#0' }] });
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

beforeEach(() => {
  _resetRegionalPrewarmForTest();
  _setRegionalCodecForTest({ sha12: async () => 'x', gunzip: async () => new ArrayBuffer(0) });   // jsdom has neither
  SF.staticFramesBase.mockReturnValue('https://cdn.test/'); SF.staticFramesEnabled.mockReturnValue(true); SF.staticSetEnabled.mockReturnValue(true);   // CRA resetMocks
  SF.getPinnedIndex.mockReset().mockResolvedValue(INDEX());
  SF.loadFrameVectors.mockReset().mockResolvedValue([{ speed: 1 }]);
  window.requestIdleCallback = (fn) => setTimeout(fn, 0);
});
afterEach(() => {
  _setRegionalCodecForTest({});
  delete window.requestIdleCallback;
  for (const k of ['REGIONAL_PREWARM', 'STATIC_FRAMES_PREWARM', 'REGIONAL_BUNDLES']) delete window[`__RAW_DISABLE_${k}__`];
});

test('pilotBoxForView: a whole view inside a pilot box names it; a view crossing its edge or wider than it does not', () => {
  expect(pilotBoxForView(COCOA_Z9)).toBe('florida_east_coast');
  expect(pilotBoxForView({ ...COCOA_Z9, east: -78.5 })).toBeNull();   // past the -79 east edge (partial cover stays on /grid)
  expect(pilotBoxForView(FLORIDA_Z7)).toBeNull();
  expect(pilotBoxForView(null)).toBeNull();
});

test('the settled first view inside a pilot box: pins that box\'s GFS waves set and loads its hour-0 frame at low priority', async () => {
  const map = fakeMap(COCOA_Z9);
  const p = prewarmRegionalForCamera({ model: 'GFS', getMap: () => map });
  await expect(p).resolves.toBe(hour0());
  expect(SF.getPinnedIndex).toHaveBeenCalledWith('GFS/marine/waves/florida_east_coast');
  expect(SF.loadFrameVectors).toHaveBeenCalledWith('GFS/marine/waves/florida_east_coast', expect.objectContaining({ valid_time: hour0() }), undefined, { priority: 'low' });
  expect(regionalTelemetry().prewarm).toMatchObject({ box: 'florida_east_coast', frame: hour0(), skipped: null });
  expect(prewarmRegionalForCamera({ getMap: () => map })).toBe(p);    // once per page load
});

test('the map opens wide (Florida z7) and then flies to z9: nothing at the wide view, the bundle once the flight settles', async () => {
  const map = fakeMap(FLORIDA_Z7);
  const p = prewarmRegionalForCamera({ model: 'GFS', getMap: () => map });
  await flush();
  expect(SF.getPinnedIndex).not.toHaveBeenCalled();
  expect(regionalTelemetry().prewarm.skipped).toBe('outside_pilot_boxes');
  map.b = COCOA_Z9; map.fire('moveend');
  await expect(p).resolves.toBe(hour0());
  expect(SF.getPinnedIndex).toHaveBeenCalledTimes(1);
  expect(map.handlers.moveend).toHaveLength(0);                       // stops watching once done
});

test('never for ICON/EURO (no regional sets), and nothing at all behind any of the three kill switches', async () => {
  const map = fakeMap(COCOA_Z9);
  await expect(prewarmRegionalForCamera({ model: 'EURO', getMap: () => map })).resolves.toBeNull();
  expect(SF.getPinnedIndex).not.toHaveBeenCalled();
  for (const k of ['REGIONAL_PREWARM', 'STATIC_FRAMES_PREWARM', 'REGIONAL_BUNDLES']) {
    _resetRegionalPrewarmForTest();
    window[`__RAW_DISABLE_${k}__`] = true;
    expect(prewarmRegionalForCamera({ model: 'GFS', getMap: () => map })).toBeNull();
    delete window[`__RAW_DISABLE_${k}__`];
  }
  expect(SF.getPinnedIndex).not.toHaveBeenCalled();
});

test('an unlisted set (no index) fetches no frame and says why', async () => {
  SF.getPinnedIndex.mockResolvedValue(null);
  await expect(prewarmRegionalForCamera({ model: 'GFS', getMap: () => fakeMap(COCOA_Z9) })).resolves.toBeNull();
  expect(SF.loadFrameVectors).not.toHaveBeenCalled();
  expect(regionalTelemetry().prewarm.skipped).toBe('no_index');
});
