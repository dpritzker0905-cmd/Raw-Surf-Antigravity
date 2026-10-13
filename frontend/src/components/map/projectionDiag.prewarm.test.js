/**
 * F-11 (audit 14.0 / 14.1): the world prewarm must not overwrite the diag that describes the DRAWN
 * marine field. Live 2026-09-23 at z9: the legend's resolution notice (legendTicks reads this diag)
 * said "~223 km grid (2°)" over a 221-vector regional field, because the whole-globe prewarm fetch
 * was the last writer.
 */
import { updateProjectionDiag, isWorldBbox } from './backendWeatherServiceClientDiag';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };          // marineGlobalPrewarm._GLOBAL_BOUNDS
const FLORIDA_VIEW = { west: -81.2, south: 27.4, east: -79.7, north: 28.3 };

const mapShowing = (b) => ({ getBounds: () => ({ getWest: () => b.west, getSouth: () => b.south, getEast: () => b.east, getNorth: () => b.north }) });

const regionalWrite = { activeModel: 'GFS', activeLayer: 'waves', requestedViewportBounds: FLORIDA_VIEW,
  productId: 'gfs_marine_waves_florida_east_coast.json', cols: 17, rows: 17, vectorCount: 289 };
const prewarmWrite = { activeModel: 'GFS', activeLayer: 'waves', requestedViewportBounds: WORLD,
  productId: 'gfs_marine_waves_global_mid.json', cols: 181, rows: 83, vectorCount: 15023 };

describe('projection diag vs the world prewarm (F-11)', () => {
  beforeEach(() => {
    delete window.__MARINE_PROJECTION_DIAG__;
    delete window.__MARINE_PREWARM_PROJECTION_DIAG__;
  });
  afterEach(() => { delete window.map; });

  it('regional view: the prewarm write goes to its own key and the drawn-field diag survives', () => {
    window.map = mapShowing(FLORIDA_VIEW);
    updateProjectionDiag('marine', regionalWrite);
    updateProjectionDiag('marine', prewarmWrite);          // the prewarm lands LAST (the live order)
    expect(window.__MARINE_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_florida_east_coast.json');
    expect(window.__MARINE_PROJECTION_DIAG__.vectorCount).toBe(289);
    expect(window.__MARINE_PREWARM_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_global_mid.json');
  });

  it('world view: the global grid IS the drawn field, so it still describes it', () => {
    window.map = mapShowing({ west: -170, south: -60, east: 170, north: 75 });
    updateProjectionDiag('marine', prewarmWrite);
    expect(window.__MARINE_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_global_mid.json');
    expect(window.__MARINE_PREWARM_PROJECTION_DIAG__).toBeUndefined();
  });

  it('no map yet: nothing to contradict, keep the historic behaviour', () => {
    updateProjectionDiag('marine', prewarmWrite);
    expect(window.__MARINE_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_global_mid.json');
  });

  it('wind and weather diags are untouched by the rule', () => {
    window.map = mapShowing(FLORIDA_VIEW);
    delete window.__WIND_PROJECTION_DIAG__;
    updateProjectionDiag('wind', prewarmWrite);
    expect(window.__WIND_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_global_mid.json');
  });

  it('isWorldBbox recognises the prewarm bounds and rejects regional or malformed ones', () => {
    expect(isWorldBbox(WORLD)).toBe(true);
    expect(isWorldBbox(FLORIDA_VIEW)).toBe(false);
    expect(isWorldBbox(null)).toBe(false);
    expect(isWorldBbox({ west: NaN, east: 180 })).toBe(false);
  });
});
