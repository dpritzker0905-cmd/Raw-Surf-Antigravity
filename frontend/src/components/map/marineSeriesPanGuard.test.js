/**
 * marineSeriesPanGuard.js: small pans stop asking the 1-CPU box for new series pages (2026-10-23). Live 19:44Z, surf ON, ICON,
 * z7-9 Florida: every small pan sent a new page for an unsnapped bbox (~20 boxes in 5 min, 10-25 s of CPU each) plus a mini.
 * The helpers, then the REAL series chain (marineGridSeries + the limiter; only fetch is mocked).
 */
import {
  SERIES_PAN_SETTLE_MS, seriesBoxContained, seriesFetchInit, seriesIdentityBounds, seriesPanSettleMs, snapRequestBox,
} from './marineSeriesPanGuard';
import { ensureMarineSeries, getMarineSeriesFrame, marineSeriesViewportIdentity, prewarmMarineSeries, _resetMarineSeriesForTest } from './marineGridSeries';
import { seriesAnchorTag } from './seriesAnchor';

const KILLS = ['SERIES_REQUEST_SNAP', 'SERIES_CONTAIN_REUSE', 'SERIES_PAN_SUPERSEDE', 'SERIES_PAN_DEBOUNCE', 'SERIES_LOW_PRIORITY'];
const clearKills = () => { for (const k of KILLS) delete window[`__RAW_DISABLE_${k}__`]; delete window.__RAW_SERIES_PAN__; };

describe('the helpers', () => {
  afterEach(clearKills);

  it('snapRequestBox snaps OUTWARD to 1 deg; wide, global and dateline-crossing boxes are left alone; the kill restores the box', () => {
    expect(snapRequestBox({ west: -82.2, south: 27.3, east: -79.1, north: 29.3 })).toEqual({ west: -83, south: 27, east: -79, north: 30 });
    const wide = { west: -100, south: 10, east: -60, north: 45 };
    expect(snapRequestBox(wide)).toBe(wide);
    const crossing = { west: 178.4, south: -20, east: -178.2, north: -17 };
    expect(snapRequestBox(crossing)).toBe(crossing);
    const nearWide = { west: -80.1, south: 20.2, east: -65.2, north: 25 };   // 14.9 deg would snap to 16: never across the 15-deg line
    expect(snapRequestBox(nearWide)).toBe(nearWide);
    window.__RAW_DISABLE_SERIES_REQUEST_SNAP__ = true;
    const b = { west: -82.2, south: 27.3, east: -79.1, north: 29.3 };
    expect(snapRequestBox(b)).toBe(b);
  });

  it('seriesIdentityBounds: two views inside one snapped box share an identity; a pan out of it does not; the kill uses the raw view', () => {
    const a = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };
    const nudge = { west: -81.6, south: 27.85, east: -79.5, north: 28.85 };
    const far = { west: -80.4, south: 27.8, east: -78.3, north: 28.8 };
    expect(marineSeriesViewportIdentity('GFS', 'waves', a)).toBe(marineSeriesViewportIdentity('GFS', 'waves', nudge));
    expect(marineSeriesViewportIdentity('GFS', 'waves', a)).not.toBe(marineSeriesViewportIdentity('GFS', 'waves', far));
    window.__RAW_DISABLE_SERIES_PAN_SUPERSEDE__ = true;
    expect(seriesIdentityBounds(a)).toBe(a);
  });

  it('seriesBoxContained: same model / layer / flavour / page / anchor, fresh, with frames, a regional box that contains the view', () => {
    const tag = seriesAnchorTag();
    const view = { west: -81.6, south: 27.9, east: -79.7, north: 28.7 };
    const box = { west: -83, south: 27, east: -79, north: 30 };
    const entry = (over = {}) => ({ ts: Date.now(), frames: new Map([[0, {}]]), bounds: box, ...over });
    const q = (cache, inFlight = new Map(), over = {}) => seriesBoxContained(cache, inFlight,
      { model: 'GFS', layer: 'waves', page: 0, bounds: view, surf: false, ttlMs: 300000, ...over });
    const k = (rest) => `GFS_waves_swell_${rest}_p0${tag}`;
    expect(q(new Map([[k('-82.0_27.5_-79.0_29.5'), entry()]]))).toBe(true);
    expect(window.__RAW_SERIES_PAN__.contained).toBe(1);
    expect(q(new Map([[`GFS_waves_surf_x_p0${tag}`, entry()]]))).toBe(false);                 // the other flavour
    expect(q(new Map([[`ICON_waves_swell_x_p0${tag}`, entry()]]))).toBe(false);               // another model
    expect(q(new Map([[`GFS_swell_1_swell_x_p0${tag}`, entry()]]))).toBe(false);              // another layer
    expect(q(new Map([[`GFS_waves_swell_x_p1${tag}`, entry()]]))).toBe(false);                // another page
    expect(q(new Map([['GFS_waves_swell_x_p0_aOTHER', entry()]]))).toBe(false);               // another anchor
    expect(q(new Map([[k('x'), entry({ ts: Date.now() - 400000 })]]))).toBe(false);           // stale
    for (const flag of ['coarsePreview', 'warming', 'staticFrames']) expect(q(new Map([[k('x'), entry({ [flag]: true })]]))).toBe(false);
    expect(q(new Map([[k('x'), entry({ frames: new Map() })]]))).toBe(false);                 // no frames
    expect(q(new Map([[k('x'), entry({ bounds: { west: -180, south: -80, east: 180, north: 85 } })]]))).toBe(false);   // a world page
    expect(q(new Map([[k('x'), entry({ bounds: { west: -81, south: 27, east: -79, north: 30 } })]]))).toBe(false);       // does not contain
    expect(q(new Map([[`${k('x')}_h0`, entry()]]))).toBe(false);                               // a mini answers only a mini
    expect(q(new Map([[`${k('x')}_h0`, entry()]]), new Map(), { mini: true })).toBe(true);
    // in flight: its REQUEST box counts; an aborted or a world flight does not
    const flight = (reqBox, aborted = false) => Object.assign(Promise.resolve(), { reqBox, seriesSignal: { aborted } });
    expect(q(new Map(), new Map([[k('y'), flight(box)]]))).toBe(true);
    expect(window.__RAW_SERIES_PAN__.containedInFlight).toBe(1);
    expect(q(new Map(), new Map([[k('y'), flight(box, true)]]))).toBe(false);
    expect(q(new Map(), new Map([[k('y'), flight({ west: -180, south: -80, east: 180, north: 85 })]]))).toBe(false);
    window.__RAW_DISABLE_SERIES_CONTAIN_REUSE__ = true;
    expect(q(new Map([[k('-82.0_27.5_-79.0_29.5'), entry()]]))).toBe(false);
  });

  it('seriesFetchInit: background pages and minis at priority low; visible ones untouched; the kill', () => {
    const s = new AbortController().signal;
    expect(seriesFetchInit(s, 'background')).toEqual({ signal: s, priority: 'low' });
    expect(seriesFetchInit(s, 'mini')).toEqual({ signal: s, priority: 'low' });
    expect(seriesFetchInit(s, 'visible')).toEqual({ signal: s });
    expect(seriesFetchInit(s, 'visible-mini')).toEqual({ signal: s });
    window.__RAW_DISABLE_SERIES_LOW_PRIORITY__ = true;
    expect(seriesFetchInit(s, 'background')).toEqual({ signal: s });
  });

  it('seriesPanSettleMs: 400 ms, 0 when killed', () => {
    expect(seriesPanSettleMs()).toBe(SERIES_PAN_SETTLE_MS);
    expect(SERIES_PAN_SETTLE_MS).toBe(400);
    window.__RAW_DISABLE_SERIES_PAN_DEBOUNCE__ = true;
    expect(seriesPanSettleMs()).toBe(0);
  });
});

describe('the real series chain', () => {
  const A = { west: -81.7, south: 27.8, east: -79.6, north: 28.8 };
  const mkBody = (url) => {
    const m = String(url).match(/bbox=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)/);
    const b = { west: +m[1], south: +m[2], east: +m[3], north: +m[4] };
    const hours = (String(url).match(/hours=([^&]+)/) || [])[1].split(',').map(Number);
    return { model: 'GFS', domain: 'marine', frames: hours.map((h) => ({ hour_offset: h, valid_time: '2026-09-23T03:00:00Z', cols: 4, rows: 4, bounds: b,
      vectors: [{ lat: 28, lng: -80, u: 0.1, v: 0.1, speed: 1, direction: 90, period: 8 }] })) };
  };
  const series = () => global.fetch.mock.calls.filter((c) => String(c[0]).includes('/grid_series'));
  const flush = async (n = 30) => { for (let i = 0; i < n; i++) await Promise.resolve(); };
  beforeEach(() => {
    window.__MOCK_DATE_NOW__ = Date.UTC(2026, 8, 23, 3, 10, 0);
    window.__MARINE_SERIES__ = true; window.__USE_BACKEND_MARINE_SYSTEM__ = true;
    _resetMarineSeriesForTest(); clearKills();
    global.fetch = jest.fn(async (url) => ({ ok: true, json: async () => mkBody(url) }));
  });
  afterEach(() => {
    clearKills();
    for (const k of ['__MOCK_DATE_NOW__', '__MARINE_SERIES__', '__USE_BACKEND_MARINE_SYSTEM__']) delete window[k];
  });

  it('a pan inside the cached page asks nothing and is served from that page; a pan out of it asks the SNAPPED box', async () => {
    await ensureMarineSeries('GFS', 'waves', A, 0, undefined, true);
    await flush();
    expect(series().map((c) => String(c[0]).match(/bbox=([^&]+)/)[1])).toEqual(['-83.0000,27.0000,-79.0000,30.0000', '-83.0000,27.0000,-79.0000,30.0000']);
    global.fetch.mockClear();
    const nudge = { west: -81.2, south: 28.3, east: -79.2, north: 29.2 };          // ANOTHER 0.5-deg key (-81.0_28.5_-79.0_29.0), inside the served box
    await ensureMarineSeries('GFS', 'waves', nudge, 0, undefined, true);
    await flush();
    expect(series()).toHaveLength(0);
    expect(getMarineSeriesFrame('GFS', 'waves', nudge, 0)).not.toBeNull();
    const out = { west: -79.8, south: 28.0, east: -77.7, north: 29.0 };            // past the served box's east edge
    await ensureMarineSeries('GFS', 'waves', out, 0, undefined, true);
    await flush();
    expect(series().length).toBeGreaterThan(0);
    expect(String(series()[0][0])).toContain('bbox=-81.0000,27.0000,-77.0000,30.0000');
  });

  it('a pan inside a page still IN FLIGHT waits for it instead of asking again', async () => {
    let release;
    global.fetch = jest.fn((url) => new Promise((r) => { release = () => r({ ok: true, json: async () => mkBody(url) }); }));
    ensureMarineSeries('GFS', 'waves', A, 0, undefined, true);
    await flush();
    const before = series().length;
    ensureMarineSeries('GFS', 'waves', { west: -81.2, south: 28.3, east: -79.2, north: 29.2 }, 0, undefined, true);   // another key
    await flush();
    expect(series().length).toBe(before);
    release();
  });

  it('positive control: with the reuse and the snap killed the nudge asks its own page and mini, unsnapped', async () => {
    window.__RAW_DISABLE_SERIES_CONTAIN_REUSE__ = true; window.__RAW_DISABLE_SERIES_REQUEST_SNAP__ = true;
    await ensureMarineSeries('GFS', 'waves', A, 0, undefined, true);
    await flush();
    global.fetch.mockClear();
    await ensureMarineSeries('GFS', 'waves', { west: -81.2, south: 28.3, east: -79.2, north: 29.2 }, 0, undefined, true);
    await flush();
    expect(series()).toHaveLength(2);
    expect(String(series()[0][0])).toContain('bbox=-81.7000,27.8000,-78.7000,29.7000');
  });

  it('the scrub prewarm (background pages) fetches at priority low', async () => {
    prewarmMarineSeries('GFS', 'waves', A, undefined);
    for (let i = 0; i < 8; i++) { await flush(); await new Promise((r) => setTimeout(r, 0)); }
    const bg = series().filter((c) => /hours=\d+,/.test(String(c[0])));
    expect(bg.length).toBeGreaterThan(0);
    expect(bg.every((c) => c[1] && c[1].priority === 'low')).toBe(true);
  });

  it('20 small drifting pans (the live pattern, swell mode here) ask far fewer pages and minis than before', async () => {
    const pans = []; let w = -81.7, s = 27.8;
    for (let i = 0; i < 20; i++) { w += [0.4, 0.15, 0.45, 0.1][i % 4]; s += [0.05, 0.25, -0.1, 0.2][i % 4]; pans.push({ west: w, south: s, east: w + 2.1, north: s + 1.0 }); }
    const run = async () => {
      _resetMarineSeriesForTest(); global.fetch.mockClear();
      for (const b of pans) { await ensureMarineSeries('GFS', 'waves', b, 0, undefined, true); await flush(); }
      return series().length;
    };
    const after = await run();
    for (const k of ['SERIES_REQUEST_SNAP', 'SERIES_CONTAIN_REUSE']) window[`__RAW_DISABLE_${k}__`] = true;
    const before = await run();
    expect(before).toBeGreaterThanOrEqual(30);          // a page and a mini for most pans
    expect(after).toBeLessThanOrEqual(before / 3);
  });
});
