/**
 * staticEuroSwellSets.js: the EURO swell world sets the client reads from the CDN (2026-11-12, move 3 "all layers should be instant
 * frames"). Kept out of staticFrames.js, which sits at the 800-line cap.
 *
 * WHY: since D-059 (2026-11-01, EURO_MARINE_MID_CMEMS_SWELL default '1') the pilots lane stores EURO swell_1 / swell_2 / wind_waves at
 * the 2-deg world tier, and the publisher writes them as static sets, plain and with /grid's targeted Gulf fill baked in
 * (backend services/frame_set.EURO_SWELL_SETS, FRAME_EURO_SWELL_SETS default '1'). The publisher's own note said the client must list
 * the keys before it reads them; until then every EURO swell scrub and toggle asked the box (/grid, /grid_series).
 * The keys follow the same rules as the EURO waves sets: a WORLD box reads only the filled set while the server, the latest.json
 * record and the index agree on the targeted mode (staticWorldFillGuard); a mid-zoom crop reads the plain set (plainCropsOn). A set
 * the publisher has not written is a miss ('no_index' / 'set_not_published') and /grid serves it, never a wrong frame.
 *
 * Kill (EURO swell back to /grid and /grid_series): window.__RAW_DISABLE_STATIC_EURO_SWELL__ = true.
 */
export const EURO_SWELL_LAYERS = Object.freeze(['swell_1', 'swell_2', 'wind_waves']);

export const EURO_SWELL_SET_KEYS = Object.freeze([
  ...EURO_SWELL_LAYERS.map((l) => `EURO/marine/${l}/global_mid`),
  ...EURO_SWELL_LAYERS.map((l) => `EURO/marine/${l}/global_mid_filled`),
]);

export const isEuroSwellSetKey = (key) => EURO_SWELL_SET_KEYS.includes(key);

/** ON unless killed (read per call). */
export const euroSwellSetsOn = () => !(typeof window !== 'undefined' && window.__RAW_DISABLE_STATIC_EURO_SWELL__ === true);
