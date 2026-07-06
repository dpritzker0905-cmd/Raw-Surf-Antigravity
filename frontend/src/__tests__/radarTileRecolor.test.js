import { recolorRadarImageData } from '../components/map/radarTileRecolor';
import { radarForecastTileUrl } from '../components/map/radarForecastSources';

// HRRR forecast tiles are painted with pyiem's precip-type ramps (green rain); the past frames
// are RainViewer scheme 7 (alpha-graded pale blue). The recolor collapses every ptype ramp onto
// the shared dBZ axis and repaints with scheme 7 so the timeline reads as one product.

const px = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);

describe('recolorRadarImageData', () => {
  it('maps a rain-ramp color to the scheme-7 color of the SAME dBZ (index 16 = 40 dBZ: #ffe81a → #4f8fff)', () => {
    const d = px(255, 232, 26); // rain[16]
    expect(recolorRadarImageData(d)).toBe(1);
    expect([...d]).toEqual([0x4f, 0x8f, 0xff, 0xff]); // RV_SCHEME7[16]
  });

  it('snow and rain of equal dBZ converge to the same target (ptype collapsed to intensity)', () => {
    const rain = px(255, 232, 26);  // rain[16]
    const snow = px(0xc4, 0x16, 0x1c); // frzr[16]
    recolorRadarImageData(rain);
    recolorRadarImageData(snow);
    expect([...rain]).toEqual([...snow]);
  });

  it('low-dBZ pixels inherit scheme 7 alpha grading (index 0 = 0 dBZ → fully transparent)', () => {
    const d = px(0xee, 0xf8, 0xea); // rain[0]
    recolorRadarImageData(d);
    expect(d[3]).toBe(0); // #cfffff00 — the haze thresholds out like the past frames
  });

  it('unknown colors and transparent pixels pass through unchanged (fail-open)', () => {
    const unknown = px(1, 2, 3);
    expect(recolorRadarImageData(unknown)).toBe(0);
    expect([...unknown]).toEqual([1, 2, 3, 255]);
    const clear = px(90, 183, 105, 0); // a ramp color but already transparent
    expect(recolorRadarImageData(clear)).toBe(0);
    expect(clear[3]).toBe(0);
  });
});

describe('radarForecastTileUrl recolor wrapping', () => {
  const frame = { future: true, minutes: 10, time: 0, source: 'iem_hrrr', runMs: Date.UTC(2026, 6, 6, 20), f: 105 };

  it('run-pinned HRRR URLs ride the hrrr-rv:// protocol by default', () => {
    expect(radarForecastTileUrl(frame, {})).toMatch(/^hrrr-rv:\/\/https:\/\/mesonet/);
  });

  it('kill switch emits the plain https URL (protocol bypassed entirely)', () => {
    expect(radarForecastTileUrl(frame, { __RAW_RADAR_RECOLOR_DISABLED__: true })).toMatch(/^https:\/\/mesonet/);
  });
});
