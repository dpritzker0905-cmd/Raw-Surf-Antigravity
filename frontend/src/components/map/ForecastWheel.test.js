import {
  shouldUseClassicScrubber,
  clampWheelVelocity,
  wheelSettleTarget,
  wheelPitchPx,
  WHEEL_MAX_VEL_HPS,
  wheelReleaseVelocity,
  wheelDragCommitDue,
  WHEEL_DRAG_COMMIT_MS,
} from './ForecastWheel';

// The Forecast Wheel's pure decision helpers (user-approved prototype d50c0923). The gesture/
// canvas surface is judged live; these pin the contracts the churn math and the kill switch
// depend on.

describe('ForecastWheel — pure helpers', () => {
  it('kill switch: __RAW_CLASSIC_SCRUBBER__ restores the classic slider', () => {
    expect(shouldUseClassicScrubber({})).toBe(false);
    expect(shouldUseClassicScrubber({ __RAW_CLASSIC_SCRUBBER__: true })).toBe(true);
    expect(shouldUseClassicScrubber({ __RAW_CLASSIC_SCRUBBER__: 'yes' })).toBe(false); // strict
  });

  it('velocity caps at ±6 hours/sec by default (a flick can never skip a day unseen)', () => {
    expect(clampWheelVelocity(40, {})).toBe(WHEEL_MAX_VEL_HPS);
    expect(clampWheelVelocity(-40, {})).toBe(-WHEEL_MAX_VEL_HPS);
    expect(clampWheelVelocity(3.2, {})).toBe(3.2);
  });

  it('velocity cap is a live lever (__RAW_WHEEL_MAX_HPS__)', () => {
    expect(clampWheelVelocity(40, { __RAW_WHEEL_MAX_HPS__: 12 })).toBe(12);
    expect(clampWheelVelocity(-40, { __RAW_WHEEL_MAX_HPS__: 12 })).toBe(-12);
    expect(clampWheelVelocity(40, { __RAW_WHEEL_MAX_HPS__: 0 })).toBe(WHEEL_MAX_VEL_HPS); // 0 = invalid, default
  });

  // ── THE FOSSIL VELOCITY (2026-08-02) ────────────────────────────────────────────────────────
  // `s.vel` is written ONLY in onPointerMove, so a finger that stops moving leaves it frozen at the
  // last motion sample. onPointerUp branched on that with no elapsed check: park on the hour you
  // want, pause to read it, release — and the wheel coasts off a velocity from before the pause.
  // These pin the DECISION, which is why it was extracted as a pure helper rather than left inline.
  const FLICK = 6;          // the velocity cap, WHEEL_MAX_VEL_HPS
  const COAST_GATE = 1.2;   // onPointerUp's threshold

  it('a genuine flick still coasts — the finger leaves in well under 100 ms', () => {
    expect(wheelReleaseVelocity(FLICK, 50, {})).toBeGreaterThan(COAST_GATE);
    expect(wheelReleaseVelocity(FLICK, 100, {})).toBeGreaterThan(COAST_GATE);
  });

  it('THE DEFECT: a one-second pause can no longer throw the wheel', () => {
    expect(wheelReleaseVelocity(FLICK, 1000, {})).toBeLessThan(COAST_GATE);
    expect(wheelReleaseVelocity(FLICK, 2000, {})).toBeLessThan(COAST_GATE);
    // KNOWN-FAILING CONTROL — without it these assertions are satisfied by a function that always
    // returns 0. The SAME pause, undecayed, is exactly what shipped and is far over the gate.
    expect(Math.abs(FLICK)).toBeGreaterThan(COAST_GATE);
  });

  it('decays continuously — no cliff for a gesture to sit on', () => {
    const v = [0, 50, 100, 200, 300, 500, 1000, 2000].map((ms) => wheelReleaseVelocity(FLICK, ms, {}));
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThan(v[i - 1]);   // strictly monotone
    expect(v[0]).toBe(FLICK);                                                 // zero elapsed changes nothing
  });

  it('reuses coast()\'s own friction, so the decay is not a second constant to calibrate', () => {
    const FRICTION_PER_SEC = 0.06;
    expect(wheelReleaseVelocity(FLICK, 1000, {})).toBeCloseTo(FLICK * FRICTION_PER_SEC, 6);
    expect(wheelReleaseVelocity(FLICK, 500, {})).toBeCloseTo(FLICK * Math.pow(FRICTION_PER_SEC, 0.5), 6);
  });

  it('preserves sign, and refuses to invent a reading it does not have', () => {
    expect(wheelReleaseVelocity(-FLICK, 1000, {})).toBeCloseTo(-FLICK * 0.06, 6);
    for (const bad of [undefined, null, NaN, -5, 0]) {
      expect(wheelReleaseVelocity(FLICK, bad, {})).toBe(FLICK);   // unusable elapsed -> unchanged
    }
    expect(wheelReleaseVelocity(undefined, 1000, {})).toBe(0);
  });

  it('kill switch: __RAW_DISABLE_WHEEL_RELEASE_DECAY__ restores the fossil velocity', () => {
    expect(wheelReleaseVelocity(FLICK, 5000, { __RAW_DISABLE_WHEEL_RELEASE_DECAY__: true })).toBe(FLICK);
    // opt-OUT: only the literal true disables it, matching the file's other switches
    expect(wheelReleaseVelocity(FLICK, 5000, { __RAW_DISABLE_WHEEL_RELEASE_DECAY__: 'yes' })).toBeLessThan(COAST_GATE);
  });

  // ⚠️ THE PURE TESTS ABOVE DO NOT GUARD THE WIRING, and a mutation battery proved it: deleting
  // `s.vel = wheelReleaseVelocity(...)` from onPointerUp, or passing `s.lastX` (a pixel) where
  // `s.lastT` (a timestamp) belongs, left all of them GREEN. A correct helper nobody calls is this
  // repo's most-recorded defect, so the call site gets its own assertion.
  //
  // This reads SOURCE, and the limit is stated rather than hidden: it can prove the call EXISTS with
  // the right argument, never that the value it returns wins at runtime. It closes deletion and
  // wrong-argument, which are the two mutations that escaped. The self-check below is what makes it
  // more than decoration — the same regexes are run against a MUTATED COPY and must fail.
  it('the release decay is WIRED into onPointerUp, with the elapsed-time field', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'ForecastWheel.js'), 'utf8');
    const CALLED = /s\.vel\s*=\s*wheelReleaseVelocity\(/;
    const USES_LAST_T = /wheelReleaseVelocity\(\s*s\.vel\s*,\s*performance\.now\(\)\s*-\s*s\.lastT\s*\)/;
    expect(CALLED.test(src)).toBe(true);
    expect(USES_LAST_T.test(src)).toBe(true);

    // NEGATIVE CONTROLS — the exact two mutations that escaped the pure tests must fail HERE.
    const deleted = src.replace(/s\.vel = wheelReleaseVelocity\([^\n]*\n/, '');
    expect(deleted).not.toBe(src);                 // assert the mutation landed
    expect(CALLED.test(deleted)).toBe(false);

    const wrongField = src.replace('performance.now() - s.lastT', 'performance.now() - s.lastX');
    expect(wrongField).not.toBe(src);              // assert the mutation landed
    expect(USES_LAST_T.test(wrongField)).toBe(false);
  });

  // ── DETENT COMMITS DURING THE DRAG (2026-08-02) ─────────────────────────────────────────────
  // The forecast path committed NOTHING during a drag; the map held the hour the gesture started on
  // and first moved 200 ms (settle) to ~1.1 s (coast) AFTER release. Radar already commits per
  // detent. This throttles the forecast path to the SAME 11 Hz the old slider used, because
  // `onCommit` runs `onTimeChange` — the render-driving prop `cb074b8b`/`5355e65e` fought.
  it('a drag commits once the throttle window has elapsed, and not before', () => {
    expect(wheelDragCommitDue(1000, null, {})).toBe(true);        // first crossing of the drag
    expect(wheelDragCommitDue(1000, 1000, {})).toBe(false);       // same instant
    expect(wheelDragCommitDue(1089, 1000, {})).toBe(false);       // 89 ms — inside the window
    expect(wheelDragCommitDue(1090, 1000, {})).toBe(true);        // 90 ms — due
    expect(wheelDragCommitDue(5000, 1000, {})).toBe(true);
  });

  it('is bounded at 11 Hz — the rate cb074b8b measured as safe, not a new number', () => {
    expect(WHEEL_DRAG_COMMIT_MS).toBe(90);
    expect(1000 / WHEEL_DRAG_COMMIT_MS).toBeCloseTo(11.1, 1);
  });

  it('revives the dead __RAW_SCRUB_COMMIT_THROTTLE_MS__ lever instead of adding a second knob', () => {
    // That lever currently reaches only the classic <input> scrubber, behind __RAW_CLASSIC_SCRUBBER__.
    expect(wheelDragCommitDue(1040, 1000, { __RAW_SCRUB_COMMIT_THROTTLE_MS__: 30 })).toBe(true);
    expect(wheelDragCommitDue(1020, 1000, { __RAW_SCRUB_COMMIT_THROTTLE_MS__: 30 })).toBe(false);
    expect(wheelDragCommitDue(1001, 1000, { __RAW_SCRUB_COMMIT_THROTTLE_MS__: 0 })).toBe(true);  // 0 = per-frame
    // a non-number must NOT silently disable the throttle — it falls back to the default
    expect(wheelDragCommitDue(1050, 1000, { __RAW_SCRUB_COMMIT_THROTTLE_MS__: 'fast' })).toBe(false);
    expect(wheelDragCommitDue(1050, 1000, { __RAW_SCRUB_COMMIT_THROTTLE_MS__: -5 })).toBe(false);
  });

  it('kill switch: __RAW_DISABLE_WHEEL_DRAG_COMMIT__ restores commit-nothing-during-drag', () => {
    expect(wheelDragCommitDue(9999, null, { __RAW_DISABLE_WHEEL_DRAG_COMMIT__: true })).toBe(false);
    // opt-OUT: only the literal true, matching every other switch in this file
    expect(wheelDragCommitDue(9999, null, { __RAW_DISABLE_WHEEL_DRAG_COMMIT__: 'yes' })).toBe(true);
  });

  it('refuses to invent a decision without a clock reading', () => {
    expect(wheelDragCommitDue(NaN, 1000, {})).toBe(false);
    expect(wheelDragCommitDue(undefined, 1000, {})).toBe(false);
  });

  it('the drag commit is WIRED into onPointerMove, non-radar only, and reset per gesture', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, 'ForecastWheel.js'), 'utf8');
    const WIRED = /else if \(wheelDragCommitDue\(t, s\.lastDragCommitT\)\)/;
    const RADAR_FIRST = /if \(isRadar\) commit\(after\);/;
    const RESET = /s\.lastDragCommitT = null;/;
    expect(WIRED.test(src)).toBe(true);
    expect(RADAR_FIRST.test(src)).toBe(true);   // radar keeps its full-rate contract, untouched
    expect(RESET.test(src)).toBe(true);         // a new gesture must not inherit the previous stamp

    // NEGATIVE CONTROLS — each mutation the pure tests above cannot see must fail HERE.
    const unwired = src.replace(WIRED, 'else if (true)');
    expect(unwired).not.toBe(src);
    expect(WIRED.test(unwired)).toBe(false);
    const noReset = src.replace(/s\.lastDragCommitT = null;/, '');
    expect(noReset).not.toBe(src);
    expect(RESET.test(noReset)).toBe(false);
  });

  it('settle target snaps to the nearest detent INSIDE the track', () => {
    expect(wheelSettleTarget(3.4, 336)).toBe(3);
    expect(wheelSettleTarget(3.6, 336)).toBe(4);
    expect(wheelSettleTarget(-2.3, 336)).toBe(0);      // never before Now
    expect(wheelSettleTarget(999, 336)).toBe(336);     // never past the horizon
  });

  it('radar frames get a wider pitch than forecast hours (few frames stay readable)', () => {
    expect(wheelPitchPx(true, 12)).toBeGreaterThan(wheelPitchPx(false, 336));
  });
});
