// ownRasterDecode (2026-11-15): the worker decoder equals the shared path (parseFrame + toField) value for value.
import { decodeFieldCore, decodeOwnField } from './ownRasterDecode';
import { parseFrame } from './staticFrameCodec';
import { MISSING, toField } from './ownRasterFrames';

// A minimal RSWF writer mirroring backend/services/frame_binary.encode_planes: header 72 B, a 24 B descriptor per field,
// then each plane (u16 byte-shuffled = every low byte, then every high byte).
function frameBytes({ cols, rows, fields, valid = Date.UTC(2026, 10, 15, 6) / 1000, run = Date.UTC(2026, 10, 15) / 1000 }) {
  const n = cols * rows;
  const planes = fields.map((f) => (f.nb === 1 ? n : 2 * n));
  const header = 72 + 24 * fields.length;
  const buf = new ArrayBuffer(header + planes.reduce((a, b) => a + b, 0));
  const dv = new DataView(buf); const u8 = new Uint8Array(buf);
  u8.set([82, 83, 87, 70], 0);
  dv.setUint16(4, 1, true); dv.setUint16(6, 1, true); dv.setUint16(8, cols, true); dv.setUint16(10, rows, true);
  dv.setUint32(12, fields.reduce((m, f) => m + 2 ** f.id, 0), true);
  dv.setUint8(16, 0); dv.setUint8(17, 0); dv.setUint8(18, fields.length); dv.setUint8(19, 1); dv.setUint32(20, header, true);
  [-180, -90, 179.75, 90].forEach((v, i) => dv.setFloat64(24 + 8 * i, v, true));
  dv.setFloat64(56, valid, true); dv.setFloat64(64, run, true);
  let pos = header;
  fields.forEach((f, i) => {
    const d = 72 + 24 * i;
    dv.setUint8(d, f.id); dv.setUint8(d + 1, f.nb); dv.setUint8(d + 2, f.nb === 2 ? 1 : 0);
    dv.setUint32(d + 4, f.missing, true); dv.setFloat64(d + 8, f.scale, true); dv.setFloat64(d + 16, f.offset, true);
    for (let k = 0; k < n; k++) {
      const c = f.codes[k];
      if (f.nb === 1) u8[pos + k] = c;
      else { u8[pos + k] = c & 0xff; u8[pos + n + k] = (c >> 8) & 0xff; }
    }
    pos += planes[i];
  });
  return buf;
}

const cols = 37; const rows = 11; const n = cols * rows;
const speed = { id: 4, nb: 2, missing: 0, scale: 0.01, offset: -0.01, codes: Array.from({ length: n }, (_, k) => (k % 13 === 0 ? 0 : 1 + ((k * 977) % 60000))) };
const direction = { id: 1, nb: 2, missing: 0xFFFFFFFF, scale: 0.01, offset: 0, codes: Array.from({ length: n }, (_, k) => (k * 331) % 36000) };
const cloud = { id: 8, nb: 1, missing: 0, scale: 1, offset: -1, codes: Array.from({ length: n }, (_, k) => (k % 7 === 0 ? 0 : 1 + (k % 101))) };

afterEach(() => { delete window.__RAW_DISABLE_RASTER_DECODE_WORKER__; });

test.each([
  ['the gust / speed field (u16, code 0 = no data)', [speed], 4],
  ['currents: speed out of a two-field frame', [direction, speed], 4],
  ['currents: the direction field (no missing code)', [direction, speed], 1],
  ['a u8 field (cloud %)', [cloud], 8],
])('%s: the worker decoder equals parseFrame + toField', (_name, fields, fid) => {
  const buf = frameBytes({ cols, rows, fields });
  const want = toField(parseFrame(buf.slice(0)), fid);
  const got = decodeFieldCore(buf.slice(0), fid, MISSING);
  expect([got.cols, got.rows, got.bounds, got.validMs, got.runMs]).toEqual([want.cols, want.rows, want.bounds, want.validMs, want.runMs]);
  expect(got.values).toEqual(want.values);
  expect([got.min, got.max]).toEqual([want.min, want.max]);
});

test('a frame without the asked field resolves null; a bad frame rejects', async () => {
  const buf = frameBytes({ cols, rows, fields: [speed] });
  expect(decodeFieldCore(buf, 7, MISSING)).toBeNull();
  const bad = new ArrayBuffer(100);
  expect(() => decodeFieldCore(bad, 4, MISSING)).toThrow(/bad magic/);
  await expect(decodeOwnField(new ArrayBuffer(100), 4, MISSING)).rejects.toThrow(/bad magic/);
});

test('without a Worker (and under its kill) the same function runs on the main thread', async () => {
  const buf = frameBytes({ cols, rows, fields: [direction, speed] });
  const ref = decodeFieldCore(buf.slice(0), 4, MISSING);
  const a = await decodeOwnField(buf.slice(0), 4, MISSING);
  expect(a.offThread).toBe(false);   // jsdom has no Worker
  expect(a.values).toEqual(ref.values);
  window.__RAW_DISABLE_RASTER_DECODE_WORKER__ = true;
  const b = await decodeOwnField(buf.slice(0), 4, MISSING);
  expect(b.offThread).toBe(false);
  expect(b.values).toEqual(ref.values);
});

// CURRENTS PARTICLES (2026-11-22): the flow direction decodes beside the speed, as one byte a cell, from the one-byte field 14
// (the publisher's FLOW_DIR_BYTE) or the two-byte frames' field 1; both decode paths agree; a frame without it has none.
describe('the flow direction beside the drawn field', () => {
  const band = { id: 13, nb: 1, missing: 0, scale: 0.02, offset: -0.01, codes: Array.from({ length: n }, (_, k) => (k % 9 === 0 ? 0 : 1 + (k % 200))) };
  const dirByte = { id: 14, nb: 1, missing: 0xFFFFFFFF, scale: 360 / 256, offset: 0, codes: Array.from({ length: n }, (_, k) => (k * 7) % 256) };

  test('the one-byte field: codes kept exactly, worker path = shared path', async () => {
    const buf = frameBytes({ cols, rows, fields: [band, dirByte] });
    const got = decodeFieldCore(buf.slice(0), [13, 4], MISSING, [14, 1]);
    expect(Array.from(got.dirCodes)).toEqual(dirByte.codes);
    const shared = toField(parseFrame(buf.slice(0)), [13, 4], [14, 1]);
    expect(Array.from(shared.dirCodes)).toEqual(dirByte.codes);
    expect(Array.from(got.values)).toEqual(Array.from(shared.values));
    const viaApi = await decodeOwnField(buf.slice(0), [13, 4], MISSING, [14, 1]);
    expect(Array.from(viaApi.dirCodes)).toEqual(dirByte.codes);
  });

  test('the two-byte field 1 (decoded before the speed in its frame) rounds to the same byte', () => {
    const buf = frameBytes({ cols, rows, fields: [direction, speed] });
    const got = decodeFieldCore(buf.slice(0), [13, 4], MISSING, [14, 1]);
    const want = direction.codes.map((c) => Math.round((c * 0.01) * 256 / 360) % 256);
    expect(Array.from(got.dirCodes)).toEqual(want);
    expect(got.fieldId).toBe(4);
  });

  test('no direction asked or none in the frame: no dirCodes, the field as before', () => {
    const buf = frameBytes({ cols, rows, fields: [band] });
    expect(decodeFieldCore(buf.slice(0), [13, 4], MISSING, [14, 1]).dirCodes).toBeUndefined();
    const two = frameBytes({ cols, rows, fields: [band, dirByte] });
    expect(decodeFieldCore(two.slice(0), [13, 4], MISSING).dirCodes).toBeUndefined();
  });
});
