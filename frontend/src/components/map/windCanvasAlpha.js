/**
 * THE WIND LEAVES THE MAP CANVAS'S ALPHA AS THE MAP DREW IT (2026-10-12, DECISIONS D-027).
 *
 * The wind is drawn INTO the map's own canvas, and that canvas is premultiplied: the browser shows `rgb + (1 - alpha) * page`,
 * the page being whatever sits behind the map. Two of the wind's passes drew there with
 * `blendFunc(SRC_ALPHA, ONE_MINUS_SRC_ALPHA)`, which blends the ALPHA channel by the same factors as the colour: a pass of
 * alpha `a` over an opaque map leaves the canvas at `1 - a + a * a` (0.75 at a = 0.5). They are the colour field when it is not
 * a multiply tint (dark's) and the trail composite when it is not premultiplied (dark's, and light's and beach's since dark's
 * rules, D-020: the white streak of D-021 is drawn with it).
 *
 * Behind the map `MapPage.js` lays BLACK in dark and beach and NEAR WHITE (Tailwind gray-50) in light. So dark and beach showed
 * the colours as drawn, and light showed the page's white through every streak: a pale veil over the colour field, and streak
 * cores near paper white. The wind bench saved its frames from the bare canvas, never over the page, so no frame of a light look
 * drawn with that composite was the picture the app showed (LESSONS L-V72).
 *
 * The fix is the alpha's blend alone: source x ZERO + destination x ONE. The colour's blend is the one asked for, so every pixel
 * the wind writes keeps its red, green and blue, and the canvas stays opaque wherever the map drew it opaque (every style opens
 * with an opaque background layer). Dark and beach draw the same screen (their page is black); light draws, on any page, what
 * dev drew over a black one.
 *
 * Kill: window.__RAW_DISABLE_WIND_OPAQUE_CANVAS__ = true (read at each call, so each frame; the blends dev drew with, call for
 * call). An older kill that sends light to one of the two passes (the field tint's; dark's rules' with the premultiplied
 * composite's) draws dev's COLOURS under this change but not the page showing through them: for dev's exact screen under such
 * a kill, set this one with it.
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
