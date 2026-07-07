import {
  radarFutureFramesForModel,
  radarForecastTileUrl,
  radarRegionForCenter,
  radarForecastSourceFor,
  discoverHrrrRun,
  hrrrRunParams,
  radarLightningTileUrl,
} from '../components/map/radarForecastSources';

// 2026-07-06: RainViewer's nowcast is discontinued — the radar timeline extends into the future
// via model-aware forecast WMS feeds (EURO → DWD WN +2h; GFS/ICON → IEM HRRR +4h).

describe('radarFutureFramesForModel', () => {
  const now = Date.UTC(2026, 6, 6, 12, 0, 0);

  it('CONUS: ALL models ride HRRR, frames pinned to the discovered run (v3: leads are run-relative — now-relative labeling was the "forecast does not tie to the nowcast" root)', () => {
    const runMs = Date.UTC(2026, 6, 6, 10, 0, 0); // latest completed run 10z, now 12:05z
    const nowMs = Date.UTC(2026, 6, 6, 12, 5, 0);
    for (const m of ['GFS', 'ICON', 'EURO']) {
      const f = radarFutureFramesForModel(m, nowMs, {}, 'CONUS', runMs);
      expect(f.length).toBeGreaterThan(0);
      expect(f.every(x => x.future && x.source === 'iem_hrrr' && x.runMs === runMs)).toBe(true);
      // Leads live on the run's 15-min grid; valid time = run + lead, exactly.
      expect(f.every(x => x.f % 15 === 0)).toBe(true);
      expect(f.every(x => x.time === Math.floor((runMs + x.f * 60000) / 1000))).toBe(true);
      // First frame is the first grid point at/after now (+10 min here) — continuous with the
      // observed frames; nothing earlier than now sneaks in (the old backward-jump).
      expect(f[0].f).toBe(135);
      expect(f[0].minutes).toBe(10);
      expect(f.every(x => x.time * 1000 >= nowMs)).toBe(true);
      // 30-min cadence, capped at +4h from now.
      expect(f[1].minutes - f[0].minutes).toBe(30);
      expect(f[f.length - 1].minutes).toBeLessThanOrEqual(240);
    }
  });

  it('CONUS without a discovered run: no future frames (truthful) — and the forced-run lever wins', () => {
    expect(radarFutureFramesForModel('GFS', now, {}, 'CONUS')).toEqual([]);
    expect(radarFutureFramesForModel('GFS', now, {}, 'CONUS', null)).toEqual([]);
    const forced = Date.UTC(2026, 6, 6, 9, 0, 0);
    const f = radarFutureFramesForModel('GFS', now, { __RAW_RADAR_HRRR_RUN_MS__: forced }, 'CONUS', null);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0].runMs).toBe(forced);
  });

  it('EU: EURO → DWD RV, GFS/ICON → DWD WN (+2h, 30-min frames) — differentiation where feeds overlap', () => {
    const euro = radarFutureFramesForModel('EURO', now, {}, 'EU');
    expect(euro.map(x => x.minutes)).toEqual([30, 60, 90, 120]);
    expect(euro.every(x => x.source === 'dwd_rv')).toBe(true);
    expect(euro[0].time).toBe(Math.floor(now / 1000) + 30 * 60);
    for (const m of ['GFS', 'ICON']) {
      expect(radarFutureFramesForModel(m, now, {}, 'EU').every(x => x.source === 'dwd_wn')).toBe(true);
    }
  });

  it('outside both footprints: no future frames (truthful — past stays RainViewer-global)', () => {
    expect(radarFutureFramesForModel('EURO', now, {}, 'NONE')).toEqual([]);
    expect(radarForecastSourceFor('GFS', 'NONE')).toBeNull();
  });

  it('kill switch empties the future everywhere', () => {
    expect(radarFutureFramesForModel('EURO', now, { __RAW_RADAR_FUTURE_DISABLED__: true }, 'EU')).toEqual([]);
  });
});

describe('radarRegionForCenter', () => {
  it('classifies CONUS, EU (DWD footprint), and elsewhere', () => {
    expect(radarRegionForCenter(-80.6, 28.3)).toBe('CONUS');   // Florida
    expect(radarRegionForCenter(-118.5, 33.9)).toBe('CONUS');  // socal
    expect(radarRegionForCenter(9.9, 51.3)).toBe('EU');        // Germany
    expect(radarRegionForCenter(153.5, -28.2)).toBe('NONE');   // Australia
    expect(radarRegionForCenter(undefined, 28)).toBe('NONE');  // degenerate
  });
});

describe('radarForecastTileUrl', () => {
  it('DWD frames: GeoServer GetMap with 5-min-grid TIME + bbox template + per-source layers', () => {
    const t = Math.floor(Date.UTC(2026, 6, 6, 12, 31, 40) / 1000);
    const wn = radarForecastTileUrl({ future: true, minutes: 30, time: t, source: 'dwd_wn' }, {});
    expect(wn).toContain('maps.dwd.de/geoserver/dwd/wms');
    expect(wn).toContain('layers=dwd%3ARadar_wn-product_1x1km_ger'); // proven via GetCapabilities 2026-07-06
    expect(wn).toContain('time=2026-07-06T12%3A30%3A00.000Z'); // rounded to the 5-min grid
    expect(wn).toContain('{bbox-epsg-3857}');
    const rv = radarForecastTileUrl({ future: true, minutes: 30, time: t, source: 'dwd_rv' }, {});
    expect(rv).toContain('layers=dwd%3ARadar_rv_product_1x1km_ger'); // live GetMap-verified 2026-07-06
    const overridden = radarForecastTileUrl({ future: true, minutes: 30, time: t, source: 'dwd_wn' }, { __RAW_RADAR_DWD_LAYER__: 'dwd:Custom' });
    expect(overridden).toContain('layers=dwd%3ACustom');
  });

  it('HRRR run-pinned frame: archive-backed refp-t with run params + 4-digit lead (GetMap-proven 2026-07-06)', () => {
    const runMs = Date.UTC(2026, 6, 6, 10, 0, 0);
    const frame = { future: true, minutes: 10, time: 0, source: 'iem_hrrr', runMs, f: 135 };
    const url = radarForecastTileUrl(frame, {});
    expect(url).toContain('mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi');
    expect(url).toContain('layers=refp-t');
    expect(url).toContain('year=2026&month=07&day=06&hour=10');
    expect(url).toContain('f=0135');
    expect(url).toContain('{bbox-epsg-3857}');
  });

  it('HRRR frame without run info: legacy static-lead layer (back-compat only)', () => {
    const frame = { future: true, minutes: 180, time: 0, source: 'iem_hrrr' };
    const url = radarForecastTileUrl(frame, {});
    expect(url).toContain('layers=refp_0180');
    expect(url).toContain('{bbox-epsg-3857}');
  });

  it('non-future or missing frames return null', () => {
    expect(radarForecastTileUrl(null, {})).toBeNull();
    expect(radarForecastTileUrl({ path: '/v2/radar/x' }, {})).toBeNull();
  });
});

describe('radarLightningTileUrl', () => {
  it('past frames get a nowCOAST NLDN URL with the frame time on the 5-min grid', () => {
    const t = Math.floor(Date.UTC(2026, 6, 6, 21, 31, 40) / 1000);
    const url = radarLightningTileUrl({ time: t, path: '/v2/radar/x' }, {});
    expect(url).toContain('nowcoast.noaa.gov/geoserver/lightning_detection');
    expect(url).toContain('layers=ldn_lightning_strike_density');
    expect(url).toContain('time=2026-07-06T21%3A30%3A00.000Z');
    expect(url).toContain('{bbox-epsg-3857}');
  });

  it('future frames carry NO lightning (observation product — never invented forward)', () => {
    expect(radarLightningTileUrl({ future: true, time: 1783376000, source: 'iem_hrrr' }, {})).toBeNull();
  });

  it('kill switch and degenerate frames return null', () => {
    expect(radarLightningTileUrl({ time: 1783376000 }, { __RAW_RADAR_LIGHTNING_DISABLED__: true })).toBeNull();
    expect(radarLightningTileUrl(null, {})).toBeNull();
    expect(radarLightningTileUrl({ path: '/v2/radar/x' }, {})).toBeNull();
  });
});

describe('discoverHrrrRun', () => {
  it('probes newest-hour-first and lands on the newest run whose f=0000 renders (missing runs answer WMS XML), then serves from cache', async () => {
    const nowMs = Date.UTC(2026, 6, 6, 21, 42, 0);
    const available = new Set(['hour=20', 'hour=19', 'hour=18']);
    const calls = [];
    const fetchFn = (url) => {
      calls.push(url);
      const hit = [...available].some(h => url.includes(h));
      return Promise.resolve({
        ok: true,
        headers: { get: () => (hit ? 'image/png' : 'text/xml') },
      });
    };
    const runMs = await discoverHrrrRun(nowMs, { fetch: fetchFn });
    expect(runMs).toBe(Date.UTC(2026, 6, 6, 20, 0, 0)); // 21z not there yet → 20z
    expect(calls.length).toBe(2); // 21z (XML) then 20z (PNG)
    // Within the TTL the cache answers — no further probes.
    const again = await discoverHrrrRun(nowMs + 60000, { fetch: fetchFn });
    expect(again).toBe(runMs);
    expect(calls.length).toBe(2);
  });

  it('hrrrRunParams renders UTC run-hour parts zero-padded', () => {
    expect(hrrrRunParams(Date.UTC(2026, 0, 3, 5, 0, 0))).toBe('year=2026&month=01&day=03&hour=05');
  });
});
