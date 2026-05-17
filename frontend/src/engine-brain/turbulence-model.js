/*
====================================================
 Raw Surf OS — Turbulence Model
 WIND SIMULATION SUB-LAYER
====================================================

PURE MATH — NO engine, NO rendering, NO DOM
var/function only (TDZ-immune)
====================================================
*/

/**
 * Add turbulent perturbation to a wind vector field.
 * Simulates sub-grid-scale turbulence using Perlin-style noise.
 *
 * @param {{ data: Array, width: number, height: number }} field
 * @param {{ amplitude: number, frequency: number, seed: number }} config
 * @returns {{ data: Array, width: number, height: number }}
 */
function applyTurbulence(field, config) {
  var amp = config.amplitude || 0.5;
  var freq = config.frequency || 0.1;
  var seed = config.seed || 0;
  var data = [];

  for (var y = 0; y < field.height; y++) {
    var row = [];
    for (var x = 0; x < field.width; x++) {
      var base = field.data[y][x];
      // Deterministic pseudo-noise
      var nx = hashNoise(x * freq + seed, y * freq);
      var ny = hashNoise(x * freq, y * freq + seed + 7.31);
      row.push({
        u: base.u + nx * amp,
        v: base.v + ny * amp,
      });
    }
    data.push(row);
  }
  return { data: data, width: field.width, height: field.height };
}

/**
 * Simple hash-based noise (deterministic, no external deps).
 * @param {number} x
 * @param {number} y
 * @returns {number} -1 to 1
 */
function hashNoise(x, y) {
  var n = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return (n - Math.floor(n)) * 2 - 1;
}

/**
 * Compute turbulent kinetic energy (TKE) at a point.
 * Used for adaptive particle dispersion.
 *
 * @param {{ u: number, v: number }} mean - mean wind
 * @param {{ u: number, v: number }} instant - instantaneous wind
 * @returns {number} TKE estimate
 */
function computeTKE(mean, instant) {
  var du = instant.u - mean.u;
  var dv = instant.v - mean.v;
  return 0.5 * (du * du + dv * dv);
}

/**
 * Compute gustiness factor from TKE.
 * Higher = more variable wind.
 * @param {number} tke
 * @param {number} meanSpeed
 * @returns {number} 0-1 gustiness
 */
function gustFactor(tke, meanSpeed) {
  if (meanSpeed < 0.1) return 0;
  return Math.min(1, Math.sqrt(2 * tke) / meanSpeed);
}

export { applyTurbulence, hashNoise, computeTKE, gustFactor };
