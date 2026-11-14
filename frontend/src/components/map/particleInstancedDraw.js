/**
 * particleInstancedDraw.js — draw the marine crest particles as ONE instanced quad instead of six vertices each (2026-11-13).
 *
 * BEFORE. `drawArrays(TRIANGLES, 0, 6 * N)`: six vertices per particle, each running the whole particle vertex shader (the
 * state fetch, the wave / mask / coarse lookups) although two of the six are repeats of a corner already computed.
 * NOW. `drawElementsInstanced(TRIANGLES, 6, UNSIGNED_BYTE, 0, N)`: four corner vertices and the index list [0,1,2, 2,1,3],
 * one instance per particle. The vertex shader runs FOUR times per particle, not six. (It cannot run once per particle:
 * WebGL has no per-primitive stage, so each corner is still a full run. The saving is the two repeated corners.)
 *
 * SAME TRIANGLES. Old corners 0..5 were BL, BR, TL, TL, BR, TR. The index list draws corner 0,1,2 then 2,1,3 with
 * 0=BL 1=BR 2=TL 3=TR: the same two triangles, the same vertex order, so the same pixels and the same interpolation.
 * The shader is the same text except its first two lines (how it learns the particle and the corner); it stays GLSL ES 1.00.
 *
 * WHERE. WebGL2 only (vertex array objects and instancing are core there). On WebGL1, or if the shader text no longer
 * matches what is rewritten here, the classic six-vertex draw is used, as before.
 * Kill: window.__RAW_DISABLE_PARTICLE_INSTANCED__ = true (read once, when the engine is initialised).
 * Measurements and the pass / fail gate: docs/weather-program/log/2026-11-13-fable-particles-instanced.md.
 */
const W = () => (typeof window !== 'undefined' ? window : {});

export const particleInstancedOn = () => W().__RAW_DISABLE_PARTICLE_INSTANCED__ !== true;

const CLASSIC_ATTR = 'attribute highp float a_vertex_id;       // 0 to (numParticles*6 - 1), six vertices per particle';
const CLASSIC_INDEX = '  float particleIndex = floor(a_vertex_id / 6.0);\n  float cornerIndex = a_vertex_id - particleIndex * 6.0;';
const CLASSIC_CORNERS = [
  '  if (cornerIndex < 0.5) cornerUV = vec2(-1.0, -1.0);',
  '  else if (cornerIndex < 1.5) cornerUV = vec2(1.0, -1.0);',
  '  else if (cornerIndex < 2.5) cornerUV = vec2(-1.0, 1.0);',
  '  else if (cornerIndex < 3.5) cornerUV = vec2(-1.0, 1.0);',
  '  else if (cornerIndex < 4.5) cornerUV = vec2(1.0, -1.0);',
  '  else cornerUV = vec2(1.0, 1.0);',
].join('\n');

const INSTANCED_ATTR = 'attribute highp float a_vertex_id;       // INSTANCED: the particle index, one value per instance\n'
  + 'attribute highp float a_corner;          // 0..3 = BL, BR, TL, TR';
const INSTANCED_INDEX = '  float particleIndex = a_vertex_id;\n  float cornerIndex = a_corner;';
const INSTANCED_CORNERS = [
  '  if (cornerIndex < 0.5) cornerUV = vec2(-1.0, -1.0);',
  '  else if (cornerIndex < 1.5) cornerUV = vec2(1.0, -1.0);',
  '  else if (cornerIndex < 2.5) cornerUV = vec2(-1.0, 1.0);',
  '  else cornerUV = vec2(1.0, 1.0);',
].join('\n');

/** The particle vertex shader rewritten for instancing, or null when its text is not the one this was written against. */
export function instancedDrawVs(classicVs) {
  if (typeof classicVs !== 'string') return null;
  let out = classicVs;
  for (const [from, to] of [[CLASSIC_ATTR, INSTANCED_ATTR], [CLASSIC_INDEX, INSTANCED_INDEX], [CLASSIC_CORNERS, INSTANCED_CORNERS]]) {
    if (out.split(from).length !== 2) return null;
    out = out.replace(from, to);
  }
  return out;
}

const canInstance = (gl) => !!gl && typeof gl.drawElementsInstanced === 'function' && typeof gl.vertexAttribDivisor === 'function'
  && typeof gl.createVertexArray === 'function';

/**
 * Decide the draw mode for this engine and return the vertex shader to compile. Sets `engine._particleInstanced`.
 * Call once, before the programs are compiled.
 */
export function chooseParticleDrawVs(engine, gl, classicVs) {
  const vs = particleInstancedOn() && canInstance(gl) ? instancedDrawVs(classicVs) : null;
  engine._particleInstanced = !!vs;
  const w = W();
  if (w.__RAW_GPU__) w.__RAW_GPU__.particleDraw = vs ? 'instanced' : 'classic';
  return vs || classicVs;
}

/** The buffers of the chosen mode. Classic: the 6N vertex ids. Instanced: N particle ids, four corners, six indices. */
export function createParticleDrawBuffers(engine, gl, numParticles) {
  if (!engine._particleInstanced) {
    const ids = new Float32Array(numParticles * 6);
    for (let i = 0; i < ids.length; i += 1) ids[i] = i;
    engine.vertexIdBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, engine.vertexIdBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    return;
  }
  const ids = new Float32Array(numParticles);
  for (let i = 0; i < numParticles; i += 1) ids[i] = i;
  engine.vertexIdBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, engine.vertexIdBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
  engine._particleCornerBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, engine._particleCornerBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 1, 2, 3]), gl.STATIC_DRAW);
  engine._particleIndexBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, engine._particleIndexBuffer);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array([0, 1, 2, 2, 1, 3]), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
}

/** Inside the bound draw vertex array, after `a_vertex_id` has been pointed at `engine.vertexIdBuffer`. */
export function finishParticleDrawVao(engine, gl, idLoc) {
  if (!engine._particleInstanced) return;
  if (idLoc !== -1) gl.vertexAttribDivisor(idLoc, 1);
  const cornerLoc = gl.getAttribLocation(engine.drawProgram, 'a_corner');
  if (cornerLoc !== -1) {
    gl.bindBuffer(gl.ARRAY_BUFFER, engine._particleCornerBuffer);
    gl.enableVertexAttribArray(cornerLoc);
    gl.vertexAttribPointer(cornerLoc, 1, gl.FLOAT, false, 0, 0);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, engine._particleIndexBuffer);
}

/** The particle draw call, with the draw vertex array bound. `numQuadVerts` = 6 x particles. */
export function drawParticles(engine, gl, numQuadVerts) {
  if (engine._particleInstanced && engine.drawVAO) gl.drawElementsInstanced(gl.TRIANGLES, 6, gl.UNSIGNED_BYTE, 0, numQuadVerts / 6);
  else gl.drawArrays(gl.TRIANGLES, 0, numQuadVerts);
}

export function deleteParticleDrawBuffers(engine, gl) {
  if (engine._particleCornerBuffer) { gl.deleteBuffer(engine._particleCornerBuffer); engine._particleCornerBuffer = null; }
  if (engine._particleIndexBuffer) { gl.deleteBuffer(engine._particleIndexBuffer); engine._particleIndexBuffer = null; }
}
