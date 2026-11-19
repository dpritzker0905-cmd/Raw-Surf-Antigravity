# 2026-11-18 Claude: two more name-only spot scripts stopped, and the Maldives seed values corrected

Session: surf-spot adviser lane (`466af216`). Branch `claude/spots-seed-stop`, stacked on `claude/spots-1-safety`
(#1070: it needs that PR's `_legacy_spot_writer.py`). Scripts and a test. No database touched, no spot changed, no
served number moves.

## Why, and on whose word

Found while filing the Maldives record (#1081): `backend/scripts/caribbean_asia_pacific_expansion.py` still carried
the old Maldives coordinates and finds spots by name, and it was not one of the five scripts #1070 stops. The
director (cross-session, 2026-11-18): "Yes to (c): add caribbean_asia_pacific_expansion.py to the stop list and
correct its Maldives coordinates in a small follow-up PR."

## What changed

- **Two more scripts stop at the top of `main()`** unless `RAW_ALLOW_LEGACY_SPOT_SCRIPT` names them:
  `caribbean_asia_pacific_expansion.py` and `archive/global_mega_expansion.py`. Both find a spot by name alone and,
  when their hard-coded coordinate differs from the stored one, overwrite it and mark it a verified peak: the same
  shape as the five in #1070. I found the second by searching every script for a by-name lookup; it was not asked
  for by name, and it is included because it is the identical hazard.
- **Quarters' seed value corrected** in `caribbean_asia_pacific_expansion.py`: 3.938, 73.248 (open water) to
  3.9333, 73.4833, the value production now holds and the repo's other seed already had. Still an estimate.
- **The four hidden Maldives spots are no longer seeded.** Yin Yang and Pasta Point (`caribbean_asia_pacific_expansion.py`)
  and Malik's and Five Islands (`expand_tahiti_maldives_africa.py`) moved out of the seed lists into
  `MALDIVES_WITHHELD`, with why. On a fresh database either script would otherwise put the wrong pins back, active.
  No coordinate was invented for them: none that is licence-clean exists.

## Measured

`tests/test_spot_safety_guards.py`: 16 passed locally (13 from #1070, 2 more scripts in the guard check, 1 new test on
the seed values: the two seeds agree on Quarters, the four hidden names are in neither seed list, nothing else left
either list). flake8 gate clean; file sizes under 800.

## Found and NOT changed here (for the director to decide)

A search of `backend/scripts/` for by-name spot lookups found eleven more scripts that this PR does not touch:

- **Bulk adders** that insert spots when a name is not found, with no duplicate rule, no review and no audit row:
  `caribbean_pacific_expansion.py`, `pacific_nc_expansion.py`, `expand_caribbean_central_america.py`,
  `expand_europe.py`, `expand_indonesia_australia_japan.py`, `expand_pacific_south_america.py`,
  `expand_southeast_asia.py`, `expand_tahiti_maldives_africa.py`, `seed_missing_florida_spots.py`,
  `import_global_spots.py`. They do not overwrite an existing pin, so they are a different hazard from the seven
  now stopped: run today they would add spots around the holding table and the duplicate tiers. Two are also
  reachable from admin routes (`/admin/spots/import` uses `import_global_spots`, `/surf-spots/admin/seed-florida-spots`
  uses `seed_missing_florida_spots`), which a stop in `main()` would not cover.
- `import_global_spots.py` has an OpenStreetMap import path (`import_osm_spots`) that writes OSM coordinates into
  `surf_spots`, which the licence rule forbids.
- `dedup_surf_spots.py` is a command-line copy of the hard-delete merge tool, with its own hand-kept table list. The
  guards #1070 put on the route do not reach it.

Recommendation, not done: stop these the same way, and retire the two admin routes, in one more small PR.
