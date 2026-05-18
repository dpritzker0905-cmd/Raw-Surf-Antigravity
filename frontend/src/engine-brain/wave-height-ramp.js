/*
====================================================
 Raw Surf OS Wave Height Color Ramp
 VISUALIZATION MAPPING FOR WAVE/SWELL DATA
====================================================

PURE MATH NO WebGL, NO DOM, NO engine
var/function only (TDZ-immune)
====================================================
*/

/**
 * Wave height color stops (Significant Wave Height scale).
 * Matches oceanographic conventions used by NOAA/ECMWF viewers.
 *
 * Each stop: [heightMeters, R, G, B, A]
 */
var WAVE_HEIGHT_STOPS = [
 [0.0, 20, 20, 80, 180], // deep blue flat
 [0.3, 40, 80, 160, 200], // steel blue ankle
 [0.6, 60, 160, 200, 220], // cyan knee
 [1.0, 80, 200, 160, 230], // teal waist
 [1.5, 120, 220, 100, 240], // green head high
 [2.0, 200, 220, 60, 245], // yellow overhead
 [3.0, 240, 180, 40, 250], // orange double
 [4.0, 240, 100, 40, 252], // red-orange triple
 [6.0, 220, 40, 40, 254], // red XXL
 [10.0, 180, 20, 100, 255], // magenta extreme
];

/**
 * Get RGBA color for a wave height value using linear interpolation.
 *
 * @param {number} height - wave height in meters
 * @returns {{ r: number, g: number, b: number, a: number }}
 */
function getWaveColor(height) {
  var stops = WAVE_HEIGHT_STOPS;
  if (height <= stops[0][0]) {
    return { r: stops[0][1], g: stops[0][2], b: stops[0][3], a: stops[0][4] };
  }
  if (height >= stops[stops.length - 1][0]) {
    var last = stops[stops.length - 1];
    return { r: last[1], g: last[2], b: last[3], a: last[4] };
  }
  for (var i = 0; i < stops.length - 1; i++) {
    if (height >= stops[i][0] && height < stops[i + 1][0]) {
      var t = (height - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      return {
        r: Math.round(stops[i][1] + (stops[i + 1][1] - stops[i][1]) * t),
        g: Math.round(stops[i][2] + (stops[i + 1][2] - stops[i][2]) * t),
        b: Math.round(stops[i][3] + (stops[i + 1][3] - stops[i][3]) * t),
        a: Math.round(stops[i][4] + (stops[i + 1][4] - stops[i][4]) * t),
      };
    }
  }
  return { r: 0, g: 0, b: 0, a: 0 };
}

/**
 * Generate a 256-pixel RGBA ramp texture for wave height visualization.
 * @param {number} maxHeight - maximum height mapped to pixel 255
 * @returns {Uint8Array} 256*4 RGBA data
 */
function generateWaveRampData(maxHeight) {
  if (maxHeight === undefined) maxHeight = 10;
  var data = new Uint8Array(256 * 4);
  for (var i = 0; i < 256; i++) {
    var h = (i / 255) * maxHeight;
    var c = getWaveColor(h);
    data[i * 4 + 0] = c.r;
    data[i * 4 + 1] = c.g;
    data[i * 4 + 2] = c.b;
    data[i * 4 + 3] = c.a;
  }
  return data;
}

export { WAVE_HEIGHT_STOPS, getWaveColor, generateWaveRampData };
