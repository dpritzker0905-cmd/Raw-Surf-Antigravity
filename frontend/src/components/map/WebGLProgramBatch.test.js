import { createProgramBatch, deferredShaderStatusEnabled } from './WebGLProgramBatch';

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
afterEach(() => { delete window.__RAW_DISABLE_DEFERRED_SHADER_STATUS__; jest.restoreAllMocks(); });

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
