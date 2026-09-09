const assert = require('node:assert/strict');
const { hash } = require('./fixture.cjs');
const names = ['default', 'blend', 'blend_repeat', 'default_repeat'];

function verifyReplay(report) {
  assert.equal(report.diagnosticOnly, true, 'Must be labeled diagnostic');
  assert.deepEqual(report.results.map(r => r.name), names, 'Missing replay leg');
  const hashes = report.results[0].inputHashes, summaries = [];
  assert(Object.keys(hashes).length === 3 && Object.values(hashes).every(h => /^[a-f0-9]{64}$/.test(h)), 'Missing input hashes');
  for (const r of report.results) {
    assert.deepEqual(r.errors, [], r.name + ': browser/render errors');
    assert.equal(r.inputsUnchanged, true, 'Inputs mutated');
    assert.deepEqual(r.inputHashes, hashes, 'Inputs differ across legs');
    assert.deepEqual(r.commits.map(c => c.tag), ['coarse', 'resident', 'incoming'], 'Missing committed target');
    assert(r.frames.length >= 26, 'Missing frames');
    assert.equal(r.frames.filter(f => f.phase === 'coarse').length, 3);
    assert.equal(r.frames.filter(f => f.phase === 'resident').length, 8);
    assert(r.frames.every((f, i) => f.index === i && f.glError === 0 && Number.isFinite(f.L)
      && Number.isFinite(f.t) && (!i || f.t > r.frames[i-1].t) && f.drawCalls > 0
      && /^[a-f0-9]{64}$/.test(f.pixelSha256)), 'Invalid frame/clock/GL/draw');
    const hidden = r.frames.filter(f => f.phase === 'hidden'), arrival = r.frames.filter(f => f.phase === 'arrival');
    assert.equal(hidden.length, 5); assert(arrival.length >= 10);
    assert(arrival.at(-1).t - arrival[0].t >= 1000, 'Incomplete arrival observation');
    assert(hidden.slice(-3).every(f => f.tag === 'resident' && f.mult === 0 && f.bridge && f.wash > 0), 'Missing hidden precondition');
    assert(arrival.every(f => f.tag === 'incoming' && f.base === hidden.at(-1).base && f.mult > 0), 'Wrong resident/base');
    const expectedBlend = r.name.startsWith('blend');
    assert.equal(r.blend, expectedBlend, 'Wrong treatment');
    assert.equal(r.starts, expectedBlend ? 1 : 0, 'Candidate did not engage exactly once');
    const replacement = arrival[0].handoff?.lastReplacement;
    assert(replacement?.sameTarget && replacement.sameBase && replacement.covers
      && replacement.priorMult === 0 && replacement.priorBridge && replacement.priorWash > 0, 'Invalid replacement');
    assert.equal(arrival[0].handoff.scale, expectedBlend ? 0 : 1, 'Wrong initial treatment scale');
    assert.equal(arrival.at(-1).handoff.scale, 1, 'Transition not observed to finish');
    assert.deepEqual(r.samples.map(s => s.phase), ['hidden', 'arrival'], 'Missing coastal samples');
    for (const s of r.samples) {
      assert(s.glError === 0 && s.count === 200 && s.known === 200 && s.water > 0 && s.water < s.known, 'Missing land/water evidence');
      assert.equal(s.values.length, 200); assert.equal(hash(s.values), s.valuesSha256, 'Mask sample evidence altered');
      assert.equal(s.values.filter(v => v.effective != null).length, s.known);
      assert.equal(s.values.filter(v => v.effective >= 128).length, s.water);
    }
    const sequence = [hidden.at(-1), ...arrival];
    summaries.push({ name: r.name, starts: r.starts,
      maxArrivalStep: Math.max(...arrival.map((f, i) => Math.abs(f.L-sequence[i].L))),
      arrivalIntervalsMs: arrival.map((f, i) => f.t-sequence[i].t),
      scales: arrival.map(f => f.handoff.scale), water: r.samples.map(s => s.water),
      blockedPublications: r.blockedWrites.length });
  }
  return { diagnosticOnly: true, measurement: 'Complete delivered-grid coastal replay; no visual/scientific release verdict', summaries };
}
module.exports = { verifyReplay, names };
