import { createProgramBatch } from './WebGLProgramBatch';

function makeGl() {
  return {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: jest.fn(() => ({})), shaderSource: jest.fn(), compileShader: jest.fn(),
    getShaderParameter: jest.fn(() => true), deleteShader: jest.fn(),
    createProgram: jest.fn(() => ({})), attachShader: jest.fn(), linkProgram: jest.fn(),
    getProgramParameter: jest.fn(() => true), deleteProgram: jest.fn(),
  };
}
const sources = [['vertexA', 'fragmentA'], ['vertexB', 'fragmentB']];

test('successful programs retain attached shader ownership for ordinary engine disposal', () => {
  const gl = makeGl();
  const programs = createProgramBatch(gl, sources);
  expect(programs).toHaveLength(2);
  expect(gl.createShader).toHaveBeenCalledTimes(4);
  expect(gl.attachShader).toHaveBeenCalledTimes(4);
  expect(gl.shaderSource.mock.calls.map(call => call[1])).toEqual(sources.flat());
  expect(gl.deleteProgram).not.toHaveBeenCalled();
  expect(gl.deleteShader).not.toHaveBeenCalled();
});
test.each(['shaderSource', 'compileShader', 'getShaderParameter', 'attachShader', 'linkProgram', 'getProgramParameter'])('%s exception releases all resources created so far', method => {
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
