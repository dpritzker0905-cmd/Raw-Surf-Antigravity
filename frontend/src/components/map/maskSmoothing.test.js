/**
 * Zoom-transition mask smoothness (2026-07-06, "bays flicker during rapid zoom"):
 *  - computePatchCarryRects: geo-exact transplant rects between two mask canvases
 *    (affine in Mercator-Y / longitude for non-antimeridian bounds);
 *  - applyPatchCarry: draws the retained truth box onto a rebuilt canvas, never throws;
 *  - desiredMaskRes: 50m↔10m swap hysteresis (enter z≥8, exit z<7.3).
 */
import {
  computePatchCarryRects,
  applyPatchCarry,
  desiredMaskRes,
  HIRES_MASK_ENTER_ZOOM,
  HIRES_MASK_EXIT_ZOOM,
} from './maskSmoothing';

// Independent Mercator-Y (same formula the mask renderer projects with).
const mercY = (lat) => {
  const l = Math.max(-85.051129, Math.min(85.051129, lat));
  const rad = (l * Math.PI) / 180;
  return (1.0 - Math.log(Math.tan(rad) + 1.0 / Math.cos(rad)) / Math.PI) / 2.0;
};
const rectFor = (box, bounds, w, h) => {
  const x0 = ((box.west - bounds.west) / (bounds.east - bounds.west)) * w;
  const x1 = ((box.east - bounds.west) / (bounds.east - bounds.west)) * w;
  const yTop = mercY(bounds.north);
  const ySpan = mercY(bounds.south) - yTop;
  return {
    x: x0,
    y: ((mercY(box.north) - yTop) / ySpan) * h,
    w: x1 - x0,
    h: ((mercY(box.south) - yTop) / ySpan) * h - ((mercY(box.north) - yTop) / ySpan) * h,
  };
};

const SOCAL = { west: -122, south: 31, east: -116, north: 36 };
const BOX = { west: -119, south: 33, east: -117.5, north: 34.2 };

describe('computePatchCarryRects', () => {
  it('is the identity when src and dst share bounds and size', () => {
    const r = computePatchCarryRects(BOX, SOCAL, 2048, 1024, SOCAL, 2048, 1024);
    expect(r).not.toBeNull();
    expect(r.sx).toBeCloseTo(r.dx, 6);
    expect(r.sy).toBeCloseTo(r.dy, 6);
    expect(r.sw).toBeCloseTo(r.dw, 6);
    expect(r.sh).toBeCloseTo(r.dh, 6);
    const expected = rectFor(BOX, SOCAL, 2048, 1024);
    expect(r.dx).toBeCloseTo(expected.x, 4);
    expect(r.dy).toBeCloseTo(expected.y, 4);
    expect(r.dw).toBeCloseTo(expected.w, 4);
    expect(r.dh).toBeCloseTo(expected.h, 4);
  });

  it('maps the truth box onto a WIDER destination (zoom-out residency swap)', () => {
    const mid = { west: -140, south: 20, east: -100, north: 45 };
    const r = computePatchCarryRects(BOX, SOCAL, 4096, 2048, mid, 2048, 1024);
    expect(r).not.toBeNull();
    const src = rectFor(BOX, SOCAL, 4096, 2048);
    const dst = rectFor(BOX, mid, 2048, 1024);
    expect(r.sx).toBeCloseTo(src.x, 4);
    expect(r.sw).toBeCloseTo(src.w, 4);
    expect(r.dx).toBeCloseTo(dst.x, 4);
    expect(r.dw).toBeCloseTo(dst.w, 4);
    expect(r.dy).toBeCloseTo(dst.y, 4);
    expect(r.dh).toBeCloseTo(dst.h, 4);
  });

  it('clips to the destination when zooming IN past the truth box', () => {
    const fine = { west: -118.5, south: 33.2, east: -117.8, north: 33.8 }; // inside BOX
    const r = computePatchCarryRects(BOX, SOCAL, 4096, 2048, fine, 4096, 2048);
    expect(r).not.toBeNull();
    // Clipped geo box == dst bounds → destination rect covers the full canvas.
    expect(r.dx).toBeCloseTo(0, 4);
    expect(r.dy).toBeCloseTo(0, 4);
    expect(r.dw).toBeCloseTo(4096, 4);
    expect(r.dh).toBeCloseTo(2048, 4);
    // Source rect is the sub-rect of BOX corresponding to `fine` on the src canvas.
    const src = rectFor(fine, SOCAL, 4096, 2048);
    expect(r.sx).toBeCloseTo(src.x, 4);
    expect(r.sw).toBeCloseTo(src.w, 4);
  });

  it('returns null when the truth box and destination do not overlap', () => {
    const elsewhere = { west: 10, south: 40, east: 20, north: 50 };
    expect(computePatchCarryRects(BOX, SOCAL, 2048, 1024, elsewhere, 2048, 1024)).toBeNull();
  });

  it('returns null for antimeridian-crossing or degenerate bounds', () => {
    const am = { west: 170, south: 20, east: -170, north: 40 }; // west > east
    expect(computePatchCarryRects(BOX, SOCAL, 2048, 1024, am, 2048, 1024)).toBeNull();
    expect(computePatchCarryRects(BOX, am, 2048, 1024, SOCAL, 2048, 1024)).toBeNull();
    const degenerate = { west: -118, south: 33, east: -118, north: 33 };
    expect(computePatchCarryRects(degenerate, SOCAL, 2048, 1024, SOCAL, 2048, 1024)).toBeNull();
  });

  it('returns null when the destination rect would be sub-8px (world-tier smear guard)', () => {
    const world = { west: -180, south: -80, east: 180, north: 85 };
    const tinyBox = { west: -118.05, south: 33.5, east: -118.0, north: 33.55 }; // ~0.05°
    // 0.05° of 360° on a 1024-wide world canvas ≈ 0.14 px — must be skipped.
    expect(computePatchCarryRects(tinyBox, SOCAL, 4096, 2048, world, 1024, 512)).toBeNull();
  });
});

describe('applyPatchCarry', () => {
  const patchState = (over = {}) => ({
    canvas: { width: 4096, height: 2048 },
    bounds: SOCAL,
    box: BOX,
    ...over,
  });

  it('draws the transplant with the exact computed rects', () => {
    const drawImage = jest.fn();
    const maskCanvas = { width: 2048, height: 1024, getContext: () => ({ drawImage }) };
    const ok = applyPatchCarry(maskCanvas, { west: -140, south: 20, east: -100, north: 45 }, patchState());
    expect(ok).toBe(true);
    expect(drawImage).toHaveBeenCalledTimes(1);
    const args = drawImage.mock.calls[0];
    expect(args[0]).toBe(patchState().canvas.constructor === Object ? args[0] : args[0]); // source object passed through
    expect(args).toHaveLength(9); // 9-arg sub-rect form
  });

  it('is a safe no-op without a retained patch, context, or overlap', () => {
    const maskCanvas = { width: 2048, height: 1024, getContext: () => ({ drawImage: jest.fn() }) };
    expect(applyPatchCarry(maskCanvas, SOCAL, null)).toBe(false);
    expect(applyPatchCarry(maskCanvas, SOCAL, patchState({ canvas: null }))).toBe(false);
    expect(applyPatchCarry({ width: 2048, height: 1024, getContext: () => null }, SOCAL, patchState())).toBe(false);
    const elsewhere = { west: 10, south: 40, east: 20, north: 50 };
    expect(applyPatchCarry(maskCanvas, elsewhere, patchState())).toBe(false);
  });

  it('never throws when drawImage fails', () => {
    const maskCanvas = {
      width: 2048, height: 1024,
      getContext: () => ({ drawImage: () => { throw new Error('boom'); } }),
    };
    expect(applyPatchCarry(maskCanvas, SOCAL, patchState())).toBe(false);
  });
});

describe('desiredMaskRes hysteresis', () => {
  it('enters hires at the enter threshold and not below it', () => {
    expect(desiredMaskRes(HIRES_MASK_ENTER_ZOOM, 'standard', true)).toBe('hires');
    expect(desiredMaskRes(7.9, 'standard', true)).toBe('standard');
  });

  it('holds hires inside the band and exits only below the exit threshold', () => {
    expect(desiredMaskRes(7.5, 'hires', true)).toBe('hires');   // in the band: no swap churn
    expect(desiredMaskRes(HIRES_MASK_EXIT_ZOOM, 'hires', true)).toBe('hires');
    expect(desiredMaskRes(7.29, 'hires', true)).toBe('standard');
  });

  it('is standard whenever hires is disallowed or zoom is invalid', () => {
    expect(desiredMaskRes(12, 'hires', false)).toBe('standard');
    expect(desiredMaskRes(NaN, 'standard', true)).toBe('standard');
    expect(desiredMaskRes(undefined, 'hires', true)).toBe('standard');
  });
});
