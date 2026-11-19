# 2026-11-18 Claude: the placement helper for candidate spots (PR 3 of 4)

Session: surf-spot adviser lane (`466af216`). Branch `claude/spots-3-placement`, in its own worktree, stacked on
`claude/spot-admin-paging` (#1067), which is stacked on #1065. Admin tooling over the holding table. No spot is
created, moved or hidden; nothing was written to any database; no served number moves.

## Why, and on whose word

**David**, typed in this session, 2026-11-18: "we should create a helper tool that helps us place them at least in
the nearest known location first, before we confirm them. This tech should work with our surf spot admin, logically."
Asked what "nearest known location" should be, he answered: "yes shoreline". Asked whether to start this step:
"Yes, start it".

**The director** (cross-session, 2026-11-18): "the shoreline placement helper (the person confirms or drags)", and on
the source: "The NOAA shoreline (GSHHG) at load time for the placement helper is the right source: public domain,
already in use, no runtime service."

## What it adds

- **`backend/scripts/spot_candidate_shoreline.py`** (offline; reads two files, writes one). For each record, the
  nearest point on the NOAA GSHHG full-resolution level-1 shoreline (land against ocean; lakes are other levels and
  are ignored), within 3 km. Before it writes it checks controls: three known breaks must be within 1 km and three
  inland points must not be. A failed control makes the run VOID: non-zero exit, nothing written. The shoreline file
  (about 180 MB) is not in the repository.
- **Holding table:** three columns, `suggested_latitude`, `suggested_longitude`, `suggested_method`. The suggestion
  is a machine's guess and is kept apart from `proposed_*`, which is a person's position. The loader reads the new
  `[km, latitude, longitude]` shoreline file (and still reads the older distance-only file).
- **`PUT /admin/spots/candidates/{id}/position`** (admin only): stores a person's position on the candidate. Taking
  the suggestion stores the suggestion itself, whatever numbers the browser sent. A hand position more than 50 km
  from the source is refused. A candidate that is already rejected, duplicate or promoted is closed. The source's
  coordinate is never overwritten. It cannot create or move a spot.
- **Admin screen** (`AdminCandidatePlacer.js`, opened from a "Place" button on each open candidate): a satellite
  picture with the source position and the nearest shoreline labelled in words, and a pin that starts on the
  suggestion. The admin drags the pin or types the latitude and longitude (the keyboard path), then saves. The list
  row says "Not placed", "Not placed: shoreline suggestion ready", "Placed: shoreline suggestion taken" or
  "Placed by hand".

## Measured

- **The real run** (30,013 Foursquare "Surf Spot" records, GSHHG full resolution): 179,832 level-1 polygons read,
  1,643,485 shoreline points kept, controls passed. Within 0.5 km of an ocean shoreline: 15,649. Within 1 km:
  18,477. Within 2 km: 20,085. None within 3 km: 9,175.
- **Agreement with the earlier filter** (`gshhg_filter.py`, the research run): on the 13,504 records both measured
  inside the reach, the distances are identical (maximum difference 0.000 km). 1,297 records had a distance in the
  earlier file and none here; every one of them was more than 3 km (minimum 3.003), which the earlier script
  reported and this one treats as out of reach.
- **Loader dry run** with the new file and the 1 km filter, against the repo's 2026-08-12 catalogue snapshot (1,773
  rows): 3,705 businesses left out, 2,117 more than 1 km from a shoreline, 8,472 with no shoreline within 3 km;
  15,719 candidates: A 49, B 431, C 345, D 1,371, E 245, F 13,278.
- **This corrects an earlier number.** "11,671 within 1 km of an ocean shoreline" (research, and the lower bound
  "at least 8,192 outside the 14 forecast boxes" quoted to the repair lead) came from measuring only the 17,113
  records of a stricter pre-filter. With every candidate measured, tier F within 1 km is **13,278**.
- Tests: `tests/test_spot_candidate_placement.py` 16 (guards lane): the tool on a synthetic shoreline file (an
  island, a lake that must be ignored, an island across the antimeridian), the void-on-failed-control path, the
  loader, the route's acceptances and refusals, admin-only. `AdminCandidatePlacer.test.js` 11 (1 suite). Local:
  backend 71 passed across the three spot files; frontend 25 passed across the two suites; eslint gate and flake8
  gate clean; file sizes under 800.

## Not verified, and not in this PR

- **Not looked at in a browser, and the map itself is untested.** jsdom has no map library, so the Jest tests
  exercise the buttons and the typed coordinates only. Dragging the pin on the satellite picture, the labels on the
  map and the layer switch have not been seen working by me. They follow the precision-pin map already in
  `AdminSpotsPanel.js`.
- The suggestion is the nearest shoreline POINT, on the waterline. A break is seaward of it. It is a starting place
  for a person, not a position for a spot.
- The satellite picture is for a person to look at. No program reads it.
- No reject, hold, duplicate or promote action on a candidate, and no candidate loaded anywhere. A committed load on
  production needs David's word in the session that runs it.
- Merging adds three columns to the holding table. If #1065 has already created the table on production, the
  backend adds the columns at its next start (`ensure_database_tables`); they are nullable.
