/*
====================================================
 Raw Surf OS — Projection Utilities
 WEB MERCATOR + COORDINATE TRANSFORMS
====================================================

PURE MATH — NO engine, NO DOM
var/function only (TDZ-immune)
====================================================
*/

var DEG2RAD = Math.PI / 180;
var RAD2DEG = 180 / Math.PI;
var TILE_SIZE = 512;

/**
 * Convert longitude/latitude to Web Mercator pixel coordinates.
 * @param {number} lng - longitude (-180 to 180)
 * @param {number} lat - latitude (-85.05 to 85.05)
 * @param {number} zoom - map zoom level
 * @returns {{ x: number, y: number }}
 */
function lngLatToPixel(lng, lat, zoom) {
  var scale = TILE_SIZE * Math.pow(2, zoom);
  var x = ((lng + 180) / 360) * scale;
  var latRad = lat * DEG2RAD;
  var y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * scale;
  return { x: x, y: y };
}

/**
 * Convert Web Mercator pixel coordinates to longitude/latitude.
 * @param {number} px
 * @param {number} py
 * @param {number} zoom
 * @returns {{ lng: number, lat: number }}
 */
function pixelToLngLat(px, py, zoom) {
  var scale = TILE_SIZE * Math.pow(2, zoom);
  var lng = (px / scale) * 360 - 180;
  var n = Math.PI - 2 * Math.PI * py / scale;
  var lat = RAD2DEG * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lng: lng, lat: lat };
}

/**
 * Convert lng/lat to normalized [0,1] Mercator coordinates.
 * Used by WebGL shaders for position mapping.
 * @param {number} lng
 * @param {number} lat
 * @returns {{ x: number, y: number }}
 */
function lngLatToMercatorNormalized(lng, lat) {
  var x = (lng + 180) / 360;
  var latRad = lat * DEG2RAD;
  var y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2;
  return { x: x, y: y };
}

/**
 * Compute tile coordinates from lng/lat at a given zoom.
 * @param {number} lng
 * @param {number} lat
 * @param {number} zoom
 * @returns {{ z: number, x: number, y: number }}
 */
function lngLatToTile(lng, lat, zoom) {
  var z = Math.floor(zoom);
  var n = Math.pow(2, z);
  var tileX = Math.floor(((lng + 180) / 360) * n);
  var latRad = lat * DEG2RAD;
  var tileY = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { z: z, x: tileX, y: tileY };
}

/**
 * Haversine distance between two points in km.
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function haversineDistance(lat1, lng1, lat2, lng2) {
  var R = 6371;
  var dLat = (lat2 - lat1) * DEG2RAD;
  var dLng = (lng2 - lng1) * DEG2RAD;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG2RAD) * Math.cos(lat2 * DEG2RAD) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export {
  lngLatToPixel, pixelToLngLat, lngLatToMercatorNormalized,
  lngLatToTile, haversineDistance, DEG2RAD, RAD2DEG, TILE_SIZE,
};
