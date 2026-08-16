/**
 * C4-MR-11 — the om:// trace must ACCOUNT FOR EVERY ENTRY, or a reading of it is inadmissible.
 *
 * ⛔ THE READING THIS EXISTS TO PREVENT. The fog row rested on:
 *     z2.99  -> 45 entered, 20 decoded   (cache cleared)
 *     z2.00  -> 24 entered,  0 decoded
 * and "0 decoded" was read as "the tiles were blocked". It is not evidence of that.
 * `TILE_TRUTH.protocolCalls` counts DECODES; the DECODED_TILE_CACHE fast path returns BEFORE it.
 * Zero decodes is exactly what a warm cache produces while serving every tile perfectly — and the
 * z2.99 leg is what warmed it. Nothing recorded at the time could separate the two.
 *
 * ★ The discriminator is reconciliation: entered === blocked + served. A shortfall means some exit
 *   path is uninstrumented, and no conclusion about blanks may be drawn from that trace.
 */
import { traceOmBlock, traceOmServed, reconcileOmTrace } from './omUrlTrace';

const freshTrace = (n) => ({ n, blocked: {}, served: {} });

describe('reconcileOmTrace — arrivals must equal departures', () => {
  it('balances when every entry is accounted for', () => {
    const t = freshTrace(10);
    t.blocked = { model_lock: 4 };
    t.served = { cache_hit: 5, decode: 1 };
    expect(reconcileOmTrace(t)).toEqual({ ok: true, entered: 10, blocked: 4, served: 6, unaccounted: 0 });
  });

  it('REFUSES when an exit path is uninstrumented (the shortfall is visible, not silent)', () => {
    const t = freshTrace(24);
    t.blocked = {};
    t.served = {};                       // exactly the fog reading: 24 in, nothing accounted for
    const r = reconcileOmTrace(t);
    expect(r.ok).toBe(false);
    expect(r.unaccounted).toBe(24);      // "0 decoded" alone could never have said this
  });

  it('THE FOG READING, replayed: 0 decodes is NOT evidence of a block when the cache served', () => {
    // Same 24 entries, now with the cache-hit route recorded. Fully accounted for, zero decodes,
    // and no defect — which is precisely the ambiguity the original measurement could not resolve.
    const t = freshTrace(24);
    t.served = { cache_hit: 24, decode: 0 };
    const r = reconcileOmTrace(t);
    expect(r.ok).toBe(true);
    expect(r.served).toBe(24);
    expect((t.served.decode || 0)).toBe(0);   // zero decodes AND nothing wrong
  });

  it('a genuine block is now distinguishable from a cache serve', () => {
    const blocked = freshTrace(24); blocked.blocked = { model_lock: 24 };
    const served = freshTrace(24); served.served = { cache_hit: 24 };
    expect(reconcileOmTrace(blocked)).toMatchObject({ ok: true, blocked: 24, served: 0 });
    expect(reconcileOmTrace(served)).toMatchObject({ ok: true, blocked: 0, served: 24 });
    // The two readings are now different objects. Before this change both showed "0 decoded".
    expect(reconcileOmTrace(blocked)).not.toEqual(reconcileOmTrace(served));
  });

  it('missing trace refuses rather than reporting a tidy zero', () => {
    expect(reconcileOmTrace(null)).toEqual({ ok: false, reason: 'no_trace' });
  });
});

describe('traceOmServed / traceOmBlock — recorders are safe and additive', () => {
  // jsdom's `window` is not reassignable, and the module reads the real global at call time — so
  // drive it through the actual global rather than swapping the object out from under it.
  afterEach(() => { delete window.__OM_URL_TRACE__; });

  it('records routes and reasons onto the live trace object', () => {
    window.__OM_URL_TRACE__ = { n: 3 };
    traceOmServed('cache_hit'); traceOmServed('cache_hit'); traceOmBlock('model_lock', 'gfs|ecmwf');
    const t = window.__OM_URL_TRACE__;
    expect(t.served).toEqual({ cache_hit: 2 });
    expect(t.blocked).toEqual({ model_lock: 1 });
    expect(reconcileOmTrace(t)).toMatchObject({ ok: true, entered: 3, served: 2, blocked: 1 });
  });

  it('never throws when the trace is absent — an instrument must not break the protocol', () => {
    expect(window.__OM_URL_TRACE__).toBeUndefined();       // no trace installed
    expect(() => { traceOmServed('cache_hit'); traceOmBlock('x'); }).not.toThrow();
    expect(traceOmServed('cache_hit')).toBeUndefined();    // foldable into `a() || fallback()`
  });
});

// ⛔ THE CALL SITES, PINNED. My first draft of this file tested the RECONCILER and nothing else, and
// the mutation run proved it hollow: deleting `traceOmServed('cache_hit')` from openMeteoProtocol.js
// left all 14 tests GREEN. An instrument whose call site can vanish silently is the exact blind spot
// this row exists to close — one level up from the one it started with.
describe('the protocol actually CALLS the recorder (instrument cannot lose its call site)', () => {
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'openMeteoProtocol.js'), 'utf8');

  it('imports traceOmServed', () => {
    expect(src).toMatch(/import\s*\{[^}]*traceOmServed[^}]*\}\s*from\s*'\.\/omUrlTrace'/);
  });

  it('records the CACHE_HIT route — the exit that made "0 decoded" ambiguous', () => {
    expect(src).toContain("traceOmServed('cache_hit')");
  });

  it('records the DECODE route, so entered = blocked + served can balance', () => {
    expect(src).toContain("traceOmServed('decode')");
  });

  it('every traceOmBlock reason is still instrumented (no exit silently un-named)', () => {
    for (const reason of ['missing_run', 'transparent_sentinel', 'model_lock']) {
      expect(src).toContain(`traceOmBlock('${reason}'`);
    }
  });
});
