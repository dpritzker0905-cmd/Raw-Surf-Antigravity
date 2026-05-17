/*
====================================================
 Raw Surf OS — Vector Field Primitives
 SHARED OPERATIONS FOR WIND, CURRENT, SWELL FIELDS
====================================================

PURE MATH — NO engine, NO rendering, NO DOM
var/function only (TDZ-immune)
====================================================
*/

/**
 * Sample a 2D vector field at fractional coordinates using bilinear interpolation.
 * Delegates to the shared interpolation kernel.
 *
 * @param {{ data: Array, width: number, height: number }} field
 * @param {number} fx - fractional x (0 to width-1)
 * @param {number} fy - fractional y (0 to height-1)
 * @returns {{ u: number, v: number }}
 */
function sampleField(field, fx, fy) {
  var x0 = Math.floor(fx);
  var y0 = Math.floor(fy);
  var x1 = Math.min(x0 + 1, field.width - 1);
  var y1 = Math.min(y0 + 1, field.height - 1);
  var dx = fx - x0;
  var dy = fy - y0;

  var q00 = field.data[y0]?.[x0] || { u: 0, v: 0 };
  var q10 = field.data[y0]?.[x1] || { u: 0, v: 0 };
  var q01 = field.data[y1]?.[x0] || { u: 0, v: 0 };
  var q11 = field.data[y1]?.[x1] || { u: 0, v: 0 };

  return {
    u: q00.u * (1 - dx) * (1 - dy) + q10.u * dx * (1 - dy) +
       q01.u * (1 - dx) * dy + q11.u * dx * dy,
    v: q00.v * (1 - dx) * (1 - dy) + q10.v * dx * (1 - dy) +
       q01.v * (1 - dx) * dy + q11.v * dx * dy,
  };
}

/**
 * Compute magnitude at a grid point.
 * @param {{ u: number, v: number }} vec
 * @returns {number}
 */
function magnitude(vec) {
  return Math.sqrt(vec.u * vec.u + vec.v * vec.v);
}

/**
 * Compute direction in degrees (meteorological convention: where FROM).
 * @param {{ u: number, v: number }} vec
 * @returns {number} 0-360
 */
function direction(vec) {
  var deg = (Math.atan2(-vec.u, -vec.v) * 180 / Math.PI + 360) % 360;
  return deg;
}

/**
 * Create an empty vector field grid.
 * @param {number} width
 * @param {number} height
 * @returns {{ data: Array, width: number, height: number }}
 */
function createEmptyField(width, height) {
  var data = [];
  for (var y = 0; y < height; y++) {
    var row = [];
    for (var x = 0; x < width; x++) {
      row.push({ u: 0, v: 0 });
    }
    data.push(row);
  }
  return { data: data, width: width, height: height };
}

/**
 * Combine two vector fields (e.g. wind + current).
 * @param {{ data: Array, width: number, height: number }} a
 * @param {{ data: Array, width: number, height: number }} b
 * @param {number} [weightB=1.0] - weight for field B
 * @returns {{ data: Array, width: number, height: number }}
 */
function combineFields(a, b, weightB) {
  if (weightB === undefined) weightB = 1.0;
  var w = Math.min(a.width, b.width);
  var h = Math.min(a.height, b.height);
  var data = [];
  for (var y = 0; y < h; y++) {
    var row = [];
    for (var x = 0; x < w; x++) {
      var va = a.data[y]?.[x] || { u: 0, v: 0 };
      var vb = b.data[y]?.[x] || { u: 0, v: 0 };
      row.push({ u: va.u + vb.u * weightB, v: va.v + vb.v * weightB });
    }
    data.push(row);
  }
  return { data: data, width: w, height: h };
}

/**
 * Compute divergence at a grid point (indicates convergence/lift zones).
 * @param {{ data: Array }} field
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function divergence(field, x, y) {
  var left  = field.data[y]?.[x - 1] || { u: 0, v: 0 };
  var right = field.data[y]?.[x + 1] || { u: 0, v: 0 };
  var up    = field.data[y - 1]?.[x] || { u: 0, v: 0 };
  var down  = field.data[y + 1]?.[x] || { u: 0, v: 0 };
  return (right.u - left.u) / 2 + (down.v - up.v) / 2;
}

/**
 * Compute vorticity (curl) at a grid point.
 * Positive = counterclockwise rotation.
 * @param {{ data: Array }} field
 * @param {number} x
 * @param {number} y
 * @returns {number}
 */
function vorticity(field, x, y) {
  var left  = field.data[y]?.[x - 1] || { u: 0, v: 0 };
  var right = field.data[y]?.[x + 1] || { u: 0, v: 0 };
  var up    = field.data[y - 1]?.[x] || { u: 0, v: 0 };
  var down  = field.data[y + 1]?.[x] || { u: 0, v: 0 };
  return (right.v - left.v) / 2 - (down.u - up.u) / 2;
}

export {
  sampleField,
  magnitude,
  direction,
  createEmptyField,
  combineFields,
  divergence,
  vorticity,
};
