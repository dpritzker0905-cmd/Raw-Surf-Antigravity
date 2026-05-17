/*
====================================================
 Raw Surf OS — WebGL Layer Renderer
 SAFE ABSTRACTION LAYER (NO DIRECT GL INIT)
====================================================

RULES:
- Does NOT create GL contexts
- Does NOT own a RAF loop
- Does NOT mutate engine state
- SAFE boundary between render pipeline and GPU
- var/function only (TDZ-immune)
====================================================
*/

/**
 * WebGLLayerRenderer — safe abstraction for feeding processed
 * simulation data into an existing WebGL pipeline.
 *
 * This does NOT replace WebGLWindEngine. It provides a clean
 * interface for FUTURE shader modules to consume RenderFrame data
 * without coupling to the engine internals.
 *
 * @param {{ gl: WebGLRenderingContext, program?: WebGLProgram }} ctx
 */
function WebGLLayerRenderer(ctx) {
  this._gl = ctx.gl;
  this._program = ctx.program || null;
  this._uniformCache = {};
}

/**
 * Cache uniform locations for performance.
 * @param {string} name
 * @returns {WebGLUniformLocation|null}
 */
WebGLLayerRenderer.prototype._getUniform = function(name) {
  if (!this._program) return null;
  if (this._uniformCache[name] === undefined) {
    this._uniformCache[name] = this._gl.getUniformLocation(this._program, name);
  }
  return this._uniformCache[name];
};

/**
 * Feed a processed RenderFrame into the GPU pipeline.
 * SAFE: reads frame data, sets uniforms — does NOT create resources.
 *
 * @param {{ wind: Array, waves: Array, metadata: Object, timestamp: number }} frame
 */
WebGLLayerRenderer.prototype.render = function(frame) {
  var gl = this._gl;
  if (!gl || !frame) return;

  // Compute aggregate intensity for uniform feeding
  var totalIntensity = 0;
  var count = 0;
  for (var y = 0; y < frame.wind.length; y++) {
    for (var x = 0; x < frame.wind[y].length; x++) {
      totalIntensity += frame.wind[y][x].intensity;
      count++;
    }
  }
  var avgIntensity = count > 0 ? totalIntensity / count : 0;

  // If a program is bound, set uniforms
  if (this._program) {
    gl.useProgram(this._program);
    var uIntensity = this._getUniform('u_avg_intensity');
    if (uIntensity) gl.uniform1f(uIntensity, avgIntensity);
    var uTime = this._getUniform('u_time');
    if (uTime) gl.uniform1f(uTime, frame.timestamp);
  }
};

/**
 * Update the shader program reference.
 * @param {WebGLProgram} program
 */
WebGLLayerRenderer.prototype.setProgram = function(program) {
  this._program = program;
  this._uniformCache = {}; // invalidate cache
};

/**
 * Cleanup — does NOT delete GL context (not owned).
 */
WebGLLayerRenderer.prototype.dispose = function() {
  this._program = null;
  this._uniformCache = {};
  this._gl = null;
};

export { WebGLLayerRenderer };
