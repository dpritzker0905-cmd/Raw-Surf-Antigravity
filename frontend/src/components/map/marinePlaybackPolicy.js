// Exact GFS wave presentation changes visible heights. Qualification flag; no persisted opt-in.
export function exactGfsPlaybackEnabled(model, layer) {
  return model === 'GFS' && layer === 'waves' && process.env.REACT_APP_GFS_EXACT_PLAYBACK === 'true' &&
    !(typeof window !== 'undefined' && window.__RAW_DISABLE_GFS_EXACT_PLAYBACK__ === true);
}
export const PLAYBACK_WORLD_BOUNDS = Object.freeze({ west: -180, south: -80, east: 180, north: 85 });
export function playbackMapBounds() {
  try {
    const b = window.map.getBounds();
    return { west: b.getWest(), east: b.getEast(), south: b.getSouth(), north: b.getNorth() };
  } catch { return null; }
}
export function isWidePlaybackView(bounds) {
  if (!bounds || !Object.values(bounds).every(Number.isFinite)) return false;
  return (bounds.east < bounds.west ? bounds.east + 360 - bounds.west : bounds.east - bounds.west) >= 60;
}
export function isExactPlaybackFrame(data, targetTime) {
  const g = data?.grid, b = g?.bounds;
  const time = Date.parse(targetTime);
  return !!g && !!b && Number.isFinite(time) && g.__sourceModel === 'GFS' && g.__componentLayer === 'waves' &&
    Array.isArray(g.vectors) && g.vectors.length > 0 && g.__renderable !== false && g.cols > 1 && g.rows > 1 &&
    !(g.__decimatedStride > 1) && !g.frame_substituted && !g.ratingMode &&
    (b.east < b.west ? b.east + 360 - b.west : b.east - b.west) >= 340 &&
    Date.parse(g.valid_time) === time && (!g.served_valid_time || Date.parse(g.served_valid_time) === time);
}
