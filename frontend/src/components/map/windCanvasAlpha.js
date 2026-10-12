/**
 * THE WIND LEAVES THE MAP'S CANVAS OPAQUE (2026-10-12, DECISIONS D-027).
 *
 * The wind is drawn INTO the map's own canvas, and that canvas is premultiplied: the browser shows `rgb + (1 - alpha) * page`,
 * the page being whatever sits behind the map. Two of the wind's passes drew there with
 * `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`, which blends the ALPHA channel by the same factors as the colour: a pass of
 * alpha `a` over an opaque map leaves the canvas at `1 - a + a * a` (0.75 at a = 0.5). They are dark's colour field and the
 * trail composite that dark, and since D-021 light's and beach's white streak, are drawn with.
 *
 * Behind the map `MapPage.js` lays BLACK in dark and beach and NEAR WHITE (Tailwind gray-50) in light. So dark and beach showed
 * the colours as drawn, and light showed the page's white through every streak: a pale veil over the colour field, and streak
 * cores near paper white. The wind bench reads the canvas over black, so no measurement and no sample taken there had drawn the
 * picture light showed in the app (LESSONS L-V72).
 *
 * The fix is the alpha's blend alone: source x ZERO + destination x ONE. The colour's blend is the one asked for, so every pixel
 * the wind writes keeps its red, green and blue. Dark and beach draw the same screen (their page is black); light draws the
 * picture the bench draws, on any page.
 *
 * Kill: window.__RAW_DISABLE_WIND_OPAQUE_CANVAS__ = true (read each frame; the blends dev drew with, call for call).
 */
export const WIND_OPAQUE_CANVAS_KILL = '__RAW_DISABLE_WIND_OPAQUE_CANVAS__';

/** Whether the wind's passes into the map leave the canvas's alpha alone (on unless the kill is set to true). */
export function windKeepsCanvasOpaque(win = (typeof window !== 'undefined' ? window : null)) {
  return !(win && win[WIND_OPAQUE_CANVAS_KILL] === true);
}

/** Set the blend of a pass drawn into the MAP'S OWN framebuffer: the colour by (src, dst); the alpha as the map drew it. */
export function blendIntoMap(gl, src, dst, win = (typeof window !== 'undefined' ? window : null)) {
  if (windKeepsCanvasOpaque(win)) gl.blendFuncSeparate(src, dst, gl.ZERO, gl.ONE);
  else gl.blendFunc(src, dst);
}

/** The alpha one SRC_ALPHA / ONE_MINUS_SRC_ALPHA pass of alpha `a` leaves in an opaque canvas: 1 when kept, else 1 - a + a x a. */
export function canvasAlphaAfter(a, kept) { return kept ? 1 : 1 - a + a * a; }

/** What the screen shows of a premultiplied canvas pixel (`rgb`, `alpha`, 0..1) over the `page` behind the map. */
export function shownOverPage(rgb, alpha, page) { return rgb.map((c, i) => c + (1 - alpha) * page[i]); }
