# 2026-11-18 Claude: the bulk spot adders stop, two admin routes fail closed, the OpenStreetMap import is removed

Session: surf-spot adviser lane (`466af216`). Branch `claude/spots-bulk-stop`, stacked on `claude/spots-seed-stop`
(#1083, itself on #1070): it extends that stack's `_legacy_spot_writer.py`. Scripts, two route gates and tests. No
database touched, no spot changed, no served number moves.

## Why, and on whose word

The eleven scripts were found and listed, not changed, in #1083's log. **The director** (cross-session, 2026-11-18):
"(1) The ten bulk adders and dedup_surf_spots.py get the same RAW_ALLOW_LEGACY_SPOT_SCRIPT stop at the top of main().
(2) The two routes, /admin/spots/import and /surf-spots/admin/seed-florida-spots: don't delete them. Make them fail
closed by default (410 with a short reason pointing to the holding-table flow). Re-enabling should take an env var,
named in the PR. Deleting the routes is David's decision, and gating keeps it reversible. (3) Remove or hard-block
the OpenStreetMap import path in import_global_spots.py now, whatever the env var says. (4) Add tests for each stop
and route, plus the floor fragment."

Behind it, David (this session, 2026-11-18): nothing enters `surf_spots` without a person's review; no duplicates.

## What changed

1. **Eleven scripts stop before anything else runs** (the first lines under `if __name__ == "__main__":`), unless
   `RAW_ALLOW_LEGACY_SPOT_SCRIPT` names that exact script:
   - ten bulk adders (`caribbean_pacific_expansion`, `pacific_nc_expansion`, `expand_caribbean_central_america`,
     `expand_europe`, `expand_indonesia_australia_japan`, `expand_pacific_south_america`, `expand_southeast_asia`,
     `expand_tahiti_maldives_africa`, `seed_missing_florida_spots`, `import_global_spots`): they insert a spot
     whenever a name is not found, with no duplicate tiers, no review and no audit row;
   - `dedup_surf_spots.py`, the command-line copy of the hard-delete merge tool, with its own hand-kept table list.
   The refusal now says which kind of script it is (`OVERWRITES`, `BULK_ADDS`, `HARD_DELETES`).
2. **`POST /surf-spots/admin/seed-florida-spots` fails closed**: 410, with the reason and a pointer to the holding
   table. Re-enabling takes `ALLOW_FLORIDA_SPOT_SEED=1` on the server. The route is kept.
3. **`POST /admin/spots/import`** was ALREADY failing closed since 2026-07-28 (it needs `ALLOW_CURATED_IMPORT=1`).
   Two changes: its refusal is now 410 (it was 409) with the holding-table pointer, and `include_osm=true` is refused
   BEFORE the setting is looked at, so the setting cannot bring the OpenStreetMap leg back.
4. **The OpenStreetMap import is removed.** `import_global_spots.import_osm_spots` had its body deleted and now
   always raises `OsmImportForbidden`; `run_global_import` no longer calls it; the route no longer imports it. No
   environment variable re-enables it. Production carries zero `osm_id` rows, and OSM coordinates (ODbL share-alike)
   may not be written to `surf_spots`.

Environment variables named by this PR: `RAW_ALLOW_LEGACY_SPOT_SCRIPT` (scripts, exact script name),
`ALLOW_FLORIDA_SPOT_SEED` (the Florida seed route), `ALLOW_CURATED_IMPORT` (the curated import route, existing).

## Measured

- `tests/test_spot_safety_guards.py`: 17 new tests (11 scripts' stops; the refusal wording and the opt-in; the
  Florida route refused and, with the setting, running; the import route refused in three cases including OSM with
  the setting ON; the OSM importer raising with every setting ON, its insert gone from the source). 67 passed locally
  across this file, `test_spot_import_honesty.py` and `test_admin_only_write_routes.py`. flake8 gate clean.
- **Run for real**, with the opt-in unset: `python scripts/dedup_surf_spots.py`, `python scripts/import_global_spots.py`,
  `python -m scripts.expand_europe`, `python -m scripts.seed_missing_florida_spots` and
  `python -m scripts.caribbean_pacific_expansion` each exited 1 printing the refusal ("... is a retired one-off: ...
  Nothing was changed."). No database was reached.

## Limits

- The stop is an environment variable, not a lock (the advisor's limit on #1070 applies here too). Someone with the
  server's environment can still run any of these.
- Several of these scripts only work as `python -m scripts.<name>` from `backend/`; run by path they already failed
  on `import database` before reaching anything. The stop covers both ways.
- `fetch_osm_surf_spots` (the Overpass fetch) is still in the file. It reads only and nothing calls it.
- `POST /seed-florida-spots` in `spot_seeding.py` (a different route) seeds 17 spots only when the table is EMPTY.
  Left as is: it cannot run on a populated catalogue.
- No frontend calls either gated route (the "Import Spots" button was removed on 2026-07-28).
