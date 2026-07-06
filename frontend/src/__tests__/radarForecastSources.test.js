import {
  radarFutureFramesForModel,
  radarForecastTileUrl,
  radarRegionForCenter,
  radarForecastSourceFor,
} from '../components/map/radarForecastSources';

// 2026-07-06: RainViewer's nowcast is discontinued — the radar timeline extends into the future
// via model-aware forecast WMS feeds (EURO → DWD WN +2h; GFS/ICON → IEM HRRR +4h).

describe('radarFutureFramesForModel', () => {
  const now = Date.UTC(2026, 6, 6, 12, 0, 0);

  it('CONUS: ALL models ride HRRR (+4h hourly) — the only forecast-radar feed there (v2: the FL-on-EURO "clears past nowcast" fix)', () => {
    for (const m of ['GFS', 'ICON', 'EURO']) {
      const f = radarFutureFramesForModel(m, now, {}, 'CONUS');
      expect(f.map(x => x.minutes)).toEqual([60, 120, 180, 240]);
      expect(f.every(x => x.future && x.source === 'iem_hrrr')).toBe(true);
    }
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

  it('HRRR frame: IEM refp WMS with 4-digit minutes layer', () => {
    const frame = { future: true, minutes: 180, time: 0, source: 'iem_hrrr' };
    const url = radarForecastTileUrl(frame, {});
    expect(url).toContain('mesonet.agron.iastate.edu/cgi-bin/wms/hrrr/refp.cgi');
    expect(url).toContain('layers=refp_0180');
    expect(url).toContain('{bbox-epsg-3857}');
  });

  it('non-future or missing frames return null', () => {
    expect(radarForecastTileUrl(null, {})).toBeNull();
    expect(radarForecastTileUrl({ path: '/v2/radar/x' }, {})).toBeNull();
  });
});
