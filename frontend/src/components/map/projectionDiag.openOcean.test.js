/**
 * W-36 (2026-09-29): F-11 filed EVERY world-bbox write under the prewarm key whenever the view was
 * regional. Over open ocean no 0.25-deg tile exists and the world 2-deg product IS the drawn field,
 * so the main diag stayed "Initial state" (measured on a production build at 30N 66W z7: the engine
 * drew gfs_marine_waves_global_mid, the main diag had productId null, the prewarm diag held the
 * drawn product, and the legend showed no resolution notice). The redirect now applies only while
 * the main diag describes a regional field the commit arbiter would keep drawn in this viewport.
 */
import { updateProjectionDiag, mainDiagDescribesDrawnRegionalField } from './backendWeatherServiceClientDiag';
import { ARBITER_MIN_COVER_DEFAULT } from './marineCommitArbiter';
import { servedResolutionNotice } from './servedResolutionNotice';

const WORLD = { west: -180, south: -80, east: 180, north: 85 };
const FLORIDA_VIEW = { west: -81.2, south: 27.4, east: -79.7, north: 28.3 };
const OPEN_ATLANTIC = { west: -69.5, south: 27.8, east: -62.5, north: 32.2 };
const mapShowing = (b) => ({ getBounds: () => ({ getWest: () => b.west, getSouth: () => b.south, getEast: () => b.east, getNorth: () => b.north }) });

const regional = (model = 'GFS', bounds = FLORIDA_VIEW) => ({ activeModel: model, activeLayer: 'waves', requestedViewportBounds: bounds,
  productId: `${model.toLowerCase()}_marine_waves_florida_east_coast.json`, cols: 17, rows: 17, vectorCount: 289 });
const world = (model = 'GFS') => ({ activeModel: model, activeLayer: 'waves', requestedViewportBounds: WORLD,
  responseGridBounds: { west: -180, south: -80, east: 180, north: 84 },
  productId: `${model.toLowerCase()}_marine_waves_global_mid.json`, cols: 181, rows: 83, vectorCount: 15023, renderable: true });

describe('projection diag over open ocean (W-36)', () => {
  beforeEach(() => {
    delete window.__MARINE_PROJECTION_DIAG__;
    delete window.__MARINE_PREWARM_PROJECTION_DIAG__;
  });
  afterEach(() => { delete window.map; });

  it('open ocean, nothing regional: the world product is the drawn field and lands in the main diag', () => {
    window.map = mapShowing(OPEN_ATLANTIC);
    window.__MARINE_PROJECTION_DIAG__ = { status: 'not_initialized', productId: null, reason: 'Initial state' };
    updateProjectionDiag('marine', world());
    expect(window.__MARINE_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_global_mid.json');
    expect(window.__MARINE_PREWARM_PROJECTION_DIAG__).toBeUndefined();
    // what the user sees: the legend's resolution notice now speaks (it was silent)
    const d = window.__MARINE_PROJECTION_DIAG__;
    expect(servedResolutionNotice(d.resolution, d.resolutionSource)).not.toBeNull();
  });

  it('panned away from the regional field: the stale regional diag no longer protects itself', () => {
    window.map = mapShowing(FLORIDA_VIEW);
    updateProjectionDiag('marine', regional());
    window.map = mapShowing(OPEN_ATLANTIC);            // the Florida field does not reach this view
    updateProjectionDiag('marine', world());
    expect(window.__MARINE_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_global_mid.json');
  });

  it('F-11 still holds: a regional field drawn here keeps the main diag, the prewarm gets its own key', () => {
    window.map = mapShowing(FLORIDA_VIEW);
    updateProjectionDiag('marine', regional());
    updateProjectionDiag('marine', world());
    expect(window.__MARINE_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_florida_east_coast.json');
    expect(window.__MARINE_PREWARM_PROJECTION_DIAG__.productId).toBe('gfs_marine_waves_global_mid.json');
  });

  it('a model switch: a GFS regional diag does not describe the EURO field being drawn', () => {
    window.map = mapShowing(FLORIDA_VIEW);
    updateProjectionDiag('marine', regional('GFS'));
    updateProjectionDiag('marine', world('EURO'));
    expect(window.__MARINE_PROJECTION_DIAG__.productId).toBe('euro_marine_waves_global_mid.json');
  });

  it('"drawn here" is the commit arbiter\'s coverage rule, on both sides of its threshold', () => {
    const view = { west: 0, south: 0, east: 10, north: 10 };
    const main = (eastEdge) => ({ status: 'active', productId: 'x', activeModel: 'GFS', activeLayer: 'waves',
      responseGridBounds: { west: 0, south: 0, east: eastEdge, north: 10 } });
    const wants = { activeModel: 'GFS', activeLayer: 'waves' };
    const at = ARBITER_MIN_COVER_DEFAULT * 10;                       // covers exactly the threshold
    expect(mainDiagDescribesDrawnRegionalField(main(at), wants, view)).toBe(true);
    expect(mainDiagDescribesDrawnRegionalField(main(at - 0.5), wants, view)).toBe(false);
    expect(mainDiagDescribesDrawnRegionalField(main(10), wants, view)).toBe(true);
  });

  it('never trusts the PILOT_COVERAGE fallback or a world extent as "regional"', () => {
    const view = FLORIDA_VIEW;
    const wants = { activeModel: 'GFS', activeLayer: 'waves' };
    // coverageBounds alone (the fixed pilot box) is not a served extent
    expect(mainDiagDescribesDrawnRegionalField({ status: 'active', productId: 'x', coverageBounds: { west: -85, south: 24, east: -79, north: 31 } }, wants, view)).toBe(false);
    expect(mainDiagDescribesDrawnRegionalField({ status: 'active', productId: 'x', responseGridBounds: WORLD }, wants, view)).toBe(false);
    expect(mainDiagDescribesDrawnRegionalField({ status: 'not_initialized', productId: null, requestedViewportBounds: view }, wants, view)).toBe(false);
  });

  it('a named but EMPTY field is not the drawn field (the A15-09 series identity publishes status "empty")', () => {
    const view = FLORIDA_VIEW;
    const wants = { activeModel: 'GFS', activeLayer: 'waves' };
    const identityOnly = { status: 'empty', renderable: false, productId: 'series_GFS_waves_h24', activeModel: 'GFS',
      activeLayer: 'waves', requestedViewportBounds: view };
    expect(mainDiagDescribesDrawnRegionalField(identityOnly, wants, view)).toBe(false);
    expect(mainDiagDescribesDrawnRegionalField({ ...identityOnly, status: 'active', renderable: true }, wants, view)).toBe(true);
  });
});
