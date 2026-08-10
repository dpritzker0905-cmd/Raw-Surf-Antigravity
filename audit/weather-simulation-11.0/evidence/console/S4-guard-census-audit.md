# S4 - GUARDS THAT CANNOT SEE THEIR OWN TARGET

**Lane 4 of the "a refusal you cannot READ is indistinguishable from a pass" sweep.**
Read-only forensic audit, 2026-08-09, working tree at `dev` / `3d3ccdc2`.

Scope: every enumerate-then-assert guard in `backend/tests` and `frontend/src`. For each registry
I derived the TRUE population independently (AST walk / whole-tree grep) and diffed it against the
registry. **The subject under test is the CENSUS, never the assertion logic.**

---

## 0. THE CLASS BEING GENERALISED

`test_rating_composition_parity.py` enumerated THREE rating surfaces in `SURFACES` while the same
file's `POST_STEP_SURFACES` already listed FOUR. The fourth -- `surf_rating.rating_transform_grid`,
the on-map rating band -- composed ratings unwatched for the whole life of the file. One file, two
registries, 3 vs 4.

The generalised shape:

> **A registry is a CLAIM of completeness, not completeness. A guard that iterates a hand-kept list
> reports "every listed member complies" and a reader hears "every member complies". The two
> sentences differ by exactly the members nobody listed -- and nothing in a green run distinguishes
> them.**

Two sub-shapes recur below and are worth naming separately:

* **S-A: the one-directional staleness check.** Many registries here verify that every LISTED entry
  still exists (`test_the_surface_list_is_not_stale`). That is the safe direction and it is
  worthless against the likely drift, which is a NEW member landing outside the list.
* **S-B: `assert len(REGISTRY) >= N` with N hardcoded.** This is the assertion that was supposed to
  catch S-A's blind side and cannot: it is satisfied by any list of length >= N regardless of what
  the true population is, and N is a frozen memory of a past census.

---

## 1. FINDINGS, RANKED

### S4-01 - `GATE_ARG_CALLERS` registers 1 of 4+ call sites, and its reader stops at the first CONFIRMED / High

**File:** `backend/tests/test_rating_composition_parity.py:503-506`

```
GATE_ARG_CALLERS = {
    # file -> (function that must pass it, callee, keyword that arms the post-step)
    "weather_sim_mcp.py": ("get_weather_forecast", "calculate_surf_rating", "valid_time"),
}
```

This registry exists because of a MEASURED defect recorded in its own header
(`test_rating_composition_parity.py:492-502`): `weather_sim_mcp.get_weather_forecast` parsed the
hour, used it for the baseline, and never threaded it into `calculate_surf_rating`, leaving the
observation gate inert -- "Nai Harn read 70.5 `good` on the sim while the app served 66.4
`fair_good`".

**TRUE POPULATION, derived by AST across every `calculate_surf_rating` call site** (my own walk,
enclosing function resolved per node):

| state | file:line | enclosing function | kwargs passed |
|---|---|---|---|
| ARMED | `backend/weather_sim_mcp.py:287` | `get_weather_forecast` | allow_reference_lookup, partitions, served_reference_size_m, **valid_time** |
| **UNARMED** | `backend/weather_sim_mcp.py:486` | `simulate_weather_change` | allow_reference_lookup, partitions, served_reference_size_m |
| **UNARMED** | `backend/weather_sim_mcp.py:556` | `simulate_weather_change` | allow_reference_lookup, partitions, served_reference_size_m |
| ARMED | `backend/services/weather_pipeline/sim_compare.py:190` | `scan` | ... **valid_time** |
| ARMED | `backend/services/weather_pipeline/sim_window.py:112` | `scan` | ... **valid_time** |
| **UNARMED** | `backend/services/weather_pipeline/sim_briefing.py:44` | `summary_line` | allow_reference_lookup, partitions, served_reference_size_m |
| UNARMED (warmup) | `backend/services/weather_pipeline/sim_boot.py:47` | `warm_hot_path` | (none) |
| UNARMED (probe) | `backend/scripts/sim_health_probe.py:168,191,386` | `probe`, `attribute` | - |

The registry names **one** of these. It is the one that is armed.

**Why `weather_sim_mcp.py:556` is the sharp one - it is the recorded defect, verbatim, in a sibling
function of the same file.** `simulate_weather_change` parses the hour at line 366
(`hour, err = _parse_valid_time(valid_time)`) and uses it at line 396 to fetch the baseline
(`_baseline_with_source(spot, hour or None)`). Line 556's `base_calc` then grades that REAL baseline
sea -- `baseline["swell_height_m"]`, not a hypothetical -- and does **not** pass `valid_time`. So the
identical baseline sea is observation-gated when read through `get_weather_forecast` and ungated
when read through `simulate_weather_change`'s `baseline_delta`. That is the exact sentence the
file's header uses to describe the 2026-08-03 defect: "the hour was parsed and used for the
BASELINE, and never threaded into `calculate_surf_rating`".

`sim_briefing.py:44` is the second: `summary_line` grades a live baseline while its two sibling
scanners (`sim_compare.scan`, `sim_window.scan`) both arm the gate. Its signature carries no hour at
all, so arming it needs an interface change -- a real blocker, but one that is **nowhere stated**.

**SECOND-ORDER BLIND SPOT IN THE SAME GUARD.** `_call_kwargs_in_function`
(`test_rating_composition_parity.py:509-522`) returns inside its loop on the first matching call:

```
            if name == callee:
                return {kw.arg for kw in node.keywords if kw.arg}
```

So even a REGISTERED function is only checked at its FIRST `calculate_surf_rating` call. Had the two
unarmed calls been inside `get_weather_forecast` rather than `simulate_weather_change`, the guard
would still be green. Contrast `_rating_call` at line 287 of the same file, which collects EVERY
call and asserts they agree -- the correct pattern exists 200 lines above.

**Consequence: NOT MEASURED.** I did not run the sim, and the score delta depends on whether an
observation report exists for the spot/hour. The code fact is unambiguous; the served divergence is
not quantified here.

**Documented?** NO. There is no exemption text anywhere for what-if call sites, for
`simulate_weather_change`, or for `sim_briefing`.

**Cheapest fix:** key the registry by `(file, function, call-index)` or drop the function scoping and
assert over EVERY call site, reusing `_rating_call`'s all-sites-agree pattern.

---

### S4-02 - `DISCLOSING_SURFACES` omits the on-map RATING BAND: the 3-vs-4 defect, again CONFIRMED / High

**File:** `backend/tests/test_directional_conflict_disclosure.py:188-193, 217`

```
DISCLOSING_SURFACES = [
    ("services/weather_pipeline/spot_ratings.py",       "map glyphs (/spot-ratings)"),
    ("services/weather_pipeline/point_surf_augment.py", "infobox (/point) ..."),
    ("services/weather_pipeline/spot_conditions.py",    "spot hub"),
    ("services/weather_pipeline/sim_rating.py",         "the weather sim"),
]
```

Contract, stated at line 185-187: *"The production surfaces that show a height AND a quality, and
must therefore disclose when the two disagree."*

**The on-map rating band satisfies that contract and is not listed.**
`surf_rating.rating_transform_grid` (`surf_rating.py:685`) computes a breaking height and a quality
score for every cell, preserves the honest height in `phys_speed` (`surf_rating.py:786`) and writes
the score into `speed` (`surf_rating.py:788`). Both numbers reach the user.

Measured: `directional_conflict` appears in **22 files** repo-wide;
`services/weather_pipeline/surf_rating.py` and `services/weather_pipeline/grid_resolver_surf.py`
(the band and its caller) are in neither the registry nor that set. The band is the surface a user
looks at most, and it is the exact surface `test_rating_composition_parity.SURFACES` was missing
until it was enrolled on 2026-08-09.

**S-B present.** Line 217: `assert len(DISCLOSING_SURFACES) >= 4, "surfaces went missing from the
list"`. Four is the count of the list as written. A fifth surface has never been able to make this
red. The comment at line 186-187 is explicit that the list is hand-written *"rather than
discovered"* -- but the reason given ("a list derived from files that call the function would agree
with the code by construction") argues against deriving it from the DISCLOSURE, not against
deriving it from the POPULATION (files that emit both a height and a score).

**Documented?** NO. No exclusion note names the band.

---

### S4-03 - One file, two registries: `SURFACES` has a census test, `HEIGHT_RENDERERS` has none CONFIRMED / High

**File:** `backend/tests/test_sim_every_surface_reads_the_served_curve.py` (218 lines, read in full)

The file's FIRST registry, `SURFACES` (line 39), is guarded properly:
`test_no_surface_is_silently_missing_from_the_registry` (line 118) walks the whole backend tree and
asserts every file calling `calculate_surf_rating` is registered or explicitly exempt. That is the
model implementation.

The file's SECOND registry, `HEIGHT_RENDERERS` (line 172), has **no equivalent**. Its tests are:
`test_every_surface_that_renders_a_height_also_renders_the_conflict` (parametrised over the list
only) and `test_every_disclosure_exemption_still_names_a_real_file` (S-A, one-directional). Nothing
walks the tree.

**TRUE POPULATION** -- production (non-test) files containing `breaking_height_ft`, measured:

| file | in HEIGHT_RENDERERS | in DISCLOSURE_EXEMPT | mentions `directional_conflict` |
|---|---|---|---|
| `backend/weather_sim_mcp.py` | yes | - | yes |
| `services/weather_pipeline/sim_compare.py` | yes | - | yes |
| `services/weather_pipeline/sim_window.py` | yes | - | yes |
| `services/weather_pipeline/sim_briefing.py` | yes | - | yes |
| `services/weather_pipeline/sim_rating.py` | - | yes (PRODUCER) | yes |
| **`services/weather_pipeline/sim_explain.py`** | **NO** | **NO** | **NO** |
| **`services/weather_pipeline/sim_observed.py`** | **NO** | **NO** | **NO** |
| **`backend/scripts/sim_health_probe.py`** | **NO** | **NO** | **NO** |

* `sim_explain.py:142` emits `"inputs": {"breaking_height_ft": round(surf_h_m / 0.3048, 1), ...}`.
  It is reached in production: `sim_rating.py:371` calls `sim_explain.explain(...)` and embeds the
  result. **Mitigating:** the explain block is nested inside a `sim_rating` payload that carries the
  top-level disclosure, so a reader of the whole payload is not misled. It is nevertheless an
  undocumented match for the registry's own stated predicate.
* `sim_observed.py:199` reads `wave_simulation["breaking_height_ft"]` and emits
  `sim_breaking_height_m` / `served_surf_height_m` / `delta_pct` to the caller
  (`sim_observed.py:200-204`) -- a height in front of a caller, with no conflict marker.
* `scripts/sim_health_probe.py` is documented-exempt in the OTHER registry (`EXEMPT`, line 56) and
  **not** in `DISCLOSURE_EXEMPT`. The two exemption sets in one file do not agree, which is the same
  two-registries-one-file shape as the founding defect.

**Documented?** NO for all three, in this registry.

---

### S4-04 - `CHAIN_MODULES` scans 6 modules; 89 chain constants live outside the scan CONFIRMED / High

**File:** `backend/tests/test_science_registry_coverage.py:71-78`

This file is otherwise the best-instrumented guard in the repo: it has a circularity guard
(`test_no_registry_module_falls_out_of_scope`), a positive control, a discriminator control, and two
shrink-only ratchets. Its blind spot is the one thing it declares rather than derives.

`CHAIN_MODULES` = `surf_transform`, `surf_rating`, `surf_point`, `surf_height_convention`,
`spot_size_climatology`, `wave_physics`.

**Measured** (my AST scan, identical predicate to `_numeric_module_constants`: module-scope
`UPPER_CASE = <numeric literal>`), across `backend/services/weather_pipeline/*.py`:

* inside `CHAIN_MODULES`: **48** constants (matching the guard's own `>= 40` floor)
* outside `CHAIN_MODULES`: **89** constants in 33 modules, none registered, none grandfathered

The ones that are unambiguously in the ONE FORECAST COMPOSITION chain:

| module | constants | why it is chain | evidence |
|---|---|---|---|
| `bathymetry.py` | `SHELF_BREAK_DEPTH_M`, `_KM_PER_DEG`, `_SLOPE_SCALE` | supplies the depth-limited cap's own inputs | imported by `surf_point.py:70` -- i.e. by `resolve_surf_geometry`, the chain entry CLAUDE.md mandates |
| `shore_normal_asset.py` | `MATCH_RADIUS_KM`, `BEARING_RADIUS_KM`, `_BUCKET_DEG`, `_EARTH_KM`, `LAND_PRESENT_MAX_KM` | the #1 Jacobian variable; `BEARING_RADIUS_KM` is the code twin of the REGISTERED flag `SHORE_NORMAL_BEARING_RADIUS_KM` (default '3.0') | `resolve_spot_geometry.py`, `wave_wrapping.py` |
| `rating_confirmation.py` | 11, incl. `GOOD_T`, `EPIC_T`, `AGREE_MODELS`, `REPORT_NUDGE_K`, `REPORT_NUDGE_MAX` | the post-`rating_score` observation gate; `GOOD_T`/`EPIC_T` are the displayed level thresholds (memory records them as 70 / 84) | imported by `spot_ratings.py:749`, `spot_conditions.py:424`, `sim_rating.py:337`, `grid_resolver_surf.py:183`, `routes/weather.py:580` |
| `shore_normal_fit.py` | `MAX_SPREAD_DEG`, `_MIN_TRUSTWORTHY_DEPTH_M`, `_MIN_WATER_CELL_M`, `_M_PER_DEG` | the confidence gate deciding whether a spot gets a bearing at all | `scripts/build_shore_normals.py:50` |
| `wave_wrapping.py` | 7, incl. `SPREAD_SIGMA_DEG`, `CELERITY_RATIO_DEFAULT`, `HEADLAND_ROTATION_MAX_DEG` | landed 2026-08-09 (`a1971972`) with the commit message "UNVALIDATED-BY-ME"; default OFF | -- |
| `swell_fetch.py` | `MAX_FETCH_KM`, `HALF_ANGLE_DEG`, `N_RAYS`, `_STEP_DEG` | fetch-geometry raycast | -- |
| `height_quantile_map.py` | `BLEND_MARGIN_M` | height blending | -- |
| `ocean_access.py` | `DEEP_M`, `MAX_OCEAN_KM` | -- | -- |
| `period_bands.py` | `BAND_MIN_H_M`, `RESIDUAL_MIN_H_M` | -- | -- |

**Why a green here misleads.** The suite's own ratchet message says unsourced-calibration debt is
**29 entries** and shrink-only. A reader takes that as the chain's total unsourced debt. It is the
debt of six files. `rating_confirmation.GOOD_T` -- the number that decides whether the product says
"good" -- has never been in scope.

**Documented?** PARTIALLY. The docstring at lines 18-28 documents WHY the list is declared rather
than derived (circularity), and lines 30-35 document two predicate exclusions (derived values,
function-locals). It does **not** document why bathymetry / shore_normal_asset / rating_confirmation
are outside the chain -- and line 69-70 asserts the list "MUST include ... the chain modules",
i.e. it claims the six ARE the chain. That claim is false.

**S-B present** at line 198 (`assert len(rows) >= 40`) and line 303 (`assert len(debt) <= 29`).
Both are documented ratchets, so they are a lesser instance -- but both freeze a number derived from
the same partial census.

---

### S4-05 - `_RATING_SURFACES`: the flag scan sees 36 of 47 science flags CONFIRMED / Medium

**File:** `backend/tests/test_flag_lane_parity.py:350-372`

This guard's own header records that the scan "came to see 17 of 35" and was widened on 2026-08-02.
It has been widened, not closed.

**Measured.** Whole-`backend/` scan for `RATING_|SURF_|SPOT_HUB_|SHORE_NORMAL_` env reads (patterns:
`os.environ.get`, `os.getenv`, `environ[...]`, `_v3(...)`):

* the guard's own scan (11 listed files, 2 patterns): **36** flags
* true backend-wide population: **47** flags
* registry `_RATING_FLAGS`: 40 entries

**Files reading a science flag that are NOT in `_RATING_SURFACES`:**

| file | flags |
|---|---|
| `services/weather_pipeline/wave_wrapping.py` | `SURF_WAVE_WRAPPING` |
| `services/weather_pipeline/product_selection.py` | `SURF_REGIONAL_PREFER_FULLCOVER_SPAN_DEG`, `SURF_REGIONAL_PREFER_MAX_POKE_DEG`, `SURF_REGIONAL_PREFER_WIDE_POKE_DEG` |
| `services/weather_pipeline/grid_resolver_selection.py` | `SURF_REGIONAL_PREFER`, `SURF_REGIONAL_PREFER_MIN_FRAC` |
| `services/weather_pipeline/marine_mid_res_ingestion.py` | `RATING_GRID_SIZE_CLIMATOLOGY` |
| `services/weather_pipeline/point_resolution.py` | `SURF_PARTITIONS` |
| `scripts/build_shore_normals.py` | `SHORE_NORMAL_ALLOW_SHRINK`, `SHORE_NORMAL_MIN_BREAKABLE_DEPTH_M`, `SHORE_NORMAL_MIN_RETAIN`, `SHORE_NORMAL_MIN_WINDOWS` |
| `scripts/science_shadow_ab.py` | `SURF_TIDE_DEPTH` |
| `scripts/surf_science_audit.py`, `scripts/sim_health_probe.py` | `RATING_LOCAL_SIZE` |

**Eleven flags are invisible to the guard entirely; six of those are also absent from
`_RATING_FLAGS`**, so they are invisible to the admin panel too -- which the registry's own comments
(`surf_forecast.py:35-37, 62-66`) call out as the failure mode: *"an unregistered flag is invisible
to the admin panel"*.

The four `SHORE_NORMAL_MIN_*` / `ALLOW_SHRINK` knobs in `scripts/build_shore_normals.py` govern the
retention gate for the shore-normal ASSET -- the #1 Jacobian variable's own build. The three
`SURF_REGIONAL_PREFER_*_DEG` knobs in `product_selection.py` choose which product answers a
viewport.

**Documented?** ONE exclusion is documented, correctly and by role
(`test_flag_lane_parity.py:366-368`: `ecmwf_opendata_fetcher.py` is an ingest fetcher, not a rating
surface). The other omissions are undocumented.

**Note in the guard's favour:** the sibling lane census IS clean. I enumerated all 27 workflow files
and found exactly 4 that set a `RATING_|SURF_|MARINE_|SPOT_RATINGS_|SHORE_NORMAL_|ECMWF_` flag, and
all 4 are in `GUARDED_LANES`. See S4-08 for the latent hole there.

**S-B present** at line 147 (`assert len(REGISTRY) >= 10`, actual 40) and line 430
(`assert len(read) >= 27`, actual 36 -- documented as a deliberate shrink-only floor).

---

### S4-06 - `PRIVATE_ENDPOINTS` guards 5 of 10 websocket routes CONFIRMED / Medium

**File:** `backend/tests/test_websocket_endpoints_auth.py:12-18`

Registered: `/ws/earnings/{user_id}`, `/ws/user/{user_id}`,
`/ws/photographer/{photographer_id}/activity`, `/ws/call/{user_id}`, `/ws/presence/{user_id}`.

**TRUE POPULATION** -- every `@router.websocket(...)` decorator in `backend/routes/`:

| route | registered | auth in code |
|---|---|---|
| `/ws/earnings/{user_id}` | yes | - |
| `/ws/user/{user_id}` | yes | - |
| `/ws/photographer/{photographer_id}/activity` | yes | - |
| `/ws/call/{user_id}` | yes | - |
| `/ws/presence/{user_id}` | yes | - |
| **`/ws/admin/events`** (`routes/live/websocket.py:134`) | **NO** | **none** -- `ws_manager.connect(websocket, room="admin_events")` runs unconditionally, no token parameter, no dependency |
| **`/ws/lineup/{lineup_id}`** (`routes/live/websocket.py:234`) | **NO** | **none** -- `ws_manager.connect(websocket, room=f"lineup_{lineup_id}")` unconditional |
| **`/ws/crew-chat/{booking_id}/{user_id}`** (`routes/crew/crew_chat_reactions.py:244`) | **NO** | `verify_chat_access(...)`, closes **4003** (the guard's helper asserts **1008**) |
| `/ws/conditions` (`websocket.py:99`) | no | public broadcast (plausibly correct) |
| `/ws/live` (`websocket.py:159`) | no | public broadcast (plausibly correct) |

**Consequence: NOT MEASURED.** I did not stand up a server or connect a socket. The CODE FACT is
that `/ws/admin/events` has no token parameter and no auth dependency; whether it broadcasts
anything sensitive in production is not established here.

**Documented?** NO. The list carries no comment naming which routes are deliberately public. A file
called `test_websocket_endpoints_auth.py` with a constant called `PRIVATE_ENDPOINTS` reads as
"every private websocket is covered".

**Related, documented elsewhere:** `CLAUDE.md` states the BOLA release "does not certify the
remaining BOLA backlog", which covers `STRICT_AUTH_FUNCTIONS`
(`test_sensitive_route_auth_contracts.py:10`, 7 files) as a scoped regression contract rather than a
completeness claim. That one is a DOCUMENTED partial census.

---

### S4-07 - `assert len(REGISTRY) >= N` with hardcoded N CONFIRMED / Low (enabler, not a defect on its own)

Every instance found in the repo:

| location | assertion | actual size | can it ever fail on an omission? |
|---|---|---|---|
| `test_rating_composition_parity.py:588` | `len(POST_STEP_SURFACES) >= 4` | 4 | no -- this is the shape that let 3-vs-4 pass |
| `test_directional_conflict_disclosure.py:217` | `len(DISCLOSING_SURFACES) >= 4` | 4 | no (S4-02) |
| `test_flag_lane_parity.py:147` | `len(REGISTRY) >= 10` | 40 | no -- 4x headroom |
| `test_flag_lane_parity.py:430` | `len(read) >= 27` | 36 | only on a 9-flag shrink; documented ratchet |
| `test_science_registry_coverage.py:198` | `len(rows) >= 40` | 48 | documented positive control |
| `test_science_registry.py:63` | `len(SR.all_constants()) >= 8` | -- | documented anti-vacuity check |
| `test_flag_lane_parity.py:537` | `len(selected) > 50 and len(excluded) > 50` | -- | documented anti-vacuity check |
| `docs/research/AUDIT-2026-08-01-v3-forensic-simulation-audit.md:174` | quotes `>= 4, "all five rating surfaces must be listed"` | -- | historical: the message said FIVE while asserting FOUR |

The last row is the class in one line: the assertion's own message contradicted its number, and it
was green.

---

### S4-08 - `_LANE_FILES` can only see lanes it already enumerates HYPOTHESIS (latent) / Low

**File:** `backend/tests/test_flag_lane_parity.py:329-334, 456-473`

`test_every_workflow_lane_the_registry_names_is_a_lane_this_suite_reads` loops
`for key, filename in _LANE_FILES.items()` and flags only when `key in text`. A registry entry whose
"where to flip" names a workflow with no matching key -- e.g. `build-shore-normals.yml` or
`science-shadow-ab.yml` -- produces no match, so `unguarded` stays empty and the test is GREEN
having checked nothing. The guard's own comment (line 324-328) claims "THE INVARIANT IS DERIVED,
NOT LISTED"; it is derived from the registry's TEXT but matched against a LISTED key set.

**Measured, current state is clean:** all 9 registry entries whose `where` mentions a workflow match
a `_LANE_FILES` key, and all 4 workflows that actually set a science flag are in `GUARDED_LANES`.
This is latent, not live. It becomes live the first time a flag's flip target is a fifth lane.

---

### S4-09 - `no-frontend-estimators.test.js` hand-names 2 files; the tree walk covers 1 directory CONFIRMED / Low

**File:** `frontend/src/tests/no-frontend-estimators.test.js`

Tests 2 and 3 read `components/map/forecastSamplers.js` and `components/map/useMarineDataFetcher.js`
by hardcoded path and assert a forbidden-token list. Test 4 walks `components/map` only, for the
single token `euroExtendedEstimate`.

**Measured:** no `euroExtendedEstimate` reference exists anywhere in `frontend/src` outside the test
itself, so no live defect. Six other `frontend/src` files carry `gfs_estimated_*` tokens
(`forecastDiagnostics.js:37`, `forecastHelpers.js:322,324`, `MapForecastOverlayDiag.js:177`,
`useMarineWindData.js:71`, `WebGLMarineLayer.js:1119,1127`, `RenderPlanDispatcher.js:516-527`) but
I inspected each: they are provider-name ACCEPT LISTS, not estimator math. No finding there.

The census gap is structural: a new frontend fetcher outside `components/map` reintroducing
estimator math is invisible to all four tests. **Not documented.**

---

### S4-10 - `loc_ratchet.py` claims "repo-wide"; SCOPES is two directories INFO

**File:** `scripts/loc_ratchet.py:3, 48-61`

Docstring says "repo-wide 800-LOC ratchet". `SCOPES` covers `backend/**` and `frontend/src/**` only.
Repo-root `scripts/` is git-tracked (6 files) and unscanned.

**Measured:** largest tracked repo-root script is `scripts/verify_v7_deploy.py` at 258 lines. Nothing
approaches 800. Latent only. The `.github/loc-baseline.json` registry itself is DERIVED
(`--update-baseline`), so it has no hand-census problem -- its risk is the separate, already-recorded
`--update-baseline` landmine.

The scope comment at lines 33-45 documents the `.js`-only hole that was closed on 2026-07-29 and
explicitly names the class ("A scanner blind to a language is the same defect shape"). The
repo-root omission is not mentioned.

---

## 2. GUARDS THAT PASS THIS AUDIT - use these as the reference implementations

These enumerate AND census. When fixing anything above, copy one of these.

| guard | why it holds |
|---|---|
| `test_fetcher_http_pooling.py:70-95` `test_NO_fetcher_escapes_the_pooling_contract` | **The best in the repo.** Lists `*_fetcher.py` from disk, requires every one to be either in `POOLED_FETCHERS` or *provably* free of `requests.*` calls. The exemption is VERIFIED, not declared -- "that needs no second list to maintain". Its own docstring names the one-directional gap it closes. |
| `test_sim_every_surface_reads_the_served_curve.py:118-144` | Walks the whole backend for `calculate_surf_rating(` call sites; `unregistered = seen - SURFACES - EXEMPT` must be empty. (Its sibling registry in the same file does not -- S4-03.) |
| `test_flag_lane_parity.py:525-551` | Resolves BOTH ci.yml lists by glob and requires the sets to match in both directions, with a documented `_COMPOSITION_EXEMPT` of 2. |
| `test_event_loop_offload_guard.py:73-76` `BLOCKING_GRID_TRANSFORMS` | I derived the true population: exactly `rating_transform_grid` and `surf_transform_grid` exist. Registry is complete. The file also widened `_SCAN_DIRS` from one file to two trees after recording "A GUARD SCOPED TO ONE FILE IS A GUARD AGAINST ONE INCIDENT". |
| `test_science_registry_coverage.py:223-253` | The circularity guard + the named (not counted) scope test are the right instruments; only `CHAIN_MODULES` itself is short (S4-04). |
| `test_observation_gate_single_model_surfaces.py:178-231` | Two-entry registry WITH a paired control test asserting the other three lanes DO read the flag -- so "nobody reads it" cannot pass. |

---

## 3. THE RULE THIS LANE ADDS

> **S-A + S-B together are the signature.** A registry that has a "the list is not stale" test and an
> `assert len(LIST) >= N` is *maximally* reassuring and *minimally* protective: the first check
> verifies the direction that does not drift, the second freezes the census at whatever it was the
> day someone counted. Every registry in Section 1 has one or both. Every registry in Section 2 has
> neither -- it has a **derivation of the true population and a set difference**.
>
> **The test for a registry is: can you write down the query that produces the true population?** If
> yes, the guard should run that query. If no, the registry is a claim and must say so in its own
> failure message.

Second: **two registries in one file is the highest-risk configuration in this repo.** It has now
produced the founding defect (`SURFACES` 3 vs `POST_STEP_SURFACES` 4), S4-03
(`SURFACES` censused vs `HEIGHT_RENDERERS` not), and S4-03's exemption split
(`sim_health_probe.py` exempt in `EXEMPT`, absent from `DISCLOSURE_EXEMPT`). When a file holds two
registries over overlapping populations, assert their relationship explicitly.

---

## 4. METHOD AND LIMITS

* All population derivations are AST walks or whole-tree regex over the working tree at `dev` /
  `3d3ccdc2`, run with `C:/Users/dprit/AppData/Local/Python/bin/python3.exe`.
* **No test was executed.** Every "the guard is green" statement is inferred from reading the
  assertion against the derived population, not from a pytest run. Where I say a guard "would pass",
  that is a code-level inference.
* **No consequence was measured live.** No sim run, no server, no websocket connection, no workflow
  dispatched. Score/height deltas for S4-01 and access outcomes for S4-06 are NOT MEASURED.
* Scope covered: `backend/tests/**`, `backend/services/weather_pipeline/**`, `backend/routes/**`,
  `backend/scripts/**`, `scripts/**`, `frontend/src/**`, `.github/workflows/**`,
  `.github/loc-baseline.json`.
* Not covered: `frontend/e2e/**` (Lane 1's subject), `backend/tests/test_*_iter*.py` feature suites
  (their constants are fixtures, not registries -- sampled ~20, none enumerate-then-assert),
  `Graph-Tools/**`, `.claude/worktrees/**`.
