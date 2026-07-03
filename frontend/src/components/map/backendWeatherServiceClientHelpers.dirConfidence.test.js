/**
 * §0B-a: mapNormalizedGridToWebGL rebuilds vectors field-by-field, so the backend's
 * GridVector.dir_confidence would be silently DROPPED unless carried explicitly (the recon
 * finding, 2026-07-03). These tests pin the plumb-through: top-level + waves sub-record get
 * dirConfidence; products without the field stay null (regional/legacy — fully backward compatible).
 */
import { mapNormalizedGridToWebGL } from './backendWeatherServiceClientHelpers';

function gridResponse(vectors) {
  return {
    provider: 'open-meteo',
    product_id: 'gfs_marine_waves_global_coarse_test.json',
    grid: {
      cols: 2, rows: 1,
      bounds: { west: -120, south: 20, east: -110, north: 20 },
      vectors,
    },
  };
}

describe('mapNormalizedGridToWebGL dir_confidence plumb (§0B-a)', () => {
  it('carries dir_confidence into top-level dirConfidence and the waves sub-record', () => {
    const out = mapNormalizedGridToWebGL(gridResponse([
      { lat: 20, lng: -120, speed: 1.4, direction: 32, u: -0.74, v: -1.19, period: 11.6, is_valid: true, dir_confidence: 0.09 },
      { lat: 20, lng: -110, speed: 1.1, direction: 40, u: -0.7, v: -0.84, period: 9.0, is_valid: true, dir_confidence: 0.97 },
    ]), null, 0, 'waves', 'GFS');
    expect(out.grid.vectors[0].dirConfidence).toBeCloseTo(0.09);
    expect(out.grid.vectors[0].waves.dirConfidence).toBeCloseTo(0.09);
    expect(out.grid.vectors[1].dirConfidence).toBeCloseTo(0.97);
  });

  it('leaves dirConfidence null when the product does not export it (regional/legacy)', () => {
    const out = mapNormalizedGridToWebGL(gridResponse([
      { lat: 20, lng: -120, speed: 1.4, direction: 32, u: -0.74, v: -1.19, period: 11.6, is_valid: true },
      { lat: 20, lng: -110, speed: 1.1, direction: 40, u: -0.7, v: -0.84, period: 9.0, is_valid: true },
    ]), null, 0, 'waves', 'GFS');
    expect(out.grid.vectors[0].dirConfidence).toBeNull();
    expect(out.grid.vectors[0].waves.dirConfidence).toBeNull();
  });

  it('carries a conjoined sub-record confidence independently of the active layer', () => {
    const out = mapNormalizedGridToWebGL(gridResponse([
      {
        lat: 20, lng: -120, speed: 1.4, direction: 32, u: -0.74, v: -1.19, period: 11.6, is_valid: true,
        waves: { speed: 1.4, direction: 32, u: -0.74, v: -1.19, period: 11.6, is_valid: true, dir_confidence: 0.4 },
        swell_1: { speed: 1.0, direction: 350, u: 0.17, v: -0.98, period: 9.8, is_valid: true },
      },
      { lat: 20, lng: -110, speed: 1.1, direction: 40, u: -0.7, v: -0.84, period: 9.0, is_valid: true },
    ]), null, 0, 'waves', 'GFS');
    expect(out.grid.vectors[0].waves.dirConfidence).toBeCloseTo(0.4);
    expect(out.grid.vectors[0].swell_1.dirConfidence).toBeNull();
  });
});
