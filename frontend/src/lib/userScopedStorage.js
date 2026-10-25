/**
 * userScopedStorage -- the browser-storage keys that hold ONE ACCOUNT'S content, and the purge for them.
 *
 * WHY (audit 2026-10-18, F-08): logout removed only the session keys, so on a shared device the next account
 * to sign in was served the previous account's cached feed (`rawsurf_cached_feed`, read back as the offline
 * fallback when /api/posts is unreachable and as the first paint of /feed), and could replay the previous
 * account's queued offline actions (`rawsurf_offline_queue`: reactions, comments, follows) under its own token.
 *
 * RULE: a key that holds an account's posts, queue, favourites, search history, location or an in-flight
 * purchase/booking handoff goes in this list. A key that is a device preference (theme, cookie consent, camera
 * permission, debug switches, map caches of public data) does not: those survive a logout on purpose. Keys that
 * already carry the user id in their name (`splitPocket_<id>`, `gearGoal_<id>`, `rs-push-optin-<id>`,
 * `tos-accepted-<id>-<v>`) cannot cross accounts and are left alone.
 * The guard test (userScopedStorage.test.js) fails when a purged key is dropped from this list.
 */

export const USER_SCOPED_STORAGE_KEYS = Object.freeze([
  // The feed's stale-while-revalidate cache and its timestamp (useFeedDataActions, Feed).
  'rawsurf_cached_feed',
  'rawsurf_cached_feed_ts',
  // Reactions/comments/follows queued offline, replayed on reconnect (useOfflineQueue).
  'rawsurf_offline_queue',
  // The account's saved spots, cached for offline use (useOfflineMode).
  'rawsurf_favorite_spots',
  // Search history and recently visited spots (Explore, GlobalSearchBar, useOnDemandLocation).
  'rs-recent-searches',
  'rawsurf_recent_searches',
  'rawsurf_recent_spots',
  // Where the person was last seen (useIPGeolocation, useUserLocation).
  'rawsurf_last_known_city',
  'rawsurf_last_known_coords',
  'user_gps_location',
  // Handoffs that carry an account's booking/purchase intent across a page load (Credits, JumpInSessionModal).
  'pending_session_join',
  'credits_return_to',
  'credits_return_reason',
  'credits_open_crew_invite',
  'credits_dispatch_id',
]);

/**
 * Remove every per-account key from localStorage. Never throws: storage can be blocked (private window,
 * disabled site data), and a failed purge must not stop the logout that called it.
 * @returns {string[]} the keys that were present and removed (for tests and diagnostics)
 */
export function purgeUserScopedStorage() {
  const removed = [];
  if (typeof window === 'undefined') return removed;
  let store;
  try {
    store = window.localStorage;
  } catch {
    return removed;
  }
  if (!store) return removed;
  for (const key of USER_SCOPED_STORAGE_KEYS) {
    try {
      if (store.getItem(key) !== null) removed.push(key);
      store.removeItem(key);
    } catch {
      /* one blocked key must not skip the rest */
    }
  }
  return removed;
}
