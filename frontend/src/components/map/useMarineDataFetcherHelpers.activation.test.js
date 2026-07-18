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
