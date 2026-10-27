// Shared by crest-over-wash.mjs and spectrum-apart.mjs: a light crest's colour by height (wave-lib's crest form) and the opacity the
// engine gives a crest core at a zoom (DRAW_VS zoomAlphaScale x DRAW_FS's energy boost, capped at 0.85).
import { ss } from './wave-lib.mjs';
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
export function crestColour(h, wc, crest) {   // crest: [calm, active, storm, foam, polarity?]
  const [c0, a0, storm, f0, pol] = crest, up = pol && h >= pol.h, e = ss(0, 6, h);
  const calm = up ? pol.calm : c0, active = up ? pol.active : a0, foam = up && pol.foam ? pol.foam : f0;
  const base = e < 0.5 ? mix(calm, active, e * 2) : mix(active, storm, (e - 0.5) * 2);
  return mix(base, foam, wc * ss(0.5, 3.0, h) * 0.45);
}
export const crestAlpha = (h, zoom) => Math.min(0.85, (0.50 + 0.35 * ss(0, 4, h)) * (0.45 + 0.55 * ss(3, 9, zoom)) * (1.2 + 0.6 * ss(0, 6, h)));
