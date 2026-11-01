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

// ASYNC COMPLETION (2026-10-20, the stall left after #403). The deferred path still blocks once: its first LINK_STATUS
// query waits for the slowest program (~435-472 ms main-thread in the #403 A/B). KHR_parallel_shader_compile adds
// COMPLETION_STATUS_KHR, a query that answers "done yet?" WITHOUT waiting (MDN; Chrome 76+, Edge, Safari 14.1+, not
// Firefox). So startProgramBatch issues every compile and link exactly as the deferred path does, then the engine polls
// COMPLETION_STATUS_KHR once per frame, only on programs not yet complete, and reads LINK_STATUS once when all are done
// (shader logs only on a failed link). Total compile wall time is unchanged; the main thread stops waiting on it.
// Measured offline (same bundle, kill switch A/B, 3 runs each): main-thread time in this batch at page load 415-594 ms
// (marine + wind, deferred) -> 3-4 ms; the worst load stall stopped being this batch.
// - The engine allocates buffers and textures meanwhile, but draws nothing (and makes no program query: getAttribLocation
//   and getUniformLocation would block like LINK_STATUS) until the batch is ready. A failed link found later releases
//   the whole batch like a failed init and reaches the same hard-error fallback (WebGLMarineCustomLayer / WebGLWindLayer).
// - A driver that never reports completion is capped: after ASYNC_SHADER_MAX_POLLS polls the batch reads LINK_STATUS,
//   which blocks only for whatever is still compiling (the deferred path's wait, late).
// - No extension (Firefox), or the deferred kill switch above: the deferred (or serial) batch, unchanged and synchronous.
// Kill switch: window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__ = true restores #403 exactly (getExtension is not even asked).
export function asyncShaderCompileEnabled() {
  return !(typeof window !== 'undefined' && window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__ === true);
}
export const ASYNC_SHADER_MAX_POLLS = 120;   // frames: ~2 s at 60 fps, several times the 0.4-0.5 s the #403 A/B measured
export const BATCH = Object.freeze({ PENDING: 'pending', READY: 'ready', FAILED: 'failed' });

export function createProgramBatch(gl, sources) {
  return deferredShaderStatusEnabled() ? createProgramBatchDeferred(gl, sources) : createProgramBatchSerial(gl, sources);
}

function parallelCompileExtension(gl) {
  try { return (gl.getExtension && gl.getExtension('KHR_parallel_shader_compile')) || null; } catch (e) { return null; }
}

function now() { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }

// The engines' entry point. Returns null when the batch failed immediately (allocation refusal, exception or, on the
// synchronous paths, a failed link), always with the whole batch released. Otherwise a batch:
//   programs  the program handles, in `sources` order
//   mode      'async' | 'deferred' | 'serial'
//   state     BATCH.READY at once on the synchronous paths; BATCH.PENDING until poll() settles it on the async path
//   poll()    advance one frame; returns the state. FAILED means the whole batch was released.
//   polls / timedOut / ms   telemetry: frames polled, whether the cap forced the blocking read, issue-to-settle time
export function startProgramBatch(gl, sources, { maxPolls = ASYNC_SHADER_MAX_POLLS } = {}) {
  const t0 = now();
  const ext = asyncShaderCompileEnabled() && deferredShaderStatusEnabled() ? parallelCompileExtension(gl) : null;
  if (!ext) {
    const programs = createProgramBatch(gl, sources);
    if (!programs) return null;
    const mode = deferredShaderStatusEnabled() ? 'deferred' : 'serial';
    return { programs, mode, state: BATCH.READY, polls: 0, timedOut: false, ms: now() - t0, poll: () => BATCH.READY };
  }
  const shaders = [], programs = [];
  const release = releaser(gl, shaders, programs);
  try {
    if (!issueBatch(gl, sources, shaders, programs)) { release(); return null; }
  } catch (e) {
    release();
    return null;
  }
  let incomplete = programs.map((_, k) => k);
  const batch = { programs, mode: 'async', state: BATCH.PENDING, polls: 0, timedOut: false, ms: null, poll };
  function settle(state) {
    batch.state = state;
    batch.ms = now() - t0;
    return state;
  }
  function poll() {
    if (batch.state !== BATCH.PENDING) return batch.state;
    // A lost context answers COMPLETION_STATUS_KHR with true and LINK_STATUS with null, which would read as a failed
    // link. Neither is a shader error: the context-loss path tears the engine down and rebuilds it on restore.
    if (gl.isContextLost && gl.isContextLost()) return batch.state;
    batch.polls++;
    try {
      incomplete = incomplete.filter(k => !gl.getProgramParameter(programs[k], ext.COMPLETION_STATUS_KHR));
      if (incomplete.length && batch.polls < maxPolls) return batch.state;
      batch.timedOut = incomplete.length > 0;
      if (settleLinks(gl, shaders, programs)) return settle(BATCH.READY);
    } catch (e) { /* driver error while asking: same as a failed link */ }
    release();
    return settle(BATCH.FAILED);
  }
  return batch;
}

function releaser(gl, shaders, programs) {
  return () => {
    for (const program of programs) { try { gl.deleteProgram(program); } catch (e) { /* lost context */ } }
    for (const shader of shaders) { if (shader) { try { gl.deleteShader(shader); } catch (e) { /* lost context */ } } }
  };
}

// Issue every compile, then every link, with no status query; false on an allocation refusal (throws on a driver error).
function issueBatch(gl, sources, shaders, programs) {
  for (const [vertex, fragment] of sources) {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type);
      if (!shader) return false;
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
    }
  }
  for (let i = 0; i < shaders.length; i += 2) {
    const program = gl.createProgram();
    if (!program) return false;
    programs.push(program);
    gl.attachShader(program, shaders[i]);
    gl.attachShader(program, shaders[i + 1]);
    gl.linkProgram(program);
  }
  return true;
}

// Ask LINK_STATUS once per program. A compile error surfaces as a failed link; read the logs only then.
function settleLinks(gl, shaders, programs) {
  for (let k = 0; k < programs.length; k++) {
    if (gl.getProgramParameter(programs[k], gl.LINK_STATUS)) continue;
    for (const shader of [shaders[2 * k], shaders[2 * k + 1]]) {
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) console.error('[WebGL] Shader error:', gl.getShaderInfoLog(shader));
    }
    console.error('[WebGL] Link error:', gl.getProgramInfoLog(programs[k]));
    return false;
  }
  return true;
}

function createProgramBatchDeferred(gl, sources) {
  const shaders = [], programs = [];
  const release = releaser(gl, shaders, programs);
  try {
    if (issueBatch(gl, sources, shaders, programs) && settleLinks(gl, shaders, programs)) return programs;
    release();
    return null;
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

// One engine's pending batch, advanced one frame. Returns BATCH.PENDING while compiling, BATCH.FAILED exactly once (on
// the frame the failure is found; the engine is then fully released, as after a failed init), BATCH.READY otherwise
// (including "nothing pending": the engine's own gates decide whether it can draw).
//   onReady(engine)   the program-dependent setup the init deferred (vertex arrays: getAttribLocation would block)
//   onFailed(engine)  release everything else the init allocated
export function pollEngineBatch(engine, onReady, onFailed) {
  const batch = engine._programBatch;
  if (!batch) return BATCH.READY;
  const state = batch.poll();
  if (state === BATCH.PENDING) return state;
  engine._programBatch = null;
  publishBatch(engine, batch);
  if (state === BATCH.READY) onReady(engine);
  else onFailed(engine);
  return state;
}

// Telemetry for the lab and the HUD: window.__RAW_GPU__.shaderBatch[name] = { mode, state, polls, timedOut, ms }.
export function publishBatch(engine, batch) {
  const info = { mode: batch.mode, state: batch.state, polls: batch.polls, timedOut: batch.timedOut, ms: batch.ms == null ? null : Math.round(batch.ms) };
  engine._shaderBatchInfo = info;
  const g = typeof window !== 'undefined' ? window.__RAW_GPU__ : null;
  if (g && engine._shaderBatchName) (g.shaderBatch = g.shaderBatch || {})[engine._shaderBatchName] = info;
}
