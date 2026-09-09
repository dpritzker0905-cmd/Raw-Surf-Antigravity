const fs = require('node:fs');
const assert = require('node:assert/strict');
const { verifyVisibility } = require('./visibility.cjs');
const source = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
verifyVisibility(source);
const cases = [
  ['missing leg', r => r.pop()], ['missing frame', r => r[0].snapshots.pop()],
  ['browser error', r => r[0].errors.push('Render error')],
  ['disabled layer', r => { r[0].layerErrors = 1; }],
  ['GL error', r => { r[0].snapshots[10].glError = 1282; }],
  ['changed pixels', r => { r[1].snapshots[10].pixelSha256 = '0'.repeat(64); }],
  ['stopped simulation', r => { r[1].snapshots[10].submissions.advection--; }],
  ['missing rating path', r => { r[0].snapshots.at(-1).ratingActive = false; }],
  ['missing debug case', r => { r[0].snapshots.at(-1).scenario.debug = 'normal'; }],
  ['vacuous draw reduction', r => {
    r[1].submissions = { ...r[0].submissions }; r[1].snapshots.at(-1).submissions = { ...r[0].submissions };
  }],
];
for (const [name, mutate] of cases) {
  const changed = structuredClone(source); mutate(changed);
  assert.throws(() => verifyVisibility(changed), undefined, name);
}
console.log('PASS: observed WebGL baseline and ' + cases.length + ' evidence-rejection controls');
