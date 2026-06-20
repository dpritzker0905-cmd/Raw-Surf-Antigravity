import {
  beginTransition,
  endTransition,
  endCurrentTransition,
  markDisplayed,
  isTransitioning,
  getGeneration,
  getTarget,
  displayMatchesRequested,
  recordClear,
  subscribe,
  __resetForTests,
} from '../components/map/marineTransitionCoordinator';

beforeEach(() => {
  __resetForTests();
  window.__MARINE_CLEAR_LOG__ = [];
});

describe('marineTransitionCoordinator — generation ownership', () => {
  test('beginTransition opens a pending transition and mirrors the legacy flag', () => {
    expect(isTransitioning()).toBe(false);
    const gen = beginTransition({ model: 'GFS', layer: 'waves', hour: 0 });
    expect(gen).toBe(1);
    expect(isTransitioning()).toBe(true);
    expect(window.__MARINE_TRANSITIONING__).toBe(true);
  });

  test('a stale request cannot end a newer transition', () => {
    const g1 = beginTransition({ model: 'GFS', layer: 'waves' });   // gen 1
    const g2 = beginTransition({ model: 'EURO', layer: 'waves' });  // gen 2 (new target)
    expect(g2).toBe(g1 + 1);

    // The stale GFS fetch finishes and tries to end its (old) generation.
    expect(endTransition(g1)).toBe(false);
    expect(isTransitioning()).toBe(true);                          // EURO transition still open
    expect(getTarget().model).toBe('EURO');
    expect(window.__MARINE_TRANSITIONING__).toBe(true);

    // The owning EURO fetch ends it.
    expect(endTransition(g2)).toBe(true);
    expect(isTransitioning()).toBe(false);
    expect(window.__MARINE_TRANSITIONING__).toBe(false);
  });

  test('beginTransition is idempotent for the same {model,layer} while pending', () => {
    const g1 = beginTransition({ model: 'GFS', layer: 'waves' });
    const g1again = beginTransition({ model: 'GFS', layer: 'waves' }); // render-phase / StrictMode re-call
    expect(g1again).toBe(g1);
    expect(getGeneration()).toBe(1);
  });

  test('a different layer bumps the generation', () => {
    const g1 = beginTransition({ model: 'GFS', layer: 'waves' });
    const g2 = beginTransition({ model: 'GFS', layer: 'swell_1' });
    expect(g2).toBe(g1 + 1);
  });

  test('rapid A→B→C: only the final generation can commit/end', () => {
    const a = beginTransition({ model: 'GFS', layer: 'waves' });
    const b = beginTransition({ model: 'EURO', layer: 'waves' });
    const c = beginTransition({ model: 'ICON', layer: 'waves' });
    expect(endTransition(a)).toBe(false);
    expect(endTransition(b)).toBe(false);
    expect(endTransition(c)).toBe(true);
    expect(isTransitioning()).toBe(false);
  });

  test('endCurrentTransition ends the active generation (cache-hit owner path)', () => {
    beginTransition({ model: 'GFS', layer: 'swell_1' });
    expect(endCurrentTransition()).toBe(true);
    expect(isTransitioning()).toBe(false);
  });
});

describe('marineTransitionCoordinator — displayed/requested parity', () => {
  test('displayMatchesRequested compares model, layer, and (optional) hour', () => {
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0 });
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0 })).toBe(true);
    // wrong layer (the v8 infobox defect: stale grid under a new label)
    expect(displayMatchesRequested({ model: 'GFS', layer: 'swell_1', hour: 0 })).toBe(false);
    // wrong model
    expect(displayMatchesRequested({ model: 'EURO', layer: 'waves', hour: 0 })).toBe(false);
    // wrong hour
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 6 })).toBe(false);
    // hour omitted by caller → not part of the comparison
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves' })).toBe(true);
  });

  test('no displayed frame means no parity', () => {
    expect(displayMatchesRequested({ model: 'GFS', layer: 'waves', hour: 0 })).toBe(false);
  });
});

describe('marineTransitionCoordinator — subscribers', () => {
  test('subscribers are notified on begin, end, and markDisplayed', () => {
    const calls = [];
    const unsub = subscribe((target) => calls.push(target ? target.status : 'idle'));
    const g = beginTransition({ model: 'GFS', layer: 'waves' });
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 0 });
    endTransition(g);
    unsub();
    expect(calls).toContain('pending');
    expect(calls).toContain('settled');
  });

  test('a throwing subscriber does not break callers', () => {
    subscribe(() => { throw new Error('boom'); });
    expect(() => beginTransition({ model: 'GFS', layer: 'waves' })).not.toThrow();
  });
});

describe('marineTransitionCoordinator — diagnostics and clear telemetry', () => {
  test('same-target updates keep the generation but refresh hour and viewport diagnostics', () => {
    const gen = beginTransition({ model: 'GFS', layer: 'waves', hour: 0, viewportKey: 'vp-a' });
    const sameGen = beginTransition({ model: 'GFS', layer: 'waves', hour: 6, viewportKey: 'vp-b' });
    expect(sameGen).toBe(gen);
    expect(getTarget()).toMatchObject({ gen, hour: 6, viewportKey: 'vp-b', status: 'pending' });
    expect(window.__MARINE_TRANSITION_STATE__.target).toMatchObject({ model: 'GFS', layer: 'waves', hour: 6, viewportKey: 'vp-b' });
  });

  test('recordClear captures transition and identity context', () => {
    beginTransition({ model: 'EURO', layer: 'swell_1', hour: 12 });
    markDisplayed({ model: 'GFS', layer: 'waves', hour: 9, viewportKey: 'old-vp' });
    const entry = recordClear('component_mismatch');
    expect(entry).toMatchObject({
      reason: 'component_mismatch', gen: 1, transitioning: true,
      displayed: { model: 'GFS', layer: 'waves', hour: 9, viewportKey: 'old-vp' },
      requested: { model: 'EURO', layer: 'swell_1', hour: 12 },
    });
    expect(typeof entry.timestamp).toBe('number');
    expect(window.__MARINE_CLEAR_LOG__).toEqual([entry]);
  });

  test('recordClear retains only the newest 50 entries', () => {
    for (let i = 0; i < 55; i += 1) recordClear(`reason-${i}`);
    expect(window.__MARINE_CLEAR_LOG__).toHaveLength(50);
    expect(window.__MARINE_CLEAR_LOG__[0].reason).toBe('reason-5');
    expect(window.__MARINE_CLEAR_LOG__[49].reason).toBe('reason-54');
  });
});