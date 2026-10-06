import { createShader, createProgram } from './WebGLWindUtils';

// The initialization batch owns every shader/program until all links succeed. Failed initialization
// releases the whole batch before the engine allocates buffers, textures or vertex arrays.
export function createProgramBatch(gl, sources) {
  const shaders = [], programs = [];
  const release = () => {
    for (const program of programs) { try { gl.deleteProgram(program); } catch (e) { /* lost context */ } }
    for (const shader of shaders) { if (shader) { try { gl.deleteShader(shader); } catch (e) { /* lost context */ } } }
  };
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
