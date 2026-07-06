import {
  radarFutureFramesForModel,
  radarForecastTileUrl,
  RADAR_FORECAST_CAP_MIN,
} from '../components/map/radarForecastSources';

// 2026-07-06: RainViewer's nowcast is discontinued — the radar timeline extends into the future
// via model-aware forecast WMS feeds (EURO → DWD WN +2h; GFS/ICON → IEM HRRR +4h).

describe('radarFutureFramesForModel', () => {
  const now = Date.UTC(2026, 6, 6, 12, 0, 0);

  it('EURO: DWD WN frames every 30 min to +120', () => {
    const f = radarFutureFramesForModel('EURO', now, {});
    expect(f.map(x => x.minutes)).toEqual([30, 60, 90, 120]);
    expect(f.every(x => x.future && x.source === 'dwd_wn')).toBe(true);
    expect(f[0].time).toBe(Math.floor(now / 1000) + 30 * 60);
  });

  it('GFS and ICON: HRRR frames every 60 min to +240', () => {
    for (const m of ['GFS', 'ICON']) {
      const f = radarFutureFramesForModel(m, now, {});
      expect(f.map(x => x.minutes)).toEqual([60, 120, 180, 240]);
      expect(f.every(x => x.source === 'iem_hrrr')).toBe(true);
    }
  });

  it('unknown model falls back to the GFS feed; kill switch empties the future', () => {
    expect(radarFutureFramesForModel(undefined, now, {}).length).toBe(4);
    expect(radarFutureFramesForModel('EURO', now, { __RAW_RADAR_FUTURE_DISABLED__: true })).toEqual([]);
  });

  it('caps match the feeds (DWD 120 / HRRR 240)', () => {
    expect(RADAR_FORECAST_CAP_MIN.EURO).toBe(120);
    expect(RADAR_FORECAST_CAP_MIN.GFS).toBe(240);
  });
});

describe('radarForecastTileUrl', () => {
  it('DWD frame: GeoServer GetMap with 5-min-grid TIME + bbox template + layer lever', () => {
    const frame = { future: true, minutes: 30, time: Math.floor(Date.UTC(2026, 6, 6, 12, 31, 40) / 1000), source: 'dwd_wn' };
    const url = radarForecastTileUrl(frame, {});
    expect(url).toContain('maps.dwd.de/geoserver/dwd/wms');
    expect(url).toContain('layers=dwd%3ARadar_wn-product_1x1km_ger'); // proven via GetCapabilities 2026-07-06
    expect(url).toContain('time=2026-07-06T12%3A30%3A00.000Z'); // rounded to the 5-min grid
    expect(url).toContain('{bbox-epsg-3857}');
    const overridden = radarForecastTileUrl(frame, { __RAW_RADAR_DWD_LAYER__: 'dwd:RV-Produkt' });
    expect(overridden).toContain('layers=dwd%3ARV-Produkt');
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
