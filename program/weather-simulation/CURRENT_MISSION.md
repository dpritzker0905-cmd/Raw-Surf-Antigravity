# CURRENT MISSION

**Mission Title:** A verified pin on blind geometry still reads "medium conf" — make the rating say
what it was allowed to know

| | |
|---|---|
| **Primary objective** | **WS-OBJ-207** — Geometry-quality disclosure |
| **Canonical task** | **WS-CAN-0062** |
| **Supporting** | WS-OBJ-401 (one authority per responsibility) · WS-OBJ-502 (regression protection that can fail) |
| **Baseline commit** | `1f4e5149abedef9bc8b6fab4d0d25135e5f787a4` on `dev` |
| **Gate unlocked** | Gate 1 (partial — see §"What this does NOT close") |
| **Size** | Small — one composition site, one vocabulary helper, one guard |
| **Evidence** | `program/weather-simulation/evidence/` |

## Why this mission, and not the one Audit 12.2 authorized

Audit 12.2's authorized mission was **WS-CAN-0066** (the scheduled surf alert states the quality).
**It is already complete** — shipped at `a1b5aac3`, floor raised at `886094ce`, and confirmed live in
the 2026-08-14 handoff. Per program rule §10, the path is re-derived rather than re-endorsed.

`UPDATED_CRITICAL_PATH.md` position ② is *"the provenance visit — `WS-CAN-0005` + `WS-CAN-0062` +
the `run_time` display half"*. Of its three parts, **only `WS-CAN-0062` passes the §12 readiness
gate**:

| part | objective | readiness |
|---|---|---|
| **WS-CAN-0062** geometry disclosure | WS-OBJ-207 | ✅ **Current Blocker: none.** Verified Current at HEAD. One producer. |
| WS-CAN-0005 `run_time`/`cycle_dt` | WS-OBJ-202 | ⛔ **BLOCKED** — register records *"NOT a one-sitting change and a PARTIAL fix is worse than none"*; needs a 4-step staged plan whose steps 3–4 are **owner-facing**. |
| the `run_time` **display** half | WS-OBJ-203 | ⛔ **BLOCKED BY WS-CAN-0005** — see §Findings. Rendering `run_time` today would render the *ingest clock* to users under a model-cycle label. |

## Problem

`spot_ratings.rate_one_spot` serves three orthogonal confidences, and the one the user reads is the
only one that cannot see the forecast's inputs:

| field | grades | reaches a rendered surface? |
|---|---|---|
| `confidence` | the **PIN** (`accuracy_flag` / `is_verified_peak`) | ✅ `MapMarkerLayers.js:285` — *"· medium conf"* |
| `geometry_readiness` | the **INPUTS** (`full`/`degraded`/`blind`) | ❌ mapped at `spotRatingsClient.js:66`, **consumed by nothing** |
| `forecast_confidence` | the **FORECAST** (ensemble spread) | absent unless it binds |

So a spot whose shore orientation could not be resolved at all — the forecast *"cannot tell which way
the beach faces, so every swell direction scores the same"* (`spot_geometry_readiness.summarize`) —
renders identically to a spot with its own measured ETOPO normal and break depth. A **verified** pin
on **blind** geometry renders `high conf`.

This is the `WS-OBJ-506` measure-or-refuse shape on a new surface: the readout asserts a confidence
it did not measure.

## Reproduction

Deterministic, no network: drive the real `rate_one_spot` with a fake resolver whose marine response
carries `geometry_readiness="blind"` and a spot with `accuracy_flag="verified"`.
Recorded in `evidence/tests/`.

## Root-cause evidence

`spot_ratings.py:275` — `spot_confidence(spot.get("accuracy_flag"), spot.get("is_verified_peak"))`.
Two arguments, neither of which is geometry. `spot_ratings.py:240` — `rating_why(...)` takes
`shore_normal` but only to name a wind quadrant; it says nothing when the normal is coarse or absent.
`geometry_readiness` is read at `:124` and passed straight through to `:290` **unconsumed by any
composition step**.

## Active runtime path

`GET /api/weather/spot-ratings` → `rate_one_spot` (live) **and** the cron precompute → Supabase L2
`spot_ratings/latest.json` → `spotRatingsCdn.js` → `spotRatingsClient.js` → `MapMarkerLayers.js`.
One producer for both lanes (the parity rule) — so one repair covers both.

## Architecture authority decision (§Step 1, recorded per governance)

> **CHOSEN: add an explicit disclosure to the string the user already reads. DO NOT redefine
> `confidence`.**

Rejected: *"make `confidence` a function of `geometry_readiness`"* (the register's first-listed
option), for three reasons:

1. `spot_ratings.py:285-299` records a **deliberate** three-axis orthogonality. Folding readiness
   into `confidence` collapses two axes and destroys a distinction the wire already carries.
2. It would silently change a **served field's meaning with nothing on the wire to distinguish the
   old semantic from the new** — which is precisely the one-quantity-two-meanings class that has
   `WS-CAN-0005` blocked. Creating a second instance of the defect the adjacent task is blocked on
   is not an acceptable repair.
3. The register explicitly permits the alternative: *"Make confidence **(or an explicit field)** a
   function of geometry_readiness."*

The disclosure goes in **`why`** because that is the only place it reaches a user today: the
frontend is frozen 85 days (`WS-CAN-0039`), so a new payload key would land on a shelf, while `why`
is already rendered. The **vocabulary** lives in `spot_geometry_readiness.py` beside `summarize()`,
so readiness phrasing keeps one owner (WS-OBJ-401).

## Files and symbols permitted

- `backend/services/weather_pipeline/spot_geometry_readiness.py` — add a compact caveat helper
- `backend/services/weather_pipeline/spot_ratings.py` — consume it at the one composition site
- `backend/tests/test_spot_rating_geometry_disclosure.py` — new guard (guards lane)
- `.github/workflows/ci.yml` + `backend/tests/test_ci_floor_staleness.py` — floor raise ONLY

## Explicit non-goals

- ⛔ No change to `score`, `level`, `confidence`, `surf_height_m`, or any `science_registry.py` value.
- ⛔ No flag flips (`SURF_PARTITIONS`, `SURF_TIDE_DEPTH`, `RATING_*`, any `window.__RAW_*`).
- ⛔ No frontend change. The repair reaches the render through `why`; the dead `geometryReadiness`
  mapping stays as-is and is recorded as deferred.
- ⛔ Not `WS-CAN-0005`, not the `run_time` display half, not `WS-CAN-0064` latency.
- ⛔ No deletion of the second alert implementation, the 261 globals, or any legacy path.

## Invariants

**Scientific:** the rating is a *disclosure* change only — `compute_surf_rating` is not called
differently and the 0-100 must be **byte-identical** before and after for every input. Pin this.
**Composition:** `rate_one_spot` stays the reference implementation (CLAUDE.md ONE FORECAST
COMPOSITION); no second geometry authority.
**Wire:** `test_spot_rating_wire_contract.py` must stay green — no undeclared key.
**Absent unless it binds:** `full` and unknown/`None` readiness add nothing, mirroring
`directional_conflict` and `forecast_confidence`. A caveat on every spot is a caveat nobody reads;
a caveat on a spot we did not grade is a fabrication.

## Tests required

**Before editing:** a test driving the real `rate_one_spot` that FAILS on the known-bad tree,
naming blind/degraded geometry rendering no signal.
**After editing:** that test passes; the score is unchanged; `full`/`None` add nothing; mutation
(revert the consumption) turns it red again.

## Rollback

Revert the two-line consumption in `spot_ratings.py`. Blast radius is one string in one payload —
no forecast quantity, no render path, no endpoint contract, no frontend behaviour.

## Stop conditions

1. The score or level moves for any input → **stop**, this became a science change.
2. `geometry_readiness` turns out not to be present on the live path's response → **stop**, it is a
   data-threading problem, a different and larger mission.
3. `why` turns out not to be rendered on the frozen production bundle → **do not stop**, but record
   it honestly in the certificate rather than claiming delivered user value.

## What this does NOT close

- Not `WS-OBJ-202`. `run_time` is still the ingest clock.
- Not `WS-OBJ-203`. The display half stays blocked.
- Gate 1 advances by one objective, not to completion.
