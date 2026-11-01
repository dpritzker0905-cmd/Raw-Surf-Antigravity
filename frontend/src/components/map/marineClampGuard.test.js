/**
 * THE ZOOM-OUT CLAMP GUARD AND THE MID-ZOOM CLIP (2026-10-26, the owner: "Heatmap temporarily cleared when switching to Euro").
 * Offline at z4.6 / z5.3 a GFS -> ICON switch drew 84-130 blank frames: the resident was the mid-zoom clip of global_mid (#459), the
 * guard called it "regional at a global viewport", and every hold refused (non_renderable_terminal, every transition flag false).
 * Pins: a covering clip is NOT regional-at-global (the display gate's own coverage rule); a tile the view has outgrown still IS; the
 * kill restores the old width-and-zoom test.
 */
import { coverOfView, residentRegionalAtGlobalViewport } from './marineClampGuard';

const mapAt = (zoom, [w, s, e, n]) => ({ getZoom: () => zoom, getBounds: () => ({ getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n }) });
// The probe's own z4.6 session: viewport -104..-46 x 6..52, the resident EURO clip -104..-46 x 6..52 (30 x 24 cells of 2 deg).
const VIEW_Z46 = [-104, 6, -46, 52];
const CLIP_Z46 = { west: -104, south: 6, east: -46, north: 52 };
const TILE_Z9 = { west: -81, south: 26, east: -79, north: 28 };   // a z9 tile resident after a zoom-out
afterEach(() => { delete window.__RAW_DISABLE_COVERING_CLIP_HOLD__; delete window.__RAW_DOWNGRADE_COVER_FRAC__; });

describe('the clamp guard judges a regional resident by how much of the view it covers', () => {
  it('the mid-zoom clip that covers the view is NOT regional-at-global (a model switch may hold it)', () => {
    expect(coverOfView(CLIP_Z46, { west: -104, south: 6, east: -46, north: 52 })).toBeCloseTo(1, 6);
    expect(residentRegionalAtGlobalViewport(CLIP_Z46, mapAt(4.6, VIEW_Z46))).toBe(false);
  });
  it('POSITIVE CONTROL: a z9 tile the zoomed-out view has outgrown IS (it would draw as a clamped rectangle)', () => {
    expect(residentRegionalAtGlobalViewport(TILE_Z9, mapAt(4.6, VIEW_Z46))).toBe(true);
    expect(residentRegionalAtGlobalViewport({ west: -104, south: 6, east: -80, north: 30 }, mapAt(4.6, VIEW_Z46))).toBe(true);   // 21% of the view
  });
  it('the threshold is the display gate\'s own (alignedCoverFrac: 0.6, lever __RAW_DOWNGRADE_COVER_FRAC__)', () => {
    const twoThirds = { west: -104, south: 6, east: -65, north: 52 };   // 39 of 58 deg wide: 67% of the view
    expect(residentRegionalAtGlobalViewport(twoThirds, mapAt(4.6, VIEW_Z46))).toBe(false);
    window.__RAW_DOWNGRADE_COVER_FRAC__ = 0.8;
    expect(residentRegionalAtGlobalViewport(twoThirds, mapAt(4.6, VIEW_Z46))).toBe(true);
  });
  it('unchanged: a world resident never is; a zoomed-in view never is; an unreadable map holds (false)', () => {
    expect(residentRegionalAtGlobalViewport({ west: -180, south: -80, east: 180, north: 84 }, mapAt(2, [-180, -80, 180, 84]))).toBe(false);
    expect(residentRegionalAtGlobalViewport(TILE_Z9, mapAt(9, [-80.6, 27.6, -80.0, 28.0]))).toBe(false);
    expect(residentRegionalAtGlobalViewport(TILE_Z9, { getZoom: () => 4, getBounds: () => { throw new Error('style loading'); } })).toBe(false);
  });
  it('KILL: __RAW_DISABLE_COVERING_CLIP_HOLD__ restores the width-and-zoom test (the covering clip counts again)', () => {
    window.__RAW_DISABLE_COVERING_CLIP_HOLD__ = true;
    expect(residentRegionalAtGlobalViewport(CLIP_Z46, mapAt(4.6, VIEW_Z46))).toBe(true);
  });
  it('an antimeridian view (west > east) is measured on the wrapped longitude', () => {
    const view = [170, -20, -170, 10];                                   // 40 deg wide across the date line
    expect(residentRegionalAtGlobalViewport({ west: 170, south: -20, east: -170, north: 10 }, mapAt(4.6, view))).toBe(false);
    expect(residentRegionalAtGlobalViewport({ west: 170, south: -20, east: 175, north: 10 }, mapAt(4.6, view))).toBe(true);   // 12.5%
  });
});
