// ═══════════════════════════════════════════════════════════════════════
// COLOUR CORE — pure functions, no p5, no DOM. The engine's own tables and
// formulas (frontend/src/components/map/WindColorRamp.js, WebGLWindShaders.js,
// WebGLWindUtils.js, windBasemapMute.js), plus the solver that gives light and
// beach dark's relation between a streak and the ground under it.
// ═══════════════════════════════════════════════════════════════════════

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// ── sRGB, CIELAB, OKLab ────────────────────────────────────────────────
const dec = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const enc = (c) => { c = clamp01(c); return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055; };
const toLin = (rgb) => rgb.map(dec);
const toEnc = (lin) => lin.map(enc);

function lab(rgb) {
  const [r, g, b] = toLin(rgb);
  const X = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const Y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
  const Z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
const Lstar = (rgb) => lab(rgb)[0];
const chromaAB = (rgb) => { const [, a, b] = lab(rgb); return Math.hypot(a, b); };

function oklab(rgb) {
  const [r, g, b] = toLin(rgb);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
          1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
          0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s];
}
function oklabToLin([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
const oklch = (rgb) => { const [L, a, b] = oklab(rgb); return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180 / Math.PI + 360) % 360]; };
const inGamut = (lin) => lin.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
// OKLCH → sRGB with chroma reduced (hue and lightness kept) until it fits the gamut.
function fromOklch(L, C, h) {
  const rad = h * Math.PI / 180;
  let lo = 0, hi = C;
  if (inGamut(oklabToLin([L, C * Math.cos(rad), C * Math.sin(rad)]))) lo = C;
  else for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (inGamut(oklabToLin([L, mid * Math.cos(rad), mid * Math.sin(rad)]))) lo = mid; else hi = mid; }
  return toEnc(oklabToLin([L, lo * Math.cos(rad), lo * Math.sin(rad)]));
}

// CIEDE2000
function de2000(c1, c2) {
  const [L1, a1, b1] = lab(c1), [L2, a2, b2] = lab(c2);
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, a) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360);
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = hp2 - hp1; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin(dh * Math.PI / 360);
  const Lm = (L1 + L2) / 2, Cpm = (Cp1 + Cp2) / 2;
  let hm = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) { if (Math.abs(hp1 - hp2) > 180) hm += hp1 + hp2 < 360 ? 360 : -360; hm /= 2; }
  const T = 1 - 0.17 * Math.cos((hm - 30) * Math.PI / 180) + 0.24 * Math.cos(2 * hm * Math.PI / 180)
    + 0.32 * Math.cos((3 * hm + 6) * Math.PI / 180) - 0.20 * Math.cos((4 * hm - 63) * Math.PI / 180);
  const dTh = 30 * Math.exp(-(((hm - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + 0.015 * (Lm - 50) ** 2 / Math.sqrt(20 + (Lm - 50) ** 2), Sc = 1 + 0.045 * Cpm, Sh = 1 + 0.015 * Cpm * T;
  const Rt = -Math.sin(2 * dTh * Math.PI / 180) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

// Colour-vision deficiency, Machado, Oliveira & Fernandes 2009, severity 1.0, applied in linear RGB.
const CVD = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.011820, 0.042940, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.303900],
};
function simulate(rgb, kind) {
  const M = CVD[kind]; if (!M) return rgb;
  const [r, g, b] = toLin(rgb);
  return toEnc([M[0] * r + M[1] * g + M[2] * b, M[3] * r + M[4] * g + M[5] * b, M[6] * r + M[7] * g + M[8] * b]);
}

// ── The engine's tables (rows: kn, r, g, b, a) ─────────────────────────
const BEAUFORT = [0, 3, 6, 10, 16, 21, 27, 33, 40, 47, 55, 63, 75];
const RAMPS = {
  darkMarks: [[0, .90, 0, 1, .80], [3, .03, 0, 1, .83], [6, 0, .67, 1, .85], [10, .003, .918, .696, .87], [16, .415, 1, .562, .88],
    [21, .636, .99, .371, .89], [27, .972, .843, .112, .90], [33, .963, .693, .18, .91], [40, .957, .517, .165, .92],
    [47, .966, .352, .19, .93], [55, .952, .178, .29, .94], [63, .92, .30, .65, .95], [75, 1, .75, .95, .95]],
  lightMarks: [[0, .942, .964, .987, .72], [3, .803, .759, .965, .75], [6, .631, .688, .883, .78], [10, .746, .65, .997, .80],
    [16, .545, .672, .377, .82], [21, .415, .764, .52, .84], [27, .61, .708, .289, .86], [33, .804, .641, .027, .87],
    [40, .842, .436, .014, .88], [47, .825, .317, .104, .90], [55, .752, .167, .184, .91], [63, .608, .084, .311, .93], [75, .395, .104, .44, .95]],
  beachMarks: [[0, .973, .953, .911, .75], [3, .471, .891, .712, .78], [6, .027, .78, .643, .81], [10, .185, .642, .496, .83],
    [16, .291, .613, .234, .85], [21, .286, .496, .208, .87], [27, .631, .71, .304, .88], [33, .827, .647, .05, .90],
    [40, .862, .455, .068, .91], [47, .822, .325, .239, .92], [55, .739, .212, .305, .93], [63, .582, .149, .411, .94], [75, .322, .173, .514, .95]],
  lightField: [[0, .97, .741, .866, .72], [3, .803, .757, .982, .75], [6, .711, .727, .967, .78], [10, .717, .581, .819, .80],
    [16, .467, .622, .412, .82], [21, .45, .762, .543, .84], [27, .703, .717, .395, .86], [33, .625, .59, .324, .87],
    [40, .60, .484, .332, .88], [47, .701, .443, .438, .90], [55, .679, .326, .414, .91], [63, .611, .348, .534, .93], [75, .562, .358, .652, .95]],
  beachField: [[0, .713, .981, .86, .75], [3, .471, .891, .712, .78], [6, .253, .783, .635, .81], [10, .034, .515, .336, .83],
    [16, .177, .713, .291, .85], [21, .439, .672, 0, .87], [27, .65, .908, .24, .88], [33, .808, .633, .003, .90],
    [40, .961, .488, .284, .91], [47, .79, .381, .308, .92], [55, .621, .314, .321, .93], [63, .498, .33, .43, .94], [75, .437, .385, .578, .95]],
};

// Ground under the wind. Dark: the app's own night-map palette (basemapFallback.js: land #1c2530, ocean #0b1d2e), not muted.
// Light and beach: the wind bench's offline basemap colours, muted as windBasemapMute.js does (OKLab chroma × 0.15, lightness
// kept; water lightness × 0.9 light, × 0.94 beach).
const BASE = { dark: { land: [28, 37, 48], water: [11, 29, 46] }, light: { land: [236, 236, 232], water: [168, 214, 222] },
  beach: { land: [222, 208, 180], water: [150, 190, 200] } };
function mute(rgb255, amount, waterL) {
  const [L, a, b] = oklab(rgb255.map((c) => c / 255));
  return toEnc(oklabToLin([L * waterL, a * (1 - amount), b * (1 - amount)]));
}
const GROUND = {
  dark: { land: BASE.dark.land.map((c) => c / 255), water: BASE.dark.water.map((c) => c / 255) },
  light: { land: mute(BASE.light.land, 0.85, 1), water: mute(BASE.light.water, 0.85, 0.9) },
  beach: { land: mute(BASE.beach.land, 0.85, 1), water: mute(BASE.beach.water, 0.85, 0.94) },
};

// Field alpha α = op·(bA + (1 − bA)·ss(0, end, kn)); dark lays it alpha-over (F·α² + dst·(1 − α)), light and beach
// as a multiply tint dst·(1 − s·(1 − F)) with s = clamp(α·k).
const FIELD = { dark: { op: 0.48, bA: 0.44, end: 5 }, light: { op: 0.65, bA: 0.42, end: 7, k: 0.70 / 0.65 },
  beach: { op: 0.55, bA: 0.45, end: 7, k: 0.60 / 0.55 } };
const fieldAlpha = (t, kn) => { const f = FIELD[t]; return f.op * (f.bA + (1 - f.bA) * ss(0, f.end, kn)); };

// Streak composite opacity at zoom 4-9: dark 0.505 (brightness alpha), light 1.0 and beach 0.6 (premultiplied).
const STREAK_OP = { dark: 0.505, light: 1.0, beach: 0.6 };

// ── huePathStops: a segment whose midpoint loses half its ends' chroma gets 1-kn OKLCH waypoints ───────
function huePathStops(stops) {
  const out = [stops[0]];
  for (let i = 0; i < stops.length - 1; i++) {
    const A = stops[i], B = stops[i + 1];
    const mid = [0, 1, 2].map((c) => (A[c + 1] + B[c + 1]) / 2);
    const [La, Ca, ha] = oklch(A.slice(1, 4)), [Lb, Cb, hb] = oklch(B.slice(1, 4));
    if (oklch(mid)[1] < 0.5 * (Ca + Cb) / 2) {
      let dh = hb - ha; if (dh > 180) dh -= 360; if (dh < -180) dh += 360;
      if (Math.abs(dh) > 150) {                    // a long arc goes the way that passes 200° (cyan)
        const via = (h) => { const t = ((200 - ha) % 360 + 360) % 360; return t; };
        const up = via(); dh = up <= ((dh % 360) + 360) % 360 ? ((dh % 360) + 360) % 360 : ((dh % 360) + 360) % 360 - 360;
      }
      for (let k = A[0] + 1; k < B[0]; k++) {
        const t = (k - A[0]) / (B[0] - A[0]);
        const rgb = fromOklch(La + (Lb - La) * t, Ca + (Cb - Ca) * t, (ha + dh * t + 360) % 360);
        out.push([k, ...rgb, A[4] + (B[4] - A[4]) * t]);
      }
    }
    out.push(B);
  }
  return out;
}

// generateRampData: linear in sRGB between (path-augmented) stops, 256 texels over 0..75 kn.
function sampleStops(stops, kn) {
  if (kn <= stops[0][0]) return stops[0].slice(1);
  for (let i = 0; i < stops.length - 1; i++) {
    const A = stops[i], B = stops[i + 1];
    if (kn <= B[0]) { const t = (kn - A[0]) / (B[0] - A[0]); return [1, 2, 3, 4].map((c) => A[c] + (B[c] - A[c]) * t); }
  }
  return stops[stops.length - 1].slice(1);
}
const TEXELS = 256, KN_TOP = 75;
const knOf = (i) => (i / (TEXELS - 1)) * KN_TOP;
function lut(stops) { const s = huePathStops(stops); return Array.from({ length: TEXELS }, (_, i) => sampleStops(s, knOf(i))); }

// ── Grounds and streaks, exactly as the shaders lay them ──────────────
function groundToday(t, surface, F, kn) {
  const base = GROUND[t][surface], a = fieldAlpha(t, kn);
  if (t === 'dark') return base.map((c, i) => F[i] * a * a + c * (1 - a));
  const s = clamp01(a * FIELD[t].k);
  return base.map((c, i) => c * (1 - s * (1 - F[i])));
}
// Dark's composite: buffer c = S·A (premultiplied), brightness b = max(c); out = c·b·op + dst·(1 − b·op). Black adds nothing.
function brightOver(G, S, A, op) { const be = A * Math.max(...S); return G.map((g, i) => S[i] * A * be * op + g * (1 - be * op)); }
// Dark's rule, ground-independent (#311's "dark's streak method"): move toward the colour at full light by b²·op.
// out = Ŝ·b²·op + dst·(1 − b²·op), Ŝ = S/max(S), b = A·max(S). Lighter than its ground wherever Ŝ is, at every age of the trail.
function glowOver(G, S, A, op) { const m = Math.max(...S), b = A * m, w = b * b * op; return G.map((g, i) => (S[i] / m) * w + g * (1 - w)); }
// Light and beach today: premultiplied, out = c·op + dst·(1 − a·op).
function premulOver(G, S, A, op) { return G.map((g, i) => S[i] * A * op + g * (1 - A * op)); }

// ── The solver: give a theme dark's relation, per wind speed ──────────
// 1. ROOM (dusk): dim the theme's own ground by ONE factor in linear light, chromaticity kept, until the everyday-wind ground
//    (6-27 kn, over land) sits at or under `ceil` L*. One factor for every band keeps the bands' relations, as dusk dims a
//    landscape without flattening it. The field texture is re-solved so the multiply tint lands on the dimmed ground.
// 2. STEP: dark's full-strength step at this speed, measured over dark's own land, scaled by `stepScale`, is the target.
// 3. STREAK: the ground's own hue at the most chroma the gamut allows (× `vivid`), lightness solved to hit the step.
const EVERYDAY = [6, 27];
const lumY = (rgb) => { const [r, g, b] = toLin(rgb); return 0.2126729 * r + 0.7151522 * g + 0.0721750 * b; };
const yOfL = (L) => (L > 8 ? ((L + 16) / 116) ** 3 : L / (24389 / 27));
function solveTheme(t, opts) {
  const { ceil = 58, stepScale = 1, strength = 1, vivid = 1, cMin = 25, sMax = 0.9, olive = 76 } = opts || {};
  const field = lut(RAMPS[t + 'Field']), dark = lut(RAMPS.darkMarks);
  const base = GROUND[t].land;
  // ROOM (dusk): one factor in linear light for every band, chromaticity kept, so the everyday ground sits at or under `ceil`.
  let yMax = 0;
  for (let i = 0; i < TEXELS; i++) { const kn = knOf(i); if (kn >= EVERYDAY[0] && kn <= EVERYDAY[1]) yMax = Math.max(yMax, lumY(groundToday(t, 'land', field[i], kn))); }
  const kU = Math.min(1, yOfL(ceil) / yMax);
  const rowsF = [], rowsS = [], rowsW = [], report = [];
  for (let i = 0; i < TEXELS; i++) {
    const kn = knOf(i), F0 = field[i].slice(0, 3), Ad = dark[i][3];
    const s0 = clamp01(fieldAlpha(t, kn) * FIELD[t].k);
    const G0 = groundToday(t, 'land', F0, kn);
    const Gd0 = groundToday('dark', 'land', dark[i].slice(0, 3), kn);
    const target0 = stepScale * (Lstar(brightOver(Gd0, dark[i].slice(0, 3), Ad, STREAK_OP.dark)) - Lstar(Gd0));
    // NAME GUARD: a dim orange reads brown and a dim yellow olive (both exist only below a brighter surround), so dimming
    // would rename those bands. Their grounds are held at or above `olive` L*; every other band (a dim blue is navy, a dim
    // red maroon: same name) takes dusk's common factor.
    const hue = oklch(G0)[2], w = ss(35, 55, hue) * ss(126, 116, hue);
    const kGuard = olive > 0 ? Math.min(1, yOfL(olive) / lumY(G0)) : 0;
    const k = kU + (Math.max(kU, kGuard) - kU) * w;
    const Gt = toEnc(toLin(G0).map((c) => c * k));                                            // the dimmed ground wanted
    // the tint strength that can lay it (a tint can only reach base·(1 − s)); everyday winds may strengthen it up to sMax
    const need = Math.max(...Gt.map((g, c) => 1 - g / base[c]));
    const s = kn >= 3 ? Math.min(sMax, Math.max(s0, need)) : s0;
    const F = Gt.map((g, c) => clamp01(1 - (1 - g / base[c]) / s));                            // the tint that lays it
    // STREAK, per ground: the rule is a relation to the ground under the streak, so land and water each get their own paint,
    // each one dark's step above its own ground (dark's step over dark's land, and over dark's sea).
    const paintFor = (surface) => {
      const Gs = GROUND[t][surface].map((b, c) => b * (1 - s * (1 - F[c])));
      const Gds = groundToday('dark', surface, dark[i].slice(0, 3), kn);
      const target = stepScale * (Lstar(brightOver(Gds, dark[i].slice(0, 3), Ad, STREAK_OP.dark)) - Lstar(Gds));
      const [Lg, , hg] = oklch(Gs);
      const paint = (L) => { const S = fromOklch(L, 0.4, hg); if (vivid >= 1) return S; const [, Cm] = oklch(S); return fromOklch(L, Cm * vivid, hg); };
      const stepAt = (L) => Lstar(glowOver(Gs, paint(L), Ad, strength)) - Lstar(Gs);
      let lo = Lg, hi = 0.995;
      if (stepAt(hi) < target) lo = hi;
      else for (let n = 0; n < 26; n++) { const m = (lo + hi) / 2; if (stepAt(m) < target) lo = m; else hi = m; }
      // COLOUR FLOOR: a streak never buys lightness with its hue. Walk down until the paint keeps cMin C* (or reaches the ground).
      let L = lo;
      while (L > Lg + 0.005 && chromaAB(paint(L)) < cMin) L -= 0.005;
      const S = paint(L);
      return { S, step: stepAt(L), target, groundL: Lstar(Gs), streakL: Lstar(S), streakC: chromaAB(S) };
    };
    const onLand = paintFor('land'), onWater = paintFor('water');
    rowsF.push([...F, s]); rowsS.push([...onLand.S, Ad]); rowsW.push([...onWater.S, Ad]);
    report.push({ kn, s, ...onLand, water: onWater });
  }
  return { field: rowsF, streak: rowsS, streakWater: rowsW, report };
}

// The three themes' tables for one rule set. today: as the engine draws now. dark: dark's relation, solved per theme.
function buildTables(rules, opts) {
  const dark = lut(RAMPS.darkMarks);
  const T = { dark: { field: dark, streak: dark, streakWater: dark, bright: true, op: STREAK_OP.dark, ring: 1 } };
  for (const t of ['beach', 'light']) {
    if (rules === 'dark') {
      const s = solveTheme(t, opts);
      T[t] = { field: s.field, streak: s.streak, streakWater: s.streakWater, bright: true, glow: true, solvedTint: true, op: (opts && opts.strength) || 1, ring: opts && opts.ring != null ? opts.ring : 0.25, report: s.report };
    } else { const m = lut(RAMPS[t + 'Marks']); T[t] = { field: lut(RAMPS[t + 'Field']), streak: m, streakWater: m, bright: false, op: STREAK_OP[t], ring: 1 }; }
  }
  return T;
}

// ── Instruments that need no pixels ───────────────────────────────────
const texelOf = (kn) => Math.round((kn / KN_TOP) * (TEXELS - 1));
function groundOf(T, t, surface, kn) {
  const r = T[t].field[texelOf(kn)];
  if (!T[t].solvedTint) return groundToday(t, surface, r.slice(0, 3), kn);
  return GROUND[t][surface].map((b, c) => b * (1 - r[3] * (1 - r[c])));        // dark's rules: the solved strength rides in alpha
}
function streakOn(T, t, surface, kn) {
  const r = T[t][surface === 'water' ? 'streakWater' : 'streak'][texelOf(kn)], G = groundOf(T, t, surface, kn), S = r.slice(0, 3), A = r[3];
  return T[t].glow ? glowOver(G, S, A, T[t].op) : T[t].bright ? brightOver(G, S, A, T[t].op) : premulOver(G, S, A, T[t].op);
}
// Colour-blind floor: the smallest CIEDE2000 between neighbouring Beaufort bands' grounds, under each simulation.
function cvdFloor(T, t, surface) {
  let min = Infinity;
  for (const kind of ['protan', 'deutan', 'tritan']) for (let i = 1; i < BEAUFORT.length; i++) {
    const a = simulate(groundOf(T, t, surface, BEAUFORT[i - 1]), kind), b = simulate(groundOf(T, t, surface, BEAUFORT[i]), kind);
    min = Math.min(min, de2000(a, b));
  }
  return min;
}
// Never grey: the weakest CIELAB chroma along the streak path from 3 kn up (calm is allowed to fade).
function weakestChroma(T, t) {
  let min = Infinity;
  for (let i = texelOf(3); i < TEXELS; i++) for (const row of [T[t].streak, T[t].streakWater]) min = Math.min(min, chromaAB(row[i].slice(0, 3)));
  return min;
}

if (typeof module !== 'undefined') module.exports = { ss, lab, Lstar, oklch, fromOklch, de2000, simulate, RAMPS, GROUND, BEAUFORT,
  huePathStops, lut, groundToday, brightOver, glowOver, premulOver, solveTheme, buildTables, groundOf, streakOn, cvdFloor, weakestChroma, fieldAlpha, knOf, texelOf };
