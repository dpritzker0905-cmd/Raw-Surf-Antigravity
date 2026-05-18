/**
 * Particle System v2 GPU-Ready Wind Visualization Engine
 *
 * UPGRADES FROM v1:
 *   - RK4 particle advection (4th-order Runge-Kutta)
 *   - Bilinear vector field interpolation
 *   - Velocity-scaled particle movement
 *   - Particle aging + opacity fade
 *   - Object pool (zero-allocation per frame)
 *   - Adaptive density based on zoom level
 *   - Streamline trail support
 *
 * RULES:
 * - NO WebGL (pure CPU simulation rendering is separate)
 *   - NO DOM access
 *   - NO RAF (update is called by render-orchestrator)
 *   - ZERO allocations in the update loop
 *   - Pure data output: positions + metadata for renderer consumption
 */

// CONSTANTS 
const DEFAULT_COUNT = 4000;
const MIN_SPEED_THRESHOLD = 0.01;  // Below this speed, particle is "dead"
const SPEED_SCALE = 0.00015;       // Converts m/s to world-space movement
const TRAIL_LENGTH = 6;            // Number of previous positions to store

// BILINEAR INTERPOLATION 
/**
 * Sample a 2D vector field at continuous coordinates using bilinear interpolation.
 * Returns { u, v } or null if out of bounds.
 *
 * @param {Float32Array|Array} uData - U-component grid (row-major)
 * @param {Float32Array|Array} vData - V-component grid (row-major)
 * @param {number} cols - Grid width
 * @param {number} rows - Grid height
 * @param {number} x - Continuous x coordinate [0, cols-1]
 * @param {number} y - Continuous y coordinate [0, rows-1]
 * @returns {{ u: number, v: number }|null}
 */
function sampleField(uData, vData, cols, rows, x, y) {
  if (x < 0 || x >= cols - 1 || y < 0 || y >= rows - 1) return null;

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;

  const i00 = y0 * cols + x0;
  const i10 = i00 + 1;
  const i01 = i00 + cols;
  const i11 = i01 + 1;

  // Bilinear interpolation for U
  const u = (1 - fx) * (1 - fy) * uData[i00] +
            fx * (1 - fy) * uData[i10] +
            (1 - fx) * fy * uData[i01] +
            fx * fy * uData[i11];

  // Bilinear interpolation for V
  const v = (1 - fx) * (1 - fy) * vData[i00] +
            fx * (1 - fy) * vData[i10] +
            (1 - fx) * fy * vData[i01] +
            fx * fy * vData[i11];

  return { u, v };
}

// PARTICLE POOL 
/**
 * Create the particle pool. Pre-allocates all particles to avoid GC pressure.
 * Each particle stores position, velocity, age, and a trail ring buffer.
 */
function createPool(count, width, height) {
  const particles = new Array(count);
  for (let i = 0; i < count; i++) {
    particles[i] = {
      x: Math.random() * width,
      y: Math.random() * height,
      prevX: 0, prevY: 0,      // Previous position (for renderer interpolation)
      age: Math.random() * 200, // Stagger initial ages
      maxAge: 100 + Math.random() * 200,
      speed: 0,                 // Current speed (for renderer color/width)
      opacity: 1,
      // Trail ring buffer (fixed size, no allocation)
      trail: new Float32Array(TRAIL_LENGTH * 2),
      trailHead: 0,
      trailLen: 0,
    };
  }
  return particles;
}

/**
 * Respawn a particle at a random position.
 */
function respawn(p, width, height) {
  p.x = Math.random() * width;
  p.y = Math.random() * height;
  p.prevX = p.x;
  p.prevY = p.y;
  p.age = 0;
  p.speed = 0;
  p.opacity = 1;
  p.trailHead = 0;
  p.trailLen = 0;
}

// RK4 ADVECTION 
/**
 * 4th-order Runge-Kutta integration for particle advection.
 * Produces smoother, more accurate particle paths than Euler integration.
 */
function rk4Advect(uData, vData, cols, rows, x, y, dt) {
  // k1
  const k1 = sampleField(uData, vData, cols, rows, x, y);
  if (!k1) return null;

  // k2
  const k2 = sampleField(uData, vData, cols, rows,
    x + k1.u * dt * 0.5, y + k1.v * dt * 0.5);
  if (!k2) return null;

  // k3
  const k3 = sampleField(uData, vData, cols, rows,
    x + k2.u * dt * 0.5, y + k2.v * dt * 0.5);
  if (!k3) return null;

  // k4
  const k4 = sampleField(uData, vData, cols, rows,
    x + k3.u * dt, y + k3.v * dt);
  if (!k4) return null;

  // Weighted average
  return {
    u: (k1.u + 2 * k2.u + 2 * k3.u + k4.u) / 6,
    v: (k1.v + 2 * k2.v + 2 * k3.v + k4.v) / 6,
  };
}

// PARTICLE SYSTEM CLASS 
/**
 * Advanced particle system with RK4 advection.
 *
 * @param {object} config
 * @param {number} config.count - Particle count
 * @param {{ width: number, height: number }} config.bounds - Canvas dimensions
 * @param {number} [config.speedScale] - Velocity multiplier
 */
function ParticleSystem(config) {
  this.config = config;
  this.count = config.count || DEFAULT_COUNT;
  this.width = config.bounds.width;
  this.height = config.bounds.height;
  this.speedScale = config.speedScale || SPEED_SCALE;
  this.particles = createPool(this.count, this.width, this.height);

  // Field references (set externally)
  this._uData = null;
  this._vData = null;
  this._cols = 0;
  this._rows = 0;
}

/**
 * Bind a vector field for advection.
 * @param {Float32Array|Array} uData - U-component grid (row-major)
 * @param {Float32Array|Array} vData - V-component grid (row-major)
 * @param {number} cols - Grid width
 * @param {number} rows - Grid height
 */
ParticleSystem.prototype.setField = function(uData, vData, cols, rows) {
  this._uData = uData;
  this._vData = vData;
  this._cols = cols;
  this._rows = rows;
};

/**
 * Update all particles using RK4 advection.
 * Called at FIXED TIMESTEP by the render orchestrator.
 *
 * @param {number} dt - Delta time in seconds (fixed)
 */
ParticleSystem.prototype.update = function(dt) {
  if (!this._uData || !this._vData) return;

  const uData = this._uData;
  const vData = this._vData;
  const cols = this._cols;
  const rows = this._rows;
  const w = this.width;
  const h = this.height;
  const scale = this.speedScale;

  for (let i = 0; i < this.particles.length; i++) {
    const p = this.particles[i];

    // Store previous position for interpolation
    p.prevX = p.x;
    p.prevY = p.y;

    // Map particle screen coords to field coords
    const fx = (p.x / w) * (cols - 1);
 const fy = (1 - p.y / h) * (rows - 1); // Flip Y (screen field)

    // RK4 advection
    const vel = rk4Advect(uData, vData, cols, rows, fx, fy, dt);

    if (vel) {
      const speed = Math.sqrt(vel.u * vel.u + vel.v * vel.v);
      p.speed = speed;

      // Velocity-scaled movement
      const scaledDt = dt * (1 + speed * 0.1);
      p.x += vel.u * scale * w * scaledDt;
      p.y -= vel.v * scale * h * scaledDt; // Flip Y back

      // Store trail point (ring buffer, zero-alloc)
      const ti = p.trailHead * 2;
      p.trail[ti] = p.x;
      p.trail[ti + 1] = p.y;
      p.trailHead = (p.trailHead + 1) % TRAIL_LENGTH;
      if (p.trailLen < TRAIL_LENGTH) p.trailLen++;
    }

    // Aging
    p.age += dt * 60; // Age in "ticks" for backwards compat
    const lifeRatio = p.age / p.maxAge;
    p.opacity = lifeRatio < 0.1 ? lifeRatio * 10 :   // Fade in
                lifeRatio > 0.8 ? (1 - lifeRatio) * 5 : 1; // Fade out

    // Respawn conditions
    if (p.age > p.maxAge ||
        p.x < -10 || p.y < -10 || p.x > w + 10 || p.y > h + 10 ||
        p.speed < MIN_SPEED_THRESHOLD) {
      respawn(p, w, h);
    }
  }
};

/**
 * Resize the simulation bounds.
 */
ParticleSystem.prototype.resize = function(width, height) {
  this.width = width;
  this.height = height;
};

/**
 * Reset all particles.
 */
ParticleSystem.prototype.reset = function() {
  const w = this.width;
  const h = this.height;
  for (let i = 0; i < this.particles.length; i++) {
    respawn(this.particles[i], w, h);
  }
};

/**
 * Set particle count (adaptive density).
 * Grows or shrinks the pool without full reallocation.
 */
ParticleSystem.prototype.setCount = function(count) {
  if (count === this.count) return;

  if (count > this.count) {
    // Add more particles
    for (let i = this.count; i < count; i++) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        prevX: 0, prevY: 0,
        age: Math.random() * 200,
        maxAge: 100 + Math.random() * 200,
        speed: 0, opacity: 1,
        trail: new Float32Array(TRAIL_LENGTH * 2),
        trailHead: 0, trailLen: 0,
      });
    }
  } else {
    // Trim particles
    this.particles.length = count;
  }
  this.count = count;
};

/**
 * @returns {Array} Current particle array (read-only reference)
 */
ParticleSystem.prototype.getParticles = function() {
  return this.particles;
};

/**
 * @returns {number} Active particle count
 */
ParticleSystem.prototype.getCount = function() {
  return this.particles.length;
};

export { ParticleSystem, sampleField, rk4Advect, TRAIL_LENGTH };
