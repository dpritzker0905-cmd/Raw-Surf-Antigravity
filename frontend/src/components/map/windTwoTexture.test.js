/**
 * BASE+OVERLAY two-texture wind engine — the enumerating gate (2026-07-19, queue #9).
 *
 * The viewport-fine tier's single-texture integration caused every day-2 regression (pan
 * "clearing" = the fine box's own edge; the moving clamp; slow activation). The two-texture
 * engine makes those geometrically impossible: the global base stays resident, a fine grid
 * files as an OVERLAY on top of it (same model+hour only), the heatmap crossfades base→fine
 * across the feather band, and advection/marks read the composited field.
 *
 * Enumerated here (the soak-agreement lesson — assert every branch, never sample):
 *   1. shader wiring: the fine lookup exists in BOTH particle stages with mirrored math, and
 *      the heatmap carries the complementary base-pass cutout;
 *   2. the pure filing predicates (global detection, model precedence, hour/valid_time
 *      compatibility, kill switch);
 *   3. setWindData filing: global→base, fine-over-global→overlay (base untouched), hour
 *      mismatch→replace+overlay drop, kill switch→legacy replace, shared maxSpeed across both
 *      textures, clearWindData frees both.
 */
import WebGLWindEngine, {
  windGridIsGlobal,
  windGridModel,
  windGridsCompatible,
  windBaseOverlayEnabled,
  windFineWideFade
} from './WebGLWindEngine';
import { ADVECT_FS, DRAW_VS, HEATMAP_FS } from './WebGLWindShaders';

// ── 1. Shader wiring ──

describe('two-texture shader wiring', () => {
  it('ADVECT_FS and DRAW_VS both carry the fine-overlay lookup with mirrored math', () => {
    for (const src of [ADVECT_FS, DRAW_VS]) {
      expect(src).toMatch(/uniform\s+sampler2D\s+u_wind_fine\s*;/);
      expect(src).toMatch(/u_fine_enabled\s*>\s*0\.5/);
      // interior-only test: strictly inside (0,1)² so out-of-box particles read the base
      expect(src).toMatch(/f_u\s*>\s*0\.0\s*&&\s*f_u\s*<\s*1\.0\s*&&\s*f_v\s*>\s*0\.0\s*&&\s*f_v\s*<\s*1\.0/);
      // feather-BLENDED velocity/colour: mix(base, fine, w) — a hard switch would put a
      // velocity step at the seam
      expect(src).toMatch(/wind\s*=\s*mix\(wind,\s*fineWind,\s*fw\)/);
      // per-texture decode: the fine texture has its OWN u/v range
      expect(src).toMatch(/mix\(u_fine_min,\s*u_fine_max/);
    }
  });

  it('ADVECT_FS remains theme-free (density is physical) after the two-texture edit', () => {
    expect(ADVECT_FS).not.toMatch(/u_theme/);
  });

  it('WIDE-ZOOM round 2: DATA never fades; only the vortex gate rides the fade; the edge widens', () => {
    // Round 1 faded the whole overlay at wide zoom and ERASED a live low pressure system (the
    // user caught it immediately). The corrected contract, pinned here:
    //   1. fw (the velocity/colour DATA blend) carries NO wide fade in either stage;
    //   2. ONLY the vortex gate rides u_fine_wide_fade (its persistence hoards the fixed
    //      particle population into the box at wide zoom — the Texas depletion);
    //   3. the rectangle reading is removed by WIDENING the edge dissolve instead.
    for (const src of [ADVECT_FS, DRAW_VS]) {
      expect(src).toMatch(/fw\s*=\s*smoothstep\(0\.0,\s*max\(u_fine_feather_frac,\s*0\.001\),\s*fEdge\)\s*;/);
      expect(src).not.toMatch(/fEdge\)\s*\*\s*u_fine_wide_fade/);
    }
    expect(ADVECT_FS).toMatch(/vortexGate\s*=\s*smoothstep\(0\.5,\s*1\.2,\s*Rdom\)\s*\*\s*fw\s*\*\s*u_fine_wide_fade/);
    expect(DRAW_VS).not.toMatch(/u_fine_wide_fade/); // draw stage reads pure data
    // fade curve: full at >=45% viewport-area coverage, gone at <=15%
    expect(windFineWideFade(0.60)).toBe(1);
    expect(windFineWideFade(0.45)).toBe(1);
    expect(windFineWideFade(0.30)).toBeCloseTo(0.5, 5);
    expect(windFineWideFade(0.15)).toBe(0);
    // edge dissolve: shipped 0.6-deg rule at full coverage, widening to 30% per side as the
    // viewport dwarfs the box — the core keeps full truth
    const { windFineFeatherFrac } = require('./WebGLWindEngine');
    expect(windFineFeatherFrac(12, 1)).toBeCloseTo(0.05, 5);   // full coverage: absolute rule
    expect(windFineFeatherFrac(12, 0)).toBeCloseTo(0.30, 5);   // vanishing coverage: wide dissolve
    expect(windFineFeatherFrac(2, 1)).toBeCloseTo(0.18, 5);    // small pilot tile: legacy cap
  });

  it('HEATMAP_FS composites base+fine in a SINGLE pass (the hairline-seam fix, 2026-07-20)', () => {
    // Two stacked translucent draws in the crossfade band compose to a different total opacity
    // than one draw (a_total = a1 + a2*(1-a1) != a) — the visible bright hairline rectangle the
    // user reported once the DATA matched on both sides. The fix mirrors ADVECT/DRAW: sample
    // BOTH textures in the base pass, mix the WIND (not the colors), draw ONCE with one alpha.
    expect(HEATMAP_FS).toMatch(/uniform\s+sampler2D\s+u_wind_fine\s*;/);
    expect(HEATMAP_FS).toMatch(/uniform\s+float\s+u_fine_singlepass\s*;/);
    expect(HEATMAP_FS).toMatch(/uniform\s+vec2\s+u_fine_min\s*;/);
    expect(HEATMAP_FS).toMatch(/uniform\s+vec2\s+u_fine_max\s*;/);
    expect(HEATMAP_FS).toMatch(/wind\s*=\s*mix\(wind,\s*fineWind,\s*fw\)/); // the same mix ADVECT/DRAW use
    // the legacy complementary-cutout two-pass path survives for the kill switch
    expect(HEATMAP_FS).toMatch(/uniform\s+float\s+u_cutout_enabled\s*;/);
    expect(HEATMAP_FS).toMatch(/uniform\s+vec2\s+u_cutout_min\s*;/);
    expect(HEATMAP_FS).toMatch(/uniform\s+vec2\s+u_cutout_max\s*;/);
    expect(HEATMAP_FS).toMatch(/alpha\s*\*=\s*\(1\.0\s*-\s*cw\)/);
    // and the alpha hole must be DISABLED in single-pass mode (no second draw to crossfade with)
    expect(HEATMAP_FS).toMatch(/u_cutout_enabled\s*>\s*0\.5\s*&&\s*u_fine_singlepass\s*<\s*0\.5/);
  });
});

// ── 2. Pure filing predicates ──

const GLOBAL_GRID = {
  bounds: { west: -180, south: -80, east: 180, north: 85 },
  coverage_scope: 'global_coarse',
  source: 'GFS', hourOffset: 0, valid_time: '2026-07-19T12:00:00Z',
  cols: 37, rows: 17
};
const FINE_GRID = {
  bounds: { west: -90, south: 22, east: -82, north: 30 },
  coverage_scope: 'viewport',
  source: 'GFS', hourOffset: 0, valid_time: '2026-07-19T12:00:00Z',
  cols: 25, rows: 29
};

describe('filing predicates', () => {
  it('windGridIsGlobal: span, coverage_scope, and regional cases', () => {
    expect(windGridIsGlobal(GLOBAL_GRID)).toBe(true);
    expect(windGridIsGlobal({ bounds: { west: -180, south: -80, east: 175, north: 85 } })).toBe(true); // span 355
    expect(windGridIsGlobal({ bounds: { west: -90, south: 22, east: -82, north: 30 }, coverage_scope: 'global' })).toBe(true);
    expect(windGridIsGlobal(FINE_GRID)).toBe(false);
    expect(windGridIsGlobal(null)).toBe(false);
    expect(windGridIsGlobal({})).toBe(false);
  });

  it('windGridModel prefers source (the choke and keepTrails compare source)', () => {
    expect(windGridModel({ source: 'GFS', truthTag: { model: 'ICON' } })).toBe('GFS');
    expect(windGridModel({ truthTag: { model: 'ICON' } })).toBe('ICON');
    expect(windGridModel({})).toBe(null);
  });

  it('windGridsCompatible: every refusal branch', () => {
    expect(windGridsCompatible(GLOBAL_GRID, FINE_GRID)).toBe(true);
    expect(windGridsCompatible(null, FINE_GRID)).toBe(false);
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, source: 'ICON' })).toBe(false);
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, hourOffset: 3 })).toBe(false);
    // valid_time drift beyond the 3-hourly step distance (180 min) refuses
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, valid_time: '2026-07-19T15:30:00Z' })).toBe(false);
    // the FULL 3-hourly step distance passes: hourly base frames sit up to 2 h from a 3-hourly
    // fine product (hours ≡ 2 mod 3) — the ±90 min window dropped the overlay exactly there
    // (the "low vanishes at every zoom" hour)
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, valid_time: '2026-07-19T14:00:00Z' })).toBe(true);
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, valid_time: '2026-07-19T13:00:00Z' })).toBe(true);
    // missing valid_time on either side: hour/model checks alone decide
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, valid_time: undefined })).toBe(true);
  });

  it('windBaseOverlayEnabled kill switch', () => {
    expect(windBaseOverlayEnabled({})).toBe(true);
    expect(windBaseOverlayEnabled({ __RAW_DISABLE_WIND_BASE_OVERLAY__: true })).toBe(false);
    expect(windBaseOverlayEnabled(null)).toBe(true);
  });

  it('windGridsIdentical: metadata equality + 5-point content sample (the no-op guard predicate)', () => {
    const { windGridsIdentical } = require('./WebGLWindEngine');
    const mk = (speed) => ({ ...GLOBAL_GRID, vectors: Array.from({ length: 629 }, () => ({ u: speed, v: 0, speed })) });
    expect(windGridsIdentical(mk(10), mk(10))).toBe(true);
    // a new RUN behind identical metadata still refuses on sampled content
    expect(windGridsIdentical(mk(10), mk(11))).toBe(false);
    expect(windGridsIdentical(mk(10), { ...mk(10), stale: true })).toBe(false);
    expect(windGridsIdentical(mk(10), { ...mk(10), valid_time: '2026-07-19T15:00:00Z' })).toBe(false);
    expect(windGridsIdentical(mk(10), { ...mk(10), hourOffset: 3 })).toBe(false);
    expect(windGridsIdentical(mk(10), { ...mk(10), bounds: { ...GLOBAL_GRID.bounds, east: 179 } })).toBe(false);
    expect(windGridsIdentical(mk(10), null)).toBe(false);
  });
});

// ── 3. setWindData filing with a mock GL ──

function makeMockGL() {
  let texId = 0;
  const deleted = [];
  const gl = {
    TEXTURE_2D: 1, TEXTURE_WRAP_S: 2, TEXTURE_WRAP_T: 3, TEXTURE_MIN_FILTER: 4,
    TEXTURE_MAG_FILTER: 5, CLAMP_TO_EDGE: 6, REPEAT: 7, RGBA: 8, UNSIGNED_BYTE: 9,
    LINEAR: 10, NEAREST: 11, TEXTURE_BINDING_2D: 12, TEXTURE0: 100,
    createTexture: () => ({ id: ++texId }),
    deleteTexture: (t) => { if (t) deleted.push(t); },
    bindTexture: () => {},
    texParameteri: () => {},
    texImage2D: () => {},
    getParameter: () => null,
    activeTexture: () => {}
  };
  return { gl, deleted };
}

function vectorsFor(cols, rows, speed) {
  const out = [];
  for (let i = 0; i < cols * rows; i++) out.push({ u: speed, v: 0, speed });
  return out;
}

function grid(base, cols, rows, speed) {
  return { ...base, cols, rows, vectors: vectorsFor(cols, rows, speed) };
}

describe('setWindData filing', () => {
  afterEach(() => { delete window.__RAW_DISABLE_WIND_BASE_OVERLAY__; delete window.__RAW_DISABLE_WIND_COMMIT_NOOP__; });

  it('NO-OP GUARD: re-committing the identical product touches no GL state (the FPS-drop root)', () => {
    const { gl, deleted } = makeMockGL();
    const engine = new WebGLWindEngine();
    const g1 = grid(GLOBAL_GRID, 37, 17, 20);
    expect(engine.setWindData(gl, g1)).toBe('base');
    const baseData = engine._windData;
    const deletedBefore = deleted.length;
    // the moveend churn: the same cached product arrives again
    expect(engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20))).toBe('noop');
    expect(engine._windData).toBe(baseData);            // texture object untouched
    expect(deleted.length).toBe(deletedBefore);         // nothing freed/re-uploaded
    // content change behind identical metadata still commits (run refresh)
    expect(engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 22))).toBe('base');
    // kill switch restores the old always-commit behaviour
    window.__RAW_DISABLE_WIND_COMMIT_NOOP__ = true;
    expect(engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 22))).toBe('base');
  });

  it('NO-OP GUARD: identical FINE overlay re-commit noops; a different fine box still files', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));
    expect(engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12))).toBe('fine');
    expect(engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12))).toBe('noop');
    const wider = { ...FINE_GRID, bounds: { west: -96, south: 16, east: -62, north: 42 } };
    expect(engine.setWindData(gl, grid(wider, 18, 14, 12))).toBe('fine');
  });

  it('global files as base; compatible fine files as overlay with the base untouched', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    expect(engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20))).toBe('base');
    const baseData = engine._windData;
    expect(baseData).toBeTruthy();
    expect(engine._windFine).toBeFalsy();

    expect(engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12))).toBe('fine');
    expect(engine._windData).toBe(baseData);            // base untouched — clamp impossible
    expect(engine._windFine).toBeTruthy();
    expect(engine._windFine.bounds).toEqual(FINE_GRID.bounds);
  });

  it('an hour-mismatched regional takes the legacy replace path and drops the overlay', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));
    engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12));
    expect(engine._windFine).toBeTruthy();

    const laterHour = { ...FINE_GRID, hourOffset: 3, valid_time: '2026-07-19T15:00:00Z' };
    expect(engine.setWindData(gl, grid(laterHour, 25, 29, 12))).toBe('base');
    expect(engine._windFine).toBeFalsy();               // stale-hour overlay dropped
    expect(engine._windData.bounds).toEqual(FINE_GRID.bounds);
  });

  it('a new global base of a different hour drops the resident overlay', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));
    engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12));
    const nextHourGlobal = { ...GLOBAL_GRID, hourOffset: 3, valid_time: '2026-07-19T15:00:00Z' };
    expect(engine.setWindData(gl, grid(nextHourGlobal, 37, 17, 20))).toBe('base');
    expect(engine._windFine).toBeFalsy();
  });

  it('a same-hour global base refresh KEEPS the compatible overlay', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));
    engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12));
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 22));
    expect(engine._windFine).toBeTruthy();
  });

  it('kill switch forces legacy replace semantics', () => {
    window.__RAW_DISABLE_WIND_BASE_OVERLAY__ = true;
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));
    expect(engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12))).toBe('base');
    expect(engine._windFine).toBeFalsy();
    expect(engine._windData.bounds).toEqual(FINE_GRID.bounds);
  });

  it('maxWindSpeed spans BOTH textures (the ramp must cover whichever grid holds the storm)', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));
    expect(engine._maxWindSpeed).toBe(20);
    engine.setWindData(gl, grid(FINE_GRID, 25, 29, 60));
    expect(engine._maxWindSpeed).toBe(60);
  });

  it('clearWindData frees BOTH textures', () => {
    const { gl, deleted } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));
    engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12));
    const baseTex = engine._windData.texture;
    const fineTex = engine._windFine.texture;
    engine.clearWindData(gl);
    expect(engine._windData).toBeNull();
    expect(engine._windFine).toBeNull();
    expect(deleted).toContain(baseTex);
    expect(deleted).toContain(fineTex);
  });

  it('choke pass-through carries ALL FOUR predicates (same model, same hour, GLOBAL covering grid, kill switch)', () => {
    // The WeatherEngine choke branch is a closure inside the hook — pin its predicates the way
    // the density gate pins shader literals. Every predicate matters: dropping sameHour would
    // composite two different hours; dropping the lgSpan>=350 guard would let a fine grid
    // replace a large REGIONAL coverer through the engine's legacy path (a real clamp).
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./WeatherEngine'), 'utf8');
    expect(src).toMatch(/__RAW_DISABLE_WIND_BASE_OVERLAY__\s*!==\s*true/);
    expect(src).toMatch(/twoTexLive\s*&&\s*sameModel\s*&&\s*sameHour\s*&&\s*lgSpan\s*>=\s*350\.0/);
    expect(src).toMatch(/passes as FINE OVERLAY/);
  });

  it('fine-over-REGIONAL base does NOT file as overlay (regional-only mode keeps legacy path)', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    const regionalBase = { ...FINE_GRID, bounds: { west: -100, south: 15, east: -70, north: 40 } };
    engine.setWindData(gl, grid(regionalBase, 31, 26, 15));
    expect(engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12))).toBe('base');
    expect(engine._windFine).toBeFalsy();
  });

  it('PROMOTE: a compatible global arriving over a regional base slides UNDER it (fine data kept)', () => {
    // The cold-enable-at-fine-zoom ordering: fine lands first (becomes base), global lands
    // second. Replacing would visually downgrade the sharper data — instead the global becomes
    // the base and the regional grid MOVES to the overlay slot, texture preserved (no re-encode).
    const { gl, deleted } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12));
    const fineHolder = engine._windData;
    const fineTex = fineHolder.texture;

    expect(engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20))).toBe('base_promote');
    expect(engine._windFine).toBe(fineHolder);            // moved, not re-encoded
    expect(engine._windFine.texture).toBe(fineTex);
    expect(deleted).not.toContain(fineTex);               // and never freed in the move
    expect(windGridIsGlobal(engine._windData.windGrid)).toBe(true);
  });

  it('an INCOMPATIBLE global over a regional base replaces it (no promote across hours)', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12));
    const laterGlobal = { ...GLOBAL_GRID, hourOffset: 3, valid_time: '2026-07-19T15:00:00Z' };
    expect(engine.setWindData(gl, grid(laterGlobal, 37, 17, 20))).toBe('base');
    expect(engine._windFine).toBeFalsy();
  });
});

// ── 4. COARSE-OVERLAY GUARD (2026-07-21, user "grid shape / small clamp" report) ──
// A grid may only occupy the FINE overlay if it SHARPENS the base. The live root: a 5x4 (~4°/cell)
// SWR-preview clip (`swr_revalidation_pending`) filed as the fine overlay over the sharp 2° world
// base (181x83), then rendered as a blocky patch/lattice on top of good data. The fine overlay's
// purpose is to sharpen; a coarser grid there is strictly a downgrade.

const SHARP_GLOBAL = { // the real 2°/cell world base (global_mid)
  bounds: { west: -180, south: -80, east: 180, north: 85 },
  coverage_scope: 'global', source: 'GFS', hourOffset: 0, valid_time: '2026-07-19T12:00:00Z',
  cols: 181, rows: 83
};
const COARSE_REGIONAL = { // a 5x4 (~4°/cell) SWR-preview clip — coarser than the base
  bounds: { west: -90, south: 14, east: -74, north: 30 },
  coverage_scope: 'viewport', source: 'GFS', hourOffset: 0, valid_time: '2026-07-19T12:00:00Z',
  cols: 5, rows: 4
};

describe('coarse-overlay guard (the "grid shape / small clamp")', () => {
  afterEach(() => { delete window.__RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__; });

  it('windGridClearlyCoarserThan: cell-size ordering', () => {
    const { windGridClearlyCoarserThan, windGridCellDeg } = require('./WebGLWindEngine');
    expect(windGridCellDeg(SHARP_GLOBAL)).toBeCloseTo(2.0, 1);       // 360/180
    expect(windGridCellDeg(COARSE_REGIONAL)).toBeCloseTo(4.0, 1);    // 16/4
    expect(windGridClearlyCoarserThan(COARSE_REGIONAL, SHARP_GLOBAL)).toBe(true);   // 4 > 2*1.3
    expect(windGridClearlyCoarserThan(SHARP_GLOBAL, COARSE_REGIONAL)).toBe(false);
    expect(windGridClearlyCoarserThan(FINE_GRID, SHARP_GLOBAL)).toBe(false);         // 0.33° fine sharpens
  });

  it('a coarse regional grid does NOT file as the fine overlay over a sharp global base', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    expect(engine.setWindData(gl, grid(SHARP_GLOBAL, 181, 83, 20))).toBe('base');
    const base = engine._windData;
    // the 5x4 SWR preview must be ignored — the base already covers it with better detail
    expect(engine.setWindData(gl, grid(COARSE_REGIONAL, 5, 4, 12))).toBe('noop_coarse');
    expect(engine._windData).toBe(base);          // base untouched
    expect(engine._windFine).toBeFalsy();          // NO coarse overlay patch
  });

  it('PROMOTE drops a coarse resident instead of moving it to the overlay', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    // the SWR preview lands first as the base, then the real world arrives
    engine.setWindData(gl, grid(COARSE_REGIONAL, 5, 4, 12));
    expect(engine.setWindData(gl, grid(SHARP_GLOBAL, 181, 83, 20))).toBe('base'); // NOT base_promote
    expect(engine._windFine).toBeFalsy();          // coarse resident dropped, not filed as fine
    expect(windGridIsGlobal(engine._windData.windGrid)).toBe(true);
  });

  it('a genuinely SHARPER regional still promotes to the overlay (the good case is preserved)', () => {
    const { gl, deleted } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(FINE_GRID, 25, 29, 12)); // 0.33°/cell sharp fine
    const fineHolder = engine._windData;
    expect(engine.setWindData(gl, grid(SHARP_GLOBAL, 181, 83, 20))).toBe('base_promote');
    expect(engine._windFine).toBe(fineHolder);     // sharp fine kept as overlay
    expect(deleted).not.toContain(fineHolder.texture);
  });

  it('kill switch restores the legacy coarse-files-as-fine behaviour', () => {
    window.__RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__ = true;
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(SHARP_GLOBAL, 181, 83, 20));
    expect(engine.setWindData(gl, grid(COARSE_REGIONAL, 5, 4, 12))).toBe('fine');
    expect(engine._windFine).toBeTruthy();
  });
});

// ── 4. NO-DOWNGRADE (2026-10-08 live test): a resident FINE overlay is never replaced by a clearly
// coarser compatible grid that lies inside it (z6 -> z9 over the Gulf: a 4x4 2-deg mid clip displaced the
// 1-deg viewport product that still covered the screen). ──
// ── 4b. BASE-RESOLUTION CLIP (2026-10-09, owner: "the zoom eye of storm movement ... still happening"): with the app's
// real 2-deg world base resident, the 2-deg world clip the server sends for a wide view (z~6) must not replace the
// finer 1-deg box that is drawing the storm (its eye moves 17-25 km between the two lattices; windOverlayKeep.js). ──
describe('setWindData — a base-resolution clip never displaces a finer overlay', () => {
  const WORLD_2DEG = { ...GLOBAL_GRID, cols: 181, rows: 84 };                                                     // 2.0 deg
  const BOX_1DEG = { ...FINE_GRID, bounds: { west: -95, south: 24, east: -78, north: 36 }, cols: 18, rows: 13 };   // the owner's 18x13
  const CLIP_2DEG = { ...FINE_GRID, bounds: { west: -100, south: 16, east: -76, north: 42 }, cols: 13, rows: 14 };  // the live 13x14 clip
  const BOX_05 = { ...FINE_GRID, bounds: { west: -91, south: 25, east: -84, north: 31 }, cols: 15, rows: 13 };     // 0.5 deg
  const setup = (fine = BOX_1DEG) => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(WORLD_2DEG, 181, 84, 20));
    expect(engine.setWindData(gl, grid(fine, fine.cols, fine.rows, 30))).toBe('fine');
    return { gl, engine };
  };
  afterEach(() => { delete window.__RAW_DISABLE_WIND_CLIP_KEEP_FINE__; delete window.__RAW_DISABLE_WIND_TIER_MOSAIC__; });

  it('keeps the 1-deg box when the 2-deg clip of a wider view arrives (the z6 swap in the owner log)', () => {
    const { gl, engine } = setup();
    const before = engine._windFine;
    expect(engine.setWindData(gl, grid(CLIP_2DEG, 13, 14, 25))).toBe('noop_base_clip');
    expect(engine._windFine).toBe(before);
    expect(engine._windFine.windGrid.cols).toBe(18);
  });
  it('POSITIVE CONTROL: with this rule and the tier mosaic both killed the clip is filed again (the swap comes back)', () => {
    const { gl, engine } = setup();
    window.__RAW_DISABLE_WIND_CLIP_KEEP_FINE__ = true;
    window.__RAW_DISABLE_WIND_TIER_MOSAIC__ = true;
    expect(engine.setWindData(gl, grid(CLIP_2DEG, 13, 14, 25))).toBe('fine');
    expect(engine._windFine.windGrid.cols).toBe(13);
  });
  it('with this rule alone killed, the tier mosaic still keeps the 1-deg nodes inside the clip (windTierMosaic.js)', () => {
    const { gl, engine } = setup();
    window.__RAW_DISABLE_WIND_CLIP_KEEP_FINE__ = true;
    expect(engine.setWindData(gl, grid(CLIP_2DEG, 13, 14, 25))).toBe('fine');
    expect(engine._windFine.windGrid.__tierMosaic.inner.cols).toBe(18);
    expect(engine._windFine.windGrid.cols).toBe(25);                 // the clip's 24 deg at the box's 1-deg spacing
  });
  it('a 1-deg box that covers a wider view is still filed over a 0.5-deg one (it carries data the base lacks)', () => {
    const { gl, engine } = setup(BOX_05);
    expect(engine.setWindData(gl, grid(BOX_1DEG, 18, 13, 25))).toBe('fine');
    expect(engine._windFine.windGrid.bounds).toEqual(BOX_1DEG.bounds);
  });
  it('with no finer overlay resident, the clip files as before (harmless: the nodes of the base itself)', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(WORLD_2DEG, 181, 84, 20));
    expect(engine.setWindData(gl, grid(CLIP_2DEG, 13, 14, 25))).toBe('fine');
  });
});

// ── 4c. TIER MOSAIC (2026-10-09, owner: the eye must hold through a whole zoom): a coarser box that covers a wider view no
// longer REPLACES the finer box it overlaps; the engine files their mosaic on the finer lattice (windTierMosaic.js). The
// ladder bench measured the swap: 0.25 -> 0.5 deg redraws the eye x3.6 larger, 0.5 -> 1 deg moves it 21 km. ──
describe('setWindData — a coarser covering box keeps the finer nodes it overlaps (tier mosaic)', () => {
  const WORLD_2DEG = { ...GLOBAL_GRID, cols: 181, rows: 84 };
  const BOX_025 = { ...FINE_GRID, bounds: { west: -90, south: 25, east: -85, north: 30 }, cols: 21, rows: 21, product_id: 'z8' };   // the z8 box
  const BOX_05 = { ...FINE_GRID, bounds: { west: -93, south: 23, east: -83, north: 32 }, cols: 21, rows: 19, product_id: 'z6.5' };  // the z6.5 box
  const BOX_1 = { ...FINE_GRID, bounds: { west: -96, south: 20, east: -79, north: 35 }, cols: 18, rows: 16, product_id: 'z5.5' };   // the z5.5 box
  const CLIP_2 = { ...FINE_GRID, bounds: { west: -104, south: 12, east: -72, north: 42 }, cols: 17, rows: 16, product_id: 'clip' }; // its cold 2-deg clip
  const setup = () => {
    const { gl, deleted } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(WORLD_2DEG, 181, 84, 20));
    expect(engine.setWindData(gl, grid(BOX_025, 21, 21, 60))).toBe('fine');
    return { gl, engine, deleted };
  };
  const centre = (g) => g.vectors[Math.floor(g.rows / 2) * g.cols + Math.floor(g.cols / 2)];
  beforeEach(() => { delete window.__WIND_TIER_MOSAIC__; });
  afterEach(() => { delete window.__RAW_DISABLE_WIND_TIER_MOSAIC__; });

  it('zoom out one tier: the 0.5-deg box is filed on the 0.25-deg lattice with the fine nodes inside it', () => {
    const { gl, engine } = setup();
    expect(engine.setWindData(gl, grid(BOX_05, 21, 19, 30))).toBe('fine');
    const g = engine._windFine.windGrid;
    expect(g.bounds).toEqual(BOX_05.bounds);                       // the whole incoming box is drawn
    expect([g.cols, g.rows]).toEqual([41, 37]);                    // at the finer spacing
    expect(g.__tierMosaic.kept).toEqual(BOX_025.bounds);
    expect(centre(g).u).toBe(60);                                  // -88, 27.5: the fine box's own value
    expect(g.vectors[0].u).toBe(30);                               // the corner: the incoming box's
    expect(engine._maxWindSpeed).toBe(60);                         // the ramp still spans the storm
    expect(window.__WIND_TIER_MOSAIC__.built).toBe(1);
  });
  it('POSITIVE CONTROL: the kill switch replaces the fine box again (the eye is redrawn from every 2nd node)', () => {
    const { gl, engine } = setup();
    window.__RAW_DISABLE_WIND_TIER_MOSAIC__ = true;
    expect(engine.setWindData(gl, grid(BOX_05, 21, 19, 30))).toBe('fine');
    expect(engine._windFine.windGrid.cols).toBe(21);
    expect(engine._windFine.windGrid.__tierMosaic).toBeUndefined();
    expect(centre(engine._windFine.windGrid).u).toBe(30);
  });
  it('the whole way out and back: 0.5 deg, 1 deg, the 2-deg clip, then 0.5 deg again, the fine nodes never leave', () => {
    const { gl, engine } = setup();
    engine.setWindData(gl, grid(BOX_05, 21, 19, 30));
    expect(engine.setWindData(gl, grid(BOX_1, 18, 16, 20))).toBe('fine');
    let g = engine._windFine.windGrid;
    expect([g.cols, g.rows, g.__tierMosaic.outer.product_id, g.__tierMosaic.inner.product_id]).toEqual([69, 61, 'z5.5', 'z8']);
    const before = engine._windFine;
    expect(engine.setWindData(gl, grid(CLIP_2, 17, 16, 15))).toBe('noop_base_clip');   // #298 still holds over a mosaic
    expect(engine._windFine).toBe(before);
    expect(engine.setWindData(gl, grid(BOX_05, 21, 19, 30))).toBe('fine');              // zooming back in: finer than the 1-deg surround
    g = engine._windFine.windGrid;
    expect([g.cols, g.rows, g.__tierMosaic.outer.product_id]).toEqual([41, 37, 'z6.5']);
    expect(centre(g).u).toBe(60);
    expect(engine.setWindData(gl, grid(BOX_025, 21, 21, 60))).toBe('fine');             // and to the fine box itself: plain again
    expect(engine._windFine.windGrid.__tierMosaic).toBeUndefined();
  });
  it('NO-OP GUARD: the same served box arriving again over its own mosaic touches no GL state', () => {
    const { gl, engine, deleted } = setup();
    engine.setWindData(gl, grid(BOX_05, 21, 19, 30));
    const held = engine._windFine, n = deleted.length;
    expect(engine.setWindData(gl, grid(BOX_05, 21, 19, 30))).toBe('noop');
    expect(engine._windFine).toBe(held);
    expect(deleted.length).toBe(n);
  });
  it('"inside the fine box" is judged on the truly fine box, not on the mosaic\'s rim', () => {
    const { gl, engine } = setup();
    engine.setWindData(gl, grid(BOX_1, 18, 16, 20));
    const held = engine._windFine;
    const inside = { ...FINE_GRID, bounds: { west: -89, south: 26, east: -86, north: 29 }, cols: 7, rows: 7 };          // 0.5 deg, inside the 0.25-deg box
    expect(engine.setWindData(gl, grid(inside, 7, 7, 30))).toBe('noop_coarser_than_fine');
    expect(engine._windFine).toBe(held);
    expect(engine.setWindData(gl, grid(BOX_05, 21, 19, 30))).toBe('fine');                                               // inside the mosaic, wider than the fine box
    expect(engine._windFine.windGrid.__tierMosaic.outer.product_id).toBe('z6.5');
  });
  // Review finding (2026-10-10): with a mosaic resident, "coarser" was measured against the mosaic's fine lattice and
  // "inside" against the fine box only, so the pre-mosaic rule (coarser than the SERVED box and inside it) was lost.
  it('NEVER DOWNGRADE the served surround: a grid coarser than the served box and inside it is still a no-op', () => {
    const { gl, engine } = setup();
    engine.setWindData(gl, grid(BOX_05, 21, 19, 30));                                                                     // mosaic: 0.5-deg surround
    const held = engine._windFine;
    const oneInside = { ...FINE_GRID, bounds: { west: -92, south: 24, east: -84, north: 31 }, cols: 9, rows: 8 };         // 1 deg, inside the 0.5-deg box, wider than the fine one
    expect(engine.setWindData(gl, grid(oneInside, 9, 8, 20))).toBe('noop_coarser_than_fine');
    expect(engine._windFine).toBe(held);
    window.__RAW_DISABLE_WIND_TIER_MOSAIC__ = true;                                                                       // the old engine agreed
    const old = setup();
    old.engine.setWindData(old.gl, grid(BOX_05, 21, 19, 30));
    expect(old.engine.setWindData(old.gl, grid(oneInside, 9, 8, 20))).toBe('noop_coarser_than_fine');
  });
  it('the 2026-10-08 live case over a mosaic: a 2-deg mid clip inside the served box, under a 10-deg world base', () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));                                                                // 10 deg: #298's clip rule does not apply
    engine.setWindData(gl, grid(BOX_025, 21, 21, 60));
    engine.setWindData(gl, grid(BOX_05, 21, 19, 30));
    const held = engine._windFine;
    const midClip = { ...FINE_GRID, bounds: { west: -92, south: 24, east: -84, north: 30 }, cols: 5, rows: 4 };            // 2 deg
    expect(engine.setWindData(gl, grid(midClip, 5, 4, 15))).toBe('noop_coarser_than_fine');
    expect(engine._windFine).toBe(held);
  });
  it('"inside the fine nodes" means the nodes the mosaic KEPT: a fine box that hangs outside the surround does not veto there', () => {
    const { gl, engine } = setup();                                                                                       // fine: -90..-85 / 25..30
    const shifted = { ...FINE_GRID, bounds: { west: -88, south: 27, east: -78, north: 36 }, cols: 21, rows: 19 };          // 0.5 deg; keeps -88..-85 / 27..30 only
    engine.setWindData(gl, grid(shifted, 21, 19, 30));
    expect(engine._windFine.windGrid.__tierMosaic.kept).toEqual({ west: -88, south: 27, east: -85, north: 30 });
    const back = { ...FINE_GRID, bounds: { west: -90, south: 25, east: -85, north: 30 }, cols: 11, rows: 11 };             // 0.5 deg on the fine box's own bounds
    expect(engine.setWindData(gl, grid(back, 11, 11, 30))).toBe('fine');                                                  // not a no-op: the mosaic draws nothing west of -88
    expect(engine._windFine.windGrid.bounds).toEqual(back.bounds);
    expect(centre(engine._windFine.windGrid).u).toBe(60);                                                                 // and the fine nodes come back with it
  });
  it('another hour, or a box the fine one has left, files plain as before', () => {
    const a = setup();
    expect(a.engine.setWindData(a.gl, grid({ ...BOX_05, hourOffset: 3, valid_time: '2026-07-19T15:00:00Z' }, 21, 19, 30))).toBe('base');
    const b = setup();
    const away = { ...FINE_GRID, bounds: { west: -80, south: 10, east: -70, north: 20 }, cols: 11, rows: 11 };
    expect(b.engine.setWindData(b.gl, grid(away, 11, 11, 30))).toBe('fine');
    expect(b.engine._windFine.windGrid.__tierMosaic).toBeUndefined();
    expect(b.engine._windFine.windGrid.cols).toBe(11);
  });
});

describe('setWindData — never downgrade the resident fine overlay', () => {
  const { windBoundsContain } = require('./WebGLWindUtils');
  const FINE_1DEG = { ...FINE_GRID, bounds: { west: -95, south: 19, east: -84, north: 29 }, cols: 12, rows: 11 };   // 1.0 deg
  const MID_INSIDE = { ...FINE_GRID, bounds: { west: -92, south: 22, east: -86, north: 28 }, cols: 4, rows: 4 };   // 2.0 deg, inside
  const MID_OUTSIDE = { ...FINE_GRID, bounds: { west: -82, south: 22, east: -76, north: 28 }, cols: 4, rows: 4 };  // 2.0 deg, panned away
  const FINER_INSIDE = { ...FINE_GRID, bounds: { west: -91, south: 23, east: -87, north: 27 }, cols: 17, rows: 17 }; // 0.25 deg
  const setup = () => {
    const { gl } = makeMockGL();
    const engine = new WebGLWindEngine();
    engine.setWindData(gl, grid(GLOBAL_GRID, 37, 17, 20));
    expect(engine.setWindData(gl, grid(FINE_1DEG, 12, 11, 30))).toBe('fine');
    return { gl, engine };
  };
  afterEach(() => { delete window.__RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__; });

  it('ignores a coarser grid inside the resident fine box (the live z9 case)', () => {
    const { gl, engine } = setup();
    const before = engine._windFine;
    expect(engine.setWindData(gl, grid(MID_INSIDE, 4, 4, 25))).toBe('noop_coarser_than_fine');
    expect(engine._windFine).toBe(before);
  });
  it('still files a coarser grid that reaches outside the box (the view moved on)', () => {
    const { gl, engine } = setup();
    expect(engine.setWindData(gl, grid(MID_OUTSIDE, 4, 4, 25))).toBe('fine');
    expect(engine._windFine.windGrid.bounds).toEqual(MID_OUTSIDE.bounds);
  });
  it('a finer grid inside the box replaces it (sharpening is never blocked)', () => {
    const { gl, engine } = setup();
    expect(engine.setWindData(gl, grid(FINER_INSIDE, 17, 17, 31))).toBe('fine');
    expect(engine._windFine.windGrid.cols).toBe(17);
  });
  it('a different hour is not "compatible", so it files normally', () => {
    const { gl, engine } = setup();
    const later = { ...MID_INSIDE, hourOffset: 3, valid_time: '2026-07-19T15:00:00Z' };
    expect(engine.setWindData(gl, grid(later, 4, 4, 25))).not.toBe('noop_coarser_than_fine');
  });
  it('kill switch restores the old filing', () => {
    const { gl, engine } = setup();
    window.__RAW_DISABLE_WIND_COARSE_OVERLAY_GUARD__ = true;
    expect(engine.setWindData(gl, grid(MID_INSIDE, 4, 4, 25))).toBe('fine');
  });
  it('windBoundsContain: plain, edge, outside, antimeridian', () => {
    const a = { west: -95, south: 19, east: -84, north: 29 };
    expect(windBoundsContain(a, { west: -92, south: 22, east: -86, north: 28 })).toBe(true);
    expect(windBoundsContain(a, a)).toBe(true);
    expect(windBoundsContain(a, { west: -96, south: 22, east: -86, north: 28 })).toBe(false);
    expect(windBoundsContain(a, { west: -92, south: 18, east: -86, north: 28 })).toBe(false);
    expect(windBoundsContain({ west: 170, south: -10, east: -170, north: 10 }, { west: 175, south: -5, east: -175, north: 5 })).toBe(true);
    expect(windBoundsContain({ west: 170, south: -10, east: -170, north: 10 }, { west: -175, south: -5, east: -160, north: 5 })).toBe(false);
    expect(windBoundsContain(null, a)).toBe(false);
  });
});
