/**
 * Wind Advection Model — Pure Scientific Simulation Layer
 *
 * PURE MATH ONLY:
 *   - NO WebGL
 *   - NO DOM
 *   - NO engine dependency
 *   - NO React
 *   - NO side effects
 *
 * This is the engine-brain's authoritative wind physics module.
 * Provides bilinear interpolation and particle advection for vector fields.
 */

/**
 * @typedef {{ u: number, v: number }} Vector
 * @typedef {{ width: number, height: number, data: Vector[][] }} WindField
 * @typedef {{ x: number, y: number }} Position
 */

/**
 * Bilinear interpolation of a 2D vector field.
 * Core physics primitive — used by all wind rendering systems.
 *
 * @param {WindField} field
 * @param {number} x - fractional column index
 * @param {number} y - fractional row index
 * @returns {Vector}
 */
export function bilinearSample(field, x, y) {
  var x0 = Math.floor(x);
  var x1 = Math.min(x0 + 1, field.width - 1);
  var y0 = Math.floor(y);
  var y1 = Math.min(y0 + 1, field.height - 1);

  var sx = x - x0;
  var sy = y - y0;

  var a = field.data[y0][x0];
  var b = field.data[y0][x1];
  var c = field.data[y1][x0];
  var d = field.data[y1][x1];

  return {
    u: a.u * (1 - sx) * (1 - sy) + b.u * sx * (1 - sy) +
       c.u * (1 - sx) * sy + d.u * sx * sy,
    v: a.v * (1 - sx) * (1 - sy) + b.v * sx * (1 - sy) +
       c.v * (1 - sx) * sy + d.v * sx * sy,
  };
}

/**
 * Bicubic interpolation weight function (Catmull-Rom).
 * Higher quality than bilinear, used for smoother field rendering.
 *
 * @param {number} t - fractional position [0, 1]
 * @returns {number[]} 4 weights
 */
export function cubicWeights(t) {
  var t2 = t * t;
  var t3 = t2 * t;
  return [
    -0.5 * t3 + t2 - 0.5 * t,
     1.5 * t3 - 2.5 * t2 + 1,
    -1.5 * t3 + 2.0 * t2 + 0.5 * t,
     0.5 * t3 - 0.5 * t2,
  ];
}

/**
 * Advect a particle through a wind vector field (Euler integration).
 *
 * @param {Position} position - current particle position in grid coords
 * @param {WindField} field - wind vector field
 * @param {number} dt - time step in seconds
 * @returns {Position} new position
 */
export function advectParticle(position, field, dt) {
  var wind = bilinearSample(field, position.x, position.y);
  return {
    x: position.x + wind.u * dt,
    y: position.y + wind.v * dt,
  };
}

/**
 * Runge-Kutta 4th order advection (higher accuracy for longer timesteps).
 *
 * @param {Position} pos
 * @param {WindField} field
 * @param {number} dt
 * @returns {Position}
 */
export function advectParticleRK4(pos, field, dt) {
  var k1 = bilinearSample(field, pos.x, pos.y);
  var k2 = bilinearSample(field, pos.x + k1.u * dt * 0.5, pos.y + k1.v * dt * 0.5);
  var k3 = bilinearSample(field, pos.x + k2.u * dt * 0.5, pos.y + k2.v * dt * 0.5);
  var k4 = bilinearSample(field, pos.x + k3.u * dt, pos.y + k3.v * dt);

  return {
    x: pos.x + (k1.u + 2 * k2.u + 2 * k3.u + k4.u) * dt / 6,
    y: pos.y + (k1.v + 2 * k2.v + 2 * k3.v + k4.v) * dt / 6,
  };
}

/**
 * Bicubic interpolation of a 2D vector field (Catmull-Rom).
 * Uses cubicWeights kernel for 4x4 neighborhood sampling.
 * Higher quality than bilinear — smoother gradients for rendering.
 *
 * @param {WindField} field
 * @param {number} x - fractional column index
 * @param {number} y - fractional row index
 * @returns {Vector}
 */
export function bicubicSample(field, x, y) {
  var ix = Math.floor(x);
  var iy = Math.floor(y);
  var fx = x - ix;
  var fy = y - iy;

  var wx = cubicWeights(fx);
  var wy = cubicWeights(fy);

  var u = 0, v = 0;
  for (var j = -1; j <= 2; j++) {
    var cy = Math.max(0, Math.min(field.height - 1, iy + j));
    for (var i = -1; i <= 2; i++) {
      var cx = Math.max(0, Math.min(field.width - 1, ix + i));
      var cell = field.data[cy]?.[cx] || { u: 0, v: 0 };
      var w = wx[i + 1] * wy[j + 1];
      u += cell.u * w;
      v += cell.v * w;
    }
  }
  return { u: u, v: v };
}

/**
 * Compute wind speed from vector components.
 * @param {number} u
 * @param {number} v
 * @returns {number} speed in m/s
 */
export function windSpeed(u, v) {
  return Math.sqrt(u * u + v * v);
}

/**
 * Compute meteorological wind direction (degrees, where wind comes FROM).
 * @param {number} u - east-west component
 * @param {number} v - north-south component
 * @returns {number} degrees [0, 360)
 */
export function windDirection(u, v) {
  var angle = Math.atan2(-u, -v) * (180 / Math.PI);
  return (angle + 360) % 360;
}
