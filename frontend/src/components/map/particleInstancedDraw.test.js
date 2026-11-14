/**
 * particleInstancedDraw: the marine crest particles drawn as one instanced quad (four vertex-shader runs per particle) instead
 * of six vertices each (2026-11-13). These pin the shader rewrite, the buffers, the draw call and the off path; the GPU timing
 * and the pixel comparison are in docs/weather-program/log/2026-11-13-fable-particles-instanced.md.
 */
import fs from 'fs';
import path from 'path';
import { DRAW_VS } from './WebGLMarineParticleShaders';
import {
  chooseParticleDrawVs, createParticleDrawBuffers, deleteParticleDrawBuffers, drawParticles, finishParticleDrawVao,
  instancedDrawVs, particleInstancedOn,
} from './particleInstancedDraw';

const fakeGl = (webgl2 = true) => {
  const calls = []; let n = 0;
  const rec = (name) => (...a) => { calls.push([name, ...a]); };
  const gl = {
    calls, ARRAY_BUFFER: 'AB', ELEMENT_ARRAY_BUFFER: 'EAB', STATIC_DRAW: 'SD', FLOAT: 'F', TRIANGLES: 'T', UNSIGNED_BYTE: 'UB',
    createBuffer: () => ({ id: (n += 1) }), bindBuffer: rec('bindBuffer'), bufferData: rec('bufferData'), deleteBuffer: rec('deleteBuffer'),
    enableVertexAttribArray: rec('enable'), vertexAttribPointer: rec('pointer'), drawArrays: rec('drawArrays'),
    getAttribLocation: (_p, name) => (name === 'a_corner' ? 5 : -1),
  };
  if (webgl2) Object.assign(gl, { drawElementsInstanced: rec('drawElementsInstanced'), vertexAttribDivisor: rec('divisor'), createVertexArray: () => ({}) });
  return gl;
};
const data = (gl, target) => gl.calls.filter((c) => c[0] === 'bufferData' && c[1] === target).map((c) => Array.from(c[2]));

beforeEach(() => { delete window.__RAW_DISABLE_PARTICLE_INSTANCED__; delete window.__RAW_GPU__; });

describe('the particle vertex shader, rewritten for instancing', () => {
  const inst = instancedDrawVs(DRAW_VS);

  test('only how it learns the particle and the corner changes; every other line is the same text', () => {
    expect(typeof inst).toBe('string');
    const a = DRAW_VS.split('\n'); const b = inst.split('\n');
    const onlyA = a.filter((l) => !b.includes(l)); const onlyB = b.filter((l) => !a.includes(l));
    expect(onlyA).toEqual([
      'attribute highp float a_vertex_id;       // 0 to (numParticles*6 - 1), six vertices per particle',
      '  float particleIndex = floor(a_vertex_id / 6.0);',
      '  float cornerIndex = a_vertex_id - particleIndex * 6.0;',
      '  else if (cornerIndex < 3.5) cornerUV = vec2(-1.0, 1.0);',
      '  else if (cornerIndex < 4.5) cornerUV = vec2(1.0, -1.0);',
    ]);
    expect(onlyB).toEqual([
      'attribute highp float a_vertex_id;       // INSTANCED: the particle index, one value per instance',
      'attribute highp float a_corner;          // 0..3 = BL, BR, TL, TR',
      '  float particleIndex = a_vertex_id;',
      '  float cornerIndex = a_corner;',
    ]);
    expect(b.length).toBe(a.length - 1);
    expect(inst).not.toMatch(/#version|gl_InstanceID|gl_VertexID/);              // still GLSL ES 1.00
  });

  test('the four corners with the index list draw the same two triangles, in the same vertex order, as the six vertices', () => {
    const cornerOf = (src, i) => {                                               // read the corner table out of the shader text
      const rows = [...src.matchAll(/(?:if|else if) \(cornerIndex < ([\d.]+)\) cornerUV = vec2\(([-\d.]+), ([-\d.]+)\);/g)].map((m) => [+m[1], +m[2], +m[3]]);
      const last = /\n {2}else cornerUV = vec2\(([-\d.]+), ([-\d.]+)\);/.exec(src);
      const hit = rows.find((r) => i < r[0]); return hit ? [hit[1], hit[2]] : [+last[1], +last[2]];
    };
    const classic = [0, 1, 2, 3, 4, 5].map((i) => cornerOf(DRAW_VS, i));
    const gl = fakeGl(); const engine = { _particleInstanced: true };
    createParticleDrawBuffers(engine, gl, 4);
    const indices = data(gl, 'EAB')[0];
    expect(indices).toEqual([0, 1, 2, 2, 1, 3]);
    expect(indices.map((i) => cornerOf(inst, i))).toEqual(classic);
    expect(classic).toEqual([[-1, -1], [1, -1], [-1, 1], [-1, 1], [1, -1], [1, 1]]);
  });

  test('a shader whose text has moved on is not rewritten (the classic draw is used)', () => {
    expect(instancedDrawVs(DRAW_VS.replace('floor(a_vertex_id / 6.0)', 'floor(a_vertex_id / 6.00)'))).toBeNull();
    expect(instancedDrawVs(DRAW_VS + '\n  float particleIndex = floor(a_vertex_id / 6.0);\n  float cornerIndex = a_vertex_id - particleIndex * 6.0;')).toBeNull();
    expect(instancedDrawVs(null)).toBeNull();
  });
});

describe('the mode is chosen once, when the engine is initialised', () => {
  test('WebGL2: instanced, and the telemetry says so', () => {
    window.__RAW_GPU__ = {}; const engine = {};
    expect(chooseParticleDrawVs(engine, fakeGl(), DRAW_VS)).toBe(instancedDrawVs(DRAW_VS));
    expect(engine._particleInstanced).toBe(true);
    expect(window.__RAW_GPU__.particleDraw).toBe('instanced');
  });

  test('OFF PATH: the kill compiles the classic shader and draws six vertices per particle, as before', () => {
    window.__RAW_DISABLE_PARTICLE_INSTANCED__ = true; window.__RAW_GPU__ = {};
    expect(particleInstancedOn()).toBe(false);
    const gl = fakeGl(); const engine = { drawVAO: {} };
    expect(chooseParticleDrawVs(engine, gl, DRAW_VS)).toBe(DRAW_VS);
    expect(engine._particleInstanced).toBe(false);
    expect(window.__RAW_GPU__.particleDraw).toBe('classic');
    createParticleDrawBuffers(engine, gl, 3);
    expect(data(gl, 'AB')).toEqual([Array.from({ length: 18 }, (_, i) => i)]);
    expect(data(gl, 'EAB')).toEqual([]);
    finishParticleDrawVao(engine, gl, 0);
    expect(gl.calls.some((c) => c[0] === 'divisor')).toBe(false);
    drawParticles(engine, gl, 18);
    expect(gl.calls.filter((c) => /^draw/.test(c[0]))).toEqual([['drawArrays', 'T', 0, 18]]);
  });

  test('WebGL1 (no instancing) and a shader that cannot be rewritten stay classic', () => {
    const e1 = {}; expect(chooseParticleDrawVs(e1, fakeGl(false), DRAW_VS)).toBe(DRAW_VS); expect(e1._particleInstanced).toBe(false);
    const e2 = {}; expect(chooseParticleDrawVs(e2, fakeGl(), 'void main() {}')).toBe('void main() {}'); expect(e2._particleInstanced).toBe(false);
  });
});

describe('instanced buffers and the draw call', () => {
  test('one id per particle (per instance), four corners, six indices; then one instanced call for all particles', () => {
    const gl = fakeGl(); const engine = { _particleInstanced: true, drawVAO: {}, drawProgram: {} };
    createParticleDrawBuffers(engine, gl, 5);
    expect(data(gl, 'AB')).toEqual([[0, 1, 2, 3, 4], [0, 1, 2, 3]]);
    finishParticleDrawVao(engine, gl, 2);
    expect(gl.calls).toContainEqual(['divisor', 2, 1]);                          // the particle id advances per instance
    expect(gl.calls).toContainEqual(['pointer', 5, 1, 'F', false, 0, 0]);         // a_corner: per vertex
    expect(gl.calls.filter((c) => c[0] === 'divisor')).toHaveLength(1);
    expect(gl.calls[gl.calls.length - 1]).toEqual(['bindBuffer', 'EAB', engine._particleIndexBuffer]);   // kept in the vertex array
    drawParticles(engine, gl, 30);
    expect(gl.calls.filter((c) => /^draw/.test(c[0]))).toEqual([['drawElementsInstanced', 'T', 6, 'UB', 0, 5]]);
    deleteParticleDrawBuffers(engine, gl);
    expect(engine._particleCornerBuffer).toBeNull(); expect(engine._particleIndexBuffer).toBeNull();
  });

  test('the engine draws particles only through this module', () => {
    const eng = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngine.js'), 'utf8');
    expect(eng).toMatch(/drawParticles\(this, gl, numQuadVerts\);/);
    expect(eng).not.toMatch(/gl\.drawArrays\(gl\.TRIANGLES, 0, numQuadVerts\)/);
    const init = fs.readFileSync(path.join(__dirname, 'WebGLMarineEngineInit.js'), 'utf8');
    expect(init).toMatch(/\[chooseParticleDrawVs\(engine, gl, DRAW_VS\), DRAW_FS\]/);
    expect(init).toMatch(/finishParticleDrawVao\(engine, gl, idLoc\);/);
  });
});
