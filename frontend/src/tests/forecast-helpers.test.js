import { sampleFromMarineGrid, mToFt, degToCompass } from '../components/map/forecastHelpers';

describe('forecastHelpers.js - sampleFromMarineGrid geodetic snapping math', () => {
  beforeEach(() => {
    // Clean up global state
    delete window.__MARINE_WIND_DATA__;
  });

  test('mToFt correctly converts meters to feet', () => {
    expect(mToFt(1)).toBe('3.3');
    expect(mToFt(3)).toBe('9.8');
    expect(mToFt(null)).toBeNull();
  });

  test('degToCompass correctly maps degrees to compass directions', () => {
    expect(degToCompass(0)).toBe('N');
    expect(degToCompass(90)).toBe('E');
    expect(degToCompass(180)).toBe('S');
    expect(degToCompass(270)).toBe('W');
    expect(degToCompass(null)).toBe('');
  });

  test('sampleFromMarineGrid nearest-neighbor fallback is correct for 1 valid ocean corner', () => {
    // Mock a 2x2 grid where the bounds are around the antimeridian: west: 179.0, east: -179.0.
    // That means the longitude wraps.
    // The grid center is 180.0 (equivalent to -180.0).
    const grid = {
      bounds: { west: 179.0, south: 60.0, east: -179.0, north: 61.0 },
      cols: 2,
      rows: 2,
      __sourceModel: 'GFS',
      __provider: 'open-meteo',
      vectors: [
        // v00: lat 60, lng 179 (not ocean)
        { lat: 60, lng: 179.0, isOcean: false },
        // v10: lat 60, lng -179 (ocean, valid data) -> wrapped as 181
        { lat: 60, lng: -179.0, isOcean: true, waves: { u: 1, v: 0, speed: 2.0 } },
        // v01: lat 61, lng 179 (not ocean)
        { lat: 61, lng: 179.0, isOcean: false },
        // v11: lat 61, lng -179 (not ocean)
        { lat: 61, lng: -179.0, isOcean: false }
      ]
    };
    window.__MARINE_WIND_DATA__ = grid;

    const result = sampleFromMarineGrid(60.1, 179.6, 'GFS', 'waves');
    expect(result).not.toBeNull();
    expect(result.value).toBe(2.0); // Selected v10 (the only valid ocean corner)
    expect(result.source).toBe('marine_grid_nearest');
  });

  test('sampleFromMarineGrid performs normalized bilinear interpolation for 2-3 valid ocean corners', () => {
    const grid = {
      bounds: { west: 179.0, south: 60.0, east: -179.0, north: 61.0 },
      cols: 2,
      rows: 2,
      __sourceModel: 'GFS',
      __provider: 'open-meteo',
      vectors: [
        // v00: lat 60, lng 179 (not ocean)
        { lat: 60, lng: 179.0, isOcean: false },
        // v10: lat 60, lng -179 (ocean, valid data) -> wrapped as 181
        { lat: 60, lng: -179.0, isOcean: true, waves: { u: 2.0, v: 0, speed: 2.0 } },
        // v01: lat 61, lng 179 (ocean, valid data) -> wrapped as 179
        { lat: 61, lng: 179.0, isOcean: true, waves: { u: 0, v: 4.0, speed: 4.0 } },
        // v11: lat 61, lng -179 (not ocean)
        { lat: 61, lng: -179.0, isOcean: false }
      ]
    };
    window.__MARINE_WIND_DATA__ = grid;

    // Target lat = 60.1, lng = 179.6
    // dx = 0.3, dy = 0.1
    // sumW = 0.27 + 0.07 = 0.34
    // norm_w10 = 0.27 / 0.34 = 0.7941
    // norm_w01 = 0.07 / 0.34 = 0.2059
    // avgU = norm_w10 * 2.0 = 1.5882
    // avgV = norm_w01 * 4.0 = 0.8236
    // Expected speed = sqrt(avgU^2 + avgV^2) = 1.789
    const result = sampleFromMarineGrid(60.1, 179.6, 'GFS', 'waves');
    expect(result).not.toBeNull();
    expect(result.value).toBeCloseTo(1.789, 3);
    expect(result.direction).toBeCloseTo(242.56, 1);
    expect(result.source).toBe('marine_grid');
  });

  test('sampleFromMarineGrid handles arbitrary large lng values', () => {
    const grid = {
      bounds: { west: -80.0, south: 25.0, east: -79.0, north: 26.0 },
      cols: 2,
      rows: 2,
      __sourceModel: 'GFS',
      __provider: 'open-meteo',
      vectors: [
        { lat: 25, lng: -80.0, isOcean: false },
        { lat: 25, lng: -79.0, isOcean: true, waves: { u: 1, v: 0, speed: 2.0 } },
        { lat: 26, lng: -80.0, isOcean: false },
        { lat: 26, lng: -79.0, isOcean: false }
      ]
    };
    window.__MARINE_WIND_DATA__ = grid;

    // Click at lng = -79.4 + 360 = 280.6 (arbitrary wrapped longitude)
    const result = sampleFromMarineGrid(25.1, 280.6, 'GFS', 'waves');
    expect(result).not.toBeNull();
    expect(result.value).toBe(2.0); // snaps to nearest ocean (25, -79)
  });
});
