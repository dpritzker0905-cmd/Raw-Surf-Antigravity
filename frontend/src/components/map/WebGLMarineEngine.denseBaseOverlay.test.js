import { computeWideOverlayMode } from './WebGLMarineEngine';

// Regression guard for the 2026-07-15 continent crest land-bleed on zoom-out (GPU-probed live):
// at a world-grid resident the overlay's water-flooded padded RING must NOT REPLACE a correct dense
// global base — it must min()-COMBINE so the base wins over land while the overlay still refines
// islands/sheltered water inside its truth box. See computeWideOverlayMode + the DENSE-GLOBAL-BASE
// note in WebGLMarineEngine.js. base-values recap from the live probe that pinned the root:
//   Ohio: base=0 (land)  overlay=255 (flooded)  → REPLACE=255 BLEED, min(0,255)=0 clean.

// A world grid (span 360°) resident over a global viewport with a fresh dense global base mask
// (4096 wide, global bounds) that covers the view — the exact zoom-out settle state that bled.
const worldGridDenseBase = (over = {}) => ({
  gwSpan: 360, mbCov: true, covReplaceOff: false,
  baseTexIsCached: true, cachedSpan: 360, cachedTexWidth: 4096, killed: false, ...over,
});

describe('computeWideOverlayMode — dense-global-base → refine-not-replace', () => {
  it('REFINES (min-combine, not replace) when a dense global base covers the world view', () => {
    const r = computeWideOverlayMode(worldGridDenseBase());
    expect(r.baseGlobalDense).toBe(true);
    expect(r.rawWideTrigger).toBe(true); // overlay stays ACTIVE (so islands still refine)
    expect(r.replace).toBe(false);       // but as min-combine — the flooded ring can't override base
  });

  it('KILL SWITCH restores the old unconditional world-grid REPLACE', () => {
    const r = computeWideOverlayMode(worldGridDenseBase({ killed: true }));
    expect(r.baseGlobalDense).toBe(false);
    expect(r.replace).toBe(true); // the pre-fix behavior that bled
  });

  it('still REPLACES when the base does NOT cover the viewport (small/regional base — overlay is the only viewport truth)', () => {
    const r = computeWideOverlayMode(worldGridDenseBase({ mbCov: false }));
    expect(r.baseGlobalDense).toBe(false); // needs mbCov
    expect(r.rawWideTrigger).toBe(true);   // gwSpan>=340
    expect(r.replace).toBe(true);
  });

  it('still REPLACES when the resident base is NOT the cached global mask (fallback grid mask)', () => {
    const r = computeWideOverlayMode(worldGridDenseBase({ baseTexIsCached: false }));
    expect(r.baseGlobalDense).toBe(false);
    expect(r.replace).toBe(true);
  });

  it('still REPLACES when the cached base is a dense REGIONAL mask (not global span) at a wide view', () => {
    // e.g. a retained 4096 regional FL mask (span ~1°) under a world grid — cannot carve continents,
    // so the overlay must still REPLACE (this is not the dense-global authoritative case).
    const r = computeWideOverlayMode(worldGridDenseBase({ cachedSpan: 1 }));
    expect(r.baseGlobalDense).toBe(false);
    expect(r.replace).toBe(true);
  });

  it('still REPLACES when the cached global base is too coarse (<4096, cannot carve continents crisply)', () => {
    const r = computeWideOverlayMode(worldGridDenseBase({ cachedTexWidth: 2048 }));
    expect(r.baseGlobalDense).toBe(false);
    expect(r.replace).toBe(true);
  });

  it('does NOT fire the wide trigger for a covered REGIONAL grid (deep-zoom min-combine path untouched)', () => {
    // Regional grid (span 3°), base covers, not a world grid — rawWideTrigger false, so overlayOn is
    // driven by the deep-zoom clause at the call site, and replace stays false regardless.
    const r = computeWideOverlayMode({
      gwSpan: 3, mbCov: true, covReplaceOff: false,
      baseTexIsCached: true, cachedSpan: 3, cachedTexWidth: 2048, killed: false,
    });
    expect(r.rawWideTrigger).toBe(false);
    expect(r.replace).toBe(false);
    expect(r.baseGlobalDense).toBe(false); // cachedSpan<340
  });

  it('REPLACES for a mid grid that does NOT cover the viewport even below the world-grid span (coverage-gap path)', () => {
    const r = computeWideOverlayMode({
      gwSpan: 16, mbCov: false, covReplaceOff: false,
      baseTexIsCached: true, cachedSpan: 16, cachedTexWidth: 2048, killed: false,
    });
    expect(r.rawWideTrigger).toBe(true); // !mbCov
    expect(r.replace).toBe(true);
    expect(r.baseGlobalDense).toBe(false);
  });
});
