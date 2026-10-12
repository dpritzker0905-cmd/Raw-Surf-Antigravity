#!/usr/bin/env node
// MIRROR MODEL: each theme's wind FIELD as it is drawn over its own map, knot by knot, in the terms the eye uses
// (CIELAB L*, C*, hue), beside dark's. Dark is the model (owner, 2026-10-11): this prints where a theme's picture
// departs from it, and by how much.
//
//   node mirror-model.mjs                 the three themes as drawn
//   node mirror-model.mjs --before-path   beach before its path (window.__RAW_DISABLE_WIND_BEACH_PATH__ = true)
//   node mirror-model.mjs --json out.json
//
// What it prints, per theme and ground, at each knot: the field's colour ON SCREEN (L*, C*, hue), how far that is from the bare map
// (dE00), and how far a streak steps above it where streaks pile up, at the strength drawn over that ground (dark: the engine's
// 0.505; light and beach: windDarkRules.js DARK_WHITE, land and sea). Read dark's
// columns first: its hue sweeps one way with speed and its lightness climbs to a plateau; a theme whose hue turns back, or whose
// lightness dips and returns, is banded where dark is smooth (D-022, "what is not done").
// It reads the app's own tables and composite law (the loader and MODEL are check.mjs's; keep them in sync).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { differenceCiede2000, converter } from 'culori';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP = path.join(HERE, '..', '..', 'src', 'components', 'map');
const args = process.argv.slice(2), arg = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const source = (file) => fs.readFileSync(file, 'utf8').replace(/^import [^\n]*$/gm, '').replace(/^export /gm, '');
const { DARK_RULES, DARK_WHITE, WHITE_STREAK, solveDarkRules } = new Function(source(path.join(MAP, 'windDarkRules.js')) + '; return { DARK_RULES, DARK_WHITE, WHITE_STREAK, solveDarkRules };')();
const LEVERS = { ...(args.includes('--before-depth') ? { __RAW_DISABLE_WIND_LAND_DEPTH__: true } : {}), ...(args.includes('--before-path') ? { __RAW_DISABLE_WIND_BEACH_PATH__: true } : {}) };   // --before-depth: the land as the mute alone leaves it (D-026's kill); --before-path: beach before its path (windBeachPath.js)
const { BEACH_PATH, beachPathRows } = new Function(source(path.join(MAP, 'windBeachPath.js')) + '; return { BEACH_PATH, beachPathRows };')();   // beach's path (no imports)
const { muteColor, windBasemapMuteAmount, windBasemapWaterL, windBasemapLandL, windLandWhite, setWindLandDepthGate } = new Function(fs.readFileSync(path.join(MAP, 'windBasemapMute.js'), 'utf8').replace(/^export /gm, '') + '; return { muteColor, windBasemapMuteAmount, windBasemapWaterL, windBasemapLandL, windLandWhite, setWindLandDepthGate };')();
export const ramps = new Function('DARK_RULES', 'DARK_WHITE', 'WHITE_STREAK', 'solveDarkRules', 'windLandWhite', 'setWindLandDepthGate', 'BEACH_PATH', 'beachPathRows',
  source(path.join(MAP, 'WindColorRamp.js')) + '; return { THEME_RAMPS, huePathStops, resolveDrawnField, resolveDrawnMarks, generateRampData, windDarkRulesOn, windWhiteStreakOn, windWhiteStrength };')(DARK_RULES, DARK_WHITE, WHITE_STREAK, solveDarkRules, windLandWhite, setWindLandDepthGate, BEACH_PATH, beachPathRows);
/** The window a sync would leave for `theme`: the mute's read-back, which the land's streak strength reads (D-026). */
const winOf = (theme) => { const amount = windBasemapMuteAmount(theme, LEVERS); return { ...LEVERS, __WIND_BASEMAP_MUTE__: { applied: amount > 0, theme, landL: amount > 0 ? windBasemapLandL(theme, LEVERS) : 1 } }; };

// The composite law, per theme (check.mjs MODEL; dark's land is the wind bench's own offline colour).
export const MODEL = {
  light: { kind: 'multiply', op: 0.65, baseA: 0.42, end: 7, k: 0.70 / 0.65, surfaces: { land: [236, 236, 232], water: [168, 214, 222] } },
  beach: { kind: 'multiply', op: 0.55, baseA: 0.45, end: 7, k: 0.60 / 0.55, surfaces: { land: [222, 208, 180], water: [150, 190, 200] } },
  dark: { kind: 'over', op: 0.48, baseA: 0.44, end: 5, k: 1, surfaces: { land: [18, 20, 26], water: [93, 117, 126] } },
};
export const groundOf = (theme, surf) => {
  const c = MODEL[theme].surfaces[surf], amount = windBasemapMuteAmount(theme, LEVERS);
  if (!(amount > 0)) return c.map((x) => x / 255);
  const m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${c.join(', ')})`, amount, surf === 'water' ? windBasemapWaterL(theme, LEVERS) : windBasemapLandL(theme, LEVERS)));
  return [+m[1] / 255, +m[2] / 255, +m[3] / 255];
};
/** A theme's muted ground with its lightness multiplied by `l` (the basemap mute's own factor: the sea's today, and the land's on PR #320). */
export const groundAt = (theme, surf, l) => { const c = MODEL[theme].surfaces[surf], m = /rgba\((\d+), (\d+), (\d+)/.exec(muteColor(`rgb(${c.join(', ')})`, windBasemapMuteAmount(theme, {}), l)); return [+m[1] / 255, +m[2] / 255, +m[3] / 255]; };
const toLab = converter('lab65'), toRgb = converter('rgb');
export const lch = (a) => { const c = toLab({ mode: 'rgb', r: a[0], g: a[1], b: a[2] }); return { L: c.l, C: Math.hypot(c.a, c.b), h: (Math.atan2(c.b, c.a) * 180 / Math.PI + 360) % 360, a: c.a, b: c.b }; };
export const fromLch = (L, C, h) => { const r = toRgb({ mode: 'lab65', l: L, a: C * Math.cos(h * Math.PI / 180), b: C * Math.sin(h * Math.PI / 180) }); return [r.r, r.g, r.b]; };
export const inGamut = (a) => a.every((x) => x >= -0.002 && x <= 1.002);
export const de = (a, b) => differenceCiede2000()({ mode: 'rgb', r: a[0], g: a[1], b: a[2] }, { mode: 'rgb', r: b[0], g: b[1], b: b[2] });
const ss = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
export const sample = (ramp, v) => { if (v <= ramp[0][0]) return ramp[0].slice(1, 4); for (let i = 1; i < ramp.length; i++) if (v <= ramp[i][0]) { const t = (v - ramp[i - 1][0]) / (ramp[i][0] - ramp[i - 1][0]); return [1, 2, 3].map((j) => ramp[i - 1][j] + (ramp[i][j] - ramp[i - 1][j]) * t); } return ramp[ramp.length - 1].slice(1, 4); };
export const strength = (theme, v) => { const m = MODEL[theme]; return Math.min(1, m.op * (m.baseA + (1 - m.baseA) * ss(0, m.end, v)) * m.k); };
/** The field's colour on screen: the tint `c` at speed `v` over ground `bm`, by the theme's own law. */
export const tintOver = (theme, v, c, bm) => { const s = strength(theme, v); return MODEL[theme].kind === 'multiply' ? bm.map((x, i) => x * (1 - s * (1 - c[i]))) : bm.map((x, i) => c[i] * s + x * (1 - s)); };
/** The stop a multiply theme must hold to draw `wanted` over `bm` at speed `v` (null where no tint can: it only darkens). */
export const stopFor = (theme, v, wanted, bm) => { const s = strength(theme, v); const c = wanted.map((w, i) => 1 - (1 - w / bm[i]) / s); return c.every((x) => x >= -0.004 && x <= 1.004) ? c.map((x) => Math.min(1, Math.max(0, x))) : null; };
/** The field's stops as the app draws them for `theme` (the path between the stops included). */
export const drawnField = (theme, levers) => ramps.huePathStops(ramps.resolveDrawnField(theme, levers || LEVERS) || ramps.THEME_RAMPS[theme], {});
/** A white streak where trails pile up: the ground mixed `op` of the way to white. Dark's own strength is the engine's 0.505. */
const DARK_OWN = 0.505;
export const wisp = (ground, op) => ground.map((x) => x + (1 - x) * op);

export const KNOTS = [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 18, 21, 24, 27, 30, 33, 36, 40, 47, 55, 63, 75];
export function table(theme, field) {
  const F = field || drawnField(theme), rows = [];
  for (const surf of Object.keys(MODEL[theme].surfaces)) {
    const bm = groundOf(theme, surf), g = lch(bm);
    for (const v of KNOTS) {
      const out = tintOver(theme, v, sample(F, v), bm), c = lch(out);
      rows.push({ theme, surf, kn: v, L: c.L, C: c.C, h: c.h, offMap: de(out, bm), mapL: g.L, mapC: g.C, wispStep: lch(wisp(out, theme === 'dark' ? DARK_OWN : ramps.windWhiteStrength(theme, winOf(theme))[surf === 'water' ? 'sea' : 'land'])).L - c.L, rgb: out });
    }
  }
  return rows;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const all = {}, f1 = (x) => x.toFixed(1).padStart(6);
  for (const theme of ['dark', 'light', 'beach']) {
    all[theme] = table(theme);
    for (const surf of Object.keys(MODEL[theme].surfaces)) {
      const rows = all[theme].filter((r) => r.surf === surf);
      console.log(`\n=== ${theme.toUpperCase()} over ${surf} (the bare map: L* ${rows[0].mapL.toFixed(1)}, C* ${rows[0].mapC.toFixed(1)})`);
      console.log('   kn |    L*     C*    hue | off the map (dE00) | step of a piled-up streak at the strength drawn there (L*)');
      for (const r of rows) console.log(`${String(r.kn).padStart(5)} |${f1(r.L)} ${f1(r.C)} ${f1(r.h)} | ${f1(r.offMap)}             | ${f1(r.wispStep)}`);
    }
  }
  if (arg('--json')) fs.writeFileSync(arg('--json'), JSON.stringify(all, null, 1));
}
