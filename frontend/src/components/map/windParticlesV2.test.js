/**
 * PARTICLES V2 (2026-10-08 wind zoom audit — audit/wind-zoom-2026-10-08/REPORT.md).
 *
 * Measured live (GFS/EURO/ICON, z2-z14, 961x914 css px, pool 147,456): on-screen density swung 12x
 * (476 -> 42 -> 138 marks per 100x100 css px at z2 / z7 / z9) with a cliff at z6->z7 where the shader
 * switches to tile-relative respawn; mean life was 0.1-0.2 s above 10 kn (leaders: 1-6 s); point
 * sprites beaded above ~35 kn; light/beach marks were pale because the brightness-alpha composite
 * cannot show a dark mark. Owner: "a good amount of animations visible, but it definitely needs to be
 * intended"; the z6 speed approved; density calibrated to INK parity with the approved look (below).
 *
 * CALIBRATION (kill __RAW_DISABLE_WIND_CALIBRATION_V2__): respawn only inside the padded viewport,
 * recycle on exit, draw-cull to a fixed screen density (12 heads, fade 0.93); ~2 s life; marks stretch by their own step;
 * the z6 speed (x1.16) everywhere with no min-step clamp.
 * THEME (kill __RAW_DISABLE_WIND_THEME_V2__): premultiplied trail buffer + one neutral body per theme +
 * single adaptive casing + near-opaque heads -> >= 3:1 against the field at every speed, every theme.
 */
import fs from 'fs';
import path from 'path';
import {
  resolveWindParticlesV2, v2GlobalBox, v2RespawnBox, v2KeepRate, v2DropRule, V2_DEFAULTS, V2_BODY,
  v2DensityAt, V2_CLOSE_INK, V2_SPEED_KEEP_INK, v2SpeedKeep, v2SpeedKeepUniform, windCasingFixedPole, v2TrailFade, V2_WIDE_TRAILS,
  v2SpeedKeepExp, V2_SPEED_KEEP_FADE,
} from './WebGLWindUtils';
import { ADVECT_FS, DRAW_VS, DRAW_FS, FADE_FS, SCREEN_FS } from './WebGLWindShaders';
import { THEME_RAMPS, sampleRamp } from './WindColorRamp';

const mercY = (lat) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2; };
const W = 961, H = 914, POOL = 384 * 384;

// The engine's viewport for a centre/zoom: map.getBounds() of a W x H css map.
function viewport(lat, lng, z, w = W, h = H) {
  const world = 512 * Math.pow(2, z), cx = (lng + 180) / 360, cy = mercY(lat);
  const latOf = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
  return [(cx - w / 2 / world) * 360 - 180, latOf(cy + h / 2 / world), (cx + w / 2 / world) * 360 - 180, latOf(cy - h / 2 / world)];
}
// Steady-state drawn heads per 100x100 css px: every live particle is inside the box (respawn there,
// recycled on exit), the screen holds pool x screen/box of them, the draw cull keeps `keep`.
function drawnPer100(z, w = W, h = H, pool = POOL, lat = 24, lng = -89.5) {
  const box = v2GlobalBox(viewport(lat, lng, z, w, h), V2_DEFAULTS.margin);
  const world = 512 * Math.pow(2, z);
  const boxArea = (box[2] - box[0]) * world * (box[3] - box[1]) * world;
  const inView = pool * Math.min(1, (w * h) / boxArea);
  return inView * v2KeepRate(v2DensityAt(resolveWindParticlesV2({}), z), w, h, pool, box, z) / (w * h / 1e4);
}

describe('resolver', () => {
  // SYNC (2026-10-08, owner: "we were close before you made major changes in v2 by making solid color particles").
  it('default = DENSITY control only, at the measured pre-v2 look (490); motion and neutral theme are opt-in', () => {
    const r = resolveWindParticlesV2({});
    expect(r).toMatchObject({ density: true, motion: false, theme: false, densityPer100: 490 });
  });
  it('opt-ins and kills', () => {
    expect(resolveWindParticlesV2({ __RAW_WIND_MOTION_V2__: true })).toMatchObject({ density: true, motion: true, theme: false, densityPer100: 12, fade: 0.93, speedMul: 1.16, lifeS: 2.0 });
    expect(resolveWindParticlesV2({ __RAW_WIND_THEME_V2__: true })).toMatchObject({ theme: true, composite: 0.95 });
    expect(resolveWindParticlesV2({ __RAW_WIND_THEME_V2__: true, __RAW_DISABLE_WIND_THEME_V2__: true }).theme).toBe(false);
    expect(resolveWindParticlesV2({ __RAW_DISABLE_WIND_DENSITY_V2__: true }).density).toBe(false);
    expect(resolveWindParticlesV2({ __RAW_DISABLE_WIND_CALIBRATION_V2__: true, __RAW_WIND_MOTION_V2__: true })).toMatchObject({ density: false, motion: false });
  });
  it('levers are clamped and junk is ignored', () => {
    expect(resolveWindParticlesV2({ __RAW_WIND_V2_DENSITY__: 9999 }).densityPer100).toBe(2000);
    expect(resolveWindParticlesV2({ __RAW_WIND_V2_SPEED__: 0 }).speedMul).toBe(0.25);
    expect(resolveWindParticlesV2({ __RAW_WIND_V2_LIFE_S__: '3' }).lifeS).toBe(2.0);
    expect(resolveWindParticlesV2({ __RAW_WIND_V2_OPACITY__: NaN }).composite).toBe(0.95);
    expect(resolveWindParticlesV2({ __RAW_WIND_V2_FADE__: 0.5 }).fade).toBe(0.8);
  });
});

describe('density is a design constant, not an accident of zoom', () => {
  // The target is INK parity with the shipped look, calibrated on the GPU (2026-10-08 A/B, real shaders): long-lived
  // heads drag tails, so the shipped head count (~130) carpeted 95% of the field; 12 heads + fade 0.93 matched the
  // shipped dark ink (mean alpha 0.112 vs 0.094, coverage 19% vs 12%). Held at EVERY zoom.
  // SYNC: the default target is the owner-approved pre-v2 look measured on dev (z2 487, z6 493 marks per 100x100
  // css px; the trough it removes: z3 173, z4 78, z5 216). Opt-in v2 motion uses its own 12-head ink-parity value.
  // CLOSE-ZOOM INK (2026-10-08, owner: "I see diamonds now in the red wind"): a flat head count is NOT a flat look — above
  // z6 each mark lays far more ink, so 490 saturated the trail buffer. The design constant is the INK, held by the curve.
  it.each([1, 2, 3, 4, 5, 6, 6.2, 7, 7.5, 8, 9, 10, 11, 12, 14])('z%d draws the designed density for its zoom', (z) => {
    expect(drawnPer100(z)).toBeCloseTo(v2DensityAt(resolveWindParticlesV2({}), z), 1);
  });
  it('the measured shipped curve swung 12x; v2 is flat from z2 to z6, where a mark lays the same ink', () => {
    const shipped = [476, 187, 100, 294, 257, 42, 124, 138, 54, 40, 56];        // GFS, z2..z12 (REPORT.md)
    expect(Math.max(...shipped) / Math.min(...shipped)).toBeGreaterThan(11);
    const v2 = [2, 3, 4, 5, 6].map((z) => drawnPer100(z));
    expect(Math.max(...v2) / Math.min(...v2)).toBeLessThan(1.02);
  });
  it('a phone with a smaller pool still reaches the target (390x844, pool 256^2)', () => {
    expect(drawnPer100(9, 390, 844, 256 * 256)).toBeCloseTo(v2DensityAt(resolveWindParticlesV2({}), 9), 1);
  });
  it('a pool too small for a huge screen draws everything it has (keep capped at 1), never more', () => {
    const box = v2GlobalBox(viewport(24, -89.5, 9, 3840, 2160), V2_DEFAULTS.margin);
    expect(v2KeepRate(500, 3840, 2160, 64 * 64, box, 9)).toBe(1);
  });
});

describe('close-zoom ink: above z6 the density holds the owner-approved close-up ink, not the z<=6 head count', () => {
  const v2 = resolveWindParticlesV2({ __RAW_DISABLE_WIND_SPEED_KEEP__: true });   // the #278 curve (no speed cull)
  // Live on dev 744a7132 (Gulf hurricane, 961x914 css px): the dose giving mean trail-buffer brightness ~150/255, the
  // owner-approved close-up ink (pre-#276: z6 156, z9 147). Flat 490 measured 201-233 there = saturation (z7.5: 99.8%
  // of the screen inked vs 19.4% pre-#276; the top-speed grid cells read as solid dark diamonds).
  it.each([[6.5, 165], [7, 120], [8, 70], [9, 45], [10, 32], [11.5, 30]])('z%d is within 15%% of the measured dose %d', (z, dose) => {
    expect(Math.abs(v2DensityAt(v2, z) / dose - 1)).toBeLessThan(0.15);
  });
  it('z<=6 keeps the owner-approved 490; the curve never rises with zoom and floors at the measured z11.5 dose', () => {
    [1, 3, 5, 6].forEach((z) => expect(v2DensityAt(v2, z)).toBe(490));
    let prev = Infinity;
    for (let z = 6.01; z <= 14; z += 0.25) { const d = v2DensityAt(v2, z); expect(d).toBeLessThanOrEqual(prev); prev = d; }
    expect(v2DensityAt(v2, 14)).toBe(V2_CLOSE_INK.floor);
  });
  it('POSITIVE CONTROL: the #276 flat target is over 3x the close-zoom dose from z7.5 on', () => {
    [7.5, 9, 12].forEach((z) => expect(V2_DEFAULTS.densityPer100 / v2DensityAt(v2, z)).toBeGreaterThan(3));
    [7.5, 9, 12].forEach((z) => expect(V2_DEFAULTS.densityPer100 / v2DensityAt(resolveWindParticlesV2({}), z)).toBeGreaterThan(3));
  });
  it('a numeric density lever stays flat at every zoom; opt-in motion keeps its own value; the kill restores flat 490', () => {
    expect(v2DensityAt(resolveWindParticlesV2({ __RAW_WIND_V2_DENSITY__: 100 }), 9)).toBe(100);
    expect(v2DensityAt(resolveWindParticlesV2({ __RAW_WIND_MOTION_V2__: true }), 9)).toBe(12);
    expect(v2DensityAt(resolveWindParticlesV2({ __RAW_DISABLE_WIND_CLOSEZOOM_INK__: true }), 9)).toBe(490);
  });
  it('the engine draws the zoom-resolved density', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(src).toContain('v2KeepRate(v2DensityAt(_v2, z), ');
  });
});

describe('speed-aware keep: ink per area stops tracking speed (no speed-shaped patches)', () => {
  const CAP = 1 / 6, RATE = 0.002, BUMP = 0.008;                     // resolveWindMotionFloor + engine defaults
  const legacyLife = (s) => 1 / (RATE + s * BUMP);                   // frames, before the motion floor
  const flooredLife = (s) => 1 / Math.min(RATE + s * BUMP, CAP);     // frames, as drawn since #268
  it('POSITIVE CONTROL: without the keep, a 45 kn mark out-inks a 15 kn one by >2x (ink ~ speed x life)', () => {
    expect((45 * flooredLife(45)) / (15 * flooredLife(15))).toBeGreaterThan(2);
  });
  it('the keep is exactly legacy-life / floored-life, so kept ink per area equals the legacy rule at every speed', () => {
    for (let s = 0; s <= 80; s += 0.5) {
      expect(v2SpeedKeep(s, CAP, RATE, BUMP) * flooredLife(s)).toBeCloseTo(legacyLife(s), 9);
    }
    expect(v2SpeedKeep(10, CAP, RATE, BUMP)).toBe(1);                // under the floor nothing is culled
    expect(v2SpeedKeep(45, CAP, RATE, BUMP)).toBeCloseTo(0.46, 2);
  });
  it('z<=6 is untouched (490, no cull); the full cull at z6.5-7.5 lifts the count ~1.6x; by z9.5 it is the #278 curve', () => {
    const on = resolveWindParticlesV2({}), off = resolveWindParticlesV2({ __RAW_DISABLE_WIND_SPEED_KEEP__: true });
    expect(on.speedKeep).toBe(true);
    [3, 6].forEach((z) => { expect(v2DensityAt(on, z)).toBe(490); expect(v2SpeedKeepUniform(on, z, CAP, RATE, BUMP, {})[0]).toBe(0); });
    [6.5, 7, 7.5].forEach((z) => { expect(v2DensityAt(on, z) / v2DensityAt(off, z)).toBeGreaterThan(1.5); expect(v2SpeedKeepUniform(on, z, CAP, RATE, BUMP, {})).toEqual([1, CAP, RATE, BUMP]); });
    expect(v2SpeedKeepUniform(on, 8.5, CAP, RATE, BUMP, {})[0]).toBeCloseTo(0.5, 12);
    expect(v2DensityAt(on, 7)).toBeCloseTo(V2_SPEED_KEEP_INK.atZ6 * Math.pow(2, -V2_SPEED_KEEP_INK.halvingsPerZoom), 9);   // full cull = its own curve
    [9.5, 10, 12, 14].forEach((z) => { expect(v2DensityAt(on, z)).toBeCloseTo(v2DensityAt(off, z), 12); expect(v2SpeedKeepUniform(on, z, CAP, RATE, BUMP, {})[0]).toBe(0); });
    let prev = Infinity; for (let z = 6.01; z <= 14; z += 0.1) { const d = v2DensityAt(on, z); expect(d).toBeLessThanOrEqual(prev + 1e-9); prev = d; }
  });
  it('the cull fades with zoom: exact at z7, off where trails bead (bench: storm/slow brightness 0.76 at z8.5-z10 at full strength)', () => {
    expect(v2SpeedKeepExp(7)).toBe(1); expect(v2SpeedKeepExp(7.5)).toBe(1); expect(v2SpeedKeepExp(9.5)).toBe(0); expect(v2SpeedKeepExp(11)).toBe(0);
    expect(v2SpeedKeepExp(8.5)).toBeCloseTo(0.5, 12);
    expect(V2_SPEED_KEEP_FADE).toEqual({ fullBelowZ: 7.5, offFromZ: 9.5 });
  });
  it('kills and levers: the kill, a numeric density lever, motion v2 and density-off all switch the cull off', () => {
    [{ __RAW_DISABLE_WIND_SPEED_KEEP__: true }, { __RAW_WIND_V2_DENSITY__: 80 }, { __RAW_WIND_MOTION_V2__: true }, { __RAW_DISABLE_WIND_DENSITY_V2__: true }]
      .forEach((lev) => expect(v2SpeedKeepUniform(resolveWindParticlesV2(lev), 7, CAP, RATE, BUMP, {})[0]).toBe(0));
  });
  it('the cull runs AFTER the speed is known, and only through the uniform', () => {
    const vs = DRAW_VS, iSpeed = vs.indexOf('v_speed = length(wind);'), iCull = vs.indexOf('if (p_rand > keepRate)');
    expect(iSpeed).toBeGreaterThan(0);
    expect(iCull).toBeGreaterThan(iSpeed);
    expect(vs.split('if (p_rand > keepRate)').length - 1).toBe(1);
    expect(vs).toContain('if (u_v2_speedkeep.x > 0.0) keepRate *= pow(min(1.0, u_v2_speedkeep.y / (u_v2_speedkeep.z + v_speed * u_v2_speedkeep.w)), u_v2_speedkeep.x);');
  });
});

describe('fixed casing pole: no grid-cell-shaped holes where the field crosses the luminance threshold', () => {
  // Live scan (dev 74ce023c, dark, z8.58, Gulf hurricane): the per-pixel pole cut two holes at the owner's two spots
  // (ink 0.56 / 0.69 of the surrounding ring, 43 / 42 kn, field Y 0.175 / 0.181); one pole: 0 artifact clusters.
  it('default on; the kill restores the per-pixel pole', () => {
    expect(windCasingFixedPole({})).toBe(true);
    expect(windCasingFixedPole({ __RAW_DISABLE_WIND_FIXED_CASING__: true })).toBe(false);
  });
  it('DRAW_FS gates the per-pixel step behind u_casing_fixed', () => {
    expect(DRAW_FS).toContain('float fieldIsBright = (u_casing_fixed > 0.5) ? 1.0 : step(0.179, fieldY);');
  });
  it('the engine binds both uniforms on the draw program', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
    expect(src).toContain("'u_casing_fixed'), windCasingFixedPole() ? 1 : 0)");
    expect(src).toContain("'u_v2_speedkeep'), v2SpeedKeepUniform(_v2, z, resolveWindMotionFloor(");
  });
});

describe('wide-zoom trails: zoomed out reads as dense as up close, at no extra particle cost', () => {
  // Bench (real engine, WebGL2, 60 fps; synthetic climatology + Holland hurricane): ink z2/z3/z4/z5 at fade 0.965 =
  // 105/109/104/91, at 0.985 = 143/148/143/126, a 512^2 pool = 105/110/105/92 (the density target, not the pool, binds).
  const v2 = resolveWindParticlesV2({}), BASE = 0.965;
  it('POSITIVE CONTROL: the wide fade keeps a trail more than twice as long (frames to 1/e)', () => {
    const tau = (f) => -1 / Math.log(f);
    expect(tau(V2_WIDE_TRAILS.fade) / tau(BASE)).toBeGreaterThan(2);
  });
  it('full wide fade at z<=5.5, the calibrated close-zoom fade from z6.5, linear between', () => {
    [2, 3, 5, 5.5].forEach((z) => expect(v2TrailFade(BASE, z, v2, {})).toBeCloseTo(0.985, 12));
    [6.5, 7, 9, 14].forEach((z) => expect(v2TrailFade(BASE, z, v2, {})).toBe(BASE));
    expect(v2TrailFade(BASE, 6, v2, {})).toBeCloseTo((0.985 + BASE) / 2, 12);
  });
  it('kill switch, opt-in motion v2 and density-off all keep the base fade', () => {
    expect(v2TrailFade(BASE, 3, v2, { __RAW_DISABLE_WIND_WIDE_TRAILS__: true })).toBe(BASE);
    expect(v2TrailFade(BASE, 3, resolveWindParticlesV2({ __RAW_WIND_MOTION_V2__: true }), {})).toBe(BASE);
    expect(v2TrailFade(BASE, 3, resolveWindParticlesV2({ __RAW_DISABLE_WIND_DENSITY_V2__: true }), {})).toBe(BASE);
  });
});

describe('respawn box', () => {
  it('pads the viewport by the margin in Mercator units', () => {
    const vb = viewport(24, -89.5, 9);
    const [x0, y0, x1, y1] = v2GlobalBox(vb, 0.1);
    const cx0 = (vb[0] + 180) / 360, cx1 = (vb[2] + 180) / 360;
    expect(x0).toBeCloseTo(cx0 - (cx1 - cx0) * 0.1, 12);
    expect(x1).toBeCloseTo(cx1 + (cx1 - cx0) * 0.1, 12);
    expect(y0).toBeLessThan(mercY(vb[3])); expect(y1).toBeGreaterThan(mercY(vb[1]));
  });
  it('handles antimeridian-crossing and unwrapped bounds', () => {
    const a = v2GlobalBox([170, -10, -170, 10], 0.1);
    expect(a[2] - a[0]).toBeCloseTo((20 / 360) * 1.2, 9);
    const b = v2GlobalBox([-189.3, -10, -156.2, 10], 0.1);
    expect(b[2] - b[0]).toBeCloseTo((33.1 / 360) * 1.2, 9);
  });
  it('a whole world in view respawns everywhere', () => {
    const w = v2GlobalBox([-300, -80, 300, 85], 0.1);
    expect([w[0], w[2]]).toEqual([0, 1]);
  });
  it('converts to tile-relative coordinates in the same world copy as the tile (z > 6)', () => {
    const vb = viewport(24, -89.5, 9);
    const g = v2GlobalBox(vb, 0.1);
    const tw = 1 / Math.pow(2, 9 - 3), cx = (g[0] + g[2]) / 2, cy = (g[1] + g[3]) / 2;
    const t = v2RespawnBox(g, true, cx - tw / 2, cy - tw / 2, tw);
    expect((t[0] + t[2]) / 2).toBeCloseTo(0.5, 9);
    expect(t[2] - t[0]).toBeCloseTo((g[2] - g[0]) / tw, 9);
    const shifted = v2RespawnBox([g[0] - 1, g[1], g[2] - 1, g[3]], true, cx - tw / 2, cy - tw / 2, tw);
    shifted.forEach((v, i) => expect(v).toBeCloseTo(t[i], 12));   // an unwrapped copy lands in the tile's world copy
    expect(v2RespawnBox(g, false, 0, 0, 1)).toBe(g);   // z <= 6: global space as-is
  });
});

describe('lifetime and motion', () => {
  it('~2 s at calm and ~0.9 s at the grid max — the leaders\' range, not 0.1-0.2 s', () => {
    const [base, bump] = v2DropRule(2.0);
    expect(1 / base / 60).toBeCloseTo(2.0, 9);
    expect(1 / (base + bump) / 60).toBeGreaterThan(0.85);
    expect(1 / (base + bump) / 60).toBeLessThan(1.0);
  });
  it('the step runs at the owner-approved z6 speed everywhere (x1.16 of nominal, no clamp)', () => {
    expect(V2_DEFAULTS.speedMul).toBeCloseTo(1.16, 9);
    expect(0.55 * V2_DEFAULTS.speedMul * 0.00025 * 512).toBeCloseTo(0.0817, 3);   // css px per kn per 60 Hz frame
  });
  it('stretched stamps always overlap (no beads): consecutive centres are one step apart, half-lengths (base+step)/2', () => {
    for (const base of [2.5, 3.073, 5, 12.5]) for (const step of [0.1, 1, 3, 5, 8, 20]) {
      expect((base + step) / 2 + (base + step) / 2 - step).toBeGreaterThan(0);   // overlap = base
    }
  });
});

describe('theme contrast: >= 3:1 against the field at every speed, every theme (WCAG 1.4.11)', () => {
  // Mirrors HEATMAP_FS / DRAW_FS field composite: fieldA = opacity*(baseA + (1-baseA)*smoothstep(0,rampEnd,s)),
  // fieldY = mix(basemapY, rampY, fieldA); the mark is composited premultiplied at composite*alpha(s); the
  // casing ring takes the pole opposite the field (Y split 0.179). The separating edge is whichever is stronger.
  const lin = (c) => Math.pow(c, 2.2);
  const Y = (rgb) => 0.2126729 * lin(rgb[0]) + 0.7151522 * lin(rgb[1]) + 0.0721750 * lin(rgb[2]);
  const ss = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  const CR = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  const FIELD = {   // engine heatmapOpacity, HEATMAP_FS baseAlpha/rampEnd, engine _basemapY
    dark: { opacity: 0.48, baseA: 0.44, rampEnd: 5, basemapY: 0.02 },
    light: { opacity: 0.65, baseA: 0.42, rampEnd: 7, basemapY: 0.72 },
    beach: { opacity: 0.55, baseA: 0.45, rampEnd: 7, basemapY: 0.30 },
  };
  const SPEEDS = [0, 2, 5, 8, 12, 17, 22, 28, 34, 41, 47, 55, 63, 75];
  it.each(['dark', 'light', 'beach'])('%s', (theme) => {
    const f = FIELD[theme], bodyY = Y(V2_BODY[theme]);
    for (const s of SPEEDS) {
      const c = sampleRamp(THEME_RAMPS[theme], s);
      const fA = f.opacity * (f.baseA + (1 - f.baseA) * ss(0, f.rampEnd, s));
      const fY = f.basemapY + (Y(c) - f.basemapY) * fA;
      const a = V2_DEFAULTS.composite * (0.85 + 0.15 * ss(0, 40, s));
      const body = CR(fY + (bodyY - fY) * a, fY);
      const ring = CR(fY + ((fY >= 0.179 ? 0 : 1) - fY) * a * 0.98, fY);
      expect(Math.max(body, ring)).toBeGreaterThanOrEqual(3.0);
    }
  });
  it('POSITIVE CONTROL: the shipped pipeline (composite 0.48, brightness alpha) cannot reach 3:1 in light mode', () => {
    // a dark ring composites at alpha = brightness ~ 0 -> invisible; only the white inner ring shows
    const f = FIELD.light;
    const worst = Math.min(...SPEEDS.map((s) => {
      const c = sampleRamp(THEME_RAMPS.light, s);
      const fY = f.basemapY + (Y(c) - f.basemapY) * f.opacity * (f.baseA + (1 - f.baseA) * ss(0, f.rampEnd, s));
      return CR(fY + (1 - fY) * 0.48 * 0.92, fY);   // white inner ring at the legacy composite
    }));
    expect(worst).toBeLessThan(3.0);
  });
});

describe('shader wiring', () => {
  it('advect: v2 drop rule, recycle on exit, respawn inside the box', () => {
    expect(ADVECT_FS).toMatch(/uniform float u_v2_density; uniform float u_v2_motion; uniform vec4 u_v2_box; uniform vec2 u_v2_drop;/);
    expect(ADVECT_FS).toContain('if (u_v2_motion > 0.5) dropRate = max(u_v2_drop.x + u_v2_drop.y * clamp(speed / max(u_speed_max, 1.0), 0.0, 1.0), speed < 1.0 ? 0.04 : 0.0);');
    expect(ADVECT_FS).toContain('drop = max(drop, 1.0 - inX * step(u_v2_box.y, nextPos.y) * step(nextPos.y, u_v2_box.w));');
    expect(ADVECT_FS).toContain('newPos = mix(u_v2_box.xy, u_v2_box.zw, randVal); if (u_zoom <= 6.0) newPos.x = fract(newPos.x);');
    // ordering: the v2 rule precedes the vortex lever and the motion floor, which still apply on top
    expect(ADVECT_FS.indexOf('u_v2_drop.x')).toBeLessThan(ADVECT_FS.indexOf('mix(1.0, 0.35, vortexGate)'));
  });
  it('draw: density cull and step stretch; the fragment stays a dash of the base width', () => {
    expect(DRAW_VS).toContain('if (u_v2_density > 0.5) keepRate = u_v2_keep;');
    expect(DRAW_VS).toContain('if (u_v2_motion > 0.5 && gl_PointSize > 0.0) {');   // the stretch belongs to MOTION
    expect(DRAW_VS).toMatch(/v_stretch = \(gl_PointSize \+ stepPx\) \/ gl_PointSize; gl_PointSize \+= stepPx;/);
    expect(DRAW_FS).toContain('localCoord = vec2(along.x, along.y * elong * max(v_stretch, 1.0));');
  });
  it('theme: neutral body, single casing, speed -> opacity; premultiplied fade and composite', () => {
    expect(DRAW_FS).toContain('if (u_v2_theme > 0.5) rgb = u_v2_body;');
    expect(DRAW_FS).toContain('inner * 0.92 * (1.0 - max(u_v2_theme, u_single_casing))');
    expect(DRAW_FS).toContain('(u_v2_theme > 0.5 ? mix(0.85, 1.0, smoothstep(0.0, 40.0, v_speed)) : color.a)');
    expect(FADE_FS).toContain('u_premul > 0.5 ? floor(color * 255.0 * u_fade) / 255.0 :');
    expect(SCREEN_FS).toContain('u_premul > 0.5 ? color * u_opacity :');
  });
});

describe('engine wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, 'WebGLWindEngine.js'), 'utf8');
  it('speed and fade: the v2 values apply only under opt-in MOTION (the default keeps the pre-v2 step and fade)', () => {
    expect(src).toContain('const stableSpeedScale = ((z > 6.0 || _v2.motion)');
    expect(src).toContain('(this.speedFactor * (_v2.motion ? _v2.speedMul : 1) * Math.pow(0.5, z) * 0.00025)');
    expect(src).toContain('perFrameFade(_v2.motion ? _v2.fade : v2TrailFade(this.fadeOpacity, z, _v2)');
  });
  it('binds every v2 uniform on the programs that declare it', () => {
    for (const u of ['u_v2_density', 'u_v2_motion', 'u_v2_box', 'u_v2_drop']) expect(src).toContain(`this.advectProgram, '${u}')`);
    for (const u of ['u_v2_density', 'u_v2_motion', 'u_v2_keep', 'u_v2_px_per_kn', 'u_v2_speed_max', 'u_v2_gamma', 'u_v2_theme', 'u_v2_body']) expect(src).toContain(`this.drawProgram, '${u}')`);
    expect(src).toContain("this.fadeProgram, 'u_premul')");
    expect(src).toContain("this.screenProgram, 'u_premul')");
  });
  it('premultiplied composite: ONE / ONE_MINUS_SRC_ALPHA, a clean buffer on every mode flip, the v2 composite opacity', () => {
    expect(src).toContain('gl.blendFunc(_premul ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);');   // _premul = _v2.theme || speed-coloured premul (windLightTheme.test.js)
    expect(src).toMatch(/if \(this\._v2Premul !== _premul\) \{ this\._v2Premul = _premul;/);
    expect(src).toContain('_premul = _v2.theme || _pm.on');
    expect(src).toContain("'u_opacity'), _v2.theme ? _v2.composite : (_pm.on ? _pm.opacity : finalOpacity) * windCloseLandFactor(effectiveTheme, z))"); // close-zoom land: windCloseLand.test.js
  });
});
