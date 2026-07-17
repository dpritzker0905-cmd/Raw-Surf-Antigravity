import { coarseBaseLruKey, pickCoarseBaseLruKey, coarseBaseLruEvict } from './WebGLMarineEngine';

// §2d PER-LAYER COARSE-BASE LRU (2026-07-16): pure decision guards. The LRU exists so a layer
// switch back to a cached layer re-engages the wash/ring-fill instantly (the layer-interaction pin:
// every switch ran blend0 until the new layer's coarse-global committed). Truth rule: retargeting
// never crosses model/layer — only flavor may fall back (§0e keeps the main texture honest).

describe('coarseBaseLruKey', () => {
  it('keys by model|layer|flavor with defaults', () => {
    expect(coarseBaseLruKey({ __sourceModel: 'GFS', __componentLayer: 'swell_1' })).toBe('GFS|swell_1|r0');
    expect(coarseBaseLruKey({ __sourceModel: 'EURO', __componentLayer: 'waves', ratingMode: true })).toBe('EURO|waves|r1');
    expect(coarseBaseLruKey({})).toBe('GFS|waves|r0');
  });
});

describe('pickCoarseBaseLruKey', () => {
  const keys = ['GFS|waves|r0', 'GFS|swell_1|r0', 'GFS|waves|r1'];
  it('prefers the exact model|layer|flavor', () => {
    expect(pickCoarseBaseLruKey(keys, 'GFS', 'waves', true)).toBe('GFS|waves|r1');
    expect(pickCoarseBaseLruKey(keys, 'GFS', 'waves', false)).toBe('GFS|waves|r0');
  });
  it('falls back to the other flavor of the SAME model|layer (honest field either way)', () => {
    expect(pickCoarseBaseLruKey(['GFS|swell_1|r0'], 'GFS', 'swell_1', true)).toBe('GFS|swell_1|r0');
  });
  it('never crosses model or layer (truth rule)', () => {
    expect(pickCoarseBaseLruKey(['GFS|waves|r0'], 'GFS', 'swell_2', false)).toBeNull();
    expect(pickCoarseBaseLruKey(['GFS|waves|r0'], 'EURO', 'waves', false)).toBeNull();
  });
});

describe('coarseBaseLruEvict', () => {
  it('no eviction at or under the cap', () => {
    expect(coarseBaseLruEvict(['a', 'b'], 2, 'b')).toBeNull();
    expect(coarseBaseLruEvict(['a'], 2, 'a')).toBeNull();
  });
  it('evicts the oldest entry that is neither displayed nor newest', () => {
    expect(coarseBaseLruEvict(['a', 'b', 'c'], 2, 'c')).toBe('a');
    expect(coarseBaseLruEvict(['a', 'b', 'c'], 2, 'a')).toBe('b'); // displayed oldest is protected
  });
  it('never evicts the newest (just-inserted) entry', () => {
    expect(coarseBaseLruEvict(['a', 'b'], 1, 'a')).toBeNull(); // only non-displayed is the newest → protected
  });
});
