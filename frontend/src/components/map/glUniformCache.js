/**
 * glUniformCache.js — uniform locations looked up once per program, not once per frame (2026-10-23).
 *
 * The marine engine asked gl.getUniformLocation for every uniform of every pass on every frame: 131 lookups per frame offline,
 * and 1.8 s of main-thread self time in the lead's 144 s live trace of dev (2026-10-23). A WebGLUniformLocation is valid for as
 * long as its program stays linked, and the engine links each program once (WebGLProgramBatch) and never relinks it; a lost
 * context brings NEW program objects, whose caches start empty. So the location is kept on the program object itself. An
 * inactive (optimized-out) uniform's null is cached too, exactly what the lookup would return again.
 * Kill: window.__RAW_DISABLE_UNIFORM_CACHE__ = true (every call goes to the driver, as before).
 */
const KEY = '__rsUniformLocs';

export function uniformLoc(gl, program, name) {
  if (!program || (typeof program !== 'object' && typeof program !== 'function')) return gl.getUniformLocation(program, name);   // no expando on a primitive
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_UNIFORM_CACHE__ === true) return gl.getUniformLocation(program, name);
  let m = program[KEY];
  if (!m) {
    m = new Map();
    try { Object.defineProperty(program, KEY, { value: m, enumerable: false }); } catch (e) { program[KEY] = m; }
  }
  let loc = m.get(name);
  if (loc === undefined) {
    loc = gl.getUniformLocation(program, name);
    m.set(name, loc);
  }
  return loc;
}
