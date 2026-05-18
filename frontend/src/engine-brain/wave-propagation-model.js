/*
====================================================
 Raw Surf OS Wave Propagation Model
 PURE SURF SCIENCE SIMULATION LAYER
====================================================

NO engine
NO rendering
NO DOM
PURE physics + transformation logic
var/function only (TDZ-immune)
====================================================
*/

/**
 * Propagate swell energy across a wave field with decay.
 * Models energy loss over distance (simplified exponential decay).
 *
 * @param {{ width: number, height: number, energy: number[][], direction: number[][], period: number[][] }} field
 * @param {number} [decay=0.98] - energy retention per step (0-1)
 * @returns {Object} new wave field with decayed energy
 */
function propagateSwell(field, decay) {
  if (decay === undefined) decay = 0.98;
  var h = field.energy.length;
  var newEnergy = [];
  for (var y = 0; y < h; y++) {
    var row = field.energy[y];
    var newRow = [];
    for (var x = 0; x < row.length; x++) {
      newRow.push(row[x] * decay);
    }
    newEnergy.push(newRow);
  }
  return {
    width: field.width,
    height: field.height,
    energy: newEnergy,
    direction: field.direction,
    period: field.period,
  };
}

/**
 * Compute significant wave height from energy.
 * Hs = sqrt(energy) simplified from Hs = 4*sqrt(m0)
 *
 * @param {number} energy - spectral energy density
 * @returns {number} wave height in meters
 */
function computeWaveHeight(energy) {
  return Math.sqrt(Math.max(energy, 0));
}

/**
 * Smooth direction field using 5-point stencil average.
 * Reduces noise in directional grids from coarse model output.
 *
 * @param {number[][]} direction - 2D direction grid (degrees)
 * @returns {number[][]} smoothed direction grid
 */
function smoothDirection(direction) {
  var h = direction.length;
  var w = direction[0].length;
  var out = [];
  for (var y = 0; y < h; y++) {
    var row = [];
    for (var x = 0; x < w; x++) {
      if (y > 0 && y < h - 1 && x > 0 && x < w - 1) {
        row.push(
          (direction[y][x] +
            direction[y - 1][x] +
            direction[y + 1][x] +
            direction[y][x - 1] +
            direction[y][x + 1]) / 5
        );
      } else {
        row.push(direction[y][x]);
      }
    }
    out.push(row);
  }
  return out;
}

/**
 * Compute wave period from energy and depth (deep water approximation).
 * T = 2*pi*sqrt(wavelength / g), simplified to T ~ sqrt(energy) * scale
 *
 * @param {number} energy
 * @param {number} [scale=1.5]
 * @returns {number} period in seconds
 */
function estimatePeriod(energy, scale) {
  if (scale === undefined) scale = 1.5;
  return Math.sqrt(Math.max(energy, 0)) * scale;
}

/**
 * Compute surf quality index from height, period, and direction.
 * Higher = better surf. Range 0-100.
 *
 * @param {number} height - wave height (m)
 * @param {number} period - wave period (s)
 * @param {number} direction - swell direction (degrees)
 * @param {number} idealDirection - spot's ideal swell direction (degrees)
 * @returns {number} quality score 0-100
 */
function computeSurfQuality(height, period, direction, idealDirection) {
  // Height score: peaks at 1-2m, drops off at extremes
  var hScore = Math.min(1, height / 1.5) * (1 - Math.max(0, (height - 3) / 5));
  hScore = Math.max(0, hScore);

  // Period score: longer = better, up to 14s
  var pScore = Math.min(1, period / 14);

  // Direction score: how close to ideal
  var dDiff = Math.abs(direction - idealDirection);
  if (dDiff > 180) dDiff = 360 - dDiff;
  var dScore = Math.max(0, 1 - dDiff / 90);

  return Math.round((hScore * 0.4 + pScore * 0.3 + dScore * 0.3) * 100);
}

// TYPED ARRAY SUPPORT (GPU pipeline) 

/**
 * Propagate swell energy using Float32Array (zero-GC for GPU pipeline).
 * @param {Float32Array} energyGrid
 * @param {number} [decay=0.98]
 * @returns {Float32Array} new decayed grid
 */
function propagateSwellTyped(energyGrid, decay) {
  if (decay === undefined) decay = 0.98;
  var out = new Float32Array(energyGrid.length);
  for (var i = 0; i < energyGrid.length; i++) {
    out[i] = energyGrid[i] * decay;
  }
  return out;
}

/**
 * Advect particles through a wind/current field.
 * Moves each particle by the vector at its position.
 *
 * @param {Array<{ x: number, y: number }>} particles
 * @param {function(number, number): { u: number, v: number }} fieldSampler
 * @param {number} [dt=1]
 * @returns {Array<{ x: number, y: number }>}
 */
function advectParticles(particles, fieldSampler, dt) {
  if (dt === undefined) dt = 1;
  var result = [];
  for (var i = 0; i < particles.length; i++) {
    var p = particles[i];
    var w = fieldSampler(p.x, p.y);
    result.push({ x: p.x + w.u * dt, y: p.y + w.v * dt });
  }
  return result;
}

export {
  propagateSwell,
  computeWaveHeight,
  smoothDirection,
  estimatePeriod,
  computeSurfQuality,
  propagateSwellTyped,
  advectParticles,
};
