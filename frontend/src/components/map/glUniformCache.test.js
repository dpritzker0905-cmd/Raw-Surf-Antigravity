import fs from 'fs';
import path from 'path';
import { uniformLoc } from './glUniformCache';

// UNIFORM LOCATIONS once per program (2026-10-23): 131 lookups per frame offline, 1.8 s of self time in the lead's 144 s live trace.
describe('uniformLoc', () => {
  const makeGl = () => ({ getUniformLocation: jest.fn((prog, name) => (name === 'u_gone' ? null : { prog: prog.id, name })) });
  afterEach(() => { delete window.__RAW_DISABLE_UNIFORM_CACHE__; });

  it('asks the driver once per program and name, and hands back the same location after', () => {
    const gl = makeGl(); const prog = { id: 1 };
    const a = uniformLoc(gl, prog, 'u_matrix');
    for (let i = 0; i < 5; i++) expect(uniformLoc(gl, prog, 'u_matrix')).toBe(a);
    expect(gl.getUniformLocation).toHaveBeenCalledTimes(1);
    expect(Object.keys(prog)).toEqual(['id']);                        // the cache is not an enumerable field of the program
  });

  it("an inactive uniform's null is cached too", () => {
    const gl = makeGl(); const prog = { id: 1 };
    expect(uniformLoc(gl, prog, 'u_gone')).toBeNull();
    expect(uniformLoc(gl, prog, 'u_gone')).toBeNull();
    expect(gl.getUniformLocation).toHaveBeenCalledTimes(1);
  });

  it('programs keep separate caches (a lost context brings new programs, which start empty)', () => {
    const gl = makeGl(); const a = { id: 1 }; const b = { id: 2 };
    expect(uniformLoc(gl, a, 'u_time').prog).toBe(1);
    expect(uniformLoc(gl, b, 'u_time').prog).toBe(2);
    expect(gl.getUniformLocation).toHaveBeenCalledTimes(2);
  });

  it('the kill switch sends every call to the driver; a primitive program (a test double) is never decorated', () => {
    const gl = makeGl(); const prog = { id: 1 };
    window.__RAW_DISABLE_UNIFORM_CACHE__ = true;
    uniformLoc(gl, prog, 'u_matrix'); uniformLoc(gl, prog, 'u_matrix');
    expect(gl.getUniformLocation).toHaveBeenCalledTimes(2);
    delete window.__RAW_DISABLE_UNIFORM_CACHE__;
    const gl2 = { getUniformLocation: jest.fn(() => 7) };
    expect(uniformLoc(gl2, 'heatmap', 'u_x')).toBe(7);
    expect(uniformLoc(gl2, 'heatmap', 'u_x')).toBe(7);
    expect(gl2.getUniformLocation).toHaveBeenCalledTimes(2);
  });

  it('wiring: the marine engine and its per-frame helpers look uniforms up through the cache only', () => {
    for (const f of ['WebGLMarineEngine.js', 'marineHeightEncoding.js', 'marineLandAwareFetch.js', 'waveSetScreenBound.js', 'gridPointRegistration.js']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      expect([f, (src.match(/gl\.getUniformLocation\(/g) || []).length]).toEqual([f, 0]);
      expect(src).toMatch(/uniformLoc\(gl, /);
    }
  });
});
