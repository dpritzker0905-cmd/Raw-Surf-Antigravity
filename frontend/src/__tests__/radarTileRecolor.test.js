import { recolorRadarImageData, whitenLightningImageData, extractLightningStrikes } from '../components/map/radarTileRecolor';
import { radarForecastTileUrl, radarLightningTileUrl } from '../components/map/radarForecastSources';

// HRRR forecast tiles are painted with pyiem's precip-type ramps (green rain); the past frames
// are RainViewer scheme 7 (alpha-graded pale blue). The recolor collapses every ptype ramp onto
// the shared dBZ axis and repaints with scheme 7 so the timeline reads as one product.

const px = (r, g, b, a = 255) => new Uint8ClampedArray([r, g, b, a]);

// ⚠️ The LUT targets are OBSERVED tile colors (sampled live from tilecache …/7/1_0.png over an
// active storm) — NOT the color-schemes documentation page, which renders differently (two
// doc-derived palettes failed the eyeball; see RV_SCHEME7's note). Blue→cyan = light precip
// ("cloud cover"), yellow→amber→red = cores.
describe('recolorRadarImageData', () => {
  it('maps a rain-ramp color to the OBSERVED scheme-7 color of the SAME dBZ (index 16 = 40 dBZ → light cyan #6cd1eb)', () => {
    const d = px(255, 232, 26); // rain[16]
    expect(recolorRadarImageData(d)).toBe(1);
    expect([...d]).toEqual([0x6c, 0xd1, 0xeb, 0xff]);
  });

  it('extreme reflectivity renders red (index 21 = 52.5+ dBZ → #e30b0f) and 45 dBZ renders amber-yellow', () => {
    const d = px(0xff, 0xa0, 0x00); // rain[21]
    recolorRadarImageData(d);
    expect([...d]).toEqual([0xe3, 0x0b, 0x0f, 0xff]);
    const mid = px(255, 197, 5);    // rain[18] = 45 dBZ
    recolorRadarImageData(mid);
    expect([...mid]).toEqual([0xff, 0xd2, 0x00, 0xff]);
  });

  it('snow and rain of equal dBZ converge to the same target (ptype collapsed to intensity)', () => {
    const rain = px(255, 232, 26);  // rain[16]
    const snow = px(0xc4, 0x16, 0x1c); // frzr[16]
    recolorRadarImageData(rain);
    recolorRadarImageData(snow);
    expect([...rain]).toEqual([...snow]);
  });

  it('low-dBZ pixels render the OPAQUE dark-blue "cloud cover" the past frames actually show (doc palettes made them invisible — user-caught twice)', () => {
    const d = px(0xee, 0xf8, 0xea); // rain[0] = 0 dBZ
    recolorRadarImageData(d);
    expect([...d]).toEqual([0x00, 0x47, 0x68, 0xff]); // darkest observed blue, full alpha
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

describe('whitenLightningImageData — strikes flash white, not heatmap colors', () => {
  it('every detected pixel becomes hot white; density ranks the alpha (pale yellow dim, red core bright)', () => {
    const low = px(255, 255, 204);  // pale yellow = low density
    const high = px(255, 0, 0);     // red = high density
    whitenLightningImageData(low);
    whitenLightningImageData(high);
    expect([low[0], low[1], low[2]]).toEqual([255, 255, 240]);
    expect([high[0], high[1], high[2]]).toEqual([255, 255, 240]);
    expect(high[3]).toBeGreaterThan(low[3]); // core pops brighter
    expect(low[3]).toBeGreaterThanOrEqual(140);
  });

  it('transparent pixels stay transparent', () => {
    const clear = px(255, 0, 0, 0);
    expect(whitenLightningImageData(clear)).toBe(0);
    expect(clear[3]).toBe(0);
  });
});

describe('extractLightningStrikes — density cores become geo-points for the flash renderer', () => {
  // 32×32 synthetic tile over a known mercator bbox: one red core (high density), one pale
  // yellow fringe pixel (below the core threshold), rest transparent.
  const W = 32, H = 32;
  const bbox = [-9000000, 3000000, -8900000, 3100000]; // 100km square, EPSG:3857
  const makeTile = () => {
    const d = new Uint8ClampedArray(W * H * 4);
    const put = (x, y, r, g, b) => { const i = (y * W + x) * 4; d[i] = r; d[i+1] = g; d[i+2] = b; d[i+3] = 255; };
    put(16, 16, 255, 0, 0);       // red core → intensity 0.8
    put(4, 4, 255, 255, 204);     // pale yellow fringe → 0.25, below the 0.45 core threshold
    return d;
  };

  it('extracts the core as a lng/lat point inside the bbox; fringe pixels are ignored', () => {
    const pts = extractLightningStrikes(makeTile(), W, H, bbox);
    expect(pts.length).toBe(1);
    expect(pts[0].intensity).toBeCloseTo(0.8, 5);
    // Center-ish of the bbox: lng ≈ merc x / R × 180
    expect(pts[0].lng).toBeGreaterThan(-81); expect(pts[0].lng).toBeLessThan(-79);
    expect(pts[0].lat).toBeGreaterThan(25); expect(pts[0].lat).toBeLessThan(27);
  });

  it('grid-binning declusters: a 3×3 red blob inside one 16px bin yields ONE point; empty tiles yield none', () => {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) { const i = (y * W + x) * 4; d[i] = 255; d[i+3] = 255; }
    expect(extractLightningStrikes(d, W, H, bbox).length).toBe(1);
    expect(extractLightningStrikes(new Uint8ClampedArray(W * H * 4), W, H, bbox)).toEqual([]);
  });
});

describe('radarLightningTileUrl flash-recolor wrapping', () => {
  const frame = { time: Math.floor(Date.UTC(2026, 6, 7, 0, 30) / 1000), path: '/v2/radar/x' };
  it('past frames ride ltg-flash:// by default; recolor kill emits plain https', () => {
    expect(radarLightningTileUrl(frame, {})).toMatch(/^ltg-flash:\/\/https:\/\/nowcoast/);
    expect(radarLightningTileUrl(frame, { __RAW_RADAR_RECOLOR_DISABLED__: true })).toMatch(/^https:\/\/nowcoast/);
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
