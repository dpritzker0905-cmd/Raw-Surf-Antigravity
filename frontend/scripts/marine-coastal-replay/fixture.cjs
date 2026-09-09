const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

// A crop is a subset of delivered cells. It never interpolates or changes physical values.
function makeTargets(input) {
  for (const p of [input.coarse, input.regional]) {
    assert(p.model === 'GFS' && p.layer === 'waves', 'Expected GFS waves');
    assert(p.grid?.cols > 1 && p.grid?.rows > 1 && p.grid.vectors.length === p.grid.cols * p.grid.rows, 'Incomplete grid');
    assert(Number.isFinite(Date.parse(p.served_valid_time)), 'Missing served time');
    const { cols, rows, bounds: b, vectors } = p.grid;
    assert(b.east > b.west && b.north > b.south, 'Invalid grid bounds');
    vectors.forEach((v, i) => {
      assert(Math.abs(v.lng - (b.west + i % cols * (b.east-b.west)/(cols-1))) < 1e-6
        && Math.abs(v.lat - (b.south + Math.floor(i/cols) * (b.north-b.south)/(rows-1))) < 1e-6, 'Irregular grid geometry');
    });
  }
  assert.equal(input.coarse.served_valid_time, input.regional.served_valid_time, 'Different served times');
  for (const key of ['value_kind', 'value_unit']) {
    assert(input.coarse[key] && input.coarse[key] === input.regional[key], 'Missing/mismatched quantity identity');
  }
  const adapt = (p, tag) => ({ ...p.grid, __sourceModel: p.model, __componentLayer: p.layer,
    ratingMode: false, hourOffset: 0, __provider: p.provider, provider: p.provider,
    source_dataset: p.source_dataset, is_estimated: p.is_estimated,
    value_kind: p.value_kind, value_unit: p.value_unit,
    productId: p.product_id, valid_time: p.valid_time, served_valid_time: p.served_valid_time,
    __replayTag: tag });
  const coarse = adapt(input.coarse, 'coarse'), incoming = adapt(input.regional, 'incoming');
  const vectors = incoming.vectors.filter(v => v.lng >= -82 && v.lng <= -78 && v.lat >= 26 && v.lat <= 30);
  const xs = [...new Set(vectors.map(v => v.lng))].sort((a, b) => a - b);
  const ys = [...new Set(vectors.map(v => v.lat))].sort((a, b) => a - b);
  assert(xs.length > 1 && ys.length > 1 && vectors.length === xs.length * ys.length, 'Coastal crop is not a complete grid');
  // Prove row-major geometry, including cells whose provider value is explicitly invalid.
  vectors.forEach((v, i) => {
    assert.equal(v.lng, xs[i % xs.length]); assert.equal(v.lat, ys[Math.floor(i / xs.length)]);
  });
  const resident = { ...incoming, __replayTag: 'resident', cols: xs.length, rows: ys.length,
    bounds: { west: xs[0], south: ys[0], east: xs.at(-1), north: ys.at(-1) }, vectors };
  return { coarse, resident, incoming, hashes: Object.fromEntries(
    Object.entries({ coarse, resident, incoming }).map(([name, grid]) => [name, hash(grid)])),
    provenance: 'Resident is an exact cell subset of the delivered regional grid; no coefficient or value edits.' };
}
module.exports = { makeTargets, hash };
