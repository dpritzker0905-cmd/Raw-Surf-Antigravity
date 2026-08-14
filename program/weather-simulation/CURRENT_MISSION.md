# CURRENT MISSION

**Mission 2 — Split the rating reference implementation off its precompute lane**

| | |
|---|---|
| **Primary objective** | **WS-OBJ-401** — one authority per responsibility |
| **Supporting** | WS-OBJ-502 (regression protection that can fail) · unblocks every future edit to the mandated reference |
| **Canonical task** | *(enabler — no new ID; see §"Why no new ID")* |
| **Baseline commit** | `70ae3623` on `dev` |
| **Gate unlocked** | none directly — this is a **prerequisite**, and it says so |
| **Size** | Medium — one file split, 12 import sites, 5 guards repointed |

## Why this, and why now

`spot_ratings.py` closed Mission 1 at **exactly 800/800 LOC** — the pre-commit ratchet's hard
ceiling. It is the file CLAUDE.md names as the ONE FORECAST COMPOSITION reference implementation, so
**every future repair to the rating chain was blocked behind a refactor**, to be done under whatever
pressure that repair arrived with. Mission 1's own closure recorded this as the top risk.

## Why no new WS-CAN ID

Per §7, a new ID requires an outcome no existing objective covers and independent acceptance
criteria. This has neither: it is a **structural enabler** under `WS-OBJ-401` (one authority per
responsibility), with no user-visible outcome and no gate of its own. Creating an ID for it would be
exactly the "new tasks invented under new names" failure §1 forbids. Recorded in `MISSION_HISTORY.md`
against WS-OBJ-401.

## Problem

One file carried two responsibilities — its own docstring said so: *"rating compute **+** precompute
persistence"*. 800 lines, zero headroom, and the rating half is load-bearing for four other surfaces.

## Root-cause evidence — three censuses, in order

1. **Ten test files read `spot_ratings.py` BY PATH as a source string.** This decided the *direction*:
   the half most guards grade keeps the filename. ⇒ compute stays, precompute moves.
2. **An AST census found exactly two cross-half edges** — `rate_one_spot → _iso_z` (stays; nothing in
   the lane uses it) and `precompute_spot_ratings → rate_one_spot` (kept; the correct direction).
3. **The precompute half reads four science switches.** Moving it without adding the new module to
   `test_flag_lane_parity._RATING_SURFACES` would have made all four invisible — silently.

Full write-up: `docs/research/FINDING-2026-08-14-splitting-the-rating-reference-implementation.md`.

## Files and symbols permitted

- `spot_ratings.py` (trim), `spot_ratings_precompute.py` (new)
- 10 production import sites: `routes/weather.py`, `routes/admin/surf_forecast.py`,
  `scripts/{ingest_forecast_ci,precompute_ci,science_shadow_ab}.py`,
  `services/weather_pipeline/{buoy_calibration,data_health,grid_resolver_surf,rating_confirmation,report_calibration}.py`
- 6 test files repointed + `test_spot_rating_module_seam.py` (new)
- CI floor pair

## Explicit non-goals

- ⛔ **No behaviour change of any kind.** `rate_one_spot` moves not one byte.
- ⛔ No renaming, no signature changes, no "while I'm here" cleanup.
- ⛔ No re-export shim in `spot_ratings.py` — that would be a permanent compatibility layer (§15).
  Importers were updated explicitly instead.
- ⛔ Not the latency mission, not `WS-CAN-0005`.

## Invariants

**Composition:** `precompute.rate_one_spot is spot_ratings.rate_one_spot` — the same object, not a
copy. The parity rule survives a file boundary or it was never structural.
**Direction:** the reference must never import the lane. Cycle = the split undone.
**Census:** every science switch that moved stays inside a scanned surface.
**Ceiling:** both halves under 800, and the reference materially under it — the point was *room*.

## Rollback

`git revert` the commit. It is a pure move plus import updates; no data, no wire, no flag default.

## Stop conditions

1. Any behaviour difference in `rate_one_spot` → stop, this stopped being a move.
2. A guard can only be made green by weakening it → stop and report.
3. The lane count or a floor cannot be reconciled → stop; do not guess the number.
