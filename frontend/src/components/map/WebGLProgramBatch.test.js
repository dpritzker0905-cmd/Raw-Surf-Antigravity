import {
  createProgramBatch, deferredShaderStatusEnabled, startProgramBatch, asyncShaderCompileEnabled, BATCH, ASYNC_SHADER_MAX_POLLS,
} from './WebGLProgramBatch';

function makeGl() {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: jest.fn(() => ({})), shaderSource: jest.fn(), compileShader: jest.fn(),
    getShaderParameter: jest.fn(() => true), deleteShader: jest.fn(), getShaderInfoLog: jest.fn(() => 'shader log'),
    createProgram: jest.fn(() => ({})), attachShader: jest.fn(), linkProgram: jest.fn(),
    getProgramParameter: jest.fn(() => true), deleteProgram: jest.fn(), getProgramInfoLog: jest.fn(() => 'link log'),
  };
}
const sources = [['vertexA', 'fragmentA'], ['vertexB', 'fragmentB']];
const MODES = [['deferred', false], ['serial (kill switch)', true]];
afterEach(() => {
  delete window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__; delete window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__;
  jest.restoreAllMocks();
});

describe.each(MODES)('%s', (_name, killed) => {
  beforeEach(() => { if (killed) window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__ = true; });

  test('successful programs retain attached shader ownership for ordinary engine disposal', () => {
    const gl = makeGl();
    const programs = createProgramBatch(gl, sources);
    expect(programs).toHaveLength(2);
    expect(gl.createShader).toHaveBeenCalledTimes(4);
    expect(gl.attachShader).toHaveBeenCalledTimes(4);
    expect(gl.shaderSource.mock.calls.map(call => call[1])).toEqual(sources.flat());
    expect(gl.attachShader.mock.calls.map(call => call[1])).toEqual(gl.createShader.mock.results.map(r => r.value));
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(gl.deleteShader).not.toHaveBeenCalled();
  });
  // getShaderParameter is only consulted after a failed link in deferred mode; its exception case is covered below.
  test.each(['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'getProgramParameter', ...(killed ? ['getShaderParameter'] : [])])('%s exception releases all resources created so far', method => {
    const gl = makeGl();
    gl[method].mockImplementationOnce(() => { throw new Error('synthetic driver error'); });
    expect(createProgramBatch(gl, sources)).toBeNull();
    const shaders = gl.createShader.mock.results.filter(r => r.type === 'return').map(r => r.value);
    const programs = gl.createProgram.mock.results.filter(r => r.type === 'return').map(r => r.value);
    expect(new Set(gl.deleteShader.mock.calls.map(call => call[0]))).toEqual(new Set(shaders));
    expect(new Set(gl.deleteProgram.mock.calls.map(call => call[0]))).toEqual(new Set(programs));
  });
  test.each(['createShader', 'createProgram'])('%s allocation refusal releases earlier resources', method => {
    const gl = makeGl();
    gl[method].mockReturnValueOnce(null);
    expect(createProgramBatch(gl, sources)).toBeNull();
    const shaders = gl.createShader.mock.results.map(r => r.value).filter(Boolean);
    const programs = gl.createProgram.mock.results.map(r => r.value).filter(Boolean);
    expect(new Set(gl.deleteShader.mock.calls.map(call => call[0]))).toEqual(new Set(shaders));
    expect(new Set(gl.deleteProgram.mock.calls.map(call => call[0]))).toEqual(new Set(programs));
  });
  test('a failed link releases the whole batch', () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const gl = makeGl();
    gl.getProgramParameter.mockReturnValueOnce(true).mockReturnValueOnce(false);
    expect(createProgramBatch(gl, sources)).toBeNull();
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(gl.deleteShader).toHaveBeenCalledTimes(4);
  });
});

test('deferred is the default and the kill switch turns it off', () => {
  expect(deferredShaderStatusEnabled()).toBe(true);
  window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__ = true;
  expect(deferredShaderStatusEnabled()).toBe(false);
});

test('deferred: every compile and link is issued before the first status query', () => {
  const order = [];
  const gl = makeGl();
  for (const m of ['compileShader', 'linkProgram', 'getProgramParameter', 'getShaderParameter']) {
    gl[m].mockImplementation(() => { order.push(m); return m.startsWith('get') ? true : undefined; });
  }
  createProgramBatch(gl, [...sources, ['vertexC', 'fragmentC']]);
  const firstQuery = order.findIndex(m => m.startsWith('get'));
  expect(order.slice(0, firstQuery)).toEqual([...Array(6).fill('compileShader'), ...Array(3).fill('linkProgram')]);
  expect(order.slice(firstQuery)).toEqual(Array(3).fill('getProgramParameter'));   // no compile query on success
});

test('serial (mutation control for the ordering test): queries interleave with compiles', () => {
  window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__ = true;
  const order = [];
  const gl = makeGl();
  for (const m of ['compileShader', 'getShaderParameter']) gl[m].mockImplementation(() => { order.push(m); return true; });
  createProgramBatch(gl, sources);
  expect(order.slice(0, 2)).toEqual(['compileShader', 'getShaderParameter']);
});

test('deferred: a compile error is reported from the shader log when its program fails to link', () => {
  const err = jest.spyOn(console, 'error').mockImplementation(() => {});
  const gl = makeGl();
  gl.getProgramParameter.mockReturnValueOnce(false);
  gl.getShaderParameter.mockImplementation((shader) => shader !== gl.createShader.mock.results[1].value);   // fragment A broken
  expect(createProgramBatch(gl, sources)).toBeNull();
  expect(err.mock.calls.map(c => c[0])).toEqual(['[WebGL] Shader error:', '[WebGL] Link error:']);
});

test('deferred: getShaderParameter throwing while reading a failed link still releases the batch', () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const gl = makeGl();
  gl.getProgramParameter.mockReturnValueOnce(false);
  gl.getShaderParameter.mockImplementationOnce(() => { throw new Error('lost context'); });
  expect(createProgramBatch(gl, sources)).toBeNull();
  expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
  expect(gl.deleteShader).toHaveBeenCalledTimes(4);
});

// ---- ASYNC COMPLETION (KHR_parallel_shader_compile) --------------------------------------------------------------------
// A GL whose program k reports COMPLETION_STATUS_KHR true from frame completeAt(k) on; the test advances gl.frame before
// each poll. LINK_STATUS follows linkOk(k).
const EXT = { COMPLETION_STATUS_KHR: 0x91B1 };
function makeAsyncGl({ completeAt = () => 1, linkOk = () => true, ext = true } = {}) {
  const gl = makeGl();
  let nextProgram = 0;
  gl.frame = 0;
  gl.createProgram = jest.fn(() => ({ id: nextProgram++ }));
  gl.getExtension = jest.fn(name => (ext && name === 'KHR_parallel_shader_compile' ? EXT : null));
  gl.isContextLost = jest.fn(() => false);
  gl.getProgramParameter = jest.fn((p, pname) => (pname === EXT.COMPLETION_STATUS_KHR ? gl.frame >= completeAt(p.id) : linkOk(p.id)));
  return gl;
}
const threeSources = [...sources, ['vertexC', 'fragmentC']];
const asked = (gl, pname) => gl.getProgramParameter.mock.calls.filter(c => c[1] === pname).map(c => c[0].id);
const frame = (gl, batch) => { gl.frame++; return batch.poll(); };

test('async compile is on by default and its kill switch turns it off', () => {
  expect(asyncShaderCompileEnabled()).toBe(true);
  window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__ = true;
  expect(asyncShaderCompileEnabled()).toBe(false);
});

describe('startProgramBatch mode selection', () => {
  test('no extension (Firefox): the deferred batch, settled during start, exactly #403', () => {
    const gl = makeAsyncGl({ ext: false });
    const batch = startProgramBatch(gl, threeSources);
    expect(batch).toMatchObject({ mode: 'deferred', state: BATCH.READY });
    expect(asked(gl, gl.LINK_STATUS)).toEqual([0, 1, 2]);           // read during start: the blocking path
    expect(asked(gl, EXT.COMPLETION_STATUS_KHR)).toEqual([]);
    expect(batch.poll()).toBe(BATCH.READY);
    expect(gl.getProgramParameter).toHaveBeenCalledTimes(3);        // a poll on a settled batch asks nothing
  });
  test('kill switch: the extension is not even asked for, and the batch is deferred', () => {
    window.__RAW_DISABLE_ASYNC_SHADER_COMPILE__ = true;
    const gl = makeAsyncGl();
    expect(startProgramBatch(gl, sources)).toMatchObject({ mode: 'deferred', state: BATCH.READY });
    expect(gl.getExtension).not.toHaveBeenCalled();
    expect(asked(gl, gl.LINK_STATUS)).toEqual([0, 1]);
  });
  test('the deferred kill switch wins over the extension: serial, as before #403', () => {
    window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__ = true;
    const gl = makeAsyncGl();
    expect(startProgramBatch(gl, sources)).toMatchObject({ mode: 'serial', state: BATCH.READY });
    expect(gl.getExtension).not.toHaveBeenCalled();
  });
  test('extension present: async, and start asks no status at all', () => {
    const gl = makeAsyncGl();
    const batch = startProgramBatch(gl, threeSources);
    expect(batch).toMatchObject({ mode: 'async', state: BATCH.PENDING, polls: 0 });
    expect(batch.programs.map(p => p.id)).toEqual([0, 1, 2]);
    expect(gl.compileShader).toHaveBeenCalledTimes(6);
    expect(gl.linkProgram).toHaveBeenCalledTimes(3);
    expect(gl.getProgramParameter).not.toHaveBeenCalled();
    expect(gl.getShaderParameter).not.toHaveBeenCalled();
  });
});

describe('async batch polling', () => {
  test('polls COMPLETION_STATUS_KHR only on programs still compiling, one query each per frame', () => {
    const gl = makeAsyncGl({ completeAt: k => k + 1 });          // program k completes on frame k + 1
    const batch = startProgramBatch(gl, threeSources);
    const perFrame = [];
    let state;
    do {
      const before = gl.getProgramParameter.mock.calls.length;
      state = frame(gl, batch);
      perFrame.push(gl.getProgramParameter.mock.calls.slice(before).filter(c => c[1] === EXT.COMPLETION_STATUS_KHR).map(c => c[0].id));
    } while (state === BATCH.PENDING && perFrame.length < 10);
    expect(perFrame).toEqual([[0, 1, 2], [1, 2], [2]]);
    expect(state).toBe(BATCH.READY);
    expect(batch).toMatchObject({ polls: 3, timedOut: false });
  });

  test('LINK_STATUS is not read until every program completes, then once per program', () => {
    const gl = makeAsyncGl({ completeAt: () => 3 });
    const batch = startProgramBatch(gl, threeSources);
    expect(frame(gl, batch)).toBe(BATCH.PENDING);
    expect(frame(gl, batch)).toBe(BATCH.PENDING);
    expect(asked(gl, gl.LINK_STATUS)).toEqual([]);
    expect(frame(gl, batch)).toBe(BATCH.READY);
    expect(asked(gl, gl.LINK_STATUS)).toEqual([0, 1, 2]);
    expect(gl.getShaderParameter).not.toHaveBeenCalled();          // compile logs only on a failed link
    const calls = gl.getProgramParameter.mock.calls.length;
    expect(frame(gl, batch)).toBe(BATCH.READY);                     // settled: no more queries
    expect(gl.getProgramParameter.mock.calls.length).toBe(calls);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(gl.deleteShader).not.toHaveBeenCalled();
  });

  test('a failed link found by the poll releases the whole batch, logs the shader, and stays failed', () => {
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    const gl = makeAsyncGl({ completeAt: () => 2, linkOk: k => k !== 1 });
    gl.getShaderParameter.mockImplementation(shader => shader !== gl.createShader.mock.results[3].value);   // fragment B broken
    const batch = startProgramBatch(gl, threeSources);
    expect(frame(gl, batch)).toBe(BATCH.PENDING);
    expect(gl.deleteProgram).not.toHaveBeenCalled();
    expect(frame(gl, batch)).toBe(BATCH.FAILED);
    expect(new Set(gl.deleteProgram.mock.calls.map(c => c[0]))).toEqual(new Set(batch.programs));
    expect(new Set(gl.deleteShader.mock.calls.map(c => c[0]))).toEqual(new Set(gl.createShader.mock.results.map(r => r.value)));
    expect(gl.deleteShader).toHaveBeenCalledTimes(6);
    expect(err.mock.calls.map(c => c[0])).toEqual(['[WebGL] Shader error:', '[WebGL] Link error:']);
    const calls = gl.getProgramParameter.mock.calls.length;
    expect(frame(gl, batch)).toBe(BATCH.FAILED);                    // no second release, no more queries
    expect(gl.getProgramParameter.mock.calls.length).toBe(calls);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(3);
  });

  test('a driver exception while polling releases the whole batch', () => {
    const gl = makeAsyncGl({ completeAt: () => 2 });
    const batch = startProgramBatch(gl, sources);
    gl.getProgramParameter.mockImplementationOnce(() => { throw new Error('synthetic driver error'); });
    expect(frame(gl, batch)).toBe(BATCH.FAILED);
    expect(gl.deleteProgram).toHaveBeenCalledTimes(2);
    expect(gl.deleteShader).toHaveBeenCalledTimes(4);
  });

  test('the poll cap falls back to the blocking LINK_STATUS read, and nothing blocks before it', () => {
    const gl = makeAsyncGl({ completeAt: () => Infinity });        // a driver that never reports completion
    const batch = startProgramBatch(gl, threeSources, { maxPolls: 5 });
    for (let i = 0; i < 4; i++) expect(frame(gl, batch)).toBe(BATCH.PENDING);
    expect(asked(gl, gl.LINK_STATUS)).toEqual([]);
    expect(frame(gl, batch)).toBe(BATCH.READY);                     // 5th poll: the deferred path's read, late
    expect(asked(gl, gl.LINK_STATUS)).toEqual([0, 1, 2]);
    expect(batch).toMatchObject({ polls: 5, timedOut: true });
  });

  test('the default cap is a bounded number of frames', () => {
    expect(ASYNC_SHADER_MAX_POLLS).toBeGreaterThanOrEqual(30);
    expect(ASYNC_SHADER_MAX_POLLS).toBeLessThanOrEqual(600);
    const gl = makeAsyncGl({ completeAt: () => Infinity });
    const batch = startProgramBatch(gl, sources);
    let pending = 0;
    while (frame(gl, batch) === BATCH.PENDING && pending < 10000) pending++;
    expect(pending + 1).toBe(ASYNC_SHADER_MAX_POLLS);
    expect(batch.timedOut).toBe(true);
  });

  test('a lost context neither counts a poll nor fails the batch (the context-loss path rebuilds the engine)', () => {
    const gl = makeAsyncGl({ completeAt: () => 1, linkOk: () => false });   // what a lost context would answer
    const batch = startProgramBatch(gl, sources, { maxPolls: 2 });
    gl.isContextLost.mockReturnValue(true);
    for (let i = 0; i < 5; i++) expect(frame(gl, batch)).toBe(BATCH.PENDING);
    expect(batch.polls).toBe(0);
    expect(gl.getProgramParameter).not.toHaveBeenCalled();
    expect(gl.deleteProgram).not.toHaveBeenCalled();
  });
});

// Immediate failures at start release everything in every mode and come back as null (a failed init).
describe.each([['async', true, false], ['deferred (no extension)', false, false], ['serial', true, true]])('startProgramBatch %s', (_name, ext, serial) => {
  beforeEach(() => { if (serial) window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__ = true; });
  test.each(['createShader', 'createProgram'])('%s allocation refusal releases earlier resources and returns null', method => {
    const gl = makeAsyncGl({ ext });
    gl[method].mockReturnValueOnce(null);
    expect(startProgramBatch(gl, sources)).toBeNull();
    const shaders = gl.createShader.mock.results.map(r => r.value).filter(Boolean);
    const programs = gl.createProgram.mock.results.map(r => r.value).filter(Boolean);
    expect(new Set(gl.deleteShader.mock.calls.map(c => c[0]))).toEqual(new Set(shaders));
    expect(new Set(gl.deleteProgram.mock.calls.map(c => c[0]))).toEqual(new Set(programs));
  });
  test.each(['shaderSource', 'compileShader', 'attachShader', 'linkProgram'])('%s exception releases everything and returns null', method => {
    const gl = makeAsyncGl({ ext });
    gl[method].mockImplementationOnce(() => { throw new Error('synthetic driver error'); });
    expect(startProgramBatch(gl, sources)).toBeNull();
    const shaders = gl.createShader.mock.results.filter(r => r.type === 'return').map(r => r.value);
    const programs = gl.createProgram.mock.results.filter(r => r.type === 'return').map(r => r.value);
    expect(new Set(gl.deleteShader.mock.calls.map(c => c[0]))).toEqual(new Set(shaders));
    expect(new Set(gl.deleteProgram.mock.calls.map(c => c[0]))).toEqual(new Set(programs));
  });
});
