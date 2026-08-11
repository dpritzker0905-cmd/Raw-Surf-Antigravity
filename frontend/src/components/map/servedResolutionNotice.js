/**
 * servedResolutionNotice — tell the user how coarse the grid under the colours actually is.
 *
 * MISSION T-1 item 3b (certification audit 11.2). Items 1 and 2 shipped in `516a7200`: the HUD's
 * `Class` row is seven-valued and the parity gate is four-valued. Both are correct — and both live
 * in `TruthOverlay`, which is gated behind `?diag=1`. **A surfer never sees either.** The legend is
 * the surface that is always on screen, and it said nothing about grid coarseness.
 *
 * MEASURED against production 2026-08-11 through `deriveResolutionDeg(bounds, cols, rows)`:
 *     regional tile  25x29 over  6° x  7°  ->   0.25°/cell  ~   28 km   native  -> SILENT
 *     global coarse  25x12 over 360° x 170° ->  15.455°/cell ~ 1,700 km  coarse  -> NOTICE
 *
 * ⚠️ THE PACKET'S PREMISE IS INVERTED, and this is why the fix is here and not in the client's
 * plumbing. T-1 item 3 says to carry `resolution` "which the backend already sends and the client
 * throws away". Measured on production, the backend sends `resolution: null` (R11-10, still open),
 * and the client does NOT throw it away — `backendWeatherServiceClientDiag.js:50` already derives
 * it from the served grid and discloses `resolutionSource`. The carrying was already done; only
 * the user-facing disclosure was missing.
 *
 * ★★★ THE FAILURE MODE THIS IS BUILT TO AVOID is the one the parity gate hit in the same session:
 * a warning that is always on carries exactly as little information as a pass that is always on.
 * So this is SILENT on every native tier, and REFUSES rather than guessing when it has no
 * resolution — an unknown resolution is not "fine" and not "coarse", and saying either would be
 * the one-bit lie Mission T-1 exists to remove.
 *
 * Kill switch: `window.__RAW_LEGEND_RESOLUTION__ = false`.
 */

/** Above this, the served cell is coarse enough that a user should be told. */
export const COARSE_DEG_THRESHOLD = 0.5;

/** Degrees of latitude → km. Longitude shrinks with latitude, so this is the generous reading. */
const KM_PER_DEG = 111.32;

/**
 * @param {number|null|undefined} resolutionDeg  coarser-axis degrees per cell
 * @param {string} resolutionSource              'backend' | 'derived_from_served_grid' | 'unknown'
 * @returns {{label: string, title: string, km: number, deg: number}|null} null = say nothing
 */
export function servedResolutionNotice(resolutionDeg, resolutionSource) {
  if (typeof window !== 'undefined' && window.__RAW_LEGEND_RESOLUTION__ === false) return null;

  // Strict: a string, a NaN or a null is UNKNOWN, and unknown earns silence here rather than a
  // guess. The HUD's `Class` row already says RESOLUTION UNKNOWN for the diagnostic audience.
  if (typeof resolutionDeg !== 'number' || !isFinite(resolutionDeg) || resolutionDeg <= 0) return null;
  if (resolutionDeg <= COARSE_DEG_THRESHOLD) return null;

  const km = Math.round(resolutionDeg * KM_PER_DEG);
  const deg = Math.round(resolutionDeg * 10) / 10;
  // ⭐ Degrees mean nothing to a surfer; kilometres do. Both are shown because the degrees are what
  // every diagnostic surface and every product id speak in.
  const label = `~${km.toLocaleString()} km grid (${deg}°)`;
  const title = resolutionSource === 'derived_from_served_grid'
    ? `Each colour cell covers about ${km.toLocaleString()} km (${deg}° per cell), derived from the served grid. `
      + 'Detail smaller than one cell is not resolved.'
    : `Each colour cell covers about ${km.toLocaleString()} km (${deg}° per cell). `
      + 'Detail smaller than one cell is not resolved.';

  return { label, title, km, deg };
}


/**
 * The legend row itself, so each of MapWeatherControls' THREE layouts costs one line instead of
 * five. That file is grandfathered over the 800-LOC ratchet and may only SHRINK — putting the
 * markup here is what keeps this feature from growing it.
 *
 * Renders nothing when there is nothing worth saying. Text label + title, never colour alone
 * (CLAUDE.md accessibility mandate); colour comes from the caller's theme-aware class.
 */
export function ServedResolutionRow({ notice, className = '', size = '8' }) {
  if (!notice) return null;
  return (
    <div className={`text-[${size}px] ${className} mt-0.5 px-0.5`} title={notice.title}>
      {notice.label}
    </div>
  );
}
