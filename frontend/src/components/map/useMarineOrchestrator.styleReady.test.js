/**
 * STYLE-READY FETCH TRIGGER (2026-07-21, live-rooted): a marine model/layer switch defers its manual fetch
 * until the map style is "ready". mapbox isStyleLoaded() can stay FALSE indefinitely (pending sprite/glyph/
 * source) while the map is already idle, so map.once('idle', …) never re-fires and the deferred fetch
 * STRANDS — the new model/layer never loads. fireWhenStyleReady fires on the FIRST of {style-ready now,
 * 'idle', a bounded fallback timeout}, at most once, so a stuck-false isStyleLoaded() can never strand it.
 */
import { fireWhenStyleReady, STYLE_READY_FALLBACK_MS } from './useMarineOrchestrator';

function makeMap({ styleLoaded, tilesLoaded = false }) {
  const idleCbs = [];
  return {
    isStyleLoaded: () => styleLoaded,
    areTilesLoaded: () => tilesLoaded,
    once: (evt, cb) => { if (evt === 'idle') idleCbs.push(cb); },
    _fireIdle: () => { idleCbs.splice(0).forEach((cb) => cb()); },
    _idleCount: () => idleCbs.length,
  };
}

describe('fireWhenStyleReady — bounded style-ready fetch trigger', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => {
    jest.runOnlyPendingTimers(); jest.useRealTimers();
    delete window.__RAW_DISABLE_STYLE_READY_FALLBACK__;
    delete window.__RAW_STYLE_READY_FALLBACK_MS__;
  });

  it('fires IMMEDIATELY when the style is already loaded (no idle listener, no timer)', () => {
    const fn = jest.fn();
    const map = makeMap({ styleLoaded: true });
    fireWhenStyleReady(map, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(map._idleCount()).toBe(0);
  });

  it('fires immediately when there is no map (fail-open)', () => {
    const fn = jest.fn();
    fireWhenStyleReady(null, fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('THE ROOT: fires IMMEDIATELY when areTilesLoaded() is true even though isStyleLoaded() is stuck false', () => {
    // The live root: isStyleLoaded() is permanently false (lazy sources) but the map is functionally ready
    // (areTilesLoaded true). Firing at once — no timing race — is what makes the switch reliably commit.
    const fn = jest.fn();
    const map = makeMap({ styleLoaded: false, tilesLoaded: true });
    fireWhenStyleReady(map, fn);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(map._idleCount()).toBe(0);
  });

  it('defers when the style is NOT loaded, then fires on idle', () => {
    const fn = jest.fn();
    const map = makeMap({ styleLoaded: false });
    fireWhenStyleReady(map, fn);
    expect(fn).not.toHaveBeenCalled();
    map._fireIdle();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('THE FIX: fires via the fallback timeout when idle NEVER fires (the strand case)', () => {
    const fn = jest.fn();
    const map = makeMap({ styleLoaded: false });
    fireWhenStyleReady(map, fn);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(STYLE_READY_FALLBACK_MS + 1); // idle never fires; fallback fires
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is IDEMPOTENT — idle then the fallback timeout fires fn exactly ONCE', () => {
    const fn = jest.fn();
    const map = makeMap({ styleLoaded: false });
    fireWhenStyleReady(map, fn);
    map._fireIdle();
    jest.advanceTimersByTime(STYLE_READY_FALLBACK_MS + 1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('is IDEMPOTENT the other way — fallback timeout then a late idle fires fn exactly ONCE', () => {
    const fn = jest.fn();
    const map = makeMap({ styleLoaded: false });
    fireWhenStyleReady(map, fn);
    jest.advanceTimersByTime(STYLE_READY_FALLBACK_MS + 1);
    map._fireIdle();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('kill switch __RAW_DISABLE_STYLE_READY_FALLBACK__ restores legacy idle-only (no fallback timer)', () => {
    window.__RAW_DISABLE_STYLE_READY_FALLBACK__ = true;
    const fn = jest.fn();
    const map = makeMap({ styleLoaded: false });
    fireWhenStyleReady(map, fn);
    jest.advanceTimersByTime(STYLE_READY_FALLBACK_MS + 5000); // no fallback → still not fired
    expect(fn).not.toHaveBeenCalled();
    map._fireIdle(); // only idle can fire it now (legacy behavior)
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours the tunable fallback delay', () => {
    window.__RAW_STYLE_READY_FALLBACK_MS__ = 300;
    const fn = jest.fn();
    const map = makeMap({ styleLoaded: false });
    fireWhenStyleReady(map, fn);
    jest.advanceTimersByTime(299);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(2);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
