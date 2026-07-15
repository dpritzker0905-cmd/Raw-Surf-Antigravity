import { expectedMaxCellDeg, evaluateResidentAdequacy, recordResolutionSample } from './marineResolutionWatch';

describe('expectedMaxCellDeg — the proven backend tier ladder (lenient: mid is legitimate at coastal zoom)', () => {
  it('accepts mid-or-finer below the global-span cutoff (<15° span)', () => {
    expect(expectedMaxCellDeg(1.5)).toBe(2.5);
    expect(expectedMaxCellDeg(7)).toBe(2.5);
    expect(expectedMaxCellDeg(14)).toBe(2.5);
  });
  it('accepts any resolution once genuinely wide (≥15° span)', () => {
    expect(expectedMaxCellDeg(20)).toBe(Infinity);
  });
  it('never flags on unknown span', () => {
    expect(expectedMaxCellDeg(0)).toBe(Infinity);
    expect(expectedMaxCellDeg(-1)).toBe(Infinity);
  });
});

describe('evaluateResidentAdequacy — flags ONLY coarse-global at a coastal/mid viewport', () => {
  it('OK: fine tile at close zoom', () => {
    expect(evaluateResidentAdequacy({ spanDeg: 1.5, cellDeg: 0.231 }).adequate).toBe(true);
  });
  it('OK: global_mid at a 7° coastal viewport (the correct tier)', () => {
    expect(evaluateResidentAdequacy({ spanDeg: 7, cellDeg: 1.78 }).adequate).toBe(true);
  });
  it('OK: global_mid at a ~2° viewport (mid where fine might fit is NOT an anomaly — no false positive)', () => {
    expect(evaluateResidentAdequacy({ spanDeg: 2.23, cellDeg: 1.6 }).adequate).toBe(true);
  });
  it('OK: global_coarse at a genuinely wide (30°) viewport', () => {
    expect(evaluateResidentAdequacy({ spanDeg: 30, cellDeg: 9.73 }).adequate).toBe(true);
  });
  it('FLAGS the stuck state: coarse-global (9.73°) at a 7° coastal viewport', () => {
    const v = evaluateResidentAdequacy({ spanDeg: 7, cellDeg: 9.73 });
    expect(v.adequate).toBe(false);
    expect(v.reason).toBe('coarse_global_at_coastal_zoom');
  });
  it('FLAGS the stuck state at a fine viewport too (coarse-global at z9)', () => {
    const v = evaluateResidentAdequacy({ spanDeg: 1.5, cellDeg: 9.73 });
    expect(v.adequate).toBe(false);
    expect(v.reason).toBe('coarse_global_at_coastal_zoom');
  });
  it('does NOT flap on an honest off-hour dynamic tile only slightly coarser (0.44° at ~2° span)', () => {
    expect(evaluateResidentAdequacy({ spanDeg: 2, cellDeg: 0.444 }).adequate).toBe(true);
  });
  it('does not flag when span or cell is unknown', () => {
    expect(evaluateResidentAdequacy({ spanDeg: 0, cellDeg: 9.73 }).adequate).toBe(true);
    expect(evaluateResidentAdequacy({ spanDeg: 7 }).adequate).toBe(true);
  });
});

describe('recordResolutionSample — bounded ring buffer, silent, non-throwing', () => {
  const mkWin = () => ({});
  it('records an anomaly and increments counters', () => {
    const w = mkWin();
    recordResolutionSample({ spanDeg: 7, cellDeg: 9.73, z: 6.45, cols: 37, model: 'GFS' }, w);
    expect(w.__RAW_RES_WATCH__.anomalies).toBe(1);
    expect(w.__RAW_RES_WATCH__.counts.coarse_global_at_coastal_zoom).toBe(1);
    expect(w.__RAW_RES_WATCH__.report().recent[0].reason).toBe('coarse_global_at_coastal_zoom');
  });
  it('counts adequate commits without logging anomalies', () => {
    const w = mkWin();
    recordResolutionSample({ spanDeg: 7, cellDeg: 1.78, z: 6.45, cols: 7 }, w);
    expect(w.__RAW_RES_WATCH__.commits).toBe(1);
    expect(w.__RAW_RES_WATCH__.anomalies).toBe(0);
  });
  it('caps the ring buffer at 50 entries', () => {
    const w = mkWin();
    for (let i = 0; i < 60; i++) recordResolutionSample({ spanDeg: 7, cellDeg: 9.73, z: 6, cols: 37 }, w);
    expect(w.__RAW_RES_WATCH__.log.length).toBe(50);
    expect(w.__RAW_RES_WATCH__.anomalies).toBe(60);
  });
  it('is a no-op when disabled', () => {
    const w = { __RAW_DISABLE_RES_WATCH__: true };
    expect(recordResolutionSample({ spanDeg: 7, cellDeg: 9.73 }, w)).toBeNull();
    expect(w.__RAW_RES_WATCH__).toBeUndefined();
  });
  it('never throws on garbage input', () => {
    const w = mkWin();
    expect(() => recordResolutionSample(null, w)).not.toThrow();
    expect(() => recordResolutionSample({ spanDeg: 'x', cellDeg: {} }, w)).not.toThrow();
  });
});
