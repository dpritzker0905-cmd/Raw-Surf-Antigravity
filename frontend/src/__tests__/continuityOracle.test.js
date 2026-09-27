/**
 * continuityOracle — verifying the instrument before pointing it at the defect.
 *
 * The marine render-continuity E2E gate decides whether a months-old defect class is present. Its
 * verdict comes entirely from `longestStall`. ⭐⭐ AN ORACLE MUST BE VERIFIED AGAINST A KNOWN
 * ANSWER BEFORE IT IS POINTED AT AN UNKNOWN ONE — if it reported gaps for a healthy series it would
 * send the next session chasing a phantom, and if it reported none for a broken one it would
 * certify the exact bug it exists to catch.
 *
 * This is deliberately a Jest test rather than a Playwright one: it needs no browser, so it runs on
 * every push in the fast lane, and the E2E lane is left to do the thing only it can do.
 */
const { longestStall, stallAnatomy, EVENT_LEAD_MS } = require('../../e2e/continuityOracle');

const s = (at, n, label = null) => ({ at, n, label });

describe('continuityOracle.longestStall', () => {
  describe('the healthy case', () => {
    it('reports NO gap when the counter advances every sample', () => {
      // THE CONTROL THAT MATTERS MOST. A detector that flagged this would make the gate useless.
      const samples = [s(0, 1), s(100, 2), s(200, 3), s(300, 4)];
      expect(longestStall(samples).ms).toBe(0);
    });

    it('a single repeated reading is exactly ONE poll interval, far under budget', () => {
      // A proven 100 ms no-draw window. It is real and it is reported — but at a 1200 ms budget it
      // is nowhere near a failure, which is the point: the oracle stays honest at small scales
      // instead of rounding real stalls down to zero.
      expect(longestStall([s(0, 1), s(100, 1), s(200, 2), s(300, 3)]).ms).toBe(100);
    });
  });

  describe('the defect case', () => {
    it('measures a stall from its START, not from the previous advance', () => {
      // n=1 is first seen at t=0 and last seen at t=400 -> a proven 400 ms no-draw window.
      const samples = [s(0, 1), s(100, 1), s(200, 1), s(300, 1), s(400, 1), s(500, 2)];
      expect(longestStall(samples).ms).toBe(400);
    });

    it('reports the LONGEST stall when there are several', () => {
      const samples = [
        s(0, 1), s(100, 1), s(200, 2),           // 100 ms stall
        s(300, 2), s(400, 2), s(500, 2), s(600, 3),  // 300 ms stall
      ];
      expect(longestStall(samples).ms).toBe(300);
    });

    it('names the gesture the stall STARTED under — the whole point of the label', () => {
      const samples = [
        s(0, 5, 'toggle:Waves'),
        s(100, 6, 'toggle:Wind Waves'),
        s(200, 6, 'toggle:Wind Waves'),
        s(300, 6, 'zoom-and-pan'),
        s(400, 7, 'zoom-and-pan'),
      ];
      const worst = longestStall(samples);
      expect(worst.ms).toBe(200);
      expect(worst.label).toBe('toggle:Wind Waves');
      expect(worst.from).toBe(6);
    });
  });

  describe('"never drew" must never masquerade as "stopped drawing"', () => {
    it('a null counter is not a gap', () => {
      // ⚠️ THE INVERSION BEING GUARDED. `n === null` means the engine has not drawn at all — a
      // precondition failure the caller checks separately. Counting it as a stall would report "a
      // 400 ms animation gap" when the real story is "the marine engine never started", pointing
      // the next session at entirely the wrong subsystem.
      const samples = [s(0, null), s(100, null), s(200, null), s(300, null), s(400, null)];
      expect(longestStall(samples).ms).toBe(0);
    });

    it('a null run does not bridge two real readings into one long stall', () => {
      const samples = [s(0, 3), s(100, null), s(200, null), s(300, 3), s(400, 4)];
      expect(longestStall(samples).ms).toBe(0);
    });

    it('a stall AFTER the engine starts is still caught', () => {
      // The control for the two above: suppressing nulls must not suppress real stalls.
      const samples = [s(0, null), s(100, 1), s(200, 1), s(300, 1), s(400, 2)];
      expect(longestStall(samples).ms).toBe(200);
    });
  });

  describe('degenerate input', () => {
    it.each([[[]], [[s(0, 1)]]])('returns a zero verdict rather than throwing (%#)', (samples) => {
      const worst = longestStall(samples);
      expect(worst.ms).toBe(0);
      expect(worst.label).toBeNull();
    });

    it('tolerates an undefined counter exactly as it tolerates null', () => {
      expect(longestStall([s(0, undefined), s(100, undefined)]).ms).toBe(0);
    });
  });

  it('uses real timestamps, not sample counts — an irregular poll is measured honestly', () => {
    // The in-page sampler uses setInterval, which drifts under load; the map is exactly the kind
    // of page that stalls a timer. A count-based oracle would UNDER-report a gap during the very
    // contention that causes it.
    const samples = [s(0, 1), s(50, 1), s(1500, 1), s(1600, 2)];
    expect(longestStall(samples).ms).toBe(1500);
  });
});

describe('continuityOracle.stallAnatomy — what happened inside the worst stall (2026-09-26)', () => {
  // A sample carrying the layer stamp: layerN advances per render() call, skip names the exit.
  const L = (at, n, layerN, skip = null, label = null) => ({ at, n, layerN, skip, label });

  it('brackets the stall with its sample times', () => {
    const w = longestStall([s(0, 1), s(100, 2), s(200, 2), s(900, 2), s(1000, 3)]);
    expect([w.start, w.end, w.ms]).toEqual([100, 900, 800]);
  });

  it('called but not drawing: the layer kept being called and names its exit', () => {
    const samples = [L(0, 5, 10), L(100, 6, 11), L(200, 6, 14, 'engine_no_data'),
      L(300, 6, 17, 'engine_no_data'), L(400, 6, 20, 'inactive_held'), L(500, 7, 23)];
    const a = stallAnatomy(samples, longestStall(samples));
    expect(a).toEqual({ layerCalls: 9, skips: { drew: 1, engine_no_data: 2, inactive_held: 1 },
      maxSampleGapMs: 100 });
  });

  it('not called at all: nothing was driving frames', () => {
    const samples = [L(0, 5, 10), L(100, 6, 11), L(200, 6, 11), L(300, 6, 11), L(400, 7, 12)];
    expect(stallAnatomy(samples, longestStall(samples)).layerCalls).toBe(0);
  });

  it('a main-thread block shows as a hole far above the 100 ms poll', () => {
    const samples = [L(0, 5, 10), L(100, 6, 11), L(900, 6, 11), L(1000, 6, 12), L(1100, 7, 13)];
    expect(stallAnatomy(samples, longestStall(samples)).maxSampleGapMs).toBe(800);
  });

  it('an old series without the stamp reads as unknown, never as "not called"', () => {
    const samples = [s(0, 1), s(100, 2), s(200, 2), s(300, 2), s(400, 3)];
    expect(stallAnatomy(samples, longestStall(samples))).toEqual({ layerCalls: null, skips: {}, maxSampleGapMs: 100 });
  });

  it('no stall, no anatomy', () => {
    const samples = [s(0, 1), s(100, 2), s(200, 3)];
    expect(stallAnatomy(samples, longestStall(samples))).toBeNull();
  });
});

describe('continuityOracle.stallAnatomy events — which clear or switch preceded the stall', () => {
  const L = (at, n, layerN, skip = null) => ({ at, n, layerN, skip, label: 'burst' });
  const samples = [L(10000, 5, 1), L(10100, 6, 2), L(10200, 6, 3, 'engine_no_data'),
    L(15000, 6, 40, 'engine_no_data'), L(15100, 7, 41)];
  const worst = longestStall(samples);

  it('lists the clears and churn inside the lead window, timed from the stall start', () => {
    const logs = {
      clears: [{ reason: 'non_renderable_terminal', timestamp: 10050 },
        { reason: 'too_early', timestamp: 10100 - EVENT_LEAD_MS - 1 },
        { reason: 'after', timestamp: 20000 }],
      churn: [{ kind: 'abort', t: 9000 }, { kind: 'recovery_grid_commit', t: 14950 }],
    };
    expect(stallAnatomy(samples, worst, logs).events).toEqual([
      { type: 'churn', what: 'abort', dtMs: -1100 },
      { type: 'clear', what: 'non_renderable_terminal', dtMs: -50 },
      { type: 'churn', what: 'recovery_grid_commit', dtMs: 4850 },
    ]);
  });

  it('omits events entirely when no logs are passed (an older caller)', () => {
    expect(stallAnatomy(samples, worst)).not.toHaveProperty('events');
  });

  it('tolerates empty or malformed logs', () => {
    expect(stallAnatomy(samples, worst, {}).events).toEqual([]);
    expect(stallAnatomy(samples, worst, { clears: [{ reason: 'x' }], churn: [{ kind: 'y' }] }).events).toEqual([]);
  });
});

it('churn events carry the fallback cause and the render error message', () => {
  const L = (at, n, layerN) => ({ at, n, layerN, skip: null, label: 'burst' });
  const samples = [L(0, 5, 1), L(100, 6, 2), L(200, 6, 2), L(900, 6, 2), L(1000, 7, 3)];
  const logs = { churn: [
    { kind: 'marine_render_error', t: 90, message: 'texImage2D: size mismatch' },
    { kind: 'marine_webgl_fallback', t: 95, cause: 'render_error_burst' },
    { kind: 'engine_dispose', t: 99 },
  ] };
  expect(stallAnatomy(samples, longestStall(samples), logs).events).toEqual([
    { type: 'churn', what: 'marine_render_error', dtMs: -10, message: 'texImage2D: size mismatch' },
    { type: 'churn', what: 'marine_webgl_fallback', dtMs: -5, cause: 'render_error_burst' },
    { type: 'churn', what: 'engine_dispose', dtMs: -1 },
  ]);
});
