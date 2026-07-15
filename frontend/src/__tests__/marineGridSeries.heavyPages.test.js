/**
 * §0f(3) per-cost-class series pages (2026-07-14).
 *
 * Production serves /api/* through Netlify's CDN proxy, which cuts responses at ~26s. A
 * 48-frame page costs (measured direct-to-Render, cold): GFS swell 1.8s (cheap re-slice),
 * GFS surf 14.4s (+~0.26s/frame rating transform), EURO surf 23.1s (+~0.2s/frame per-hour
 * L2 resolve) — the EURO/surf class dies in the window under any contention ("Fetch failed",
 * user logs 07-14) and the client caches ZERO frames. HEAVY-class pages (EURO any-flavor,
 * or surf mode any-model) are therefore 16 frames (~8.5s worst case, ~3× headroom); the
 * cheap GFS/ICON swell class keeps the original 48-frame pages.
 */
import {
  ensureMarineSeries,
  getMarineSeriesFrame,
  marineSeriesPageForHour,
  _resetMarineSeriesForTest,
} from '../components/map/marineGridSeries';

const bounds = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };

function requestedHours(url) {
  const m = /[?&]hours=([\d,]+)/.exec(url);
  return m ? m[1].split(',').map(Number) : [];
}

function responseForUrl(url) {
  // Echo a frame per requested hour so retrieval tests can hit any page.
  const hours = requestedHours(url);
  return {
    model: 'EURO', domain: 'marine', layer: 'waves', cols: 4, rows: 4,
    frames: hours.map((h) => ({
      hour_offset: h, valid_time: '2026-07-14T00:00:00Z', cols: 4, rows: 4, bounds,
      vectors: [{ lat: 28, lng: -80, u: 0.1, v: 0.2, speed: 1, direction: 90, period: 8 }],
      provider: 'copernicus',
    })),
  };
}

describe('marineGridSeries — per-cost-class page spans (proxy-window fit)', () => {
  beforeEach(() => {
    _resetMarineSeriesForTest();
    window.__MARINE_SERIES__ = true;
    window.__SURF_MODE__ = false;
    global.fetch = jest.fn().mockImplementation((url) => Promise.resolve({ ok: true, json: async () => responseForUrl(url) }));
  });
  afterEach(() => {
    delete window.__MARINE_SERIES__;
    delete window.__SURF_MODE__;
  });

  it('GFS swell keeps the cheap 48-frame pages (unchanged fast class)', async () => {
    await ensureMarineSeries('GFS', 'waves', bounds, 0);
    const hours = requestedHours(global.fetch.mock.calls[0][0]);
    expect(hours.length).toBe(48);
    expect(hours[0]).toBe(0);
    expect(hours[hours.length - 1]).toBe(141);
  });

  it('EURO pages are 16 frames regardless of surf mode (per-hour L2 resolve cost)', async () => {
    await ensureMarineSeries('EURO', 'waves', bounds, 0);
    const hours = requestedHours(global.fetch.mock.calls[0][0]);
    expect(hours.length).toBe(16);
    expect(hours[0]).toBe(0);
    expect(hours[hours.length - 1]).toBe(45);
  });

  it('surf mode makes EVERY model heavy-class (per-frame rating transform cost)', async () => {
    window.__SURF_MODE__ = true;
    await ensureMarineSeries('GFS', 'waves', bounds, 0);
    const url = global.fetch.mock.calls[0][0];
    expect(url).toContain('surf=1');
    expect(requestedHours(url).length).toBe(16);
  });

  it('a far-tail scrub loads the SMALL page containing that hour first', async () => {
    window.__SURF_MODE__ = true;
    await ensureMarineSeries('EURO', 'waves', bounds, 300); // the class that died in the proxy window
    const hours = requestedHours(global.fetch.mock.calls[0][0]);
    expect(hours[0]).toBe(288);                              // page 6 of the 48h regime
    expect(hours[hours.length - 1]).toBe(333);
    expect(hours.length).toBe(16);
  });

  it('page math: heavy regime maps hours to 48h pages; the +336h ceiling stays reachable', () => {
    expect(marineSeriesPageForHour(0, 'EURO')).toBe(0);
    expect(marineSeriesPageForHour(150, 'EURO')).toBe(3);
    expect(marineSeriesPageForHour(300, 'EURO')).toBe(6);
    expect(marineSeriesPageForHour(336, 'EURO')).toBe(7);   // the wheel max = its own tiny page
    expect(marineSeriesPageForHour(300, 'GFS')).toBe(2);    // cheap regime unchanged
  });

  it('the +336h page loads and serves its single frame', async () => {
    await ensureMarineSeries('EURO', 'waves', bounds, 336);
    const hours = requestedHours(global.fetch.mock.calls[0][0]);
    expect(hours).toEqual([336]);
    const f = getMarineSeriesFrame('EURO', 'waves', bounds, 336);
    expect(f).not.toBeNull();
    expect(f.grid.hourOffset).toBe(336);
  });

  it('cross-regime containment fallback: a warmed cheap-class page still serves after surf toggles on', async () => {
    // Warm GFS swell page 1 (144..285, 48 frames), then flip surf ON: the exact-key lookup misses
    // (flavor + page regime both changed) but the hour-range containment fallback must still find
    // the covering swell frames — the guard is hour-based, not page-index-based, across regimes.
    // (This is the ALLOWED flavor direction: an honest frame in rating mode renders honestly via
    // the engine's Option-A gate until a rating grid lands.)
    await ensureMarineSeries('GFS', 'waves', bounds, 150);
    window.__SURF_MODE__ = true;
    const f = getMarineSeriesFrame('GFS', 'waves', { west: -81.0, south: 28.0, east: -80.0, north: 28.6 }, 150);
    expect(f).not.toBeNull();
    expect(f.grid.hourOffset).toBe(150);
  });

  it('NEVER serves a surf page in swell mode (the "band will not turn off" wedge)', async () => {
    // Warm a SURF page, then toggle OFF: the containment fallback must refuse it — surf frames
    // carry SCOREs (ratingMode:true), and the engine's reverse gate keeps painting the band until
    // an HONEST commit lands; serving the cached surf frame preempted that commit forever
    // (user report 2026-07-15: "the rating band isn't turning off when the toggle is off").
    window.__SURF_MODE__ = true;
    await ensureMarineSeries('GFS', 'waves', bounds, 0);
    expect(getMarineSeriesFrame('GFS', 'waves', { west: -81.0, south: 28.0, east: -80.0, north: 28.6 }, 0)).not.toBeNull();
    window.__SURF_MODE__ = false;
    // Exact-key path: swell keys miss surf entries by construction; the containment fallback must
    // now ALSO refuse the surf-stamped entry → a clean miss → the per-hour swell fetch takes over.
    expect(getMarineSeriesFrame('GFS', 'waves', { west: -81.0, south: 28.0, east: -80.0, north: 28.6 }, 0)).toBeNull();
  });
});
