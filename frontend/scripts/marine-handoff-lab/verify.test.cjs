// Test the evidence judge with observed data, including false-green/blank-scene interventions.
const assert = require('assert/strict');
const fs = require('fs');
const { verifyResults } = require('./run.cjs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const cases = [
  ['missing leg', r => r.pop(), /missing experiment leg/],
  ['missing frame', r => r[0].snapshots.pop(), /missing frames/],
  ['blank setup', r => { r[0].snapshots[0].painted = 0; }, /invalid\/blank draw/],
  ['coverage gap', r => { r[0].snapshots.at(-1).painted = 100000; }, /measured coverage gap/],
  ['GL error', r => { r[0].snapshots[0].glError = 1282; }, /invalid\/blank draw/],
  ['missing pixel hash', r => { delete r[0].snapshots[0].pixelSha256; }, /invalid\/blank draw/],
  ['disabled renderer', r => { r[0].layerErrors = 1; }, /disabled layer/],
  ['changed on-time path', r => { r[6].snapshots.at(-1).pixelSha256 = '0'.repeat(64); }, /opt-in changed/],
  ['vacuous value control', r => { r[3].snapshots = r[0].snapshots; }, /insensitive to changed/],
  ['unexercised treatment', r => { r[4].snapshots.find(s => s.phase === 'handoff' && s.frame === 10).handoff.scale = 1; }, /never engaged/],
];
const log = console.log;
try {
  console.log = () => {};
  verifyResults(source);
  for (const [name, mutate, reason] of cases) {
    const changed = JSON.parse(JSON.stringify(source));
    mutate(changed);
    assert.throws(() => verifyResults(changed), reason, name);
  }
} finally { console.log = log; }
console.log('PASS: observed baseline and ' + cases.length + ' evidence-rejection controls');
