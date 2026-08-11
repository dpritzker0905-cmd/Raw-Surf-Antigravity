/**
 * T-1 item 3b — surface grid COARSENESS in the legend (the user-facing surface).
 *
 * WHY THIS IS THE PIECE THAT WAS LEFT. Items 1 and 2 of Mission T-1 shipped in `516a7200`: the
 * `Class` row is now seven-valued (NO DATA / UNVERIFIED SOURCE / ESTIMATED FALLBACK / SUBSTITUTED
 * SOURCE / RESOLUTION UNKNOWN / COARSE n° GRID / AUTHORITATIVE NATIVE) and the parity gate is
 * four-valued (MATCH / MISMATCH / UNSAMPLED / NOT_APPLICABLE). Both are correct and both were
 * verified before this file was written.
 *
 * But every one of those surfaces lives in `TruthOverlay`, which is gated behind `?diag=1`.
 * **A surfer never sees it.** The legend is the surface that is always on screen, and it currently
 * says nothing about how coarse the grid under the colours actually is.
 *
 * MEASURED against production (2026-08-11), via `deriveResolutionDeg(bounds, cols, rows)`:
 *   regional tile   25x29 over 6° x 7°     ->  0.25°/cell   ~28 km   (native, say nothing)
 *   global coarse   25x12 over 360° x 170° -> 15.455°/cell  ~1,700 km (say something)
 *
 * ⚠️ AND THE PACKET'S PREMISE IS INVERTED, which is why this file exists rather than a client fix.
 * T-1 item 3 says to carry `resolution` "which the backend already sends and the client throws
 * away". Measured on production: the backend sends `resolution: null` (R11-10, still open), and the
 * client does NOT throw it away — `backendWeatherServiceClientDiag.js` already derives it from the
 * served grid and discloses `resolutionSource: 'backend' | 'derived_from_served_grid' | 'unknown'`.
 * The carrying is done. Only the user-facing disclosure was missing.
 *
 * ★ THE FAILURE MODE THIS MUST AVOID is the one the same session hit with the parity gate: a
 * warning that is always on carries exactly as little information as a pass that is always on. So
 * the notice must be SILENT on a native grid, and must refuse to guess when it has no resolution.
 */
import { servedResolutionNotice, COARSE_DEG_THRESHOLD } from './servedResolutionNotice';

describe('servedResolutionNotice', () => {
  // ── silent when there is nothing worth saying ──────────────────────────────────────────────
  test('a native 0.25 deg regional tile produces NO notice', () => {
    expect(servedResolutionNotice(0.25, 'derived_from_served_grid')).toBeNull();
  });

  test('anything at or under the threshold is silent', () => {
    expect(servedResolutionNotice(COARSE_DEG_THRESHOLD, 'backend')).toBeNull();
    expect(servedResolutionNotice(0.5, 'backend')).toBeNull();
  });

  test('REFUSES to guess when the resolution is unknown', () => {
    // Null is not "fine" and not "coarse" — it is unknown, and inventing either would be the
    // one-bit lie this whole mission exists to remove.
    expect(servedResolutionNotice(null, 'unknown')).toBeNull();
    expect(servedResolutionNotice(undefined, 'unknown')).toBeNull();
    expect(servedResolutionNotice(NaN, 'derived_from_served_grid')).toBeNull();
    expect(servedResolutionNotice('0.25', 'backend')).toBeNull();
  });

  // ── speaks when the grid is genuinely coarse ───────────────────────────────────────────────
  test('the production global-coarse tier produces a notice with its real size', () => {
    const n = servedResolutionNotice(15.455, 'derived_from_served_grid');
    expect(n).not.toBeNull();
    expect(n.label).toMatch(/15\.5/);          // the degrees, rounded for humans
    expect(n.km).toBeGreaterThan(1000);        // ~1,700 km at the equator
    expect(n.label).toMatch(/km/);             // ⭐ degrees mean nothing to a surfer
  });

  test('the 2 deg mid tier also speaks', () => {
    const n = servedResolutionNotice(2.0, 'derived_from_served_grid');
    expect(n).not.toBeNull();
    expect(n.km).toBeGreaterThan(200);
  });

  // ── it must not convey by colour alone (CLAUDE.md accessibility mandate) ───────────────────
  test('carries a TEXT label and a title, never colour alone', () => {
    const n = servedResolutionNotice(15.455, 'derived_from_served_grid');
    expect(typeof n.label).toBe('string');
    expect(n.label.length).toBeGreaterThan(0);
    expect(typeof n.title).toBe('string');
    expect(n.title.length).toBeGreaterThan(0);
  });

  // ── the source must be disclosed, not laundered ────────────────────────────────────────────
  test('a DERIVED resolution says so in the title; a backend one does not claim derivation', () => {
    const derived = servedResolutionNotice(15.455, 'derived_from_served_grid');
    expect(derived.title.toLowerCase()).toMatch(/derived|served grid/);
    const backend = servedResolutionNotice(15.455, 'backend');
    expect(backend.title.toLowerCase()).not.toMatch(/derived/);
  });

  // ── kill switch ────────────────────────────────────────────────────────────────────────────
  test('__RAW_LEGEND_RESOLUTION__ = false silences it entirely', () => {
    window.__RAW_LEGEND_RESOLUTION__ = false;
    try {
      expect(servedResolutionNotice(15.455, 'derived_from_served_grid')).toBeNull();
    } finally {
      delete window.__RAW_LEGEND_RESOLUTION__;
    }
  });

  // ── the control that stops this becoming an always-on warning ──────────────────────────────
  test('POSITIVE CONTROL: the notice is silent across the whole native range', () => {
    // If this ever starts producing notices, the threshold has drifted below the tiers we
    // actually serve and the legend would nag on every ordinary view.
    for (const deg of [0.05, 0.1, 0.25, 0.4, 0.5]) {
      expect(servedResolutionNotice(deg, 'derived_from_served_grid')).toBeNull();
    }
  });
});
