/**
 * sessionRejection -- this tab's memory that the backend refused its session (a 401 sent it to the
 * sign-in form).
 *
 * The 401 handler in apiClient redirects with a HARD load (window.location.href), which restarts
 * every module, so module state cannot remember that the redirect happened. On 2026-10-08 that let
 * the redirect loop: 401 -> /auth -> (a session re-appeared) -> /feed -> 401 -> /auth ..., over
 * 1,500 requests until the tab was closed, with the shared backend slowing for everyone. The mark
 * lives in sessionStorage: it survives the hard load, stays in this tab, and dies with it.
 *
 * Readers:
 *   - apiClient: a second 401 inside REDIRECT_GUARD_MS of the last redirect does not navigate.
 *   - Auth page: never auto-forwards a "signed-in" user while the mark is set.
 *   - AuthContext: never re-seeds the development mock identity while the mark is set; a
 *     successful login or signup clears it.
 */

const KEY = 'raw-surf-session-rejected-at';

/** How long after a 401 redirect another 401 counts as the same failure (a loop), not a new one. */
export const REDIRECT_GUARD_MS = 30000;

function rejectedAt() {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null; // storage blocked: degrade to the old behaviour rather than break the page
  }
}

export function markSessionRejected(now = Date.now()) {
  try {
    sessionStorage.setItem(KEY, String(now));
  } catch {
    // storage blocked: nothing to remember with
  }
}

export function wasSessionRejected() {
  return rejectedAt() !== null;
}

/** True inside the guard window. A mark from the future (clock moved back) counts as recent. */
export function sessionRejectedRecently(now = Date.now()) {
  const at = rejectedAt();
  return at !== null && now - at < REDIRECT_GUARD_MS;
}

export function clearSessionRejected() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // storage blocked: nothing was stored
  }
}
