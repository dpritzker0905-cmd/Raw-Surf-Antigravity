// One-byte BAND fields (2026-11-16, lever A of #928; backend frame_binary.BAND_FIELDS, log sections 12 / 12b).
import { decodeFieldCore } from './ownRasterDecode';
import { CURRENT_BAND_FIELD, GUST_BAND_FIELD, MISSING, OWN_RASTER_SETS, SPEED_FIELD } from './ownRasterFrames';
import { GUST_LUT, gustScale } from './gustPalette';
import { CURRENTS_LUT, currentsScale } from './currentsPalette';
import { buildStepLut } from './ownRasterLayer';

// The publisher's rule (frame_binary.encode_planes, band fields): k = floor(v / step + 1e-3) + 1, 255 = saturated; decode =
// (k - 1) x step + step / 2 through the generic descriptor (scale = step, offset = -step / 2).
const encode = (v, step) => Math.min(Math.floor(v / step + 1e-3) + 1, 255);
const decode = (k, step) => k * step - step / 2;
// The client shader's LUT index (ownRasterLayer.js): clamp(floor((v - min) / step + 1e-3), 0, n - 1).
const lutIndex = (v, lut) => Math.min(Math.max(Math.floor((v - lut.min) / lut.step + 1e-3), 0), lut.n - 1);

function frame(cols, rows, fields) {   // a minimal RSWF writer (frame_binary layout)
  const n = cols * rows; const header = 72 + 24 * fields.length;
  const buf = new ArrayBuffer(header + fields.reduce((a, f) => a + n * f.nb, 0));
  const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  u8.set([82, 83, 87, 70], 0); dv.setUint16(4, 1, true); dv.setUint16(6, 1, true); dv.setUint16(8, cols, true); dv.setUint16(10, rows, true);
  dv.setUint8(18, fields.length); dv.setUint32(20, header, true); [0, 0, 1, 1].forEach((v, i) => dv.setFloat64(24 + 8 * i, v, true));
  dv.setFloat64(56, 1763251200, true); dv.setFloat64(64, 1763251200, true);
  let pos = header;
  fields.forEach((f, i) => {
    const d = 72 + 24 * i;
    dv.setUint8(d, f.id); dv.setUint8(d + 1, f.nb); dv.setUint8(d + 2, f.nb === 2 ? 1 : 0); dv.setUint32(d + 4, 0, true);
    dv.setFloat64(d + 8, f.scale, true); dv.setFloat64(d + 16, f.offset, true);
    f.codes.forEach((c, k) => { if (f.nb === 1) u8[pos + k] = c; else { u8[pos + k] = c % 256; u8[pos + n + k] = Math.floor(c / 256); } });
    pos += n * f.nb;
  });
  return buf;
}

test('the layers prefer the band field and still read field 4 (frames published before the change)', () => {
  expect(OWN_RASTER_SETS.gusts.field).toEqual([GUST_BAND_FIELD, SPEED_FIELD]);
  expect(OWN_RASTER_SETS.currents.field).toEqual([CURRENT_BAND_FIELD, SPEED_FIELD]);
  const band = { id: 12, nb: 1, scale: 0.5, offset: -0.25, codes: [0, 1, 61, 255] };
  const old = { id: 4, nb: 2, scale: 0.01, offset: -0.01, codes: [0, 1, 3001, 9001] };
  const both = decodeFieldCore(frame(4, 1, [old, band]), OWN_RASTER_SETS.gusts.field, MISSING);
  expect(both.fieldId).toBe(12);
  expect(Array.from(both.values)).toEqual([MISSING, 0.25, 30.25, 127.25]);   // no data, the first band, 30 kn's band, saturated
  const legacy = decodeFieldCore(frame(4, 1, [old]), OWN_RASTER_SETS.gusts.field, MISSING);
  expect(legacy.fieldId).toBe(4);
  expect(Array.from(legacy.values)).toEqual([MISSING, 0, 30, 90]);
});

// THE PALETTE CLAIM, exactly: every cell draws the palette entry of its SOURCE value (byte for byte). Today's two-byte frames
// round to 0.01 kn first, so a source value within 0.005 kn under a band edge was drawn one band up; those cells now draw their
// true band. On real frames that difference is measured and reported (log section 12c), not hidden here.
test.each(['light', 'dark', 'beach'])("%s: every cell draws its SOURCE value's palette entry, byte for byte (both layers)", (theme) => {
  for (const [scale, lut, step, top] of [[gustScale(theme), GUST_LUT, 0.5, 80], [currentsScale(theme), CURRENTS_LUT, 0.02, 4.5]]) {
    const bytes = buildStepLut(scale, lut);
    for (let v = 0; v <= top; v += step / 37) {
      const before = lutIndex(v, lut);                        // the source value's palette entry
      const after = lutIndex(decode(encode(v, step), step), lut);
      if (before !== after) throw new Error(`${theme} ${step}: v ${v} drew LUT ${before}, now ${after}`);
      expect(bytes.slice(after * 4, after * 4 + 4)).toEqual(bytes.slice(before * 4, before * 4 + 4));
    }
  }
});
