import { getSnapConfig } from './marineControllerUtils';

// SNAP-CONFIG goldens (2026-07-18, the snap-overshoot class): the padded+snapped request must
// never cross a resolution-tier ceiling the raw viewport sits under — crossing demotes the serve
// (close zoom: fine tile → mid, the rating-toggle direction shift; mid zoom: mid → UNRATED
// global_coarse, the z6.5 band flap). These lock the tiers + the worst-case snapped span.

// Worst-case snapped span for a config: span + 2*padding + 2*(snap - epsilon).
const worstSnapped = (span, cfg) => span + 2 * cfg.padding + 2 * cfg.snap;

describe('getSnapConfig', () => {
  it('legacy tiers unchanged for default callers (wind/pressure lanes untouched)', () => {
    expect(getSnapConfig({ west: -81, east: -80, south: 27, north: 28 })).toEqual({ snap: 4.0, padding: 2.0 });
    expect(getSnapConfig({ west: -86, east: -75, south: 22, north: 33 })).toEqual({ snap: 4.0, padding: 2.0 });
    expect(getSnapConfig({ west: -90, east: -70, south: 15, north: 35 })).toEqual({ snap: 8.0, padding: 4.0 });
  });

  it('tight mode (clamp re-drive) stays viewport-scoped', () => {
    expect(getSnapConfig({ west: -81, east: -80, south: 27, north: 28 }, { tight: true }))
      .toEqual({ snap: 0.5, padding: 0.25 });
  });

  it('MID-CEILING GUARD: 4-14° marine spans can never snap past the 15° mid ceiling', () => {
    for (const span of [4.5, 6, 8, 10, 11.2, 13, 13.9]) {
      const cfg = getSnapConfig({ west: -80 - span, east: -80, south: 20, north: 20 + span }, { midCeilingGuard: true });
      expect(cfg.snap).toBe(0.5);
      expect(worstSnapped(span, cfg)).toBeLessThan(15.0);
    }
  });

  it('mid-ceiling guard leaves close zoom (<4°) and wide (≥14°) on the legacy tiers', () => {
    expect(getSnapConfig({ west: -81, east: -80, south: 27, north: 28 }, { midCeilingGuard: true }))
      .toEqual({ snap: 4.0, padding: 2.0 });
    expect(getSnapConfig({ west: -88, east: -73.5, south: 20, north: 34.5 }, { midCeilingGuard: true }))
      .toEqual({ snap: 8.0, padding: 4.0 });
  });

  it('kill switch __RAW_DISABLE_MID_CEILING_SNAP__ restores the legacy tier', () => {
    window.__RAW_DISABLE_MID_CEILING_SNAP__ = true;
    try {
      expect(getSnapConfig({ west: -86, east: -75, south: 22, north: 33 }, { midCeilingGuard: true }))
        .toEqual({ snap: 4.0, padding: 2.0 });
    } finally {
      delete window.__RAW_DISABLE_MID_CEILING_SNAP__;
    }
  });
});
