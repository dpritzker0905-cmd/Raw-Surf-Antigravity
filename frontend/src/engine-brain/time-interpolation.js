/*
====================================================
 Raw Surf OS — Time Interpolation Model
 TEMPORAL FORECAST SCRUBBING + BLENDING
====================================================

PURE MATH — NO engine, NO DOM
var/function only (TDZ-immune)
====================================================
*/

/**
 * Linearly interpolate between two forecast frames.
 * Used when the time slider is between two discrete model outputs.
 *
 * @param {{ data: Array }} frameA - earlier frame
 * @param {{ data: Array }} frameB - later frame
 * @param {number} t - blend factor (0 = frameA, 1 = frameB)
 * @returns {{ data: Array }}
 */
function interpolateFrames(frameA, frameB, t) {
  var clamped = Math.max(0, Math.min(1, t));
  var data = [];
  var h = Math.min(frameA.data.length, frameB.data.length);
  for (var y = 0; y < h; y++) {
    var rowA = frameA.data[y];
    var rowB = frameB.data[y];
    var w = Math.min(rowA.length, rowB.length);
    var row = [];
    for (var x = 0; x < w; x++) {
      var a = rowA[x];
      var b = rowB[x];
      row.push({
        u: a.u + (b.u - a.u) * clamped,
        v: a.v + (b.v - a.v) * clamped,
      });
    }
    data.push(row);
  }
  return { data: data };
}

/**
 * Interpolate scalar grids (rain, pressure, temperature).
 *
 * @param {number[][]} gridA
 * @param {number[][]} gridB
 * @param {number} t - blend factor
 * @returns {number[][]}
 */
function interpolateScalarGrids(gridA, gridB, t) {
  var clamped = Math.max(0, Math.min(1, t));
  var result = [];
  var h = Math.min(gridA.length, gridB.length);
  for (var y = 0; y < h; y++) {
    var w = Math.min(gridA[y].length, gridB[y].length);
    var row = [];
    for (var x = 0; x < w; x++) {
      row.push(gridA[y][x] + (gridB[y][x] - gridA[y][x]) * clamped);
    }
    result.push(row);
  }
  return result;
}

/**
 * Compute the blend factor from a continuous time value
 * and two discrete timesteps.
 *
 * @param {number} time - current time (e.g. epoch ms or forecast hour)
 * @param {number} timeA - time of frame A
 * @param {number} timeB - time of frame B
 * @returns {number} 0-1 blend factor
 */
function computeBlendFactor(time, timeA, timeB) {
  if (timeB === timeA) return 0;
  return Math.max(0, Math.min(1, (time - timeA) / (timeB - timeA)));
}

/**
 * Find the two bracketing frames for a given time from a sorted array.
 *
 * @param {Array<{ time: number }>} frames - sorted by time ascending
 * @param {number} time
 * @returns {{ a: number, b: number, t: number }} indices + blend factor
 */
function findBracketingFrames(frames, time) {
  if (frames.length === 0) return { a: 0, b: 0, t: 0 };
  if (frames.length === 1) return { a: 0, b: 0, t: 0 };
  if (time <= frames[0].time) return { a: 0, b: 0, t: 0 };
  if (time >= frames[frames.length - 1].time) {
    var last = frames.length - 1;
    return { a: last, b: last, t: 0 };
  }
  for (var i = 0; i < frames.length - 1; i++) {
    if (time >= frames[i].time && time < frames[i + 1].time) {
      var blend = computeBlendFactor(time, frames[i].time, frames[i + 1].time);
      return { a: i, b: i + 1, t: blend };
    }
  }
  return { a: 0, b: 0, t: 0 };
}

export {
  interpolateFrames,
  interpolateScalarGrids,
  computeBlendFactor,
  findBracketingFrames,
};
