import fs from 'fs';
import path from 'path';
import { maskAwaitsPatch, unpatchedMaskHold, HOLD_MS } from './marineUnpatchedMaskHold';
import { stampMaskPatch } from './maskPatchKeep';

// Owner report 2026-11-08: ICON wind waves on the Florida east coast (21x25 grid, -84..-79 lon, 24..30 lat) bleed into the Indian River
// Lagoon / Banana River / Mosquito Lagoon / ICW, then "correct themselves". The lagoon exclusion (basemap water + inland guard + sheltered
// verdict) is painted onto the mask AFTER the encoder builds it from Natural Earth land only, and that paint is async and tile-gated.
// Until it lands the heatmap samples an NE-only mask, in which every lagoon is open water. These tests pin that the heatmap is not drawn
// through such a mask (and is again the moment the paint lands, or the bounded hold runs out).
// Kill switch: window.__RAW_DISABLE_UNPATCHED_MASK_HOLD__ (see killSwitch.inventory.test.js).

const FL = { west: -84, south: 24, east: -79, north: 30 };
const frame = (over = {}) => {
  const tex = over.tex || {};
  return { tex, cachedTex: tex, bounds: FL, z: 9, overlayOn: false, nowMs: 1000, win: {}, ...over };
};

describe('unpatchedMaskHold — no NE-only mask through the lagoons', () => {
  it('REPRODUCTION: a freshly rebuilt Florida mask with no basemap-water paint withholds the heatmap', () => {
    const e = {};
    const f = frame();
    expect(unpatchedMaskHold(e, f)).toBe(0);
    expect(unpatchedMaskHold(e, { ...f, nowMs: 1000 + HOLD_MS - 1 })).toBe(0);
  });

  it('draws as soon as the basemap-water paint stamps the mask texture', () => {
    const e = {};
    const f = frame();
    expect(unpatchedMaskHold(e, f)).toBe(0);
    stampMaskPatch(f.tex, { gridKey: 'k', box: FL, degraded: false, z: 9 });   // what refreshMaskWithBasemapWater does after the paint
    expect(unpatchedMaskHold(e, { ...f, nowMs: 1100 })).toBe(1);
    expect(e._maskHold).toBeNull();
  });

  it('fails open after the bounded hold (a source that never becomes queryable must not blank the sea)', () => {
    const e = {};
    const f = frame();
    expect(unpatchedMaskHold(e, f)).toBe(0);
    expect(unpatchedMaskHold(e, { ...f, nowMs: 1000 + HOLD_MS })).toBe(1);
  });

  it('a NEW mask texture restarts the hold (a lane switch rebuilds the mask)', () => {
    const e = {};
    const a = frame();
    unpatchedMaskHold(e, a);
    expect(unpatchedMaskHold(e, { ...a, nowMs: 1000 + HOLD_MS + 5 })).toBe(1);
    expect(unpatchedMaskHold(e, frame({ nowMs: 1000 + HOLD_MS + 10 }))).toBe(0);
  });

  it.each([
    ['below the patch gate (z<6, nothing will paint it)', { z: 5.5 }],
    ['a viewport overlay is already carving', { overlayOn: true }],
    ['a world-span mask (not patched by the commit path)', { bounds: { west: -180, south: -85, east: 180, north: 85 } }],
    ['the bound mask is not the engine-built one', { cachedTex: {} }],
    ['no mask bounds yet', { bounds: null }],
  ])('does not hold: %s', (_n, over) => {
    expect(unpatchedMaskHold({}, frame(over))).toBe(1);
  });

  it('kill switch draws through the NE-only mask as before', () => {
    expect(maskAwaitsPatch(frame({ win: { __RAW_DISABLE_UNPATCHED_MASK_HOLD__: true } }))).toBe(false);
    expect(unpatchedMaskHold({}, frame({ win: { __RAW_DISABLE_UNPATCHED_MASK_HOLD__: true } }))).toBe(1);
  });

  it('the engine multiplies the main heatmap opacity by the hold', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
    expect(src).toMatch(/'u_opacity'\), heatmapOpacity \* unpatchedMaskHold\(this,/);
  });
});
