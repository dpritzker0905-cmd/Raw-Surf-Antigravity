/**
 * spotMovePayload — the ONE place the admin spot-move request body is built.
 *
 * ⛔ THE REGRESSION THIS DELETES (owner report 2026-08-09: "the map editor is failing to move
 * spots"). `AdminSpotEditor` had TWO call sites for `PUT /admin/spots/{id}/move` that built the
 * body independently:
 *
 *   dragend        -> { latitude: newPos.lat, longitude: newPos.lng, ... }   ✅ correct
 *   land-override  -> { ...landWarning.coords, ... }  where coords = { lat, lng }   ❌ 422
 *
 * `SpotMoveRequest` (backend/routes/surf_spots/spot_admin.py:45-48) requires `latitude` and
 * `longitude`, so the second body was rejected by FastAPI BEFORE the handler ran — proven by
 * execution against a verbatim copy of the model (loc=('latitude',) type=missing) and independently
 * by the DEPLOYED schema (`/openapi.json` -> SpotMoveRequest -> required:["latitude","longitude"]).
 *
 * ★ THE FAILURE WAS PERMANENT, NOT INTERMITTENT. The land-warning branch reverts the marker before
 * showing the dialog, so the sequence is: drag → backend says `land_detected` → pin snaps back →
 * "Confirm Offshore Peak" → 422 → "Failed to move spot". No amount of retrying can move a spot the
 * land check flags, and the land check is reachable in normal use: replaying its classifier against
 * real Nominatim responses for five near-shore surf coordinates flagged 1 of 5 (Montauk Ditch
 * Plains, type=`parking`).
 *
 * ⭐ WHY A SHARED FUNCTION RATHER THAN FIXING THE ONE LINE: the bug existed because two call sites
 * had to independently remember a naming convention that differs from Leaflet's. Leaflet hands back
 * `{lat, lng}`; the API wants `{latitude, longitude}`. Any future caller holding either shape now
 * gets it right by construction, which is the only fix that also covers the caller nobody has
 * written yet. (The sibling CREATE path escaped the bug only by luck — it happened to spell the
 * fields out at AdminSpotEditor.js:374-375.)
 */
export function spotMovePayload(coords, overrideLandWarning = false) {
  // Accept either the API shape or Leaflet's LatLng shape. `??` not `||` so a legitimate 0.0
  // latitude (the equator — Gabon, São Tomé, Kiribati all have surf) is never treated as absent.
  const latitude = coords?.latitude ?? coords?.lat;
  const longitude = coords?.longitude ?? coords?.lng;
  return { latitude, longitude, override_land_warning: !!overrideLandWarning };
}

/**
 * A 401 on an admin call is not "failed to load" — it is "you are not signed in as an admin", and
 * the two need different actions from the operator. `apiClient` deliberately EXEMPTS `/admin/` URLs
 * from the global 401 session-clear/redirect (apiClient.js:108-112) so that one transient 401 during
 * the console's 7+ parallel boot calls cannot nuke the session — correct, but it means an admin 401
 * surfaces ONLY as whatever string the local catch chose. The map then renders perfectly with zero
 * pins, which reads as "there are no spots" rather than "you are not authorised".
 */
export function adminErrorMessage(error, fallback) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) {
    return 'Not authorised as admin — sign in with an admin account (a dev token will not work).';
  }
  return error?.response?.data?.detail || fallback;
}
