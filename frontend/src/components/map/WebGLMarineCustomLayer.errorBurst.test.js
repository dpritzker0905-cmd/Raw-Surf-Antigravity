import fs from 'fs';
import path from 'path';
import { shouldResetErrorBurst } from './WebGLMarineCustomLayer';

// MARINE RENDER ERROR BURST (2026-07-31).
//
// WHY THIS EXISTS: a throw inside engine.render() is not a crash — it is a hidden OFF SWITCH.
// createCustomLayer catches it, increments errorCount, and at 3 calls onErrorRef() which disables
// the GPU marine layer; `errorCount > 3` then early-returns forever. Until this change marine had
// NO decay (wind has had one since v3.15), so the counter was a LIFETIME total: three unrelated
// transient throws, hours apart, permanently killed the layer with only a console.warn. The
// user-visible symptom is "the heatmap vanished and never came back".
//
// The counter must therefore measure a BURST, not a lifetime.

describe('shouldResetErrorBurst — the counter measures a burst, not a lifetime', () => {
  const WINDOW = 10000;

  it('does NOT reset while errors keep arriving inside the window (a real broken frame loop still trips)', () => {
    expect(shouldResetErrorBurst(1, 1000, 1000 + 500)).toBe(false);
    expect(shouldResetErrorBurst(2, 1000, 1000 + WINDOW - 1)).toBe(false);
  });

  it('RESETS once a full quiet window has passed — this is the regression that mattered', () => {
    expect(shouldResetErrorBurst(1, 1000, 1000 + WINDOW + 1)).toBe(true);
    expect(shouldResetErrorBurst(3, 0, 3600_000)).toBe(true);   // an hour later
  });

  it('is a no-op when the counter is already clean (never resets what is not set)', () => {
    expect(shouldResetErrorBurst(0, 0, 10 ** 9)).toBe(false);
  });

  it('is exclusive at the boundary — exactly windowMs is NOT yet a reset', () => {
    expect(shouldResetErrorBurst(1, 1000, 1000 + WINDOW)).toBe(false);
    expect(shouldResetErrorBurst(1, 1000, 1000 + WINDOW + 1)).toBe(true);
  });

  it('honours a custom window', () => {
    expect(shouldResetErrorBurst(1, 0, 500, 1000)).toBe(false);
    expect(shouldResetErrorBurst(1, 0, 1500, 1000)).toBe(true);
  });

  // THE SCENARIO IN ONE TEST: three isolated throws spread across a session. Under the OLD
  // never-reset behaviour the count reaches 3 and the layer dies. With decay each one stands alone.
  it('three isolated throws an hour apart never accumulate to the disable threshold', () => {
    let count = 0;
    let last = 0;
    const LIMIT = 3;
    for (const t of [0, 3600_000, 7200_000]) {
      if (shouldResetErrorBurst(count, last, t)) count = 0;
      count += 1;                 // the throw
      last = t;
      expect(count).toBeLessThan(LIMIT);   // never reaches the disable threshold
    }
    expect(count).toBe(1);
  });

  // CALL-SITE GUARD — a pure predicate is worthless if nobody calls it. A unit test cannot catch
  // deletion of the call site, so assert the wiring in source: the reset must be invoked, and the
  // catch block must stamp lastErrorTime (without the stamp the window never advances and the
  // counter silently becomes a lifetime total again).
  it('createCustomLayer actually wires the predicate AND stamps lastErrorTime on catch', () => {
    const src = fs.readFileSync(path.join(__dirname, 'WebGLMarineCustomLayer.js'), 'utf8');
    expect(src).toMatch(/if \(shouldResetErrorBurst\(errorCount, lastErrorTime, Date\.now\(\)\)\) \{\s*\r?\n\s*errorCount = 0;/);
    expect(src).toMatch(/errorCount\+\+;\s*\r?\n\s*lastErrorTime = Date\.now\(\);/);
  });
});
