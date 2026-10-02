/**
 * The zoom-out bridge's decision also promotes the held base over a stale WORLD frame (2026-10-01, audit F-21; marineStaleHour.js rule 4).
 *
 * A seed that lands after the zoom-out replaces the held base but not the frame already drawn (the earlier promotion of the old base).
 * The engine asks `shouldBridgeToCoarseGlobal` every frame; the layer hands it the selected instant (`engine.__staleSwapMs`) only in the
 * frames it judged the drawn frame stale. Without that sixth argument the function is exactly what it was.
 */
import { shouldBridgeToCoarseGlobal } from './marineCommitGate';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const TILE = { west: -82, south: 26, east: -79, north: 29 };
const VB = [-170, -50, 20, 60];                                         // a far-zoom viewport, 190 degrees wide
const NOW0 = '2026-10-01T12:00:00Z';
const WED15 = '2026-10-07T15:00:00Z';
const SEL = Date.parse(WED15);
const world = (vt, over = {}) => ({ bounds: WORLD, cols: 181, rows: 82, valid_time: vt, __sourceModel: 'GFS', __componentLayer: 'waves', ...over });
const regional = (over = {}) => ({ bounds: TILE, cols: 40, rows: 30, valid_time: WED15, __sourceModel: 'GFS', __componentLayer: 'waves', ...over });

afterEach(() => {
  delete window.__RAW_DISABLE_ZOOMOUT_BRIDGE__;
  delete window.__RAW_DISABLE_STALE_RESIDENT_SWAP__;
});

describe('shouldBridgeToCoarseGlobal: a stale WORLD resident', () => {
  it('is promoted over when the layer hands the selected instant and the held base is that hour', () => {
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world(WED15), 3.6, VB, window, SEL)).toBe(true);
  });

  it('is inert without the sixth argument: a world resident was never bridged and still is not', () => {
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world(WED15), 3.6, VB, window)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world(WED15), 3.6, VB, window, null)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world(WED15), 3.6, VB, window, undefined)).toBe(false);
  });

  it('never promotes an older base over the right resident, nor over another stale one', () => {
    expect(shouldBridgeToCoarseGlobal(world(WED15), world(NOW0), 3.6, VB, window, SEL)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world('2026-10-03T12:00:00Z'), 3.6, VB, window, SEL)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(world(WED15), world(WED15), 3.6, VB, window, SEL)).toBe(false);
  });

  it('does not undo a deliberate switch: another model, layer or rating flavor is not "the same field for the right hour"', () => {
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world(WED15, { __sourceModel: 'ICON' }), 3.6, VB, window, SEL)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world(WED15, { __componentLayer: 'swell_1' }), 3.6, VB, window, SEL)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(world(NOW0, { ratingMode: true }), world(WED15), 3.6, VB, window, SEL)).toBe(false);
  });

  it('stops under its own kill switch and under the bridge\'s (it rides the bridge)', () => {
    window.__RAW_DISABLE_STALE_RESIDENT_SWAP__ = true;
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world(WED15), 3.6, VB, window, SEL)).toBe(false);
    delete window.__RAW_DISABLE_STALE_RESIDENT_SWAP__;
    window.__RAW_DISABLE_ZOOMOUT_BRIDGE__ = true;
    expect(shouldBridgeToCoarseGlobal(world(NOW0), world(WED15), 3.6, VB, window, SEL)).toBe(false);
  });

  it('a base that is not a coarse global grid is never promoted (the bridge\'s own first rule)', () => {
    expect(shouldBridgeToCoarseGlobal(world(NOW0), regional(), 3.6, VB, window, SEL)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(world(NOW0), null, 3.6, VB, window, SEL)).toBe(false);
  });
});

describe('shouldBridgeToCoarseGlobal: the regional-resident rule is exactly what it was', () => {
  it('a regional resident that no longer covers a wide viewport is bridged, with or without the sixth argument', () => {
    expect(shouldBridgeToCoarseGlobal(regional(), world(WED15), 3.6, VB, window)).toBe(true);
    expect(shouldBridgeToCoarseGlobal(regional(), world(WED15), 3.6, VB, window, SEL)).toBe(true);
    expect(shouldBridgeToCoarseGlobal(regional(), world(WED15), 3.6, VB, window, null)).toBe(true);
  });
  it('a regional resident at a regional viewport is not bridged, whatever the sixth argument says', () => {
    const vbRegional = [-81, 27, -80, 28];
    expect(shouldBridgeToCoarseGlobal(regional(), world(WED15), 9, vbRegional, window, SEL)).toBe(false);
    expect(shouldBridgeToCoarseGlobal(regional(), world(WED15), 9, vbRegional, window)).toBe(false);
  });
});
