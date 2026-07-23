/**
 * ANTIMERIDIAN RING UNWRAP (2026-07-23) — the N-Pacific RECTANGLE.
 *
 * Root cause (measured live, not inferred): a viewport near ±180 builds an overlay mask whose
 * projector centre is ~−150°, putting the projector's ANTI-CENTER meridian at ~+30°E — straight
 * through Africa/Eurasia. `renderMaskToCanvas` wrapped every vertex independently, so the NE-10m
 * "Land" polygon (bbox −17.5..180 / −34.8..77.7) teleported 360° between two consecutive vertices
 * (2732 px on a 512 px canvas) and `ctx.fill()` flooded the ENTIRE canvas black. Live GPU read-back
 * of the resulting overlay: every texel 0 (land) while the base mask correctly read 255 (water).
 * Applied in REPLACE mode over a world grid, that suppressed the heatmap AND the crest particles
 * together (both read the same oceanFlag) — the "rectangle where nothing paints".
 *
 * These tests assert the REAL invariant — the LAND FRACTION of an actually-rendered canvas and the
 * per-vertex jump of the traced ring — NOT metadata. (The 3°-scramble lesson: a test that checked
 * cols/rows instead of len(vectors)==cols*rows let a scrambled grid ship.)
 */
import { unwrapRingLngs, ringCopyOffsets, renderMaskToCanvas } from './WebGLMarineMaskRenderer';

// The live-observed failing geometry: the padded overlay bounds for a z4.15 central-Pacific view.
const PACIFIC_OVERLAY_BOUNDS = {
  west: -183.62265239411266, south: -19.043245250679654,
  east: -116.16333119704505, north: 30.873679773519974,
};

// A stand-in for the NE-10m "Land" feature: one ring spanning −17.5°→180° across lat −34.8..77.7,
// i.e. it straddles the +30.1°E anti-center meridian of the bounds above. Coarse but faithful in
// the only property that matters here: it crosses the seam and it brackets the target latitudes.
function afroEurasiaRing() {
  const ring = [];
  for (let lng = -17.5; lng <= 180; lng += 2.5) ring.push([lng, 77.7]);
  for (let lng = 180; lng >= -17.5; lng -= 2.5) ring.push([lng, -34.8]);
  ring.push([-17.5, 77.7]);
  return ring;
}
const LAND_GEOJSON = {
  features: [{ geometry: { type: 'Polygon', coordinates: [afroEurasiaRing()] }, properties: { featurecla: 'Land' } }],
};

// jsdom ships no 2D rasteriser, so we record the TRACED PATH instead of reading pixels. That is a
// stronger assertion for this bug, not a weaker one: the defect IS a single ring segment spanning
// the whole canvas (a 360° teleport), and `ctx.fill()` of such a path is what floods it. We assert
// the geometry the rasteriser would be handed.
function installPathRecorder() {
  const filled = [];
  let cur = null;
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, imageSmoothingEnabled: true,
    beginPath() { cur = []; },
    moveTo(x, y) { if (cur) cur.push([x, y, 'M']); },
    lineTo(x, y) { if (cur) cur.push([x, y, 'L']); },
    closePath() {},
    fill() { if (cur && cur.length) filled.push(cur.slice()); },
    stroke() {},
    fillRect() {}, rect() {}, clip() {}, save() {}, restore() {},
    drawImage() {},
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    putImageData() {},
  };
  ctx.__filled = filled;
  const spy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  return { ctx, filled, restore: () => spy.mockRestore() };
}

// Longest horizontal step between consecutive vertices of any filled subpath, in canvas px.
function maxSegmentSpan(filled) {
  let m = 0;
  for (const path of filled) {
    for (let i = 1; i < path.length; i++) {
      if (path[i][2] === 'M') continue;              // a new subpath, not a segment
      m = Math.max(m, Math.abs(path[i][0] - path[i - 1][0]));
    }
  }
  return m;
}

describe('unwrapRingLngs — continuity', () => {
  it('never steps more than 180° between consecutive vertices, even across the seam', () => {
    const center = -149.893;               // the live centre for the Pacific overlay bounds
    const { lngs } = unwrapRingLngs(afroEurasiaRing().map((p) => [p[0], p[1]]), center);
    let maxStep = 0;
    for (let i = 1; i < lngs.length; i++) maxStep = Math.max(maxStep, Math.abs(lngs[i] - lngs[i - 1]));
    expect(maxStep).toBeLessThanOrEqual(180);
  });

  it('the OLD per-vertex wrap DOES tear — this is the bug being fixed', () => {
    const center = -149.893;
    const wrapRel = (lng, c) => { let d = lng - c; let w = ((d + 180) % 360); if (w < 0) w += 360; w -= 180; return c + w; };
    const old = afroEurasiaRing().map((p) => wrapRel(p[0], center));
    let maxStep = 0;
    for (let i = 1; i < old.length; i++) maxStep = Math.max(maxStep, Math.abs(old[i] - old[i - 1]));
    expect(maxStep).toBeGreaterThan(300);   // a ~360° teleport mid-ring
  });

  it('keeps a ring that does not cross the seam byte-identical to the plain wrap', () => {
    const center = 0;
    const ring = [[-10, 5], [10, 5], [10, -5], [-10, -5], [-10, 5]];
    const { lngs } = unwrapRingLngs(ring, center);
    expect(lngs).toEqual([-10, 10, 10, -10, -10]);
  });
});

describe('ringCopyOffsets — placement', () => {
  it('places a ring that sits one world-copy west of the window', () => {
    // continuous ring at −347..−180 vs a window at −183.6..−116.2 → the k=0 copy overlaps
    expect(ringCopyOffsets(-347, -180, -183.62, -116.16)).toContain(0);
  });
  it('returns the ±360 copy when the ring only reaches the window after a shift', () => {
    expect(ringCopyOffsets(170, 190, -183.62, -116.16)).toEqual([-360]);
  });
  it('culls a ring that genuinely misses the window', () => {
    expect(ringCopyOffsets(0, 30, -183.62, -116.16)).toEqual([]);
  });
  it('never fans out unboundedly for a ring spanning more than a world', () => {
    expect(ringCopyOffsets(-400, 400, -183.62, -116.16).length).toBeLessThanOrEqual(3);
  });
});

describe('renderMaskToCanvas — the N-Pacific rectangle', () => {
  let rec;
  const WIDTH = 256;   // opts.maxWidth below; the tear was 5.3x the canvas width
  beforeEach(() => { window.__RAW_DISABLE_MASK_CANVAS_CACHE__ = true; rec = installPathRecorder(); });
  afterEach(() => {
    rec.restore();
    delete window.__RAW_DISABLE_MASK_RING_UNWRAP__;
    delete window.__RAW_DISABLE_MASK_CANVAS_CACHE__;
  });

  it('traces no segment wider than the canvas over the Pacific window (no flood)', () => {
    renderMaskToCanvas(LAND_GEOJSON, PACIFIC_OVERLAY_BOUNDS, { maxWidth: WIDTH });
    expect(rec.filled.length).toBeGreaterThan(0);          // it IS drawn (legit Chukotka reach)
    expect(maxSegmentSpan(rec.filled)).toBeLessThan(WIDTH); // ...but never teleports across it
  });

  it('KILL-SWITCH A/B: the old path teleports a segment clear across the canvas', () => {
    window.__RAW_DISABLE_MASK_RING_UNWRAP__ = true;
    renderMaskToCanvas(LAND_GEOJSON, PACIFIC_OVERLAY_BOUNDS, { maxWidth: WIDTH });
    expect(maxSegmentSpan(rec.filled)).toBeGreaterThan(WIDTH * 2);
  });

  it('still traces land where land actually is (no regression on a normal window)', () => {
    const africa = { west: 10, south: -10, east: 40, north: 20 };
    renderMaskToCanvas(LAND_GEOJSON, africa, { maxWidth: WIDTH });
    expect(rec.filled.length).toBeGreaterThan(0);
    expect(maxSegmentSpan(rec.filled)).toBeLessThan(WIDTH * 2);
  });

  it('a REGIONAL window straddling ±180 is safe too (centre 180 ⇒ seam on Greenwich)', () => {
    // Fiji/Chatham class: bounds 176..184 wrap to centre 180, so the projector seam falls on 0°E —
    // which also cuts Afro-Eurasia. Same tear, close zoom. Regression-guards the whole family.
    const fiji = { west: 176, south: -22, east: 184, north: -14 };
    renderMaskToCanvas(LAND_GEOJSON, fiji, { maxWidth: WIDTH });
    expect(maxSegmentSpan(rec.filled)).toBeLessThan(WIDTH);
  });

  it('a global window keeps the SAME traced vertices as before the fix', () => {
    const globalB = { west: -180, south: -80, east: 180, north: 84 };
    renderMaskToCanvas(LAND_GEOJSON, globalB, { maxWidth: WIDTH });
    const fixed = JSON.stringify(rec.filled);
    rec.restore();
    rec = installPathRecorder();
    window.__RAW_DISABLE_MASK_RING_UNWRAP__ = true;
    renderMaskToCanvas(LAND_GEOJSON, globalB, { maxWidth: WIDTH });
    expect(JSON.stringify(rec.filled)).toEqual(fixed);      // world mask byte-identical
  });
});
