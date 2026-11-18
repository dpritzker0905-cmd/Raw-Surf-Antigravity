/**
 * marineQuietFrames.js — is this a QUIET frame, one where deferrable GPU work cannot land on an interaction (2026-10-23)?
 *
 * The engine consumes a staged coarse-base seed (prewarmGlobalMarineGrid -> _pendingCoarseBaseGrid) inside its render callback,
 * the only place its GL context may be touched. The live trace (2026-10-23) caught one such consume at 139.9 ms inside a frame,
 * 2 s after a scrub step: on a real scrub the next key lands in that frame. The seed is best-effort by design (the zoom-out fetch
 * still commits the global), so it can wait for a frame with no input in the last QUIET_MS and no camera zoom change.
 * Input clock: capture-phase keydown / pointerdown / wheel / touchstart and pointermove with a button held, installed when this
 * module loads (a lazy install missed the very key that preceded the first seed: measured offline, the seed landed 170-179 ms
 * after it). The engine asks EVERY frame, before it looks for a seed, so a zoom in progress is seen frame to frame.
 * Kill: window.__RAW_DISABLE_QUIET_SEED__ = true (consume on the first frame again).
 */
export const QUIET_MS = 1000;

let _lastInput = -Infinity;
let _lastKey = -Infinity;
let _installed = false;
let _lastZoom = null;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function install() {
  if (_installed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  _installed = true;
  const on = (e) => {
    if (e && e.type === 'pointermove' && !e.buttons) return;
    _lastInput = nowMs();
    if (e && e.type === 'keydown') _lastKey = _lastInput;
  };
  for (const t of ['keydown', 'pointerdown', 'pointermove', 'wheel', 'touchstart']) {
    window.addEventListener(t, on, { capture: true, passive: true });
  }
}

/** True when nothing asked the map for anything in the last `ms` and the zoom did not change since the previous frame. */
export function quietFrame(zoom, ms = QUIET_MS) {
  install();
  if (typeof zoom === 'number') {
    if (_lastZoom !== null && zoom !== _lastZoom) _lastInput = nowMs();
    _lastZoom = zoom;
  }
  return nowMs() - _lastInput >= ms;
}

/**
 * THE LATE WASH (2026-11-15, docs/weather-program/log/2026-11-15-claude-marine-late-wash.md). After a multi-hour jump the new hour's
 * world seed is staged at once, but the old base is REFUSED by the time rule (marineStaleHour.washMatchesResident), so for the whole
 * QUIET_MS the sea around a regional grid drew no wash, and the picture "corrected itself" when the quiet second ended. Measured
 * offline (scn_hour_jump_wash.js, cached pass): 13.0-13.2 luminance units off the same hour at rest at 250 / 900 ms, 0.000 at 2.5 s
 * (the hour-blend lane's live-shaped read: ~4.1). When the seed REPAIRS a refused wash (`urgent`: marineStaleHour.seedRepairsWash),
 * it waits URGENT_QUIET_MS instead: a held key (30/s) still never gets an upload mid-burst; a burst's end gets the wash back at once.
 * NO-KEY GUARD (2026-11-16, pre-registered in the same log, section 4): the step-time run failed 3 of 6 cells (desktop 200 / 800 ms
 * p95, phone 800 ms long tasks), so an urgent seed also waits URGENT_KEY_QUIET_MS after the last KEY: stepping at 200-400 ms never
 * takes the upload; a pointer or wheel still only needs URGENT_QUIET_MS.
 * Kill: window.__RAW_DISABLE_URGENT_WASH_SEED__ = true (QUIET_MS for every seed again).
 */
export const URGENT_QUIET_MS = 150;
export const URGENT_KEY_QUIET_MS = 400;

/** Whether the render callback may consume a staged coarse-base seed on this frame (`urgent`: the seed repairs a refused wash). */
export function seedConsumeAllowed(zoom, urgent = false) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_QUIET_SEED__ === true) return true;
  if (urgent && !(typeof window !== 'undefined' && window.__RAW_DISABLE_URGENT_WASH_SEED__ === true)) return quietFrame(zoom, URGENT_QUIET_MS) && nowMs() - _lastKey >= URGENT_KEY_QUIET_MS;
  return quietFrame(zoom);
}

install();

export function _resetQuietFramesForTest() { _lastInput = -Infinity; _lastKey = -Infinity; _lastZoom = null; }
export function _noteInputForTest(t = nowMs(), key = false) { _lastInput = t; if (key) _lastKey = t; }
