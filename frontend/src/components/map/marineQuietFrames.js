/**
 * marineQuietFrames.js — is this a QUIET frame, one where deferrable GPU work cannot land on an interaction (2026-10-23)?
 *
 * The engine consumes a staged coarse-base seed (prewarmGlobalMarineGrid -> _pendingCoarseBaseGrid) inside its render callback,
 * the only place its GL context may be touched. The live trace (2026-10-23) caught one such consume at 139.9 ms inside a frame,
 * 2 s after a scrub step: on a real scrub the next key lands in that frame. The seed is best-effort by design (the zoom-out fetch
 * still commits the global), so it can wait for a frame with no input in the last QUIET_MS and no camera zoom change.
 * Input clock: capture-phase keydown / pointerdown / wheel / touchstart and pointermove with a button held, installed on first use.
 * Kill: window.__RAW_DISABLE_QUIET_SEED__ = true (consume on the first frame again).
 */
export const QUIET_MS = 1000;

let _lastInput = -Infinity;
let _installed = false;
let _lastZoom = null;

const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function install() {
  if (_installed || typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  _installed = true;
  const on = (e) => {
    if (e && e.type === 'pointermove' && !e.buttons) return;
    _lastInput = nowMs();
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

/** Whether the render callback may consume a staged coarse-base seed on this frame. */
export function seedConsumeAllowed(zoom) {
  if (typeof window !== 'undefined' && window.__RAW_DISABLE_QUIET_SEED__ === true) return true;
  return quietFrame(zoom);
}

export function _resetQuietFramesForTest() { _lastInput = -Infinity; _lastZoom = null; }
export function _noteInputForTest(t = nowMs()) { _lastInput = t; }
