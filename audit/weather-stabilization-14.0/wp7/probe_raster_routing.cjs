/* Executes the actual nested routing function in isolation; no React/network/serving changes. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../..');
const head = process.argv[2];
assert(/^[a-f0-9]{40}$/.test(head || ''), 'Pass the git rev-parse HEAD result as the sole argument');
const sources = {};
function read(name) {
  const relative = `frontend/src/components/map/${name}`;
  const text = fs.readFileSync(path.join(root, relative), 'utf8');
  sources[relative] = crypto.createHash('sha256').update(text).digest('hex');
  return text;
}
const registry = read('LayerRegistry.js');
const hook = read('useOpenMeteoTileUrls.js');
const horizons = read('modelHorizons.js');
const context = { eff: declared => declared };
for (const name of ['PRECIP_MODEL_MAP', 'WIND_MODEL_MAP', 'MARINE_MODEL_MAP']) {
  const object = registry.match(new RegExp(`export const ${name} = (\\{[\\s\\S]*?\\n\\});`));
  assert(object, `Actual registry map missing: ${name}`);
  context[name] = vm.runInNewContext(`(${object[1]})`);
}
for (const match of horizons.matchAll(/export const (\w+_CUTOVER_H) = (\d+);/g)) {
  context[match[1]] = Number(match[2]);
}
const fn = hook.match(/const resolveModel = (\(entry, variable\) => \{[\s\S]*?\n        \});\n\n        const activeTasks/);
assert(fn, 'Actual hook routing function not found; do not silently replace it');
const offsets = [0, 168, 169, 228, 229];
const expected = {
  GFS: ['ncep_gfs013', 'ncep_gfs013', 'ncep_gfs013', 'ncep_gfs013', 'ncep_gfs013'],
  ICON: ['dwd_icon', 'dwd_icon', 'ncep_gfs013', 'ncep_gfs013', 'ncep_gfs013'],
  EURO: ['ecmwf_ifs025', 'ecmwf_ifs025', 'ecmwf_ifs025', 'ecmwf_ifs025', 'ncep_gfs013'],
};
const rows = [];
for (const layer of ['satellite', 'temperature', 'water_temp']) {
  const match = registry.match(new RegExp(`^  ${layer}: (\\{[\\s\\S]*?^  \\}),`, 'm'));
  assert(match, `Actual layer not found: ${layer}`);
  const entry = vm.runInNewContext(`(${match[1]})`);
  for (const model of ['GFS', 'ICON', 'EURO']) {
    for (const [index, offset] of offsets.entries()) {
      const resolve = vm.runInNewContext(`(${fn[1]})`, {
        ...context, activeModel: model, targetModel: context.PRECIP_MODEL_MAP[model],
        debouncedTimeOffsetHours: offset,
      });
      const actual = resolve(entry, entry.omVariable);
      const wanted = layer === 'water_temp' && model === 'ICON'
        ? 'ncep_gfs013' : expected[model][index];
      assert.equal(actual, wanted, `${model}/${layer}/+${offset}`);
      rows.push({ layer, variable: entry.omVariable, selected_model: model,
        offset_hours: offset, rendered_model: actual });
    }
  }
}
const result = {
  captured_at: new Date().toISOString(),
  head,
  source_sha256: sources,
  method: 'Unmodified resolveModel function extracted from hook, real registry maps/entries/constants; VM invocation; axis-floor default OFF.',
  limits: 'Isolated routing execution only: not React mounting, live provider availability, decoded pixels, or browser display verification. No network access.',
  checks: rows.length, passed: rows.length, rows,
};
fs.writeFileSync(path.join(__dirname, 'routing-results.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ checks: rows.length, passed: rows.length, head: result.head }));
