// V6 handoff fact-pack probe — drive the SHIPPED forecastDiagnostics.js source text through the
// full model x layer x producer-status matrix. Read-only: loads the real file, strips only the
// ESM import (stubbed) and the `export` keyword, evals the rest verbatim.
//
// Purpose: test the d1b40987 claim "AFTER warns in 12/12". That claim was measured with the
// producer PINNED at {status:'retained_previous_hour'}. The producer (WebGLMarineLayer.js:176-181)
// can also emit 'no_copernicus_coverage' and 'rate_limited_cached'. This sweeps ALL of them.

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '..', '..', 'frontend', 'src', 'components', 'map', 'forecastDiagnostics.js');
let src = fs.readFileSync(SRC, 'utf8');

// Cut everything from writeOverlayDiagnostics onward — we only need computeHeatmapStatus.
const cut = src.indexOf('export function writeOverlayDiagnostics');
if (cut > 0) src = src.slice(0, cut);
src = src.replace(/^import .*$/gm, '');
src = src.replace(/export function/g, 'function');

const harness = `
  ${src}
  module.exports = { computeHeatmapStatus };
`;

const mod = { exports: {} };
// isInCooldown stub — false, so cooldown never masks a result.
const isInCooldown = () => false;
// eslint-disable-next-line no-new-func
new Function('module', 'isInCooldown', 'window', harness)(mod, isInCooldown, globalThis.window || (globalThis.window = {}));
const { computeHeatmapStatus } = mod.exports;

const MODELS = ['GFS', 'ICON', 'EURO'];
const LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves'];

// Producer values reachable at WebGLMarineLayer.js:176-181 when parity === false.
const PRODUCER_STATES = [
  ['retained_previous_hour  (reason=default)', (m) => ({ status: 'retained_previous_hour' })],
  ['rate_limited_cached     (reason=cooldownActive)', (m) => ({ status: 'rate_limited_cached' })],
  ['coverageMissing         (model-dependent)', (m) => ({ status: m === 'EURO' ? 'no_copernicus_coverage' : 'no_backend_coverage' })],
  ['HEALTHY (control)       (status=null)', () => null],
];

let out = '';
for (const [label, mk] of PRODUCER_STATES) {
  let warn = 0, silent = 0;
  const silentCells = [];
  out += '\n' + label + '\n';
  for (const m of MODELS) {
    for (const l of LAYERS) {
      globalThis.window.__MARINE_HEATMAP_STATUS__ = mk(m);
      globalThis.window.__MARINE_FETCH_DIAG__ = undefined;
      const r = computeHeatmapStatus({ activeModel: m, activeLayer: l, renderMarineData: {} });
      const shown = r !== null && r !== 'loading';
      if (shown) warn++; else { silent++; silentCells.push(m + '/' + l + ' -> ' + String(r)); }
      out += '  ' + (m + '/' + l).padEnd(18) + ' => ' + String(r) + '\n';
    }
  }
  out += '  SUMMARY: visible ' + warn + '/12, silent-or-loading ' + silent + '/12\n';
  if (silentCells.length) out += '  SILENT CELLS: ' + silentCells.join(' | ') + '\n';
}
console.log(out);
