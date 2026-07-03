/**
 * Direction-only dilation (land-aware seam coherence, 2026-07-03 — HANDOFF-2026-07-03 §0A):
 * the seam fade measures coherence as the bilinear |waveVec|, but the encoder wrote the zero vector
 * (0.5,0.5) for every no-direction texel (land / is_valid:false / beyond the extrapolation ring), so
 * the fade could not tell a divergent seam from proximity to land and culled a cell-width of ocean
 * beside every coastline. dilateDirectionField fills DIRECTION (unit u,v) from the nearest
 * direction-bearing cell into every zero-direction texel; height/period/mask are untouched.
 */
import { dilateDirectionField, encodeMarineTexture } from './WebGLMarineTextureEncoder';

const mag = (u, v) => Math.sqrt(u * u + v * v);

// Build u/v arrays from a rows×cols layout of [u, v] pairs (null = zero-direction texel).
function buildField(layout) {
  const rows = layout.length;
  const cols = layout[0].length;
  const uArr = new Float32Array(rows * cols);
  const vArr = new Float32Array(rows * cols);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cell = layout[r][c];
      if (cell) {
        uArr[r * cols + c] = cell[0];
        vArr[r * cols + c] = cell[1];
      }
    }
  }
  return { uArr, vArr, cols, rows };
}

describe('dilateDirectionField (land-aware direction fill)', () => {
  it('fills every zero-direction texel of a land-adjacent grid with a unit direction', () => {
    // Left half "land" (zero vectors), right half ocean flowing east — the coastline case that
    // produced the missing patches: the texel column beside the data must become direction-bearing.
    const E = [1, 0];
    const { uArr, vArr, cols, rows } = buildField([
      [null, null, null, E, E, E],
      [null, null, null, E, E, E],
      [null, null, null, E, E, E],
      [null, null, null, E, E, E],
    ]);
    const filled = dilateDirectionField(uArr, vArr, cols, rows, false);
    expect(filled).toBe(12);
    for (let i = 0; i < cols * rows; i++) {
      expect(mag(uArr[i], vArr[i])).toBeCloseTo(1.0, 5);
      expect(uArr[i]).toBeCloseTo(1.0, 5);
      expect(vArr[i]).toBeCloseTo(0.0, 5);
    }
  });

  it('never modifies source cells (raw magnitudes preserved exactly)', () => {
    const { uArr, vArr, cols, rows } = buildField([
      [null, [2.5, 0], null],
      [null, [0, -3.5], null],
    ]);
    dilateDirectionField(uArr, vArr, cols, rows, false);
    expect(uArr[1]).toBe(2.5);
    expect(vArr[1]).toBe(0);
    expect(uArr[4]).toBe(0);
    expect(vArr[4]).toBe(-3.5);
  });

  it('averages the (normalized) directions of multiple adjacent sources', () => {
    // Center texel sits between a north source and an east source; raw magnitudes differ wildly —
    // the fill must average unit directions, not raw vectors, or the 5x source would dominate.
    const { uArr, vArr, cols, rows } = buildField([
      [null, null, null],
      [[0, 5], null, [1, 0]],
      [null, null, null],
    ]);
    dilateDirectionField(uArr, vArr, cols, rows, false);
    const c = 1 * cols + 1;
    expect(uArr[c]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(vArr[c]).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('opposing sources that self-cancel fall back to one neighbor unit direction (never zero)', () => {
    // East meets west across a zero column — the vector average is (0,0), exactly the failure this
    // pass exists to remove. The fill must still be a unit vector (deterministic neighbor copy).
    const { uArr, vArr, cols, rows } = buildField([
      [[1, 0], null, [-1, 0]],
      [[1, 0], null, [-1, 0]],
    ]);
    const filled = dilateDirectionField(uArr, vArr, cols, rows, false);
    expect(filled).toBe(2);
    for (const idx of [1, cols + 1]) {
      expect(mag(uArr[idx], vArr[idx])).toBeCloseTo(1.0, 5);
    }
  });

  it('reaches texels arbitrarily far from data (full BFS, not a fixed ring)', () => {
    // Single source in one corner of a 10x8 grid: every texel must end up direction-bearing —
    // extrapolateOceanData's 2-ring is exactly what left far texels at zero before.
    const cols = 10, rows = 8;
    const uArr = new Float32Array(cols * rows);
    const vArr = new Float32Array(cols * rows);
    uArr[0] = 0.6;
    vArr[0] = 0.8;
    const filled = dilateDirectionField(uArr, vArr, cols, rows, false);
    expect(filled).toBe(cols * rows - 1);
    for (let i = 0; i < cols * rows; i++) {
      expect(mag(uArr[i], vArr[i])).toBeGreaterThan(0.999);
    }
  });

  it('honours the global column wrap (col 0 reads col N-1 as a neighbor)', () => {
    // c0 is zero; c1 flows east, c4 flows north. Non-global: only c1 is adjacent → fill = east.
    // Global: c4 is also adjacent via the wrap → fill = normalize(E + N).
    const layout = [
      [null, [1, 0], null, null, [0, 1]],
      [null, [1, 0], null, null, [0, 1]],
    ];
    const nonGlobal = buildField(layout);
    dilateDirectionField(nonGlobal.uArr, nonGlobal.vArr, nonGlobal.cols, nonGlobal.rows, false);
    expect(nonGlobal.uArr[0]).toBeCloseTo(1.0, 4);
    expect(nonGlobal.vArr[0]).toBeCloseTo(0.0, 4);

    const global = buildField(layout);
    dilateDirectionField(global.uArr, global.vArr, global.cols, global.rows, true);
    expect(global.uArr[0]).toBeCloseTo(Math.SQRT1_2, 4);
    expect(global.vArr[0]).toBeCloseTo(Math.SQRT1_2, 4);
  });

  it('terminates untouched on all-zero and all-source grids', () => {
    const zero = buildField([[null, null], [null, null]]);
    expect(dilateDirectionField(zero.uArr, zero.vArr, 2, 2, false)).toBe(0);
    expect(Array.from(zero.uArr)).toEqual([0, 0, 0, 0]);

    const full = buildField([[[1, 0], [0, 1]], [[-1, 0], [0, -1]]]);
    expect(dilateDirectionField(full.uArr, full.vArr, 2, 2, false)).toBe(0);
    expect(Array.from(full.uArr)).toEqual([1, 0, -1, 0]);
  });

  it('is direction-only by signature: takes no height/period/mask arrays', () => {
    // The contract that makes the fill safe: height stays 0 and the ocean mask still gates drawing,
    // so dilated land texels can never become renderable. Guard the arity so a future "helpful"
    // height fill can't sneak in through this function.
    expect(dilateDirectionField.length).toBeLessThanOrEqual(5);
  });
});

describe('encodeMarineTexture wiring', () => {
  it('does not synthesize direction from placeholder data on non-ocean cells', () => {
    // Coarse products mirror the v.waves sub-record to the top level WITHOUT is_valid, and land
    // arrives as {direction: 0, u: 0, v: 0} — synthesizing from that stamped a phantom due-south
    // vector on every landmass (a coastline-wide fake direction seam). The synthesis must be gated
    // on isOcean, and isOcean must consult the v.waves sub-record's is_valid for the waves layer.
    const src = encodeMarineTexture.toString();
    expect(src).toContain('waveSub.is_valid === false');
    expect(src).toMatch(/direction !== undefined && isOcean/);
    // The validity decision must come BEFORE the synthesis so the gate can use it.
    expect(src.indexOf('waveSub.is_valid === false')).toBeLessThan(src.indexOf('direction !== undefined && isOcean'));
  });

  it('runs the dilation after extrapolation, behind the __RAW_DISABLE_DIR_DILATION__ kill switch', () => {
    const src = encodeMarineTexture.toString();
    expect(src).toContain('__RAW_DISABLE_DIR_DILATION__');
    expect(src).toContain('__MARINE_DIR_DILATION__');
    const extrapolateIdx = src.indexOf('extrapolateOceanData(');
    const dilateIdx = src.indexOf('dilateDirectionField(');
    expect(extrapolateIdx).toBeGreaterThan(-1);
    expect(extrapolateIdx).toBeGreaterThan(-1);
    expect(dilateIdx).toBeGreaterThan(extrapolateIdx);
  });
});
