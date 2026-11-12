/**
 * marineMotionDirection.test.js: which way does every moving element of the marine layers go? (2026-11-11, owner report:
 * "I'm seeing opposing wave animations in all the marine layers"). Diagnosis only; nothing here changes a picture.
 * Log: docs/weather-program/log/2026-11-11-claude-marine-motion-direction.md.
 *
 * A known input (waves coming FROM 270 deg, i.e. travelling EAST, plus the other three compass points) is pushed through the
 * same chain the GPU runs: direction -> stored u/v (backend normalizer + both client encoders) -> texture bytes (the real
 * packStaticFrame) -> shader decode (rg * 2 - 1, y negated for Mercator) -> screen (a north-up camera matrix) -> each moving
 * element: particle drift (ADVECT_FS), wave-train band (the real crestLocalPhase JS mirror), foam roll (DRAW_FS), orbital
 * pitch (DRAW_VS), and the rating band's shimmer (HEATMAP_FS). Shader lines the mirrors stand for are pinned by text, so a
 * shader edit that changes a sign fails here.
 */
import fs from 'fs';
import path from 'path';
import { packStaticFrame } from './marineFramePack';
import { createCrestPhaseState, stepCrestPhase, localCrestBand } from './crestLocalPhase';
import { waveSetFreq, viewWorldWidth } from './waveSetScreenBound';
import { NATURAL_ANIM_DEFAULTS } from './marineEngineDecisions';
import { ORBITAL_SWAY_PX } from './oneWayCrests';
import { ADVECT_FS, DRAW_VS, DRAW_FS } from './WebGLMarineParticleShaders';
import { HEATMAP_FS } from './WebGLMarineShaders';

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const DEG = Math.PI / 180;
// FROM direction -> expected travel unit vector in GEOGRAPHIC (east, north) and in MERCATOR (x east, y SOUTH).
const CASES = [
  { from: 270, name: 'W -> travels E', geo: [1, 0] },
  { from: 0, name: 'N -> travels S', geo: [0, -1] },
  { from: 90, name: 'E -> travels W', geo: [-1, 0] },
  { from: 180, name: 'S -> travels N', geo: [0, 1] },
];
const merc = (geo) => [geo[0], -geo[1]];
const close = (a, b, eps = 0.02) => a.every((x, i) => Math.abs(x - b[i]) < eps);

// The production u/v convention (frame_binary uv_convention 0): u = -h sin d, v = -h cos d, d = where waves come FROM.
const towardUV = (h, d) => [-h * Math.sin(d * DEG), -h * Math.cos(d * DEG)];
// Shader decode: waveVec = rg * 2 - 1, then waveVec.y = -waveVec.y (ADVECT_FS, DRAW_VS, particleRk2 midpoint).
const decode = (r, g) => [r / 255 * 2 - 1, -(g / 255 * 2 - 1)];

describe('1. direction convention: FROM -> toward, one convention for every layer and source', () => {
  test('backend writes u = -h sin d, v = -h cos d everywhere it builds vectors (all layers share the normalizer)', () => {
    const be = (rel) => fs.readFileSync(path.join(__dirname, '../../../../backend/services/weather_pipeline', rel), 'utf8');
    expect(be('normalizer.py')).toContain('u = -speed * math.sin(rad)');
    expect(be('normalizer.py')).toContain('v = -speed * math.cos(rad)');
    expect(be('consensus_product.py')).toContain('round(-c["hs"] * math.sin(rad), 4), round(-c["hs"] * math.cos(rad), 4)');
    expect(be('far_edge_bridge.py')).toContain('"u": round(-h * math.sin(rad), 4), "v": round(-h * math.cos(rad), 4)');
  });
  test('both client encoders synthesise the same toward vector from a FROM direction when u/v are absent', () => {
    expect(read('WebGLMarineTextureEncoder.js')).toMatch(/uVal = -Math\.sin\(dirRad\);\s*vVal = -Math\.cos\(dirRad\);/);
    expect(read('marineFramePack.js')).toMatch(/uVal = -Math\.sin\(rad\);\s*vVal = -Math\.cos\(rad\);/);
  });
  test.each(CASES)('stored u/v for waves FROM $from ($name) point the way the waves travel', ({ from, geo }) => {
    const [u, v] = towardUV(1, from);
    expect(close([u, v], geo, 1e-9)).toBe(true);
  });
});

describe('2. texture bytes -> shader decode -> Mercator heading (the real packStaticFrame)', () => {
  const frame = (from, uvConvention = 0) => {
    const C = 4, R = 4, n = C * R;
    const H = new Float64Array(n).fill(2), D = new Float64Array(n).fill(from), P = new Float64Array(n).fill(12);
    return { cols: C, rows: R, bounds: { west: -130, east: -127, south: 30, north: 33 }, fields: { 0: H, 1: D, 2: P }, uvConvention };
  };
  test.each(CASES)('FROM $from ($name): the decoded Mercator heading is the travel direction', ({ from, geo }) => {
    const packed = packStaticFrame(frame(from), { layer: 'waves', win: {} });
    expect(packed).toBeTruthy();
    const i = 5 * 4;   // an interior texel
    const dir = decode(packed.bytes[i], packed.bytes[i + 1]);
    expect(close(dir, merc(geo))).toBe(true);
  });
  test('the 0/360 wrap and the diagonals: FROM 360 packs the same bytes as FROM 0; FROM 45 travels SW, FROM 225 travels NE', () => {
    const bytesOf = (from) => Array.from(packStaticFrame(frame(from), { layer: 'waves', win: {} }).bytes.slice(20, 22));
    expect(bytesOf(360)).toEqual(bytesOf(0));
    expect(bytesOf(359.99)).toEqual(bytesOf(0));
    const r = Math.SQRT1_2;
    const dirOf = (from) => { const b = bytesOf(from); return decode(b[0], b[1]); };
    expect(close(dirOf(45), merc([-r, -r]))).toBe(true);
    expect(close(dirOf(225), merc([r, r]))).toBe(true);
  });
  test('a MISSING direction (NaN) on a valid height: characterised, not fixed (see the log)', () => {
    const f = frame(0); f.fields[1] = new Float64Array(16).fill(NaN);
    const b = packStaticFrame(f, { layer: 'waves', win: {} }).bytes;
    // packStaticFrame reads a NaN direction as 0 deg, so the texel carries FROM-north = travels south. Record what it does.
    const dir = decode(b[20], b[21]);
    expect(close(dir, merc([0, -1]))).toBe(true);
  });
  test('the shader negates y in every pass that reads the field (advect, draw, RK2 midpoint)', () => {
    expect((ADVECT_FS.match(/waveVec\.y = -waveVec\.y;/g) || []).length).toBe(1);
    expect((DRAW_VS.match(/waveVec\.y = -waveVec\.y;/g) || []).length).toBe(1);
    expect(read('particleRk2.js')).toContain('wv.y = -wv.y;');
    expect(ADVECT_FS).toContain('vec2 waveVec = waveData.rg * 2.0 - 1.0;');
    expect(DRAW_VS).toContain('vec2 waveVec = waveData.rg * 2.0 - 1.0;');
  });
});

// A north-up camera (as MapLibre builds it): clip.x grows east, clip.y grows NORTH (Mercator y grows south).
const S = 1000, VIEW = [1000, 800];
const pixelDeltaOf = (dir) => { const c0 = [S, 0], c1 = [0, -S];   // u_matrix[0].xy, u_matrix[1].xy
  return [(dir[0] * c0[0] + dir[1] * c1[0]) * VIEW[0], (dir[0] * c0[1] + dir[1] * c1[1]) * VIEW[1]]; };
const unit = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l]; };
// GL pixels have y UP, so the expected screen heading equals the GEOGRAPHIC (east, north) heading.

describe('3. Mercator -> screen and each moving element, for each compass input', () => {
  test.each(CASES)('crest orientation (DRAW_VS waveDir) for FROM $from points $name on screen', ({ geo }) => {
    expect(DRAW_VS).toContain('vec2 pixelDelta = (dir.x * matCol0 + dir.y * matCol1) * u_viewport;');
    expect(close(unit(pixelDeltaOf(merc(geo))), geo)).toBe(true);
  });

  test.each(CASES)('particle drift (ADVECT_FS offset = +waveVec * ...) for FROM $from moves $name', ({ geo }) => {
    expect(ADVECT_FS).toContain('vec2 offset = (waveVec * driftHeight * 0.1 / merc_scale) * u_speed_scale * energyBoost;');
    expect(ADVECT_FS).toContain('nextPos = pos + offset;');
    const offset = merc(geo).map((c) => c * 2 * 0.1 * 1e-6);   // positive scale
    expect(close(unit(pixelDeltaOf(offset)), geo)).toBe(true);
  });

  test.each(CASES)('wave-train band (crestLocalPhase, ON by default) for FROM $from travels $name', ({ geo }) => {
    expect(DRAW_VS).toContain("vec2 localBand = crestLocalBand(global_pos, dir0, periodVal");
    const dir = merc(geo), T = 12, w = viewWorldWidth(1400, 6), freq = (t) => waveSetFreq(t, w);
    const st = createCrestPhaseState(), anchor = [0.3, 0.4];
    // phase(p, t) = s * F - theta(t), s = (p - anchor) . dir; a crest is a fixed phase, so it moves along +dir iff the phase
    // RISES along +dir and FALLS with time at a fixed point. Measured over 8 frames each, on the real JS mirror.
    const at = (s) => [anchor[0] + dir[0] * s, anchor[1] + dir[1] * s];
    stepCrestPhase(st, 0, 1, anchor);
    const unwrapStep = (a, b) => { let d = b - a; d -= Math.round(d); return d; };
    for (let f = 1; f <= 8; f++) {
      const before = localCrestBand(at(1e-4), dir, T, st, freq).phase;
      stepCrestPhase(st, f / 60, 1, anchor);
      const after = localCrestBand(at(1e-4), dir, T, st, freq).phase;
      expect(unwrapStep(before, after)).toBeLessThan(0);                       // falls with time
      const ahead = localCrestBand(at(1e-4 + 1e-5), dir, T, st, freq).phase;
      expect(unwrapStep(after, ahead)).toBeGreaterThan(0);                     // rises along +dir
    }
    // and the crest's travel per frame is a small fraction of the set spacing (no wagon-wheel): dtheta = m dt / T << 1/4
    expect((1 / 60) / Math.max(2, T)).toBeLessThan(0.25);
    expect(0.25 / 4).toBeLessThan(0.25);   // even at the 0.25 s frame clamp and the shortest class (4 s): 1/16 of a set
  });

  test('foam roll (DRAW_FS) sweeps toward the leading (+waveDir) side as the phase advances', () => {
    expect(DRAW_FS).toContain('float waveLocal = clamp(-acrossCrest * 0.5 + 0.5, 0.0, 1.0);');
    expect(DRAW_FS).toContain('float rollFront = fract(v_phase);');
    // v_phase = fract(s * F - theta), theta grows with time -> v_phase falls -> the front (waveLocal == rollFront) moves to
    // larger acrossCrest, and acrossCrest = +1 is the +waveDir corner (DRAW_VS: + waveDir * cornerUV.y * deviceHalfThickness).
    expect(DRAW_VS).toContain('+ waveDir * cornerUV.y * deviceHalfThickness;');
    const frontAcross = (vphase) => -(2 * vphase - 1);   // solve -a*0.5+0.5 = vphase
    expect(frontAcross(0.4)).toBeGreaterThan(frontAcross(0.6));
  });
});

// The shipped constants that set how far a dash moves, read from the source so a retune moves these numbers too.
const SPEED_FACTOR = Number(read('WebGLMarineEngine.js').match(/this\.speedFactor = ([0-9.]+);/)[1]);
// 2026-11-12 (one-way crests): the pitch DEFAULT is now 0 (oneWayCrests.js). Section 4 characterises the sway the kill switch
// window.__RAW_DISABLE_ONE_WAY_CRESTS__ restores; oneWayCrests.test.js pins that the default has no backward dash.
const PITCH_PX = ORBITAL_SWAY_PX;
const motionScaleAt = (z) => { const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return (0.75 + 0.25 * ss(4, 7, z)) * (z < 6 ? 0.75 + 0.25 * ss(3, 6, z) : 1); };
/** Dash drift in CSS px/s: ADVECT_FS offset per frame x fps, world = 512 * 2^z CSS px (WebGLMarineEngine stableSpeedScale). */
function driftPxPerSec({ h, lat, z, fps = 60, cap = 3 }) {
  const hd = Math.min(h, cap), ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const scale = SPEED_FACTOR * 0.5 ** Math.max(0, z - 6) * 1.5e-5 * motionScaleAt(z);
  return hd * 0.1 / Math.max(0.1, Math.cos(lat * DEG)) * scale * (1 + ss(1, 5, h) * 0.3) * fps * 512 * 2 ** z;
}
/** Peak sway speed in CSS px/s: pixel0 += waveDir * sin(2 pi phase) * pitch, phase falling at m / T cycles per second. */
const swayPeakPxPerSec = (T, z) => PITCH_PX * 2 * Math.PI * motionScaleAt(z) / Math.max(2, T);
/** Band (crest) speed in CSS px/s: one set spacing per T / m seconds. */
const bandPxPerSec = (T, z) => (512 * 2 ** z / waveSetFreq(T, viewWorldWidth(1400, z))) * motionScaleAt(z) / Math.max(2, T);

describe('4. THE FINDING: orbital pitch moves the trough dashes AGAINST the swell (the default until 2026-11-12; now only under the one-way-crests kill)', () => {
  test('the sway the kill restores is 2.5 px, off by default, and phase-locked to the band (forward under the crest, back under the trough)', () => {
    expect(PITCH_PX).toBe(2.5);
    expect(NATURAL_ANIM_DEFAULTS.__RAW_ORBITAL_PITCH__).toBe(0);
    expect(DRAW_VS).toContain('pixel0 += waveDir * sin(orbPhase) * u_orbitalPitch * dpr;');
    // the band peak sits at phase 0.5 (crestBand = 1 - smoothstep(0.08, 0.30, |fract(ph) - 0.5|)); d/dt sin(2 pi ph) with ph
    // falling = -2 pi cos(2 pi ph) * rate: + (forward) at ph 0.5, - (backward) at ph 0 (the trough).
    const swayVel = (ph) => -Math.cos(2 * Math.PI * ph);
    expect(swayVel(0.5)).toBeGreaterThan(0);
    expect(swayVel(0.0)).toBeLessThan(0);
  });

  const ROWS = [
    { z: 3, T: 12, h: 2, lat: 35 }, { z: 6, T: 12, h: 2, lat: 35 }, { z: 9, T: 12, h: 2, lat: 35 },
    { z: 9, T: 8, h: 3, lat: 20 }, { z: 12, T: 16, h: 1.5, lat: 35 },
  ];
  test.each(ROWS)('z $z, T $T s, H $h m: sway peak beats the dash drift, so trough dashes run backwards', (row) => {
    const drift = driftPxPerSec(row), sway = swayPeakPxPerSec(row.T, row.z), band = bandPxPerSec(row.T, row.z);
    // net dash velocity along travel = drift + sway * (-cos 2 pi ph); the fraction of phases where it is negative:
    let back = 0; const N = 1000;
    for (let i = 0; i < N; i++) if (drift - sway * Math.cos(2 * Math.PI * (i / N)) < 0) back++;
    expect(sway).toBeGreaterThan(drift);
    expect(back / N).toBeGreaterThan(0.35);          // ~41-49% of the cycle every dash moves AGAINST the swell
    expect(band).toBeGreaterThan(3 * sway);           // while the bright band sweeps forward several times faster
    if (process.env.MOTION_TABLE) console.log(JSON.stringify({ ...row, driftPxS: +drift.toFixed(3), swayPeakPxS: +sway.toFixed(2), bandPxS: +band.toFixed(1), backFrac: back / N }));
  });

  test('at 30 fps (mobile, a busy main thread) the drift halves but the sway does not: drift is per FRAME, sway per SECOND', () => {
    const r = { z: 6, T: 12, h: 2, lat: 35 };
    expect(driftPxPerSec({ ...r, fps: 30 })).toBeCloseTo(driftPxPerSec(r) / 2, 9);
  });
});

describe('5. other time-driven terms', () => {
  test('rating-band shimmer (surf mode only): two ripples travelling 135 deg apart (SE and N), unrelated to the swell', () => {
    expect(HEATMAP_FS).toContain('float shimmer = 0.05 * sin(v_mercator_xy.x * 520.0 + v_mercator_xy.y * 520.0 - u_time * 1.4)');
    expect(HEATMAP_FS).toContain('+ 0.03 * sin(v_mercator_xy.y * 900.0 + u_time * 0.9);');
    // sin(k.x - w t) travels along +k; sin(k.x + w t) along -k. Mercator y is south, so convert to (east, north).
    const a = unit([520, -520]);            // term 1: +k = (+x, +y merc) -> south-east
    const b = unit([0, 900]).map((c) => -c); // term 2: -k = -y merc -> north
    const bGeo = [b[0], -b[1]];
    const ang = Math.acos(a[0] * bGeo[0] + a[1] * bGeo[1]) / DEG;
    expect(ang).toBeGreaterThan(130);       // SE vs N: 135 deg apart
  });
  test('foam-noise scroll runs ALONG the crest (sideways), not across it', () => {
    expect(DRAW_FS).toContain('foamNoise(vec2(alongCrest * 8.0 - v_phase * 0.3, acrossCrest * 6.0');
  });
  test('crest heading jitter is a static per-dash rotation (+-0.26 rad = +-15 deg), never a reversal', () => {
    expect(NATURAL_ANIM_DEFAULTS.__RAW_CREST_DIR_JITTER__).toBeLessThan(Math.PI / 2);
  });
});
