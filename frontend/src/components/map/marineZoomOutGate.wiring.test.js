/**
 * C4-MR-15 — the gate is WIRED, and wiring it changed nothing.
 *
 * ⛔ WHY. PR #7 landed `marineZoomOutGate.js` with ZERO importers. Its own header called itself
 * "a specification with a test, not the live code path" and warned the two could drift silently.
 * They already had: `e17f0332` (2026-08-15) added the coarse-bridge grace to the layer, nine days
 * after the module froze branch 1 at a flat 0.0. Wiring the module AS WRITTEN would have reverted
 * that grace — a behaviour regression delivered by a "no-op refactor".
 *
 * So this file proves two things that a passing render says nothing about:
 *   1. EQUIVALENCE — the module reproduces the retired inline logic exactly, across the input grid.
 *   2. WIRING — the layer actually imports and calls it, so the extraction cannot silently rot back
 *      into a second copy.
 */
import { resolveRejectedOpacity } from './marineZoomOutGate';

const fs = require('fs');
const path = require('path');

// The RETIRED inline logic, transcribed verbatim from WebGLMarineCustomLayer before this change
// (branches 2-4; branch 1 is the impure grace and stays in the layer). This is the oracle.
function legacyInline({ isViewportZoomedOut, isGridRegional, hasCoarseBridge, isZoomingOrMoving,
  currentZoom, overlapRatio }) {
  if (isViewportZoomedOut && isGridRegional && hasCoarseBridge) return { kind: 'bridge' };
  if (!isZoomingOrMoving) return { kind: 'bail' };
  if (isViewportZoomedOut && isGridRegional) return { kind: 'opacity', opacity: 0.0 };
  let zoomFade = 1.0;
  if (currentZoom <= 6.5) zoomFade = Math.max(0.0, Math.min(1.0, (currentZoom - 5.5) / (6.5 - 5.5)));
  let overlapFade = 1.0;
  if (overlapRatio < 0.15) overlapFade = Math.max(0.0, Math.min(1.0, (overlapRatio - 0.05) / (0.15 - 0.05)));
  return { kind: 'opacity', opacity: Math.min(zoomFade, overlapFade) };
}

// How the LAYER now consumes the module — mirrors the wired call site exactly.
const viaModule = (s) => {
  const r = resolveRejectedOpacity(s);
  if (r.bail) return { kind: 'bail' };
  if (r.coarseBridge) return { kind: 'bridge' };
  return { kind: 'opacity', opacity: r.opacity };
};

describe('C4-MR-15 — module and retired inline logic agree on every input', () => {
  // Zoom values chosen to straddle every threshold in the arithmetic: below 5.5, the 5.5-6.5 ramp,
  // and above 6.5. Overlap likewise straddles 0.05 / 0.15 and the measured 0.6 cover-frac.
  const ZOOMS = [4.625, 4.805, 4.985, 5.5, 5.9, 6.0, 6.5, 7.2, 12.0];
  const OVERLAPS = [0, 0.04, 0.05, 0.1, 0.15, 0.3, 0.604, 0.9, 1];
  const BOOLS = [false, true];

  it('exhaustive grid: identical verdict and identical opacity', () => {
    let n = 0;
    for (const isViewportZoomedOut of BOOLS) {
      for (const isGridRegional of BOOLS) {
        for (const hasCoarseBridge of BOOLS) {
          for (const isZoomingOrMoving of BOOLS) {
            for (const currentZoom of ZOOMS) {
              for (const overlapRatio of OVERLAPS) {
                const s = { isViewportZoomedOut, isGridRegional, hasCoarseBridge,
                  isZoomingOrMoving, currentZoom, overlapRatio };
                expect({ input: s, out: viaModule(s) }).toEqual({ input: s, out: legacyInline(s) });
                n++;
              }
            }
          }
        }
      }
    }
    expect(n).toBe(BOOLS.length ** 4 * ZOOMS.length * OVERLAPS.length); // 16 * 9 * 9 = 1296
  });

  // NON-VACUITY — the oracle must actually exercise all four branches, or "identical" is empty.
  it('the grid reaches every branch (bridge, bail, blank-0, and a FRACTIONAL fade)', () => {
    const kinds = new Set();
    let sawFractional = false;
    for (const zo of BOOLS) for (const gr of BOOLS) for (const cb of BOOLS) for (const zm of BOOLS) {
      for (const currentZoom of ZOOMS) for (const overlapRatio of OVERLAPS) {
        const r = legacyInline({ isViewportZoomedOut: zo, isGridRegional: gr, hasCoarseBridge: cb,
          isZoomingOrMoving: zm, currentZoom, overlapRatio });
        kinds.add(r.kind);
        if (r.kind === 'opacity' && r.opacity > 0 && r.opacity < 1) sawFractional = true;
      }
    }
    expect([...kinds].sort()).toEqual(['bail', 'bridge', 'opacity']);
    expect(sawFractional).toBe(true);   // the fade ramp is genuinely exercised, not just 0 and 1
  });
});

describe('C4-MR-15 — the layer actually calls the module (extraction cannot rot back)', () => {
  const layerSrc = fs.readFileSync(path.join(__dirname, 'WebGLMarineCustomLayer.js'), 'utf8');

  it('imports resolveRejectedOpacity from marineZoomOutGate', () => {
    expect(layerSrc).toMatch(/import\s*\{[^}]*resolveRejectedOpacity[^}]*\}\s*from\s*'\.\/marineZoomOutGate'/);
  });

  it('calls it, and consumes both bail and coarseBridge', () => {
    expect(layerSrc).toMatch(/resolveRejectedOpacity\(\s*\{/);
    expect(layerSrc).toContain('.bail');
    expect(layerSrc).toContain('.coarseBridge');
  });

  it('the retired inline arithmetic is GONE from the layer (no second copy)', () => {
    // ⚠️ SCOPED DELIBERATELY. My first draft also forbade the bare zoom ramp
    // `(currentZoom - 5.5) / (6.5 - 5.5)` and went red — correctly, but for the wrong subject: that
    // ramp ALSO appears in the NON-rejected path (the `shouldReject === false` branch), which is a
    // different decision with no overlap term and is not what C4-MR-15 retired. Forbidding it there
    // would have made this test a tripwire on unrelated code.
    // The retired block's distinctive signature is the overlap fade and the PAIRING of the two.
    expect(layerSrc).not.toMatch(/overlapRatio\s*-\s*0\.05\)\s*\/\s*\(0\.15\s*-\s*0\.05\)/);
    expect(layerSrc).not.toMatch(/Math\.min\(\s*zoomFade\s*,\s*overlapFade\s*\)/);
    expect(layerSrc).not.toContain('let overlapFade');
  });
});
