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
  windBaseOverlayEnabled
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

  it('HEATMAP_FS carries the complementary base-pass cutout', () => {
    expect(HEATMAP_FS).toMatch(/uniform\s+float\s+u_cutout_enabled\s*;/);
    expect(HEATMAP_FS).toMatch(/uniform\s+vec2\s+u_cutout_min\s*;/);
    expect(HEATMAP_FS).toMatch(/uniform\s+vec2\s+u_cutout_max\s*;/);
    // complementary fade: base alpha goes DOWN exactly where the overlay's edge fade goes up
    expect(HEATMAP_FS).toMatch(/alpha\s*\*=\s*\(1\.0\s*-\s*cw\)/);
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
    // valid_time drift beyond the 3-hourly snap (90 min) refuses
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, valid_time: '2026-07-19T15:00:00Z' })).toBe(false);
    // within the snap window passes (series frames are hourly, fine products 3-hourly)
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, valid_time: '2026-07-19T13:00:00Z' })).toBe(true);
    // missing valid_time on either side: hour/model checks alone decide
    expect(windGridsCompatible(GLOBAL_GRID, { ...FINE_GRID, valid_time: undefined })).toBe(true);
  });

  it('windBaseOverlayEnabled kill switch', () => {
    expect(windBaseOverlayEnabled({})).toBe(true);
    expect(windBaseOverlayEnabled({ __RAW_DISABLE_WIND_BASE_OVERLAY__: true })).toBe(false);
    expect(windBaseOverlayEnabled(null)).toBe(true);
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
  afterEach(() => { delete window.__RAW_DISABLE_WIND_BASE_OVERLAY__; });

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
