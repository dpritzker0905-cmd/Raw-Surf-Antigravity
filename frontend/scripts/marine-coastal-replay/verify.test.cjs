const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeTargets, hash } = require('./fixture.cjs');
const { verifyReplay, names } = require('./verify.cjs');

function input() {
  const grid = { cols: 3, rows: 3, bounds: { west: -82, south: 26, east: -78, north: 30 },
    vectors: Array.from({ length: 9 }, (_, i) => ({ lng: -82 + i%3*2, lat: 26 + Math.floor(i/3)*2,
      speed: i/10, is_valid: i !== 4 })) };
  const p = { model: 'GFS', layer: 'waves', served_valid_time: '2026-09-09T00:00:00Z',
    value_kind: 'significant_wave_height', value_unit: 'm', grid };
  return { coarse: structuredClone(p), regional: structuredClone(p) };
}
test('crop preserves delivered cells including invalid flags, input and served identity', () => {
  const data = input(), before = structuredClone(data), targets = makeTargets(data);
  assert.deepEqual(targets.resident.vectors, data.regional.grid.vectors);
  assert.deepEqual(data, before); assert.equal(targets.resident.served_valid_time, data.regional.served_valid_time);
  assert.equal(hash(targets.resident), targets.hashes.resident);
});
for (const [name, change] of [
  ['missing served time', d => { delete d.regional.served_valid_time; }],
  ['different served time', d => { d.regional.served_valid_time = '2026-09-09T01:00:00Z'; }],
  ['wrong quantity', d => { d.regional.value_unit = 'ft'; }],
  ['incomplete grid', d => { d.regional.grid.vectors.pop(); }],
  ['irregular geometry', d => { d.regional.grid.vectors[1].lng += .1; }],
  ['wrong layer', d => { d.regional.layer = 'wind'; }],
]) test('input refuses ' + name, () => { const d = input(); change(d); assert.throws(() => makeTargets(d)); });

function report() {
  const values = Array.from({ length: 200 }, (_, i) => ({ effective: i < 100 ? 255 : 0 }));
  return { diagnosticOnly: true, results: names.map(name => {
    const blend = name.startsWith('blend');
    return { name, errors: [], blend, inputsUnchanged: true, inputHashes: makeTargets(input()).hashes,
      commits: ['coarse', 'resident', 'incoming'].map(tag => ({ tag })), starts: blend ? 1 : 0, blockedWrites: [],
      frames: Array.from({ length: 26 }, (_, i) => {
        const phase = i<3?'coarse':i<11?'resident':i<16?'hidden':'arrival';
        return { index: i, phase, t: i*150, L: 80, glError: 0, drawCalls: 3, pixelSha256: 'a'.repeat(64),
          tag: phase==='arrival'?'incoming':phase==='coarse'?'coarse':'resident', mult: phase==='hidden'?0:1, base: 1,
          bridge: true, wash: .4, handoff: { scale: blend && i===16?0:1,
            lastReplacement: { sameTarget: true, sameBase: true, covers: true, priorMult: 0, priorBridge: true, priorWash: .4 } } };
      }), samples: ['hidden', 'arrival'].map(phase => ({ phase, glError: 0, count: 200, known: 200, water: 100,
        values: structuredClone(values), valuesSha256: hash(values) })) };
  }) };
}
test('complete instrument evidence produces diagnostic only, never a release verdict', () => {
  const result = verifyReplay(report()); assert.equal(result.diagnosticOnly, true); assert.equal(result.summaries.length, 4);
});
for (const [name, change] of [
  ['absent leg', r => r.results.pop()],
  ['never engaged', r => { r.results[1].starts = 0; }],
  ['missing frame', r => r.results[0].frames.splice(17,1)],
  ['hidden precondition absent', r => { r.results[1].frames[15].mult = 1; }],
  ['base changed', r => { r.results[1].frames[16].base = 2; }],
  ['input mutated', r => { r.results[0].inputsUnchanged = false; }],
  ['different input', r => { r.results[1].inputHashes.coarse = 'b'.repeat(64); }],
  ['GPU error', r => { r.results[0].frames[18].glError = 1282; }],
  ['browser error', r => r.results[0].errors.push('Render error')],
  ['coastal samples absent', r => { r.results[0].samples = []; }],
  ['mask sample modified', r => { r.results[0].samples[0].values[0].effective = 0; }],
  ['wrong target', r => { r.results[1].frames[16].handoff.lastReplacement.sameTarget = false; }],
  ['empty draw', r => { r.results[1].frames[16].drawCalls = 0; }],
  ['unfinished transition', r => { r.results[1].frames.at(-1).handoff.scale = .5; }],
]) test('replay refuses ' + name, () => { const r = report(); change(r); assert.throws(() => verifyReplay(r)); });
