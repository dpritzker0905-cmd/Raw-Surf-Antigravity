/**
 * The zoom-out release (2026-10-22, marineZoomOutRelease.js): a world frame of the clip's own field takes over as soon as the clip
 * stops covering the view, and a frame-store show never leaves the layer's duplicate-upload record describing the engine.
 */
import fs from 'fs';
import path from 'path';
import { CLIP_FULL_COVER, clipNeedsFullCover, layerUploadIsStale } from './marineZoomOutRelease';
import { shouldRejectResolutionDowngrade, __resetRatingGraceForTests } from './marineEngineDecisions';
import { decideMarineCommit } from './marineCommitGate';

const grid = (bounds, cols, rows, extra = {}) => ({ bounds, cols, rows, vectors: [{ speed: 1 }], hourOffset: 0,
  __sourceModel: 'GFS', __componentLayer: 'waves', ...extra });
// The owner's z4.45 resident: a 26 x 19 clip of the 2-degree global_mid (50 x 36 deg), and the world frame of the same field.
const CLIP = grid({ west: -106, south: 8, east: -56, north: 44 }, 26, 19);
const WORLD = grid({ west: -180, south: -80, east: 180, north: 82 }, 181, 82);
const TILE = grid({ west: -85, south: 24, east: -79, north: 31 }, 25, 29);           // a 0.25-deg regional tile
const COARSE = grid({ west: -180, south: -80, east: 180, north: 85 }, 37, 17);      // the 10-deg global_coarse
const VIEW_IN = [-93, 21, -69, 31];        // z4.45 on 844 x 390: inside the padded clip
const VIEW_OUT = [-110, 14, -48, 40];      // after the zoom-out: the clip covers ~80 % of it
const frac = (g, v) => {
  const ix = Math.max(0, Math.min(g.bounds.east, v[2]) - Math.max(g.bounds.west, v[0]));
  const iy = Math.max(0, Math.min(g.bounds.north, v[3]) - Math.max(g.bounds.south, v[1]));
  return (ix * iy) / ((v[2] - v[0]) * (v[3] - v[1]));
};
const KILLS = ['__RAW_DISABLE_CLIP_COVER_RELEASE__', '__RAW_DISABLE_STORE_SHOW_RESYNC__', '__RAW_MARINE_ARBITER__', '__SURF_MODE__'];
beforeEach(() => { __resetRatingGraceForTests(); KILLS.forEach((k) => delete window[k]); });
afterEach(() => KILLS.forEach((k) => delete window[k]));

describe('the guard: a same-field world frame replaces a clip once the clip stops covering the whole view', () => {
  it('fixtures: the clip covers the scrubbing view whole, and 60-80 % of the zoomed-out one (the band the guard held)', () => {
    expect(frac(CLIP, VIEW_IN)).toBe(1);
    expect(frac(CLIP, VIEW_OUT)).toBeGreaterThan(0.6);
    expect(frac(CLIP, VIEW_OUT)).toBeLessThan(CLIP_FULL_COVER);
  });

  it('while the clip covers the view the same-hour world frame is still refused (no world/clip ping-pong per step)', () => {
    expect(shouldRejectResolutionDowngrade(CLIP, WORLD, 4.45, VIEW_IN, false, 0)).toBe(true);
    expect(decideMarineCommit(CLIP, WORLD, 4.45, VIEW_IN, window, 0).reject).toBe(true);
  });

  it('after a zoom-out that shows ground the clip lacks, the world frame lands at once (it was held down to 60 %)', () => {
    expect(shouldRejectResolutionDowngrade(CLIP, WORLD, 3.25, VIEW_OUT, false, 0)).toBe(false);
    expect(decideMarineCommit(CLIP, WORLD, 3.25, VIEW_OUT, window, 0).reject).toBe(false);
    window.__RAW_DISABLE_CLIP_COVER_RELEASE__ = true;                // the kill restores the 60 % rule (the defect)
    expect(shouldRejectResolutionDowngrade(CLIP, WORLD, 3.25, VIEW_OUT, false, 0)).toBe(true);
  });

  it('a finer tile, a coarser world field, another model and a rating grid keep the 60 % rule', () => {
    const tileView = [-86, 23.5, -78.5, 31.5];                       // the tile covers ~80 % of it
    expect(frac(TILE, tileView)).toBeGreaterThan(0.6);
    expect(frac(TILE, tileView)).toBeLessThan(CLIP_FULL_COVER);
    expect(shouldRejectResolutionDowngrade(TILE, WORLD, 6.5, tileView, false, 0)).toBe(true);
    expect(clipNeedsFullCover(CLIP, COARSE)).toBe(false);            // 10-deg cells: a real downgrade of the 2-deg clip
    expect(shouldRejectResolutionDowngrade(CLIP, COARSE, 3.25, VIEW_OUT, false, 0)).toBe(true);
    expect(clipNeedsFullCover(CLIP, { ...WORLD, __sourceModel: 'ICON' })).toBe(false);
    window.__SURF_MODE__ = true;
    expect(clipNeedsFullCover({ ...CLIP, ratingMode: true }, WORLD)).toBe(false);
    expect(shouldRejectResolutionDowngrade({ ...CLIP, ratingMode: true }, WORLD, 3.25, VIEW_OUT, false, 0)).toBe(true);
  });

  it('clipNeedsFullCover: a regional resident and a world incoming of the same lattice only', () => {
    expect(clipNeedsFullCover(CLIP, WORLD)).toBe(true);
    expect(clipNeedsFullCover(WORLD, WORLD)).toBe(false);
    expect(clipNeedsFullCover(CLIP, CLIP)).toBe(false);
    expect(clipNeedsFullCover(TILE, WORLD)).toBe(false);
    expect(clipNeedsFullCover(null, WORLD)).toBe(false);
  });
});

describe('the layer: after a frame-store show its last-upload record is stale', () => {
  it('a store show marks the engine; a layer upload (a fresh resident) clears it; the kill keeps the old dedup', () => {
    expect(layerUploadIsStale({ _waveData: { waveGrid: { ...CLIP, __fromFrameStore: true } } })).toBe(true);
    expect(layerUploadIsStale({ _waveData: { waveGrid: { ...CLIP } } })).toBe(false);
    expect(layerUploadIsStale({ _waveData: null })).toBe(false);
    expect(layerUploadIsStale(null)).toBe(false);
    window.__RAW_DISABLE_STORE_SHOW_RESYNC__ = true;
    expect(layerUploadIsStale({ _waveData: { waveGrid: { ...CLIP, __fromFrameStore: true } } })).toBe(false);
  });
});

// WIRING (no unit test runs WebGLMarineLayer's upload path or the guard's call site): the two call sites, pinned in the source.
describe('wiring', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  it('the layer asks layerUploadIsStale before trusting its last upload as what the engine holds', () => {
    expect(src('WebGLMarineLayer.js')).toMatch(/const alreadyResident = !!engine\._waveData && !layerUploadIsStale\(engine\);/);
  });
  it('the guard asks clipNeedsFullCover inside its coverage test', () => {
    expect(src('marineEngineDecisions.js')).toMatch(/if \(covers && clipNeedsFullCover\(resident, incoming\)\) covers = frac >= CLIP_FULL_COVER;/);
  });
});
