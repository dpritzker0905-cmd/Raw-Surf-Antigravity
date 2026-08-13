/**
 * WS-CAN-0063 — the CLIENT half of the fps fabrication.
 *
 * ⛔ WHY A SOURCE GUARD AND NOT A RENDER TEST. The payload is built inside a `useEffect` deep in
 * TruthOverlay, which has no test harness and would need map/theme context to mount. More to the
 * point, the SERVER-side guard (backend/tests/test_measure_or_refuse_last_two_surfaces.py) cannot
 * protect this half: reintroduce `|| 60` here and the backend would faithfully log the 60 it was
 * handed, with every backend test still green. The two halves need two guards.
 *
 * THE DEFECT: `fps: window.__WEATHER_TELEMETRY__?.gpuStats?.fps || 60`. gpuStats.fps is
 * `Math.round(frames * 1000 / elapsed)` — 0 when the render is FROZEN — and `0 || 60` is 60. So a
 * frozen render, an absent telemetry module and a healthy 60 all left the device as the same
 * number, on the only client→server transport in the system.
 *
 * ⚠️ Project landmine: `"x" in src` is never a real needle. This asserts a POSITIVE CONTROL first
 * — that the payload line still exists — so a rename makes the guard RED rather than vacuous.
 */
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, 'TruthOverlay.js'), 'utf8');

// The payload key as it is actually written, ignoring surrounding whitespace.
const FPS_PAYLOAD_LINE = /^\s*fps:\s*(.+?),\s*$/m;

describe('TruthOverlay fps payload — measure or refuse (WS-CAN-0063)', () => {
  test('POSITIVE CONTROL: the fps payload line still exists', () => {
    // Without this, every assertion below passes vacuously the day the key is renamed or removed.
    expect(SRC).toMatch(FPS_PAYLOAD_LINE);
  });

  test('a measured 0 must survive — no numeric `||` default on the fps payload', () => {
    const line = SRC.match(FPS_PAYLOAD_LINE)[1];
    // `|| <number>` is the exact defect: it replaces a measured 0 with a fabricated reading.
    expect(line).not.toMatch(/\|\|\s*\d/);
  });

  test('unmeasured is sent as null, via `??` rather than `||`', () => {
    const line = SRC.match(FPS_PAYLOAD_LINE)[1];
    expect(line).toMatch(/\?\?/);
    expect(line).toMatch(/null/);
  });

  test('the literal 60 is gone from the fps payload', () => {
    const line = SRC.match(FPS_PAYLOAD_LINE)[1];
    expect(line).not.toMatch(/\b60\b/);
  });
});
