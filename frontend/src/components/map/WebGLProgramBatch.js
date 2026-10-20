import { createShader, createProgram } from './WebGLWindUtils';

// The initialization batch owns every shader/program until all links succeed. Failed initialization
// releases the whole batch before the engine allocates buffers, textures or vertex arrays.
//
// DEFERRED STATUS (2026-10-20, page-load stall profile, PR #400: shader compiles were 30% of load-stall time, the wind
// and marine batches among them). A COMPILE_STATUS or LINK_STATUS query is synchronous: it waits for that shader or
// program to finish. The serial path asked after EVERY compile and link, so the browser compiled one shader at a time.
// MDN WebGL best practices: compile every shader in one loop, link every program in a second loop, and query only
// LINK_STATUS in a third, reading compile logs only when a link fails; many browsers then compile and link the batch in
// parallel on background threads, so the first query waits for roughly the slowest shader instead of the sum.
// Ownership and failure semantics are unchanged: any refusal, exception or failed link releases the whole batch.
// Kill switch: window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__ = true restores the serial path.
export function deferredShaderStatusEnabled() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__ === true);
}

export function createProgramBatch(gl, sources) {
  return deferredShaderStatusEnabled() ? createProgramBatchDeferred(gl, sources) : createProgramBatchSerial(gl, sources);
}

function releaser(gl, shaders, programs) {
  return () => {
    for (const program of programs) { try { gl.deleteProgram(program); } catch (e) { /* lost context */ } }
    for (const shader of shaders) { if (shader) { try { gl.deleteShader(shader); } catch (e) { /* lost context */ } } }
  };
}

function createProgramBatchDeferred(gl, sources) {
  const shaders = [], programs = [];
  const release = releaser(gl, shaders, programs);
  try {
    // 1. Issue every compile; no status query yet.
    for (const [vertex, fragment] of sources) {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type);
        if (!shader) { release(); return null; }
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
      }
    }
    // 2. Issue every link; still no status query.
    for (let i = 0; i < shaders.length; i += 2) {
      const program = gl.createProgram();
      if (!program) { release(); return null; }
      programs.push(program);
      gl.attachShader(program, shaders[i]);
      gl.attachShader(program, shaders[i + 1]);
      gl.linkProgram(program);
    }
    // 3. Only now ask. A compile error surfaces as a failed link; read the logs only then.
    for (let k = 0; k < programs.length; k++) {
      if (gl.getProgramParameter(programs[k], gl.LINK_STATUS)) continue;
      for (const shader of [shaders[2 * k], shaders[2 * k + 1]]) {
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error('[WebGL] Shader error:', gl.getShaderInfoLog(shader));
      }
      console.error('[WebGL] Link error:', gl.getProgramInfoLog(programs[k]));
      release();
      return null;
    }
    return programs;
  } catch (e) {
    release();
    return null;
  }
}

function createProgramBatchSerial(gl, sources) {
  const shaders = [], programs = [];
  const release = releaser(gl, shaders, programs);
  try {
    for (const [vertex, fragment] of sources) {
      shaders.push(createShader(gl, gl.VERTEX_SHADER, vertex));
      shaders.push(createShader(gl, gl.FRAGMENT_SHADER, fragment));
    }
    if (shaders.some(shader => !shader)) { release(); return null; }
    for (let i = 0; i < shaders.length; i += 2) {
      const program = createProgram(gl, shaders[i], shaders[i + 1]);
      if (!program) { release(); return null; }
      programs.push(program);
    }
    return programs;
  } catch (e) {
    release();
    return null;
  }
}
