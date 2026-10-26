import { isFlavorToggleSource, releasePendingStampOf, resolveBandOffNow, ratingBandLoadingText, BAND_LOADING_MS } from './marineFlavorToggle';
import { resolveRatingBandFade } from './marineEngineDecisions';
import { ratingBandHeldText } from './marineRatingBandRes';

afterEach(() => { delete window.__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__; delete window.__RAW_DISABLE_BAND_OFF_INSTANT__; });

describe('isFlavorToggleSource: a user flip of the band, and its replay', () => {
  it('flavor_toggle and flavor_toggle_pending, nothing else; the kill switch turns it off', () => {
    expect(isFlavorToggleSource('flavor_toggle')).toBe(true);
    expect(isFlavorToggleSource('flavor_toggle_pending')).toBe(true);
    for (const s of ['manual', 'moveend', 'timeline_scrub', 'flavor_backstop', 'series_upgrade', '', undefined, null]) expect(isFlavorToggleSource(s)).toBe(false);
    window.__RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__ = true;
    expect(isFlavorToggleSource('flavor_toggle')).toBe(false);
  });
});

describe('releasePendingStampOf: the released fetch\'s pending stamp is cleared, only if it is still the current one', () => {
  it('clears its own stamp; leaves a newer stamp alone; no stamp, no controller, or the kill: nothing', () => {
    const stamp = { model: 'GFS' }; const w = { __MARINE_FETCH_PENDING__: stamp };
    expect(releasePendingStampOf({ __fetchPendingStamp: stamp }, w)).toBe(true);
    expect(w.__MARINE_FETCH_PENDING__).toBeNull();
    const newer = { model: 'EURO' }; w.__MARINE_FETCH_PENDING__ = newer;
    expect(releasePendingStampOf({ __fetchPendingStamp: stamp }, w)).toBe(false);
    expect(w.__MARINE_FETCH_PENDING__).toBe(newer);
    expect(releasePendingStampOf({}, w)).toBe(false);
    expect(releasePendingStampOf(null, w)).toBe(false);
    expect(releasePendingStampOf({ __fetchPendingStamp: newer }, { __MARINE_FETCH_PENDING__: newer, __RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__: true })).toBe(false);
  });
});

describe('the instant hide: flag OFF, resident still a rating grid', () => {
  const COV = { bandOff: true, coverFrac: 1, zoom: 8, cellDeg: 0.25 };
  it('with the honest coarse wash engaged: band opacity 0, wash at full strength, in the same frame (the old code kept the band until the honest grid committed)', () => {
    const r = resolveRatingBandFade(4, false, true, {}, COV);
    expect(r.bandMult).toBe(0);
    expect(r.washStrength).toBe(1);
    expect(r.fade).toBe(0);
    expect(r.heldBy).toBe('off');
  });
  it('without a wash a blank heatmap would be worse: the old hold stands (identity here, the engine keeps painting the band)', () => {
    const r = resolveRatingBandFade(4, false, false, {}, COV);
    expect(r.bandMult).toBe(1);
    expect(r.heldBy).toBeUndefined();
  });
  it('the kill switch restores the old behaviour; a flag-ON band is never touched by it', () => {
    expect(resolveRatingBandFade(4, false, true, { __RAW_DISABLE_BAND_OFF_INSTANT__: true }, COV).bandMult).toBe(1);
    expect(resolveRatingBandFade(4, true, true, {}, { ...COV, bandOff: false }).heldBy).toBeNull();
    expect(resolveBandOffNow({ __RAW_DISABLE_BAND_OFF_INSTANT__: true })).toBeNull();
  });
});

describe('the words while the band is switched ON and its grid is on the way', () => {
  it('only inside the window after the toggle and only while the band is forced off; never for the instant hide', () => {
    expect(ratingBandLoadingText(true, 1000, 1500)).toMatch(/loading/);
    expect(ratingBandLoadingText(true, 1000, 1000 + BAND_LOADING_MS)).toBeNull();
    expect(ratingBandLoadingText(false, 1000, 1500)).toBeNull();
    expect(ratingBandLoadingText(true, undefined, 1500)).toBeNull();
    expect(ratingBandHeldText('loading')).toMatch(/loading for this view/);
    expect(ratingBandHeldText('off')).toBeNull();
  });
});
