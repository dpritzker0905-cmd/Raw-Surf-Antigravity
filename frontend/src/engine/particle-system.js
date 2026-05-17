/*
====================================================
 Raw Surf OS — Particle System
 WIND FIELD VISUALIZATION LAYER (CPU-safe)
====================================================

RULES:
- NO WebGL
- NO engine init at import time
- NO DOM
- NO RAF
- PURE UPDATE SYSTEM ONLY
- var/function declarations only (TDZ-immune)
====================================================
*/

/**
 * Create a particle.
 * @param {number} width
 * @param {number} height
 * @returns {{ x: number, y: number, age: number, maxAge: number }}
 */
function createParticle(width, height) {
  return {
    x: Math.random() * width,
    y: Math.random() * height,
    age: 0,
    maxAge: 100 + Math.random() * 200,
  };
}

/**
 * ParticleSystem constructor — CPU-based wind particle advection.
 * Used as a fallback when WebGL is unavailable or for lightweight overlays.
 *
 * @param {{ count: number, bounds: { width: number, height: number } }} config
 */
function ParticleSystem(config) {
  this.config = config;
  this.particles = [];
  this.reset();
}

/**
 * Reset all particles to random positions.
 */
ParticleSystem.prototype.reset = function() {
  var w = this.config.bounds.width;
  var h = this.config.bounds.height;
  this.particles = [];
  for (var i = 0; i < this.config.count; i++) {
    this.particles.push(createParticle(w, h));
  }
};

/**
 * Update particles using a wind field.
 * Pure simulation — no rendering, no DOM.
 *
 * @param {{ data: Array, width: number, height: number }} field - wind vector grid
 * @param {number} dt - delta time in seconds
 */
ParticleSystem.prototype.update = function(field, dt) {
  for (var i = 0; i < this.particles.length; i++) {
    var p = this.particles[i];
    var gx = Math.floor(p.x);
    var gy = Math.floor(p.y);

    var row = field.data[gy];
    if (!row) continue;
    var wind = row[gx];
    if (!wind) continue;

    // Advect by wind vector
    p.x += wind.u * dt;
    p.y += wind.v * dt;
    p.age += dt;

    // Respawn if out of bounds or too old
    if (p.age > p.maxAge || p.x < 0 || p.y < 0 ||
        p.x > field.width || p.y > field.height) {
      p.x = Math.random() * field.width;
      p.y = Math.random() * field.height;
      p.age = 0;
    }
  }
};

/**
 * @returns {Array} current particle positions
 */
ParticleSystem.prototype.getParticles = function() {
  return this.particles;
};

/**
 * @returns {number} active particle count
 */
ParticleSystem.prototype.getCount = function() {
  return this.particles.length;
};

export { ParticleSystem };
