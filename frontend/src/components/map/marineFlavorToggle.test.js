import { isFlavorToggleSource, leasePendingStampOf, PENDING_LEASE_MS, resolveBandOffNow, ratingBandLoadingText, BAND_LOADING_MS } from './marineFlavorToggle';
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

describe('leasePendingStampOf: the pending stamp of a released fetch is leased, then cleared only if nothing took over', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());
  const mk = () => { const stamp = { model: 'GFS' }; return { stamp, w: { __MARINE_FETCH_PENDING__: stamp }, ctl: { __fetchPendingStamp: stamp } }; };
  it('keeps the stamp during the lease (no "model switch with nothing pending" gap), clears it after when nothing is fetching', () => {
    const { w, ctl } = mk();
    expect(leasePendingStampOf(ctl, { isFetching: false }, w)).toBe(true);
    jest.advanceTimersByTime(PENDING_LEASE_MS - 1);
    expect(w.__MARINE_FETCH_PENDING__).not.toBeNull();
    jest.advanceTimersByTime(2);
    expect(w.__MARINE_FETCH_PENDING__).toBeNull();
  });
  it('a replacement fetch (its own stamp) or an active fetch is left alone', () => {
    const a = mk(); leasePendingStampOf(a.ctl, { isFetching: false }, a.w);
    const newer = { model: 'ICON' }; a.w.__MARINE_FETCH_PENDING__ = newer;
    jest.advanceTimersByTime(PENDING_LEASE_MS + 10);
    expect(a.w.__MARINE_FETCH_PENDING__).toBe(newer);
    const b = mk(); leasePendingStampOf(b.ctl, { isFetching: true }, b.w);
    jest.advanceTimersByTime(PENDING_LEASE_MS + 10);
    expect(b.w.__MARINE_FETCH_PENDING__).toBe(b.stamp);
  });
  it('no stamp, no controller, a stamp that is not current, or the kill: no lease', () => {
    const { stamp, w } = mk();
    expect(leasePendingStampOf({}, {}, w)).toBe(false);
    expect(leasePendingStampOf(null, {}, w)).toBe(false);
    expect(leasePendingStampOf({ __fetchPendingStamp: { other: 1 } }, {}, w)).toBe(false);
    expect(leasePendingStampOf({ __fetchPendingStamp: stamp }, {}, { __MARINE_FETCH_PENDING__: stamp, __RAW_DISABLE_FLAVOR_TOGGLE_PRIORITY__: true })).toBe(false);
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
  it('without a wash there is no honest field to show: the band is still gone at once and the status says wave heights are loading (heldBy off_loading)', () => {
    const r = resolveRatingBandFade(4, false, false, {}, COV);
    expect(r.bandMult).toBe(0);
    expect(r.heldBy).toBe('off_loading');
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
    expect(ratingBandHeldText('off_loading')).toMatch(/wave heights/);
  });
});
