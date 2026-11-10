/**
 * §5b wedge root contract (2026-07-18 EVE-2): the surf-rating toggle's re-fetch must NOT be
 * classified an activation. Activation sources fetch the WORLD bbox (global-base-first), and a
 * world+surf=1 request structurally cannot return a rated grid — the ring-pinned wedge was
 * toggle('manual') → world bbox → unrated global coarse → no-downgrade reject → [rating-band]
 * OFF forever at a settled camera. 'flavor_toggle' keeps the live viewport.
 */
import { isActivationSource, handleRegionalGridClearing } from './useMarineDataFetcherHelpers';

describe('isActivationSource (§5b wedge root)', () => {
  it('classifies genuine activation lanes as activations', () => {
    expect(isActivationSource('mount')).toBe(true);
    expect(isActivationSource('load')).toBe(true);
    expect(isActivationSource('manual')).toBe(true);
    expect(isActivationSource('manual_pending')).toBe(true);
  });

  it('does NOT classify the surf toggle as an activation', () => {
    expect(isActivationSource('flavor_toggle')).toBe(false);
  });

  it('does NOT classify viewport/recovery lanes as activations', () => {
    expect(isActivationSource('moveend')).toBe(false);
    expect(isActivationSource('flavor_backstop')).toBe(false);
    expect(isActivationSource('series_upgrade')).toBe(false);
    expect(isActivationSource('clamp_resharpen')).toBe(false);
    expect(isActivationSource('swr_revalidation')).toBe(false);
  });
});

describe('handleRegionalGridClearing bounds selection', () => {
  const vp = { west: -80.65, south: 26.65, east: -79.45, north: 27.44 };
  const mapInstance = {
    getBounds: () => ({
      getWest: () => vp.west, getSouth: () => vp.south,
      getEast: () => vp.east, getNorth: () => vp.north,
    }),
  };
  const base = {
    mapInstance, marineData: null, zoom: 9.31, model: 'GFS', layer: 'waves',
    setMarineData: () => {}, lastCommittedSigRef: { current: null },
  };

  it('activation → world bounds (global-base-first, unchanged)', () => {
    const b = handleRegionalGridClearing({ ...base, isActivation: true });
    expect(b.west).toBe(-180);
    expect(b.east).toBe(180);
  });

  it('non-activation (the toggle path) → live viewport bounds', () => {
    const b = handleRegionalGridClearing({ ...base, isActivation: false });
    expect(b).toEqual(vp);
  });
});

// SWITCH AT A REGIONAL VIEW ASKS THE VIEWPORT (2026-11-09): GFS->ICON at z9 drew the 181x83 world frame at 3.3 s and the viewport
// tile at 7.7 s (clean offline session); the battery saw the world frame on screen 0.4-17.3 s per switch.
describe('a manual switch at a regional view asks the viewport (kill: __RAW_DISABLE_SWITCH_VIEWPORT_FIRST__)', () => {
  const mapOf = (w, s, e, n) => ({ getBounds: () => ({ getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n }) });
  const z9 = mapOf(-80.65, 26.65, -79.45, 27.44);           // 1.2 x 0.8 deg
  const z5 = mapOf(-95, 15, -65, 35);                        // 30 x 20 deg
  const win = {};

  it('manual at z9 is NOT an activation: the fetch keeps the viewport box', () => {
    expect(isActivationSource('manual', z9, win)).toBe(false);
    expect(isActivationSource('manual_pending', z9, win)).toBe(false);
    const b = handleRegionalGridClearing({ mapInstance: z9, isActivation: isActivationSource('manual', z9, win), marineData: null,
      zoom: 9, model: 'ICON', layer: 'waves', setMarineData: () => {}, lastCommittedSigRef: { current: null } });
    expect(b.west).toBeCloseTo(-80.65); expect(b.east).toBeCloseTo(-79.45);
  });

  it('manual at a wide view, mount and load stay world-first', () => {
    expect(isActivationSource('manual', z5, win)).toBe(true);
    expect(isActivationSource('mount', z9, win)).toBe(true);
    expect(isActivationSource('load', z9, win)).toBe(true);
  });

  it('a span of 15 deg or more on EITHER axis is wide; the antimeridian is measured across', () => {
    expect(isActivationSource('manual', mapOf(-80, 20, -66, 35), win)).toBe(true);    // 14 x 15
    expect(isActivationSource('manual', mapOf(-80, 20, -65, 34), win)).toBe(true);    // 15 x 14
    expect(isActivationSource('manual', mapOf(175, -20, -175, -15), win)).toBe(false); // 10 x 5 across 180
  });

  it('no map, an unreadable map, or the kill switch keep the old rule', () => {
    expect(isActivationSource('manual')).toBe(true);
    expect(isActivationSource('manual', { getBounds: () => { throw new Error('not ready'); } }, win)).toBe(true);
    expect(isActivationSource('manual', z9, { __RAW_DISABLE_SWITCH_VIEWPORT_FIRST__: true })).toBe(true);
  });

  it('non-activation lanes are untouched by the map', () => {
    expect(isActivationSource('moveend', z5, win)).toBe(false);
    expect(isActivationSource('flavor_toggle', z9, win)).toBe(false);
  });
});

// THE WASH FOR A VIEWPORT-FIRST SWITCH: measured offline, the base stayed GFS under ICON 25 s after the switch without it.
jest.mock('./marineGlobalPrewarm', () => ({
  prewarmGlobalMarineGrid: jest.fn(),
  _coarseBaseMatches: (o, m, l) => !!o && o.__sourceModel === m && (o.__componentLayer || 'waves') === (l || 'waves'),
}));
describe('a viewport-first switch asks the new model\'s world grid first, for the wash only', () => {
  const { prewarmGlobalMarineGrid } = require('./marineGlobalPrewarm');
  const z9 = { getBounds: () => ({ getWest: () => -80.65, getSouth: () => 26.65, getEast: () => -79.45, getNorth: () => 27.44 }) };
  const run = (extra) => handleRegionalGridClearing({ mapInstance: z9, marineData: null, zoom: 9, model: 'ICON', layer: 'waves',
    setMarineData: () => {}, lastCommittedSigRef: { current: null }, ...extra });
  beforeEach(() => { prewarmGlobalMarineGrid.mockClear(); delete window.__MARINE_ENGINE__; });
  afterAll(() => { delete window.__MARINE_ENGINE__; });

  it('manual + viewport: one grid-first warm for the new model and hour', () => {
    run({ isActivation: false, source: 'manual', timeOffset: 6 });
    expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(1);
    const [model, hour, bounds, layer, opts] = prewarmGlobalMarineGrid.mock.calls[0];
    expect([model, hour, layer]).toEqual(['ICON', 6, 'waves']);
    expect(bounds.west).toBeCloseTo(-80.65);
    expect(opts).toEqual({ gridFirst: true, band: true, foreground: true });
  });

  it('a world-first activation, a pan, a missing hour or no source ask nothing extra', () => {
    run({ isActivation: true, source: 'manual', timeOffset: 6 });
    run({ isActivation: false, source: 'moveend', timeOffset: 6 });
    run({ isActivation: false, source: 'manual', timeOffset: undefined });
    run({ isActivation: false });
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
  });

  it('no warm when the engine base (or its pending seed) already is this model and layer: the old-model dispatch at click time', () => {
    window.__MARINE_ENGINE__ = { _coarseBaseData: { __sourceModel: 'ICON', __componentLayer: 'waves' } };
    run({ isActivation: false, source: 'manual', timeOffset: 0 });
    window.__MARINE_ENGINE__ = { _coarseBaseData: { __sourceModel: 'GFS' }, _pendingCoarseBaseGrid: { __sourceModel: 'ICON' } };
    run({ isActivation: false, source: 'manual', timeOffset: 0 });
    expect(prewarmGlobalMarineGrid).not.toHaveBeenCalled();
    window.__MARINE_ENGINE__ = { _coarseBaseData: { __sourceModel: 'GFS', __componentLayer: 'waves' } };
    run({ isActivation: false, source: 'manual', timeOffset: 0 });
    expect(prewarmGlobalMarineGrid).toHaveBeenCalledTimes(1);   // GFS base under ICON: stale, warm it
  });

  it('a throwing warm never breaks the switch', () => {
    prewarmGlobalMarineGrid.mockImplementationOnce(() => { throw new Error('boom'); });
    expect(() => run({ isActivation: false, source: 'manual', timeOffset: 0 })).not.toThrow();
  });
});
