// BEACH crest STYLE (owner A/B, 2026-10-21): every style keeps beach's crest colours (orchid-pink -> electric turquoise -> sunset
// magenta, white foam, DRAW_FS) and the v1 sea (D-035), and changes only how light and dark each crest is inside itself, so a crest
// never flips colour at a height and stands off every band of the sea. Why: a single crest colour that varies smoothly with height
// cannot avoid matching the brightness of a sea whose brightness goes up and down (it must cross it somewhere, unless it is darker
// or lighter than the whole sea); a crest that carries a dark part AND a light part always has one of them standing off the sea.
// Today's beach crests read at APCA |Lc| < 30 at most heights at world, coastal and close zoom, |Lc| 0 on the sand (1-2 m) and
// grey-mauve (4.4-7 m) bands (frontend/scripts/wind-color/beach-crest-style.mjs; the engine's real per-zoom crest alpha and #425 /
// #430's measured wash alpha). Numbers: docs/weather-program/evidence/beach-crest-style-2026-10-21.json.
// Levers, set before page load: window.__RAW_BEACH_CREST_STYLE__ = 'twotonebold' | 'twotone' | 'soft' | 'cased'.
// Kill: window.__RAW_DISABLE_BEACH_CREST_STYLE__ = true draws today's crest exactly (DRAW_FS hash-pinned in the test).
//   twotonebold: twotone, with beach's crest alpha x 3 before DRAW_FS's 0.85 cap. Far out (DRAW_VS zoomAlphaScale 0.45 below z3)
//                today's crests draw at ~0.3-0.6, too faint for any colour to stand off mid-brightness water; x 3 brings them to
//                the cap at every zoom (the recommendation).
//   twotone:     a dark rim (the crest's own colour x 0.30) across the ribbon's outer band and a light centre line (75% toward
//                white) in its core, today's colour between them; the ribbon opaque to 0.80 of its radius so the rim is crisp.
//   soft:        twotone with the centre line 55% toward white.
//   cased:       the engine's own self-contrast (dark skirt x 0.55, core x 1.30 plus a little foam) at every zoom and height in
//                beach, where today it runs only below 1.05 m and in the z ~3.6-4.3 band.
const WIN = typeof window === 'undefined' ? {} : window;
export const BEACH_CREST_STYLES = {
  twotonebold: { rim: 0.30, centre: 0.75, alpha: 3.0 },
  twotone: { rim: 0.30, centre: 0.75 },
  soft: { rim: 0.30, centre: 0.55 },
  cased: {},
};

export function resolveBeachCrestStyle(win = WIN) {
  if (win.__RAW_DISABLE_BEACH_CREST_STYLE__ === true) return 'today';
  const s = win.__RAW_BEACH_CREST_STYLE__;
  return typeof s === 'string' && Object.prototype.hasOwnProperty.call(BEACH_CREST_STYLES, s) ? s : 'today';
}
export const BEACH_CREST_STYLE = resolveBeachCrestStyle();

/** The DRAW_FS text pieces a style sets; for 'today' each is the shader's own text, so DRAW_FS is byte for byte today's.
 *  Every piece is gated on u_theme > 1.5 (beach): dark and light draw exactly as before under any style. */
export function beachCrestStyleGlsl(style = BEACH_CREST_STYLE) {
  const t = BEACH_CREST_STYLES[style], twoTone = Boolean(t && t.rim !== undefined);
  return {
    shapeEdge: twoTone ? 'u_theme > 1.5 ? 0.80 : 0.55' : '0.55',
    tone: twoTone ? ` if (u_theme > 1.5) finalColor = mix(mix(finalColor, finalColor * ${t.rim.toFixed(2)}, smoothstep(0.55, 0.72, ellipseDist)), vec3(1.0), ${t.centre.toFixed(2)} * (1.0 - smoothstep(0.12, 0.32, ellipseDist)));` : '',
    contrastHead: style === 'cased' ? 'u_theme > 1.5 ? 1.0 : ' : twoTone ? 'u_theme > 1.5 ? 0.0 : ' : '',
    alphaHead: t && t.alpha ? `(u_theme > 1.5 ? ${t.alpha.toFixed(2)} : 1.0) * ` : '',
  };
}
export const BEACH_CREST_STYLE_GLSL = beachCrestStyleGlsl();
