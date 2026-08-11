/**
 * marineServeDiag.js — the serve-coverage diagnostic, lifted out of marineController.
 *
 * WHAT IT ANSWERS: which cache path served this request, and does the grid it served actually COVER
 * the viewport? `coversViewport: false` at a regional viewport is the heatmap-CLAMP signature — a
 * sub-viewport grid painted as though it were the whole field.
 *
 * WHY IT LIVES HERE NOW (2026-08-09): `marineController.js` reached 853 LOC against a hard 800
 * ceiling on a file that is not grandfathered. The house fix — relocate rationale to docs — was the
 * wrong tool: only 24 of the 66 lines that pushed it over were comment, and the file is 21% comment
 * because that reasoning was written at the point of use. So the file splits by LANE instead, and
 * this is the first cut: pure INSTRUMENTATION with no serve behaviour, which makes it the lowest-risk
 * extraction of the three.
 *
 * ⚠️ THE CONTRACT IS THE GLOBAL, NOT THE IMPORT. Nothing imports this reader — `window.__MARINE_SERVE_DIAG__`
 * is consumed at runtime by `scripts/live_session_diagnostic.js` and `scripts/probe_wind_zoomburst.js`.
 * Changing the SHAPE of the published object breaks those probes silently, because a probe reading a
 * missing key gets `undefined` and reports it as a value. Add fields; do not rename them.
 *
 * ⛔ KNOWN LIMIT, measured 2026-08-09 and worth having at the point of use: this is written ONLY on a
 * cache HIT. During fetch-heavy periods nothing updates it, so a reader sees a STALE object rather
 * than a fresh miss — and before the first serve it is absent entirely. Measured unknown-coverage
 * windows across four live sessions: 1 s / 24 s / 33 s / 95 s (the 95 s run was a slow backend).
 * ⇒ A consumer must treat `gridWidth == null` as "not measured", never as "does not cover".
 * ⭐ And `coversViewport` has NO global-span shortcut: a 360°-wide world grid can report `false`
 *    (measured at z9: covers false, gridWidth 360). Callers that care must special-case span >= 350,
 *    the way `probe_wind_zoomburst.js` does.
 */

/**
 * Publish the serve-coverage diagnostic. Never throws: a diagnostic must not break the serve it
 * observes.
 *
 * @param {object|null} hitData      the served marine payload (its `.grid.bounds` is the subject)
 * @param {object|null} bounds       the viewport being served
 * @param {object} meta              { cacheSource, model, layer, hour } — the identity of this serve
 */
export function publishServeDiag(hitData, bounds, meta) {
  if (!hitData || typeof window === 'undefined' || !bounds) return;
  try {
    const g = hitData.grid;
    const gb = g && g.bounds;
    let covers = null, gw = null;
    if (gb && gb.west !== undefined) {
      gw = (gb.east < gb.west) ? (gb.east + 360 - gb.west) : (gb.east - gb.west);
      covers = gb.west <= bounds.west + 1e-6 && gb.east >= bounds.east - 1e-6 &&
               gb.south <= bounds.south + 1e-6 && gb.north >= bounds.north - 1e-6;
    }
    window.__MARINE_SERVE_DIAG__ = {
      cacheSource: meta.cacheSource, model: meta.model, layer: meta.layer, hour: meta.hour,
      gridWidth: gw, coversViewport: covers,
      gridBounds: gb && gb.west !== undefined ? { w: gb.west, s: gb.south, e: gb.east, n: gb.north } : null,
      viewport: { w: bounds.west, s: bounds.south, e: bounds.east, n: bounds.north },
      ts: Date.now()
    };
  } catch (e) { /* diag must not break the serve */ }
}
