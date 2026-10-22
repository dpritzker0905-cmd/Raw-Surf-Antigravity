// ORIGINAL LIGHT CRESTS OVER A LIGHT WASH, AT THE ENGINE'S REAL CREST OPACITY (2026-10-21; D-041 made the original crests light's default
// again, and the owner's complaint was crests blending into the sea). For each height: the crest colour DRAW_FS mixes by energy (v1: deep
// navy -> amber-gold -> crimson red, white foam) laid over the wash at the opacity DRAW_VS + DRAW_FS give a crest core at that zoom:
//   alpha = min(0.85, mix(0.50, 0.85, smoothstep(0, 4, h)) x zoomAlphaScale x mix(1.2, 1.8, smoothstep(0, 6, h)))
//   zoomAlphaScale = mix(0.45, 1, smoothstep(3, 9, zoom))     (far zoom <= 3: 0.45; z 9+: 1)
// blended in encoded sRGB as the GL blend does (premultiplied ONE, ONE_MINUS_SRC_ALPHA), against the wash composited at world opacity.
// Weakest APCA |Lc| over swell lighting 0 / 0.5 / 1 and whitecap off / on. Usage: node crest-over-wash.mjs [--crest v1|v2|v2s]
import { loadPalettes, composite, ALPHAS, apcaLc, ss, LIGHT_CRESTS } from './wave-lib.mjs';

const mod = loadPalettes(), args = process.argv.slice(2), crestId = args.includes('--crest') ? args[args.indexOf('--crest') + 1] : 'v1';
const WASHES = { 'live light (v2 @ 16 m)': mod.widenWavePalette(mod.WAVE_PALETTES.v2), 'spectrum (#431)': mod.WAVE_PALETTES.spectrum };
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export function crestColour(h, wc, crest = LIGHT_CRESTS[crestId]) {   // wave-lib's crest form: [calm, active, storm, foam, polarity?]
  const [c0, a0, storm, f0, pol] = crest, up = pol && h >= pol.h, e = ss(0, 6, h);
  const calm = up ? pol.calm : c0, active = up ? pol.active : a0, foam = up && pol.foam ? pol.foam : f0;
  const base = e < 0.5 ? mix(calm, active, e * 2) : mix(active, storm, (e - 0.5) * 2);
  return mix(base, foam, wc * ss(0.5, 3.0, h) * 0.45);
}
export const crestAlpha = (h, zoom) => Math.min(0.85, (0.50 + 0.35 * ss(0, 4, h)) * (0.45 + 0.55 * ss(3, 9, zoom)) * (1.2 + 0.6 * ss(0, 6, h)));
const HS = [0.3, 0.8, 1.25, 1.5, 2, 2.5, 3, 4, 6, 9, 13];
console.log(`crest ${crestId}: weakest APCA |Lc| of a crest core on the wash under it (world wash opacity; lighting 0/0.5/1; whitecap off/on)`);
for (const zoom of [2.2, 4.6, 9]) {
  console.log(`\nzoom ${zoom} (crest core opacity ${HS.map((h) => crestAlpha(h, zoom).toFixed(2)).join(' ')})`);
  console.log('  height       ' + HS.map((h) => String(h).padStart(6)).join(''));
  for (const [name, P] of Object.entries(WASHES)) {
    const row = HS.map((h) => {
      let w = Infinity;
      for (const dir of [0, 0.5, 1]) for (const wc of [0, 1]) {
        const under = composite(P, 'light', h, ALPHAS.world, dir), a = crestAlpha(h, zoom), c = crestColour(h, wc);
        w = Math.min(w, Math.abs(apcaLc(under.map((u, i) => Math.min(1, c[i] * a + u * (1 - a))), under)));
      }
      return w;
    });
    console.log(`  ${name.padEnd(24)}` + row.map((v) => v.toFixed(1).padStart(6)).join('') + `   min ${Math.min(...row).toFixed(1)}`);
  }
}
