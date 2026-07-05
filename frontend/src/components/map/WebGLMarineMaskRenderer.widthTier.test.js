/**
 * Mask canvas width tiers (2026-07-05, "land coastline shows over the heatmap below ~z5.8"):
 * while the GLOBAL grid is resident the mask bounds span 360°, and the old 1024-px world tier
 * (~0.35°/px) made the mask edge retreat a visible grey band from every coastline (islands
 * ballooned into blobs); mid/fine residency uses the finer tiers, which is why zooming past ~z6
 * "corrected" it. Lock the ladder so a refactor can't quietly reintroduce the coarse world mask.
 */
import { maskCanvasWidthForSpan } from './WebGLMarineMaskRenderer';

afterEach(() => { delete window.__RAW_WORLD_MASK_WIDTH__; });

it('close-zoom tiles (<10°) use 4096', () => {
  expect(maskCanvasWidthForSpan(2)).toBe(4096);
  expect(maskCanvasWidthForSpan(9.9)).toBe(4096);
});

it('mid clips (10–30°) use 2048', () => {
  expect(maskCanvasWidthForSpan(10)).toBe(2048);
  expect(maskCanvasWidthForSpan(29.9)).toBe(2048);
});

it('WORLD spans use 4096 (the coastal-band fix) — never the legacy 1024', () => {
  expect(maskCanvasWidthForSpan(30)).toBe(4096);
  expect(maskCanvasWidthForSpan(360)).toBe(4096);
});

it('world tier honors the live override (legacy rollback lever)', () => {
  window.__RAW_WORLD_MASK_WIDTH__ = 1024;
  expect(maskCanvasWidthForSpan(360)).toBe(1024);
  expect(maskCanvasWidthForSpan(5)).toBe(4096); // override is world-tier only
});
