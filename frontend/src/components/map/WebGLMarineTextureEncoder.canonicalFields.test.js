import { encodeMarineTexture } from './WebGLMarineTextureEncoder';

/**
 * CANONICAL SYNTHETIC FIELDS — Gate 2 residue (audit 11.2 → 11.3 mission A).
 *
 * 11.2 certified Gate 2 CONDITIONAL PASS and named this exact hole: "synthetic canonical fields
 * (uniform E/W/N/S, vortex, checkerboard) remain absent, so row reversal / UV flip / handedness are
 * unverified IN EITHER DIRECTION." Real forecast data cannot settle orientation — a plausible-looking
 * swell field looks plausible mirrored. Only a field whose correct output is known in advance can.
 *
 * ═══ WHAT THIS HARNESS SETTLES ═══
 *   1. HANDEDNESS — the meteorological "direction FROM" convention survives encode with +u=east,
 *      +v=north (WebGLMarineTextureEncoder.js:190-194).
 *   2. INDEX ORDER — the encoder does not reverse rows or columns: grid cell i lands at texel i.
 *   3. FLIP-Y — every upload happens with UNPACK_FLIP_Y_WEBGL false, which the project's texture
 *      contract requires (CLAUDE.md architecture invariants).
 *
 * ⛔ ═══ WHAT THIS HARNESS DOES **NOT** SETTLE — DO NOT CITE IT FOR THESE ═══
 *   a. Whether the BACKEND's `vectors[0]` is the north-west or south-west corner. That is an
 *      upstream contract; this harness asserts only that the encoder passes it through unchanged.
 *   b. Whether the SHADER's v=0 samples the north or the south edge of `bounds`. That is decided in
 *      the vertex/fragment path, not here.
 *   Composing (a) + this + (b) is what actually proves the pixel on screen is at the right latitude.
 *   ★ A pass-through proof is not an end-to-end proof. Two flips still cancel.
 */

// RGBA packing (encoder lines 355-358): [u, v, height, period], u/v mapped n = (x+1)/2 then *255.
const U = 0, V = 1, H = 2;
const decodeSigned = (byte) => (byte / 255) * 2 - 1;

function makeRecordingGL() {
  let handle = 0;
  let bound = null;
  let flipY = false;
  const uploads = new Map();
  const gl = {
    TEXTURE_2D: 'TEXTURE_2D', RGBA: 'RGBA', UNSIGNED_BYTE: 'UNSIGNED_BYTE',
    LINEAR: 'LINEAR', NEAREST: 'NEAREST', CLAMP_TO_EDGE: 'CLAMP_TO_EDGE',
    TEXTURE_WRAP_S: 'WS', TEXTURE_WRAP_T: 'WT',
    TEXTURE_MIN_FILTER: 'MIN', TEXTURE_MAG_FILTER: 'MAG',
    TEXTURE_BINDING_2D: 'TEXTURE_BINDING_2D', UNPACK_FLIP_Y_WEBGL: 'UNPACK_FLIP_Y_WEBGL',
    getParameter: (p) => (p === 'TEXTURE_BINDING_2D' ? bound : p === 'UNPACK_FLIP_Y_WEBGL' ? flipY : null),
    createTexture: () => ({ __tex: ++handle }),
    deleteTexture: () => {},
    bindTexture: (_target, tex) => { bound = tex; },
    texParameteri: () => {},
    pixelStorei: (p, val) => { if (p === 'UNPACK_FLIP_Y_WEBGL') flipY = val; },
    texImage2D: (...a) => {
      // (target, level, internalFormat, width, height, border, format, type, data)
      if (a.length >= 9 && bound) {
        uploads.set(bound, {
          width: a[3], height: a[4],
          data: a[8] ? Uint8Array.from(a[8]) : null,
          flipYAtUpload: flipY
        });
      }
    },
    texSubImage2D: () => {}
  };
  return { gl, uploads };
}

// A uniform all-ocean grid carrying ONLY `direction` — u/v are left at 0 so the encoder's
// direction→vector conform branch is the code under test.
function uniformDirectionGrid(directionDeg, cols = 4, rows = 3) {
  const vectors = [];
  for (let i = 0; i < cols * rows; i++) {
    vectors.push({ direction: directionDeg, speed: 2, height: 2, period: 10, is_valid: true });
  }
  return {
    cols, rows, vectors,
    __componentLayer: 'waves', __sourceModel: 'GFS', hourOffset: 0, __renderable: true,
    coverage_scope: 'regional', productId: `canonical-${directionDeg}`,
    bounds: { west: -82, east: -79, south: 27, north: 29 }
  };
}

function encode(grid) {
  const { gl, uploads } = makeRecordingGL();
  const out = encodeMarineTexture(gl, grid, null, {}, undefined);
  expect(out).not.toBeNull();
  const wave = uploads.get(out.u_waveTexture);
  expect(wave).toBeDefined();
  expect(wave.data).not.toBeNull();
  return { out, wave, uploads };
}

const texel = (wave, index) => ({
  u: decodeSigned(wave.data[index * 4 + U]),
  v: decodeSigned(wave.data[index * 4 + V]),
  h: wave.data[index * 4 + H]
});

describe('canonical uniform fields — direction handedness survives encode', () => {
  // Meteorological convention: `direction` is where the swell comes FROM. A swell FROM the north
  // travels SOUTH, so the encoded flow vector must point south (-v).
  const CASES = [
    { name: 'FROM NORTH (0°) flows SOUTH', dir: 0, u: 0, v: -1 },
    { name: 'FROM EAST (90°) flows WEST', dir: 90, u: -1, v: 0 },
    { name: 'FROM SOUTH (180°) flows NORTH', dir: 180, u: 0, v: 1 },
    { name: 'FROM WEST (270°) flows EAST', dir: 270, u: 1, v: 0 }
  ];

  CASES.forEach(({ name, dir, u, v }) => {
    it(name, () => {
      const { wave } = encode(uniformDirectionGrid(dir));
      const t = texel(wave, 0);
      expect(t.u).toBeCloseTo(u, 1);
      expect(t.v).toBeCloseTo(v, 1);
    });
  });

  it('a uniform field is uniform across EVERY texel (no positional drift)', () => {
    const { wave } = encode(uniformDirectionGrid(270));
    const first = texel(wave, 0);
    for (let i = 1; i < 12; i++) {
      const t = texel(wave, i);
      expect(t.u).toBeCloseTo(first.u, 2);
      expect(t.v).toBeCloseTo(first.v, 2);
    }
  });

  it('the four cardinals are mutually distinct (a harness that cannot tell them apart proves nothing)', () => {
    const sigs = CASES.map(({ dir }) => {
      const { wave } = encode(uniformDirectionGrid(dir));
      const t = texel(wave, 0);
      return `${t.u.toFixed(2)},${t.v.toFixed(2)}`;
    });
    expect(new Set(sigs).size).toBe(4);
  });
});

describe('canonical hotspot — index order is preserved end to end through encode', () => {
  // One tall cell in a calm field. If the encoder reversed rows or columns, the tall texel would
  // land at the mirrored index — which is exactly the defect class this harness exists to exclude.
  const COLS = 4, ROWS = 3, HOT_ROW = 0, HOT_COL = 1;
  const HOT_INDEX = HOT_ROW * COLS + HOT_COL;

  function hotspotGrid() {
    const g = uniformDirectionGrid(270, COLS, ROWS);
    g.productId = 'canonical-hotspot';
    g.vectors = g.vectors.map((v, i) => ({ ...v, height: i === HOT_INDEX ? 9 : 1, speed: i === HOT_INDEX ? 9 : 1 }));
    return g;
  }

  it('the tall cell encodes at its own index, not the row-reversed one', () => {
    const { wave } = encode(hotspotGrid());
    const hot = texel(wave, HOT_INDEX).h;
    const rowReversedIndex = (ROWS - 1 - HOT_ROW) * COLS + HOT_COL;
    const colReversedIndex = HOT_ROW * COLS + (COLS - 1 - HOT_COL);

    expect(hot).toBeGreaterThan(texel(wave, rowReversedIndex).h);
    expect(hot).toBeGreaterThan(texel(wave, colReversedIndex).h);
  });

  it('the tall cell is the unique maximum (exactly one texel carries the hotspot)', () => {
    const { wave } = encode(hotspotGrid());
    const heights = [];
    for (let i = 0; i < COLS * ROWS; i++) heights.push(texel(wave, i).h);
    const max = Math.max(...heights);
    expect(heights.filter((h) => h === max)).toHaveLength(1);
    expect(heights.indexOf(max)).toBe(HOT_INDEX);
  });

  it('the texture is uploaded at grid dimensions (cols × rows, not transposed)', () => {
    const { wave } = encode(hotspotGrid());
    expect(wave.width).toBe(COLS);
    expect(wave.height).toBe(ROWS);
  });
});

describe('texture contract — UNPACK_FLIP_Y_WEBGL stays disabled', () => {
  it('every recorded upload happened with flipY false', () => {
    const { uploads } = encode(uniformDirectionGrid(90));
    expect(uploads.size).toBeGreaterThan(0);
    for (const [, up] of uploads) expect(up.flipYAtUpload).toBe(false);
  });
});
