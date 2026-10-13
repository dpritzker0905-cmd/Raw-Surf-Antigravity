// Optional browser persistence must never throw through a forecast decision or a legend render.
export function readMarineSurfMode(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  if (!w) return false;
  if (w.__SURF_MODE__ !== undefined) return w.__SURF_MODE__ === true;
  try { return w.localStorage?.getItem('__SURF_MODE__') === 'true'; }
  catch (e) { return false; }
}
