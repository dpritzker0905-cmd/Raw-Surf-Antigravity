/**
 * Wind bench: a MapLibre-equivalent Web Mercator camera. Pure, no DOM, no GL.
 *
 * MapLibre draws 512 css px per world tile, so zoom z spans 512 * 2^z css px around the globe.
 * `matrix` maps Mercator [0,1]^2 to clip space exactly as the custom-layer `matrix` argument does
 * for a north-up, unpitched view, which is all the engine needs.
 */

const TILE_PX = 512;
const MAX_LAT = 85.0511;

function mercY(lat) {
  const r = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI / 180;
  return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2;
}

function latOf(y) {
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;
}

/**
 * @param {number} lng   view centre
 * @param {number} lat   view centre
 * @param {number} z     MapLibre zoom
 * @param {number} cssW  viewport width in css px
 * @param {number} cssH  viewport height in css px
 */
function makeCamera(lng, lat, z, cssW, cssH) {
  const world = TILE_PX * Math.pow(2, z);
  const cx = (lng + 180) / 360, cy = mercY(lat);
  const sx = world * 2 / cssW, sy = -world * 2 / cssH;
  const matrix = new Float32Array([sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, -cx * sx, -cy * sy, 0, 1]);
  const viewBounds = [
    (cx - cssW / 2 / world) * 360 - 180, latOf(cy + cssH / 2 / world),
    (cx + cssW / 2 / world) * 360 - 180, latOf(cy - cssH / 2 / world),
  ];
  const unproject = (px, py) => ({ lng: (cx + (px - cssW / 2) / world) * 360 - 180, lat: latOf(cy + (py - cssH / 2) / world) });
  return { matrix, viewBounds, unproject, z };
}

module.exports = { TILE_PX, mercY, latOf, makeCamera };
