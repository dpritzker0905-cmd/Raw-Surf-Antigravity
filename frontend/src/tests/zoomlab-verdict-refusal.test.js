/**
 * INSTRUMENT vs RENDER in the zoomlab verdict (2026-08-09).
 *
 * The Marine Nightly was red on most days since 08-03 and nobody read it. Cause: every console
 * error became a finding against a "≤2 findings total" budget, so ten failed fetches to the prod
 * backend = 20 findings = red, whatever the renderer did. Control pair, SAME COMMIT 3cf5a1ce,
 * 13 minutes apart (real retained artifacts, both replayed while building this):
 *   07:34Z scheduled  REFUSE  20 transport errors, 10 render findings (9 MULT0_FRAME + 1 SETTLED_STEP)
 *   07:47Z dispatch   PASS     0 transport errors,  0 render findings, 415 anim frames
 * The renderer did not change in 13 minutes — the backend woke up. MULT0_FRAME is by definition a
 * frame drawn with no data, so grading it during a transport failure grades the renderer on a sea
 * that was never delivered.
 *
 * ⛔ The refusal must never launder a REAL defect: a JS error is not transport, and render findings
 * with a working network still fail.
 */
const { analyzeTrace } = require('../../scripts/zoomlab-verdict');

const mult0Frames = [
  { t: 0, z: 6.5, L: 100, mult: 1 },
  { t: 500, z: 6.5, L: 100, mult: 0 },
];

describe('zoomlab verdict: instrument findings do not page as rendering defects', () => {
  it('refuses to grade when the data under test never arrived', () => {
    const v = analyzeTrace({
      frames: mult0Frames,
      consoleErrors: ['Failed to load resource: net::ERR_FAILED'],
    });
    expect(v.verdict).toBe('REFUSE');
    expect(v.observable).toBe(false);
    // reported, never hidden — the operator still sees what the session saw
    expect(v.renderFindings.map((f) => f.type)).toEqual(['MULT0_FRAME']);
    expect(v.instrumentFindings).toHaveLength(1);
  });

  it('the same render findings FAIL when the network was fine', () => {
    const v = analyzeTrace({ frames: mult0Frames, consoleErrors: [] });
    expect(v.verdict).toBe('FAIL');
    expect(v.observable).toBe(true);
  });

  it('a clean trace passes', () => {
    expect(analyzeTrace({ frames: [{ t: 0, z: 6.5, L: 100, mult: 1 }] }).verdict).toBe('PASS');
  });

  it('⛔ a genuine JS error is NOT laundered into a refusal', () => {
    const v = analyzeTrace({
      frames: [{ t: 0, z: 6.5, L: 100, mult: 1 }],
      consoleErrors: ["TypeError: Cannot read properties of undefined (reading 'wave')"],
    });
    expect(v.verdict).toBe('FAIL');
    expect(v.observable).toBe(true);
    expect(v.renderFindings).toHaveLength(1);
  });

  it('classifies every transport shape the real incident produced', () => {
    // ★ REGRESSION PIN, verbatim from run 31301456177's retained trace. The first regex matched
    // only "Access to fetch" and "NetworkError" and misclassified the last two as rendering
    // defects — found by replaying the real artefact, which a synthetic fixture would not have.
    const real = [
      "Access to fetch at 'https://raw-surf-antigravity.onrender.com/api/weather/grid_series?model=GFS'",
      'Failed to load resource: net::ERR_FAILED',
      "Access to XMLHttpRequest at 'https://raw-surf-antigravity.onrender.com/api/dispatch/user/x/active' from origin",
      '[apiClient] Network error: Network Error',
    ];
    const v = analyzeTrace({ frames: [{ t: 0, z: 6.5, L: 100, mult: 1 }], consoleErrors: real });
    expect(v.instrumentFindings).toHaveLength(real.length);
    expect(v.renderFindings).toHaveLength(0);
    expect(v.transportErrors).toBe(real.length);
  });
});
