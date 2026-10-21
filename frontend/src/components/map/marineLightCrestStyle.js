// LIGHT crest STYLE (owner A/B, 2026-10-21): light's ORIGINAL crest colours (deep navy -> amber-gold -> crimson red, white foam; the
// default again since D-041) with a luminance-only TWO-TONE, the method beach's #433 measured best: each crest carries a dark rim (its
// own colour x RIM) round its outer band and a light centre line (CENTRE of the way toward white) in its core, today's colour between,
// so one part always stands off the wash's brightness and the crest never changes hue at a height (the owner's rule, 2026-10-21: one
// colour family per theme). Why: light's wash (v2) passes the original crests' brightness from 2.3 m up (APCA |Lc| 0), and #431's
// spectrum from 1.7 m to 14 m; a single colour that varies smoothly with height cannot avoid crossing a wash whose brightness falls
// and rises, a crest with a dark and a light part always keeps one of them off it. The owner asked for this ("It still needs to adjust
// for areas in the colour for heatmaps that blend too much with the animation colors"; "yes or adjust the animation colors, whatever
// is better"). Measured by frontend/scripts/wind-color/light-crest-style.mjs (reads this table).
// Lever, set before page load: window.__RAW_LIGHT_CREST_STYLE__ = 'twotone'. Off by default until the owner picks.
// Kill: window.__RAW_DISABLE_LIGHT_CREST_STYLE__ = true draws the original exactly (DRAW_FS hash-pinned in the test).
// Every DRAW_FS piece is gated on the light theme (u_theme 1): dark and beach draw exactly as before under any style; each piece is a
// prefix or suffix on a line beach's #433 also extends, so the two compose.
const WIN = typeof window === 'undefined' ? {} : window;
// Chosen by light-crest-style.mjs (worst APCA |Lc| of the crest's best part vs the wash, every 0.1 m to 14 m, every zoom state and
// lighting, whitecap off and on): the original 0 on v2 and on #431's spectrum; this two-tone >= 40.2 on v2 and >= 41.1 on the spectrum,
// colour-blind >= 33.9 / 29.0 dE00, centre vs rim >= 72 (targets: 45 / floor 30 at the edge, 60 inside). Alpha x 3 before DRAW_FS's
// 0.85 cap, tapering to x 1 by z 9, is what lifts far zoom (DRAW_VS draws crests at 45% there): without it the world view stays at
// 21; a flat x 3 also turned close-zoom crests into solid blobs that hid the wash (engine stills, 2026-10-21). #433's beach values
// (rim 0.30, centre 0.75) give >= 33.9; rim 0.10 / centre 0.90 reaches 43 but turns crests into near-black outlines round white cores.
export const LIGHT_CREST_STYLES = {
  twotone: { rim: 0.15, centre: 0.85, alpha: 3.0 },
};

export function resolveLightCrestStyle(win = WIN) {
  if (win.__RAW_DISABLE_LIGHT_CREST_STYLE__ === true) return 'today';
  const s = win.__RAW_LIGHT_CREST_STYLE__;
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(LIGHT_CREST_STYLES, s) ? s : 'today';
}
export const LIGHT_CREST_STYLE = resolveLightCrestStyle();

const LIGHT = 'abs(u_theme - 1.0) < 0.5';
/** The DRAW_FS text pieces a style sets; for 'today' each is empty, so DRAW_FS is byte for byte the shader without this module. */
export function lightCrestStyleGlsl(style = LIGHT_CREST_STYLE) {
  const t = LIGHT_CREST_STYLES[style];
  if (!t) return { decl: '', shapeHead: '', tone: '', contrastHead: '', alphaHead: '' };
  return {
    decl: t.alpha !== 1 ? ' uniform highp float u_zoom;' : '',   // the map zoom DRAW_VS already gets (same name, same precision)
    shapeHead: `${LIGHT} ? 0.80 : `,   // the ribbon opaque to 0.80 of its radius, so the rim is crisp
    tone: ` if (${LIGHT}) finalColor = mix(mix(finalColor, finalColor * ${t.rim.toFixed(2)}, smoothstep(0.55, 0.72, ellipseDist)), vec3(1.0), ${t.centre.toFixed(2)} * (1.0 - smoothstep(0.12, 0.32, ellipseDist)));`,
    contrastHead: `${LIGHT} ? 0.0 : `,   // the engine's own self-contrast stands down where the two-tone draws
    // x alpha far out, tapering to x 1 by z 9: DRAW_VS draws crests at 45% of their alpha below z 3 (zoomAlphaScale), so the boost
    // restores far-zoom crests and leaves close zoom, where the crests already cover most of a big-surf view, as it was.
    alphaHead: t.alpha !== 1 ? `(${LIGHT} ? mix(${t.alpha.toFixed(2)}, 1.0, smoothstep(3.0, 9.0, u_zoom)) : 1.0) * ` : '',
  };
}
export const LIGHT_CREST_STYLE_GLSL = lightCrestStyleGlsl();
