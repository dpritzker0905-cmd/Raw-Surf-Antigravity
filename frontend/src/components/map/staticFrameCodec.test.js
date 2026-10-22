import {
  apiIso, buildVectors, gridJsonFromFrame, isGzip, parseFrame, pickIndexFrame, seriesFrameFromFrame,
} from './staticFrameCodec';
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';
import { frameToMarineData } from './marineSeriesFrame';

import { SOURCE, goldenBuffer } from './staticFrameGolden.fixture';

describe('static frame codec', () => {
  test('decodes the golden frame to the source values within the stated tolerances', () => {
    const parsed = parseFrame(goldenBuffer());
    expect([parsed.cols, parsed.rows, parsed.uvConvention, parsed.fieldMask]).toEqual([4, 3, 0, 15]);
    expect(parsed.bounds).toEqual({ west: 100, south: -10, east: 107.5, north: 0 });
    expect(apiIso(parsed.validEpoch * 1000)).toBe('2026-10-20T00:00:00Z');
    expect(apiIso(parsed.runEpoch * 1000)).toBe('2026-10-19T18:00:00Z');
    const vectors = buildVectors(parsed);
    expect(vectors).toHaveLength(12);
    vectors.forEach((v, i) => {
      expect(v.lat).toBe(-10 + Math.floor(i / 4) * 5);
      expect(v.lng).toBe(100 + (i % 4) * 2.5);
      const src = SOURCE[i];
      if (!src) {
        expect(v).toMatchObject({ is_valid: false, speed: 0, u: 0, v: 0, direction: 0, period: 0, dir_confidence: null });
        return;
      }
      const [h, d, p, c] = src;
      expect(v.is_valid).toBe(true);
      expect(Math.abs(v.speed - h)).toBeLessThanOrEqual(0.0005 + 1e-9);
      expect(v.direction).toBeCloseTo(d, 6);
      expect(v.period).toBe(p);
      if (c === null) expect(v.dir_confidence).toBeNull();
      else expect(Math.abs(v.dir_confidence - c)).toBeLessThanOrEqual(0.5 / 254 + 1e-4);
      const rad = v.direction * Math.PI / 180;                       // u, v follow the ingest normalizer: -h sin d
      expect(v.u).toBeCloseTo(-v.speed * Math.sin(rad), 3);
      expect(v.v).toBeCloseTo(-v.speed * Math.cos(rad), 3);
      expect(Object.keys(v).sort()).toEqual(['dir_confidence', 'direction', 'gust', 'is_valid', 'lat', 'lng', 'period', 'speed', 'u', 'v', 'value']);
    });
  });

  test('gzip detection and refusals (bad magic, unsupported version, truncation)', () => {
    expect(isGzip(Uint8Array.from([0x1f, 0x8b, 8]))).toBe(true);
    expect(isGzip(new Uint8Array(goldenBuffer()))).toBe(false);
    const bad = new Uint8Array(goldenBuffer()); bad[0] = 0x58;
    expect(() => parseFrame(bad.buffer)).toThrow(/magic/);
    const v2 = new Uint8Array(goldenBuffer()); v2[4] = 2;
    expect(() => parseFrame(v2.buffer)).toThrow(/encoding_version/);
    expect(() => parseFrame(goldenBuffer().slice(0, 240))).toThrow(/truncated/);
  });

  test('picks the frame /grid would serve: nearest within 3 h, authoritative first, earlier on a tie', () => {
    const f = (vt, est = false) => ({ valid_time: vt, is_estimated: est, path: vt + (est ? 'e' : '') });
    const index = { frames: [f('2026-10-20T00:00:00Z'), f('2026-10-20T03:00:00Z'), f('2026-10-20T06:00:00Z', true), f('2026-10-20T12:00:00Z', true)] };
    const at = (iso) => pickIndexFrame(index, Date.parse(iso));
    expect(at('2026-10-20T01:00:00Z').path).toBe('2026-10-20T00:00:00Z');
    expect(at('2026-10-20T02:00:00Z').path).toBe('2026-10-20T03:00:00Z');
    expect(at('2026-10-20T01:30:00Z').path).toBe('2026-10-20T00:00:00Z');        // tie: the earlier
    expect(at('2026-10-20T05:00:00Z').path).toBe('2026-10-20T03:00:00Z');        // authoritative beats a nearer estimate
    expect(at('2026-10-20T10:00:00Z').path).toBe('2026-10-20T12:00:00Ze');       // only an estimate in the window
    expect(at('2026-10-20T15:00:00Z').path).toBe('2026-10-20T12:00:00Ze');       // exactly 3 h is inside
    expect(at('2026-10-20T15:00:01Z')).toBeNull();
  });

  const INDEX = {
    path: 'v1/gfs/marine/waves/global_mid/index/r-1.json', run: '2026-10-19T18:00:00Z',
    grid: { cols: 4, rows: 3, bounds: { west: 100, south: -10, east: 107.5, north: 0 } },
    common_meta: {
      model: 'GFS', provider: 'open-meteo', domain: 'marine', layer: 'waves', run_time: '2026-10-19T23:22:22Z',
      model_run_time: '2026-10-19T18:00:00Z', model_run_time_status: 'known', is_forecast_authoritative: true,
      is_estimated: false, value_kind: 'wave_height', value_unit: 'm', display_unit_hint: 'ft',
      source_dataset: 'ncep_gfswave025', upstream_provider: 'noaa', region_id: 'global_mid', diagnostics: { gridMode: 'rectangular' },
    },
  };
  const FRAME = { valid_time: '2026-10-20T00:00:00Z', path: 'v1/x/f.bin', sha256: 'ab', meta: { product_id: 'gfs_marine_waves_global_mid_20261020T000000Z.json' } };

  test('rebuilds the /grid response: the asked time echoed, the served time disclosed, mapper-ready', () => {
    const vectors = buildVectors(parseFrame(goldenBuffer()));
    const box = { west: -180, south: -80, east: 180, north: 85 };
    const json = gridJsonFromFrame(INDEX, FRAME, vectors, { askIso: '2026-10-20T01:00:00.000Z', requestedBbox: box });
    expect(json).toMatchObject({
      model: 'GFS', provider: 'open-meteo', layer: 'waves', valid_time: '2026-10-20T01:00:00Z',
      served_valid_time: '2026-10-20T00:00:00Z', frame_offset_hours: -1, frame_substituted: true,
      product_id: FRAME.meta.product_id, coverage_scope: 'regional', coverage_mode: 'regional_tile',
      requested_bbox: '-180.0000,-80.0000,180.0000,85.0000', served_bbox: '100.0000,-10.0000,107.5000,0.0000',
      model_run_time: '2026-10-19T18:00:00Z', upstream_provider: 'noaa', is_estimated: false,
      static_frame: { path: 'v1/x/f.bin', index: INDEX.path, run: INDEX.run },
    });
    expect(json.grid.diagnostics).toMatchObject({ gridMode: 'rectangular', served_valid_time: '2026-10-20T00:00:00Z', renderable: true });
    const mapped = mapNormalizedGridToWebGL(json, box, 1, 'waves', 'GFS');
    expect(mapped.grid.vectors).toHaveLength(12);
    expect(mapped.grid.vectors[2].isOcean).toBe(false);
    expect(mapped.grid.vectors[0].waves.speed).toBeCloseTo(0.462, 4);
    expect(mapped.grid.served_valid_time).toBe('2026-10-20T00:00:00Z');
    expect(mapped.grid.productId).toBe(FRAME.meta.product_id);
    const exact = gridJsonFromFrame(INDEX, FRAME, vectors, { askIso: '2026-10-20T00:00:00Z' });
    expect([exact.frame_offset_hours, exact.frame_substituted]).toEqual([0, false]);
  });

  test('a series frame is full resolution and keeps its stored identity', () => {
    const vectors = buildVectors(parseFrame(goldenBuffer()));
    const f = seriesFrameFromFrame(INDEX, FRAME, vectors, { hourOffset: 3, askIso: '2026-10-20T01:00:00.000Z' });
    expect(f).toMatchObject({ hour_offset: 3, cols: 4, rows: 3, served_valid_time: '2026-10-20T00:00:00Z', rating_mode: false });
    expect(f.decimated_stride).toBeUndefined();
    const md = frameToMarineData(f, 'GFS', 'waves');
    expect(md.grid.__decimatedStride).toBe(0);
    expect(md.grid.__servedProductId).toBe(FRAME.meta.product_id);
    expect(md.grid.vectors).toBe(vectors);
  });
});
