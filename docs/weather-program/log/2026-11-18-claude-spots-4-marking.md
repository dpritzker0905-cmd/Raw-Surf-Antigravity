# 2026-11-18 Claude: unverified-location spots are marked on the map, and an admin switch shows or hides them (PR 4 of 4)

Session: surf-spot adviser lane (`466af216`). Branch `claude/spots-4-marking`, from `origin/dev` `48cea2958`,
independent of the other surf-spot PRs. No spot is changed and no database is written. **Nothing a user sees changes
today:** no spot carries the mark yet (see "Which spots").

## Why, and on whose word

**David**, typed in this session, 2026-11-18: "when we do put the spots pins locations in, ones that arent verified
could be a different color, or different border color to the spot pin circle, what do you think?"; to "Mark unverified
pins with a dashed hollow ring plus an 'Unverified' label, not colour alone?": "Yes, dashed ring"; "Unverified spots
we should have an admin toggle to make them visible or not"; and "start the map marking for unverified pins".

**The director** (cross-session, 2026-11-18): "unverified pins as a hollow pin with a dashed ring plus 'Unverified
location' text, all three themes, desktop and mobile, accessible name", shipped ON with a kill switch and tests.

## Which spots

Only a spot ADDED from the holding table and not yet verified by a person: `accuracy_flag = 'new_unverified'`
(`services/spot_location_status.NEW_UNVERIFIED_FLAG`). The roughly 1,300 existing rows whose `accuracy_flag` is the
old default `'unverified'` are deliberately NOT marked: the decision David confirmed was that today's pins do not
change. Nothing writes the new value yet; the promote action (a later change) will. Widening the set later is one
line in one function.

Rating confidence is not touched: `spot_ratings.spot_confidence` gives the new value "medium", the same as the old
default, so no served number or confidence word moves.

## What it adds

- **Server.** `SurfSpotResponse.location_unverified` (default false) on `GET /surf-spots`, and the same key on
  `GET /surf-spots/nearby`. One switch, the existing feature-flag row `show_unverified_spots` (no schema change):
  missing, off or kill-switched, those two lists leave the marked spots out; on, they are listed and flagged. The
  switch is read at most once every 30 s per process and reads as OFF on any doubt (including a database error).
- **Map pin** (`MapMarkerLayers.js`, `map/unverifiedLocation.js`): a dashed white ring with a dark edge around the
  pin, a hollow fill in the plain view, and the words. The ring is decoration (`aria-hidden`); the meaning is in
  words: the pin's accessible name ends ", unverified location", and its hover and focus card says "Unverified
  location: the pin may not be on the break". In the rating view the rating colour and its text are kept and the
  ring and words are added. Colour carries nothing, so it does not depend on the theme or the basemap.
- **Spot drawer** (`UnifiedSpotDrawer.js`, one component for phone and desktop): the same words under the spot's
  name, in the drawer's theme text colour.
- **Admin switch** (`AdminUnverifiedSpotsToggle.js`, in the Spots panel): a real switch (`role="switch"`,
  `aria-checked`), its state in words (Shown / Hidden / Unknown), creating the flag on first use. A failed read is
  "Unknown" and an error, never "Hidden".
- **Kill switch:** `window.__RAW_DISABLE_UNVERIFIED_PIN_MARK__ = true` before the map loads draws marked pins like
  any other and drops the words.

## Measured

- Backend `tests/test_spot_location_unverified.py`, 14 tests (guards lane), over real HTTP against the real router
  on SQLite: only the new value counts (the old default, NULL and the verified values do not); with the switch
  missing, off or kill-switched the marked spot is absent from both lists; on, it is present and flagged, cached and
  filtered requests alike; the 30 s cache and the fail-closed read. The existing list and cache tests still pass
  (50 passed across the three files).
- Frontend `map/unverifiedLocation.test.js`, 11 tests (1 suite): an unflagged pin is named and drawn exactly as
  before; a flagged pin has the dashed ring, the hollow fill and the words, in the plain and the rating view; only a
  strict `true` counts; the kill switch removes it; the admin switch's four states. The existing pin accessibility,
  area-estimate and drawer suites still pass. eslint gate, flake8 gate and file sizes clean.

## Not verified, and not done

- **Not looked at in a browser.** No spot carries the mark, so there is nothing to see on the live map; the pin was
  exercised in Jest only. How the dashed ring reads over each basemap in light, dark and beach has not been seen.
  The first promoted spot should be looked at before the switch is turned on.
- The drawer line is not covered by a test of its own (the drawer's existing suite still passes).
- **The hide switch covers the map list and the nearby list only.** These public routes do not apply it yet, and a
  marked spot would still appear in them while hidden on the map: `/explore/search`, `/search/global`,
  `/explore/surf-spots`, `/spot-of-the-day`, the spot detail and spot hub routes, and the ratings precompute. No
  spot carries the mark, so nothing leaks today; closing these belongs with the promote action and must land before
  the first promotion.
- The spot hub page does not show the words yet.
- A change of the switch reaches the map within about a minute (two 30 s caches), not at once.
