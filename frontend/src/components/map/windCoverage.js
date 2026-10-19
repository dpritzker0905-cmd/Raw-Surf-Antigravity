/** Does wind grid bounds `gb` cover viewport `vp`? A world grid (span >= 350 deg) covers every viewport. (from WeatherEngine.js) */
export function windGridCovers(gb, vp) {
  if (!gb || !vp) return false;
  const span = gb.west > gb.east ? (gb.east + 360.0) - gb.west : gb.east - gb.west;
  if (span >= 350.0) return true;
  const eps = 0.05;
  return gb.west <= vp.west + eps && gb.east >= vp.east - eps && gb.south <= vp.south + eps && gb.north >= vp.north - eps;
}
