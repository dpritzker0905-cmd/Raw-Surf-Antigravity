/**
 * The 0.125-degree frame (2880 x 1441) through the client's own path (G2, #956; registered before any upload: "the frame encoder
 * and the client's frame decoder must take (1441, 2880), with a test"). A real backend-encoded frame -> parseFrame (the static
 * frame codec) -> toField (what the raster layer uploads) -> wrapsLongitude (the shader's column wrap at the antimeridian).
 */
import zlib from 'zlib';
import { parseFrame } from './staticFrameCodec';
import { toField, MISSING } from './ownRasterFrames';
import { wrapsLongitude } from './ownRasterLayer';
import { FRAME_0P125_GZ_B64 } from './ownRasterGrid0p125.fixture';

const PRECIP = 10;
const raw = () => zlib.gunzipSync(Buffer.from(FRAME_0P125_GZ_B64, 'base64'));

describe('a 0.125-degree raster frame (2880 x 1441) on the client', () => {
  test('the codec reads the full grid and its bounds', () => {
    const p = parseFrame(raw());
    expect([p.cols, p.rows]).toEqual([2880, 1441]);
    expect(p.bounds).toEqual({ west: -180, south: -90, east: 179.875, north: 90 });
    expect(p.fields[PRECIP]).toHaveLength(2880 * 1441);
  });

  test('values land at their nodes, row 0 = south and column 0 = west, including the 179.875E column', () => {
    const f = toField(parseFrame(raw()), PRECIP);
    const at = (r, c) => f.values[r * f.cols + c];
    expect(at(720, 1440)).toBeCloseTo(12.34, 2);
    expect(at(0, 0)).toBeCloseTo(1.5, 2);
    expect(at(1440, 2879)).toBeCloseTo(7.77, 2);
    expect(at(1000, 100)).toBe(MISSING);
    expect(at(720, 1441)).toBe(0);
    expect(f.max).toBeCloseTo(12.34, 2);
  });

  test('the grid is a full circle, so the shader wraps its columns at the antimeridian', () => {
    const f = toField(parseFrame(raw()), PRECIP);
    expect(wrapsLongitude(f)).toBe(true);
  });
});
