import { initEngine as initMarine } from './WebGLMarineEngineInit';
import { initEngine as initWind } from './WebGLWindEngineInit';
import WebGLMarineEngine from './WebGLMarineEngine';
import WebGLWindEngine from './WebGLWindEngine';
import { createCustomLayer } from './WebGLMarineCustomLayer';

function makeGl(failShader = -1, failProgram = -1) {
  const shaders = [], programs = [], deletedShaders = [], deletedPrograms = [];
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: jest.fn(() => { const s = { id: shaders.length }; shaders.push(s); return s; }),
    shaderSource: jest.fn(), compileShader: jest.fn(),
    getShaderParameter: jest.fn(s => s.id !== failShader), getShaderInfoLog: () => 'synthetic compile failure',
    deleteShader: jest.fn(s => deletedShaders.push(s)),
    createProgram: jest.fn(() => { const p = { id: programs.length }; programs.push(p); return p; }),
    attachShader: jest.fn(), linkProgram: jest.fn(), getProgramParameter: jest.fn(p => p.id !== failProgram),
    getProgramInfoLog: () => 'synthetic link failure', deleteProgram: jest.fn(p => deletedPrograms.push(p)),
    createBuffer: jest.fn(() => { throw new Error('allocation reached after failed init'); }),
  };
  return { gl, shaders, programs, deletedShaders, deletedPrograms };
}

beforeEach(() => { jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe.each([['marine', initMarine, 6, 3], ['wind', initWind, 10, 5]])('%s failed initialization', (name, init, shaderCount, programCount) => {
  test.each(Array.from({ length: shaderCount }, (_, i) => i))('shader failure at position %i deletes every allocated shader', index => {
    const { gl, shaders, programs, deletedShaders } = makeGl(index);
    const engine = { _initialized: false };
    expect(() => init(engine, gl)).not.toThrow();
    expect(new Set(deletedShaders)).toEqual(new Set(shaders));
    expect(deletedShaders).toHaveLength(shaders.length);
    expect(programs).toHaveLength(0);
    expect(gl.createBuffer).not.toHaveBeenCalled();
    expect(engine._initialized).toBe(false);
  });

  test.each(Array.from({ length: programCount }, (_, i) => i))('link failure at position %i releases programs and shaders before allocation', index => {
    const { gl, shaders, programs, deletedShaders, deletedPrograms } = makeGl(-1, index);
    const engine = { _initialized: false };
    expect(() => init(engine, gl)).not.toThrow();
    expect(new Set(deletedShaders)).toEqual(new Set(shaders));
    expect(new Set(deletedPrograms)).toEqual(new Set(programs));
    expect(deletedShaders).toHaveLength(shaders.length);
    expect(deletedPrograms).toHaveLength(programs.length);
    expect(gl.createBuffer).not.toHaveBeenCalled();
    expect(engine._initialized).toBe(false);
    expect(engine.advectProgram).toBeFalsy();
  });
});

test.each([WebGLMarineEngine, WebGLWindEngine])('public engine initialization reports failure to the layer caller', Engine => {
  const engine = Object.create(Engine.prototype);
  engine._initialized = false;
  expect(() => engine.init(makeGl(0).gl)).toThrow(/initialization failed/i);
});

test('failed marine initialization reaches the actual layer hard-error fallback handler', () => {
  const engine = Object.create(WebGLMarineEngine.prototype);
  engine._initialized = false;
  const onError = jest.fn();
  const ref = current => ({ current });
  const layer = createCustomLayer(engine, ref(true), ref(null), ref(null), ref(null), ref(onError), ref('dark'), ref(null));
  const { gl, shaders, deletedShaders } = makeGl(0);
  layer.onAdd(null, gl);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(new Set(deletedShaders)).toEqual(new Set(shaders));
});
