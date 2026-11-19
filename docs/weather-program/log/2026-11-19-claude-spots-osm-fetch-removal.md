# 2026-11-19 Claude: the leftover OpenStreetMap fetch is deleted from the spot importer

Session: surf-spot adviser lane (`466af216`). Branch `claude/spots-osm-fetch-removal`, stacked on
`claude/spots-bulk-stop` (#1088). One script and one test. No database touched, no spot changed.

**Asked for by the director** (cross-session, 2026-11-18, after reading #1088): "Also delete the uncalled
fetch_osm_surf_spots in a later small PR (dead code that invites reuse)."

**What changed** in `backend/scripts/import_global_spots.py`: the function `fetch_osm_surf_spots` (it posted an
Overpass query and returned OpenStreetMap surfing nodes), the `OVERPASS_API` endpoint constant and the `aiohttp`
import it alone used are deleted, and the module's docstring no longer calls it an OpenStreetMap importer.
`import_osm_spots` stays, only to refuse (#1088). The curated list and `import_curated_spots` are untouched.

**Not changed, on purpose:** `IMPORT_REGIONS` (the tier names and bounding boxes) stays; `routes/explore_discover/geolocation.py`
and `scripts/validate_shore_normals_osm.py` have their own Overpass use for other purposes (place lookup, and a
read-only shoreline check that writes nothing to `surf_spots`) and are outside this change.

**Measured:** one new test (the importer's source has no Overpass fetch, endpoint or `aiohttp`; the function is
gone; the curated list is intact). 39 passed locally across the guard and import-honesty files; flake8 gate clean.
