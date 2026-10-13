/**
 * Wind bench: THE PAGE BEHIND THE MAP, and the map canvas's own alpha (2026-10-12, DECISIONS D-027, LESSONS L-V72).
 *
 * The map's canvas is premultiplied: the screen shows `rgb + (1 - alpha) x page`. The app lays the page in `MapPage.js`
 * (`isLight ? 'bg-gray-50' : 'bg-black'`, and beach is not `isLight`): near white behind light, black behind dark and beach.
 * A frame the bench saves is the canvas laid over that page, so it is what the screen shows whatever the canvas's alpha.
 *
 * Until 2026-10-12 a frame was saved from the BARE canvas. That is not the screen over any page: an encoder un-premultiplies a
 * pixel first (clamped at 255) and then fills with black, so wherever a channel was brighter than the alpha the wind had left,
 * the saved pixel held min(channel, alpha). Under dev's blends that darkened 6% to 26% of the picture's pixels, by 1.7 to 3.6 L*
 * each on average and up to 13, the streaks' bright cores most, in every theme (the independent review's read of #321: one scene,
 * the offline basemap); and in light it also left out the page's white, which the app showed.
 *
 * One module for the page (page/map-entry.js), the runners and the tests (src/components/map/windCanvasAlpha.test.js pins
 * APP_PAGE against MapPage.js).
 */
const APP_PAGE = Object.freeze({ light: '#f9fafb', dark: '#000000', beach: '#000000' });   // Tailwind gray-50 is #f9fafb

/** The page laid behind a theme's frames: the one asked for (`--behind`, a run's `behind`), else the app's own. */
function pageOf(theme, asked) { return asked || APP_PAGE[theme] || '#000000'; }

/** { min, mean } (0..1, three decimals) of the alpha channel of RGBA bytes. 1 and 1: the page cannot matter. */
function alphaOf(px) {
  let min = 255, sum = 0; const n = px.length >> 2;
  for (let i = 3; i < px.length; i += 4) { if (px[i] < min) min = px[i]; sum += px[i]; }
  return { min: n ? +(min / 255).toFixed(3) : 1, mean: n ? +(sum / n / 255).toFixed(3) : 1 };
}

/** A run's alpha from its frames': the LEAST of the frames' minima, the mean of their means; `frames` counts them. */
function foldAlpha(run, frame) {
  if (!frame) return run || null;
  if (!run) return { min: frame.min, mean: frame.mean, frames: 1 };
  const frames = run.frames + 1;
  return { min: Math.min(run.min, frame.min), mean: +((run.mean * run.frames + frame.mean) / frames).toFixed(3), frames };
}

/** The line a runner prints when a scored read was taken on a canvas whose alpha was under 1 (null when it was not). */
function alphaWarning(alpha, theme, what) {
  if (!alpha || !(alpha.min < 1)) return null;
  return `WARNING ${what}: the map canvas's alpha was ${alpha.min} at the least (mean ${alpha.mean}) in ${theme}. The scored columns read the canvas's own colour, ` +
    `which is the screen over a BLACK page; the app's page for ${theme} is ${APP_PAGE[theme] || '#000000'}. Saved frames are laid over the page and are the screen.`;
}

module.exports = { APP_PAGE, pageOf, alphaOf, foldAlpha, alphaWarning };
