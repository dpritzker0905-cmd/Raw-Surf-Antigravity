// Execute the extracted actual CI count gate against immutable receipt controls.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const source = fs.readFileSync(path.join(__dirname, 'frontend-gate-check.cjs'), 'utf8');
const original = JSON.parse(fs.readFileSync(path.join(__dirname, '../frontend-gate.json'), 'utf8'));
const controls = [
  ['healthy', r => r, 0],
  ['one_pass_below_floor', r => ({ ...r, numPassedTests: 95 }), 1],
  ['one_suite_below_floor', r => ({ ...r, numTotalTestSuites: 6 }), 1],
  ['failed_test', r => ({ ...r, numFailedTests: 1 }), 1],
];
const results = controls.map(([name, mutate, expected]) => {
  const receipt = mutate(JSON.parse(JSON.stringify(original)));
  let exit = null;
  const context = {
    require: module => module === 'fs'
      ? { readFileSync: () => JSON.stringify(receipt) } : require(module),
    console: { log() {}, error() {} },
    process: { exit(code) { const error = new Error('controlled process exit');
      error.auditExit = code; throw error; } },
  };
  try { vm.runInNewContext(source, context); }
  catch (error) { if (error.auditExit === undefined) throw error; exit = error.auditExit; }
  assert.equal(exit, expected, name);
  return { name, gate_exit: exit, expected_exit: expected };
});
fs.writeFileSync(path.join(__dirname, 'frontend-gate-controls.json'),
  JSON.stringify({ method: 'Exact extracted CI JavaScript; only fs input/process exit substituted',
    source_receipt: '../frontend-gate.json', controls: results }, null, 2) + '\n');
console.log(`${results.length} count-gate controls passed`);
