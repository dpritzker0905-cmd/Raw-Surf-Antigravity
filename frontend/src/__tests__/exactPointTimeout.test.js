import { resolveExactPointTimeoutMs } from '../hooks/useExactPointFetch';

// 2026-07-06 infobox "Loading… → Timeout" root: a flat 12s abort vs a COLD native CMEMS EURO
// point measured at 17s live (GFS 0.9s / ICON 2.5s) — every first EURO marker lookup died at
// 12s. EURO gets its realistic cold budget; fast models keep the interactive 12s.

describe('resolveExactPointTimeoutMs (model-aware infobox fetch budget)', () => {
  it('fast models keep the interactive 12s', () => {
    expect(resolveExactPointTimeoutMs('GFS', {})).toBe(12000);
    expect(resolveExactPointTimeoutMs('ICON', null)).toBe(12000);
  });

  it('EURO gets the 25s cold-CMEMS budget', () => {
    expect(resolveExactPointTimeoutMs('EURO', {})).toBe(25000);
    expect(resolveExactPointTimeoutMs('EURO', null)).toBe(25000);
  });

  it('levers override per class (min 1s sanity floor)', () => {
    expect(resolveExactPointTimeoutMs('GFS', { __RAW_EXACT_POINT_TIMEOUT_MS__: 8000 })).toBe(8000);
    expect(resolveExactPointTimeoutMs('EURO', { __RAW_EXACT_POINT_EURO_TIMEOUT_MS__: 30000 })).toBe(30000);
    // the EURO lever does not leak onto fast models and vice versa
    expect(resolveExactPointTimeoutMs('GFS', { __RAW_EXACT_POINT_EURO_TIMEOUT_MS__: 30000 })).toBe(12000);
    expect(resolveExactPointTimeoutMs('EURO', { __RAW_EXACT_POINT_TIMEOUT_MS__: 8000 })).toBe(25000);
    // junk / sub-1s lever values fall back to defaults
    expect(resolveExactPointTimeoutMs('EURO', { __RAW_EXACT_POINT_EURO_TIMEOUT_MS__: 5 })).toBe(25000);
    expect(resolveExactPointTimeoutMs('GFS', { __RAW_EXACT_POINT_TIMEOUT_MS__: 'x' })).toBe(12000);
  });
});
