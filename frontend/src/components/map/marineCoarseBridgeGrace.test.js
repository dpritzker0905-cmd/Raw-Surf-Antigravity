import { resolveCoarseBridgeGrace } from './marineCoarseBridgeGrace';

// COARSE-BRIDGE GRACE (2026-08-15). The coarse-base bridge hides a non-covering regional at mult 0
// and is the ONLY fade-to-zero in this family with no time bound; `Marine Nightly` measured it
// holding 18,836 ms (08-13) and 4,874 ms (08-15), with 2.9-3.3 s of that AFTER the zoom had stopped.
// This grace reveals the regional after a bounded wait, ramped, and NEVER mid-gesture.
// Locks: default-off byte-identity, the grace BOUNDARY (the mutation that matters), the ramp shape,
// the motion veto + ramp reset, episode boundaries, and the two replays from the nightly traces.

const ON = { __RAW_COARSE_BRIDGE_GRACE__: true };
const OFF = {};
const act = { bridgeActive: true, moving: false };

// ★ DRIVE IT AS THE RENDER LOOP DOES — dense frames, state threaded. An earlier version of this file
// drove SPARSE frames (one per second, copying the nightly's SAMPLER cadence rather than the render
// cadence) and 7 of 11 tests failed against correct code. The layer renders at animation rate; a
// test that models the sampler is testing a different system.
const FRAME = 33;
const drive = (win, script) => {
  let state = null;
  let t = 0;
  const seen = [];
  for (const seg of script) {
    for (; t <= seg.until; t += FRAME) {
      const r = resolveCoarseBridgeGrace(state,
        { bridgeActive: seg.bridgeActive !== false, moving: !!seg.moving }, t, win);
      state = r.state;
      seen.push([t, r.mult]);
    }
  }
  const at = (ms) => { const hit = seen.filter(([x]) => x <= ms).pop(); return hit ? hit[1] : null; };
  const visibleMs = seen.filter(([, m]) => m > 0).length * FRAME;
  return { at, state, seen, visibleMs };
};

describe('resolveCoarseBridgeGrace', () => {
  // ★ THE CONTROL, and the reason this can ship dark: with the flag unset the resolver must be
  // indistinguishable from the literal `opacityMultiplier = 0.0` it replaces, at every age.
  it('DEFAULT OFF is byte-identical to the legacy line — 0 and no state, however long it holds', () => {
    for (const t of [0, 1000, 4000, 4001, 20000, 100000]) {
      expect(resolveCoarseBridgeGrace(null, act, t, OFF)).toEqual({ mult: 0, state: null });
    }
    // ...and it never inherits a clock from a previous ON session.
    expect(resolveCoarseBridgeGrace({ t0: 0, rt0: 0 }, act, 9999, OFF)).toEqual({ mult: 0, state: null });
    // The whole 08-13 hold, flag off: never anything but hidden.
    expect(drive(OFF, [{ until: 18836 }]).visibleMs).toBe(0);
  });

  it('drops the clock the moment the bridge stops holding', () => {
    const r = resolveCoarseBridgeGrace({ t0: 0, rt0: 0 }, { bridgeActive: false }, 200, ON);
    expect(r).toEqual({ mult: 0, state: null });
  });

  // ⭐ THE MUTATION THAT MATTERS: delete the `held >= graceMs` test and this pair flips. Asserting
  // the BOUNDARY, not just "eventually visible", is what makes that mutation fail.
  it('the grace BOUNDARY binds — hidden at 3,999 ms, revealing after 4,000', () => {
    const d = drive(ON, [{ until: 6000 }]);
    expect(d.at(3999)).toBe(0);
    expect(d.at(4400)).toBeCloseTo(1.0, 5);
    expect(d.visibleMs).toBeGreaterThan(0);
    expect(d.visibleMs).toBeLessThan(2100);   // only the post-grace tail of a 6 s hold
  });

  it('reveals on a RAMP, not a step — smoothstep through its own midpoint', () => {
    const d = drive(ON, [{ until: 6000 }]);
    const mid = d.at(4026 + 175);             // rt0 is the first eligible frame (t=4026 at 33 ms)
    expect(mid).toBeGreaterThan(0.35);
    expect(mid).toBeLessThan(0.65);
    // monotone non-decreasing across the ramp — no flicker back down
    const ramp = d.seen.filter(([t]) => t >= 4000 && t <= 4500).map(([, m]) => m);
    for (let i = 1; i < ramp.length; i++) expect(ramp[i]).toBeGreaterThanOrEqual(ramp[i - 1]);
  });

  // ⛔ b21cf29d (2026-07-16) was REVERTED because a partial regional painted mid-gesture read as a
  // "motion rectangle". Motion must veto the reveal AND reset the ramp, so it can only ever hide
  // faster — never appear faster.
  it('MOTION VETO: hides for the whole gesture, and the ramp restarts from zero afterwards', () => {
    const d = drive(ON, [{ until: 5000 }, { until: 5600, moving: true }, { until: 7000 }]);
    expect(d.at(5000)).toBeCloseTo(1.0, 5);                       // fully up before the gesture
    for (const [, m] of d.seen.filter(([t]) => t > 5000 && t <= 5600)) expect(m).toBe(0);
    expect(d.at(5650)).toBeLessThan(0.15);                        // restarts from hidden...
    expect(d.at(6050)).toBeCloseTo(1.0, 5);                       // ...and re-ramps over ~350 ms
  });

  it('a frame where the bridge is not holding ENDS the episode — the next one starts at zero', () => {
    // This is why the caller clears the clock every frame: without it, a bridge that dropped out and
    // re-engaged would inherit an armed clock and reveal on its very first frame.
    const d = drive(ON, [{ until: 5000 }, { until: 5033, bridgeActive: false }, { until: 6000 }]);
    expect(d.at(5000)).toBeCloseTo(1.0, 5);
    expect(d.at(5100)).toBe(0);
    expect(d.at(6000)).toBe(0);               // 1 s into the NEW episode: still inside the grace
  });

  // ★ REPLAY: the two measured holds. These are the cases the CI budget actually failed on.
  it('REPLAY 08-15 — 4,874 ms held becomes ~0.5 s of it visible instead of none', () => {
    const d = drive(ON, [{ until: 2008, moving: true }, { until: 4874 }]);
    expect(d.at(3999)).toBe(0);                       // legacy behaviour for the whole grace
    expect(d.at(4874)).toBeCloseTo(1.0, 5);           // ...and visible when the 32x32 grid lands,
    // which also gives applySharpenOpacityEase a visible `from`, so the arriving grid stops taking
    // its FROM-hidden snap path — the -21.2 L SETTLED_STEP the nightly budget failed on.
    expect(d.visibleMs).toBeGreaterThan(400);
  });

  it('REPLAY 08-13 — 18,836 ms held becomes ~14.5 s visible', () => {
    const d = drive(ON, [{ until: 18836 }]);
    expect(d.at(4400)).toBeCloseTo(1.0, 5);
    expect(d.at(18836)).toBeCloseTo(1.0, 5);
    expect(d.visibleMs).toBeGreaterThan(14000);
    expect(d.visibleMs).toBeLessThan(15000);
  });

  it('levers move the threshold, the ramp and the ceiling', () => {
    const W = { ...ON, __RAW_COARSE_BRIDGE_GRACE_MS__: 1000, __RAW_COARSE_BRIDGE_GRACE_RAMP_MS__: 100,
      __RAW_COARSE_BRIDGE_GRACE_CEIL__: 0.5 };
    const d = drive(W, [{ until: 2000 }]);
    expect(d.at(999)).toBe(0);
    expect(d.at(1200)).toBeCloseTo(0.5, 5);   // ceiling honoured, and reached 10x sooner
  });

  it('a ceiling of 0 is a second kill switch — hidden, but the telemetry still says WHY', () => {
    const W = { ...ON, __RAW_COARSE_BRIDGE_GRACE_CEIL__: 0 };
    const d = drive(W, [{ until: 5000 }]);
    expect(d.visibleMs).toBe(0);
    expect(d.state.revealing).toBe(true);
  });
});
