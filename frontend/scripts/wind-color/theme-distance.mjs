// THEME DISTANCE (D-037 follow-up, 2026-10-21; owner: "I'm not sold on light modes blue water, it seems too close to the same color as dark
// modes water"; "Resolve it so light improves but isnt too much like dark"). For each height, light's wash as composited over light's
// water against dark's (the shader's non-surf ramp over the dark style's sea, wave-quant.mjs / crest-critique.mjs) and beach's (v1 over
// its water), at world opacity and swell lighting 0.5: CIEDE2000 and OKLCH (L, C, hue). The sea a viewer remembers is the 1-3 m band
// (most of the world's ocean most days), so that range is the one that must stay apart.
// Usage: node theme-distance.mjs [--palette spectrum|v2@16|<json table>]   (prints every light table in marineWavePalette.js by default)
import fs from 'fs';
import { loadPalettes, composite, ALPHAS, dE, oklab, ss } from './wave-lib.mjs';

const mod = loadPalettes(), HS = [0.3, 0.8, 1.25, 1.5, 2, 2.5, 3, 4, 6, 9, 13];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t), clamp01 = (c) => c.map((v) => Math.min(1, Math.max(0, v)));
const DARK_C = [[0.05, 0.19, 0.36], [0.00, 0.82, 0.51], [0.00, 0.92, 1.00], [0.35, 0.15, 1.00], [1.00, 0.10, 0.75], [1, 1, 1]], DARK_B = [0, 0.20, 0.46, 0.72, 0.94, 1.0];
const tNl = (h) => (h < 0.6 ? (h / 0.6) * 0.20 : h < 1.2 ? 0.20 + ((h - 0.6) / 0.6) * 0.26 : h < 2.4 ? 0.46 + ((h - 1.2) / 1.2) * 0.26 : h < 5.0 ? 0.72 + ((h - 2.4) / 2.6) * 0.22 : 0.94 + Math.min(1, Math.max(0, (h - 5.0) / 5.0)) * 0.06);
const darkRamp = (h) => { const t = tNl(Math.min(h, 10)); for (let i = 0; i < 5; i++) if (t < DARK_B[i + 1] || i === 4) return mix(DARK_C[i], DARK_C[i + 1], (t - DARK_B[i]) / (DARK_B[i + 1] - DARK_B[i])); return DARK_C[5]; };
export const darkWash = (h, a = ALPHAS.world, dir = 0.5, water = [93, 117, 126]) => {
  const W = mix([0.005, 0.015, 0.05], darkRamp(h), ss(0, 0.18, h)), lit = W.map((v, i) => v + [0.03, 0.05, 0.08][i] * dir * ss(0.1, 3.0, h));
  return clamp01(clamp01(lit).map((v, i) => v * a + (water[i] / 255) * (1 - a)));
};
export const beachWash = (h, a = ALPHAS.world, dir = 0.5) => composite(mod.WAVE_PALETTES.v1, 'beach', h, a, dir);
export function distances(P) {
  return HS.map((h) => {
    const l = composite(P, 'light', h, ALPHAS.world, 0.5), d = darkWash(h), b = beachWash(h), o = oklab(l), od = oklab(d);
    return { h, light: l.map((v) => Math.round(v * 255)), dark: d.map((v) => Math.round(v * 255)), dDark: +dE(l, d).toFixed(1), dBeach: +dE(l, b).toFixed(1),
      L: +o.L.toFixed(3), C: +o.C.toFixed(3), hue: Math.round(o.h), darkL: +od.L.toFixed(3), darkHue: Math.round(od.h) };
  });
}
if (process.argv[1] && process.argv[1].endsWith('theme-distance.mjs')) {
  const i = process.argv.indexOf('--palette'), id = i > 0 ? process.argv[i + 1] : null;
  const tables = id ? { [id]: id.endsWith('.json') ? JSON.parse(fs.readFileSync(id, 'utf8')) : id.endsWith('@16') ? mod.widenWavePalette(mod.WAVE_PALETTES[id.replace('@16', '')]) : mod.WAVE_PALETTES[id] }
    : { 'v2@16 (light today)': mod.widenWavePalette(mod.WAVE_PALETTES.v2), 'spectrum (#431)': mod.WAVE_PALETTES.spectrum };
  for (const [name, P] of Object.entries(tables)) {
    const rows = distances(P), core = rows.filter((r) => r.h >= 0.8 && r.h <= 3);
    console.log(`\n${name}: dE00 to dark over 0.8-3 m min ${Math.min(...core.map((r) => r.dDark))} mean ${(core.reduce((s, r) => s + r.dDark, 0) / core.length).toFixed(1)}`);
    rows.forEach((r) => console.log(`  ${String(r.h).padStart(5)} m  light ${r.light.join(',').padEnd(12)} L ${r.L} C ${r.C} h ${String(r.hue).padStart(3)} | dark ${r.dark.join(',').padEnd(12)} L ${r.darkL} h ${String(r.darkHue).padStart(3)} | dE dark ${String(r.dDark).padStart(5)}  beach ${r.dBeach}`));
  }
}
