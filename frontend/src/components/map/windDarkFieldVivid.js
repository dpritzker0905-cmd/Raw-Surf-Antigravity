/** Production Wind uses SRC_ALPHA with a premultiplied field. Gusts reads the
 * same choice when building its colour table. Rebuild the table after changing
 * the browser comparison switch (reload or switch themes).
 */
export const WIND_DARK_VIVID_KILL = '__RAW_DISABLE_DARK_WIND_VIVID__';

export function windDarkVividOn(theme, win = (typeof window !== 'undefined' ? window : null)) {
  return theme === 'dark' && win?.__RAW_DARK_WIND_VIVID__ === true && win?.__RAW_DISABLE_DARK_WIND_VIVID__ !== true;
}

export function windFieldSrcFactor(gl, theme, win = (typeof window !== 'undefined' ? window : null)) {
  return windDarkVividOn(theme, win) ? gl.ONE : gl.SRC_ALPHA;
}
