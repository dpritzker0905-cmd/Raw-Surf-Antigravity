// Offline diagnostic instrument; no forecast fetch, runtime patch or GPU claim.
const path = require('path');
const fs = require('fs');
const assert = require('assert/strict');
const frontend = path.resolve(__dirname, '../../frontend');
const resolve = name => require.resolve(name, { paths: [frontend] });
const {JSDOM} = require(resolve('jsdom'));
const dom = new JSDOM('<!doctype html><html></html>', {url: 'http://localhost/'});
global.window = dom.window;
global.document = dom.window.document;
window.URL.createObjectURL = () => 'blob:offline-diagnostic';
global.fetch = window.fetch = () => {throw new Error('Diagnostic forbids network');};
const babel = require(resolve('@babel/core'));
const loadJS = require.extensions['.js'];
require.extensions['.js'] = (module, filename) => {
  if (!filename.startsWith(path.join(frontend, 'src'))) return loadJS(module, filename);
  const transformed = babel.transformSync(fs.readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false,
    presets: [[resolve('@babel/preset-env'), {targets: {node: 'current'}}]],
  });
  module._compile(transformed.code, filename);
};
const {encodeMarineTexture} = require(path.join(frontend, 'src/components/map/WebGLMarineTextureEncoder'));
const {getThemedWaveColorJS} = require(path.join(frontend, 'src/components/map/colorScales'));
const {gridValidMs} = require(path.join(frontend, 'src/components/map/marineStaleHour'));

function encode(height, cols, rows, global, perCell = null) {
  let bound = null, flip = false, id = 0;
  const uploads = new Map();
  const gl = {
    TEXTURE_2D: 1, TEXTURE_BINDING_2D: 2, UNPACK_FLIP_Y_WEBGL: 3,
    RGBA: 4, UNSIGNED_BYTE: 5, LINEAR: 6, NEAREST: 7, CLAMP_TO_EDGE: 8,
    getParameter: p => p === 2 ? bound : p === 3 ? flip : null,
    createTexture: () => ({id: ++id}), deleteTexture: () => {},
    bindTexture: (_, tex) => {bound = tex;}, texParameteri: () => {},
    pixelStorei: (_, value) => {flip = value;},
    texImage2D: (...args) => {uploads.set(bound, Uint8Array.from(args[8] || []));},
    texSubImage2D: () => {},
  };
  const grid = {cols, rows, productId: `fixture-${height}-${cols}`, __sourceModel: 'GFS',
    __componentLayer: 'waves', hourOffset: 98, ratingMode: false,
    bounds: global ? {west: -180, east: 180, south: -80, north: 85}
      : {west: -98, east: -76, south: 18, north: 33},
    vectors: Array.from({length: cols * rows}, (_, i) => ({
      height: perCell ? perCell[i] : height, speed: perCell ? perCell[i] : height,
      u: 1, v: 0, period: 9.1, is_valid: true,
    })),
  };
  const result = encodeMarineTexture(gl, grid, null, {});
  assert(result);
  const data = uploads.get(result.u_waveTexture);
  assert.equal(data.length, cols * rows * 4);
  const decoded = Array.from({length: cols * rows}, (_, i) => data[4 * i + 2] / 255 * 10);
  assert(decoded.every((value, i) => {
    const expected = perCell ? perCell[i] : height;
    return value <= expected + 1e-6 && expected - value < 10 / 255 + 1e-6;
  }));
  return {heightM: height, dimensions: [cols, rows], decodedM: decoded[0],
    decodedFt: decoded[0] / 0.3048, everyTexelPreserved: true,
    ...(perCell ? {cornersM: decoded} : {})};
}

const fields = [0, 4, 8, 12, 19, 25].flatMap(ft => [
  encode(ft * 0.3048, 181, 82, true), encode(ft * 0.3048, 27, 20, false),
]);
for (const dims of [181, 27]) {
  const lane = fields.filter(field => field.dimensions[0] === dims);
  assert(lane.every((field, i) => !i || field.decodedM > lane[i - 1].decodedM));
}
const colors = ['dark', 'light', 'beach'].map(theme => {
  const low = getThemedWaveColorJS(4 * 0.3048, theme, false);
  const high = getThemedWaveColorJS(19 * 0.3048, theme, false);
  assert.notDeepEqual(low, high);
  return {theme, fourFtRGB: low, nineteenFtRGB: high};
});
// Equal requested-hour labels cannot certify equal served times.
const early = {hourOffset: 98, valid_time: '2026-10-05T00:00:00Z'};
const late = {hourOffset: 98, valid_time: '2026-10-09T00:00:00Z'};
assert.notEqual(gridValidMs(early), gridValidMs(late));
assert.equal(gridValidMs({hourOffset: 98}), null);
// A counterexample, not a claim about the unknown live Gulf cells: LINEAR sampling at
// the midpoint of a four-ocean-cell footprint attenuates a narrow peak by its weight.
const cells = [19, 4, 4, 4].map(ft => ft * 0.3048);
const before = encode(0, 2, 2, false, cells).cornersM;
const perturbed = encode(0, 2, 2, false, [cells[0] + 0.2, ...cells.slice(1)]).cornersM;
const midpoint = before.reduce((sum, value) => sum + value, 0) / 4;
const inputDelta = perturbed[0] - before[0];
const outputDelta = perturbed.reduce((sum, value) => sum + value, 0) / 4 - midpoint;
assert(Math.abs(outputDelta / inputDelta - 0.25) < 1e-9);
assert(midpoint < before[0]);
const receipt = {source: 'actual encoder and JS shader-ramp mirror',
  synthetic: true, realGPU: false, fields, colors,
  interpolationCounterexample: {cornerFt: before[0] / 0.3048,
    midpointFt: midpoint / 0.3048, derivativeToPeakTexel: outputDelta / inputDelta},
  requestedHourIsNotFrameIdentity: true, passed: true};
fs.writeFileSync(path.join(__dirname, 'visual/gulf-height-results.json'), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
dom.window.close();
