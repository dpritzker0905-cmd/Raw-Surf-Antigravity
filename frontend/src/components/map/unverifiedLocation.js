/**
 * Marking for a surf spot whose LOCATION no person has verified yet.
 *
 * Owner, 2026-11-18: "ones that arent verified could be a different color, or different border color to the spot
 * pin circle", confirmed as "Yes, dashed ring". The mark is a SHAPE (a hollow pin inside a dashed ring) plus the
 * WORDS "Unverified location" in the pin's accessible name, its hover card and the spot drawer. Colour carries
 * nothing here, so it reads the same in light, dark and beach, on any basemap, and for colour-blind viewers.
 *
 * Which spots: only those the server flags `location_unverified` (spots added from the holding table and not yet
 * verified; backend/services/spot_location_status.py). Every pin that exists today is unflagged and is drawn
 * exactly as before.
 *
 * Ships ON. Kill switch (before the map loads): `window.__RAW_DISABLE_UNVERIFIED_PIN_MARK__ = true` draws these
 * pins like any other and drops the words.
 */
export const UNVERIFIED_LOCATION_TEXT = 'Unverified location';

export const unverifiedPinMarkDisabled = (win = typeof window !== 'undefined' ? window : undefined) =>
  !!(win && win.__RAW_DISABLE_UNVERIFIED_PIN_MARK__ === true);

/** True when this spot (or map cluster item) should carry the mark. Only a strict `true` from the server counts. */
export const isLocationUnverified = (spot, win) =>
  !!(spot && spot.location_unverified === true) && !unverifiedPinMarkDisabled(win);

/** The accessible name with the words appended, e.g. "Rocky Point: Fair, 3.3 ft, unverified location". */
export const withUnverifiedLocation = (label, unverified) =>
  (unverified ? `${label}, unverified location` : label);

/**
 * The dashed ring drawn around the pin: white dashes with a thin dark edge on both sides, so it stays visible over
 * pale sand, dark water and satellite imagery alike. Decorative (the words carry the meaning for assistive tech).
 */
export const UNVERIFIED_RING_STYLE = {
  position: 'absolute', top: -6, left: -6, right: -6, bottom: -6, borderRadius: '50%',
  border: '2px dashed rgba(255,255,255,0.96)',
  boxShadow: '0 0 0 1px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(0,0,0,0.6)',
  pointerEvents: 'none',
};
