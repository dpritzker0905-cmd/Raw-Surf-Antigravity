# HANDOFF — Surf‑Rating Engine v2 (physics‑first) + bug backlog — IMPLEMENTATION PLAN (2026‑06‑28)

> **START HERE for a fresh context.** This is the agreed plan to evolve the surf‑rating overlay from a coarse
> raster into a physics‑first, per‑spot rating engine, plus the bug backlog that must land alongside it.
> Discussion happened 2026‑06‑28 PM; this doc is the build spec. Branch `dev`. Don't push `main` (§22 rules).
> Science grounding: Espejo 2014 (multivariable surf index), Goda 2010 (breaker stats), + the nearshore
> transformation literature cited inline below. Keep `surf_rating.py` ⇄ `surfRating.js` in parity. NEVER label
> anything "Surfline" in code/UI.

---

## 0. STATE AS OF THIS SESSION (already shipped on `dev`)
- `9c3a809a` — per‑spot rating **glyphs** (`useSpotRatings.js` samples score/10 from the rating grid → animated
  colored dots in `MapMarkerLayers.js`; spots forced visible in surf mode via `useSpotClusteringData.js`;
  wired in `MapWebGL.js`) + smooth animated band shader (`WebGLMarineShaders.js` `getRatingColorSmooth` +
  `u_time` shimmer) + **infobox retry** fix (`useExactPointFetch.js`, resolves Loading→Timeout).
- `f0d2b6f4` — **infobox accuracy**: `backendWeatherServiceClientPoint.js` drops `grid_product_id`/`grid_bbox`
  hints when the loaded grid is `coarse`/globe‑wide so `/point` resolves the precise viewport tile (was
  sampling the global‑coarse cell → 9.3ft/ENE where the true point is 2.7ft/SW). VERIFIED via curl.
- `aab77b0f` — **arrow revert**: marine direction arrows back to `(dir+180)` travel/toward‑shore (a from‑source
  flip regressed FL/Mexico). Direction DATA is correct everywhere; convention is travel. ⚠️ Don't re‑flip.
- `e0d334ec` — **rating model: swell‑ANGLE exposure added**. `surf_rating.py` is now
  `rating = size_gate × swell_exposure × (0.60·wind_quality + 0.40·period_quality)`; `swell_exposure(swell_from,
  shore_normal)` softened incidence (head‑on=1, grazing↓, behind→0.1, unknown→1.0). Mirrored in `surfRating.js`,
  badge in `MapForecastOverlay.js` passes primary swell dir; parity tests 15 (py) / 14 (js).
- VERIFIED: rating DOES fuse wind on REGIONAL tiles (`/grid?surf=true` → `surf_transform {wind:True}`). The
  backend is accurate; the gaps are (a) coarse/global path, (b) the clamp, (c) deeper nature physics.
- `f96ee1f8` (2026‑06‑28 later) — **CLAMP degree‑boundary fix** (`padRegionalBbox` in `marineGridSeries.js`):
  the `regional_too_small`/`found:false` clamp was a frontend bug (0.5° viewportKey + strict bboxContains +
  TTL dedup pinned a non‑covering tile); padding the grid_series request +0.5° fixes it. The REMAINING clamp
  everywhere else is a backend DATA‑COVERAGE gap (most regions return global‑coarse) → needs the worldwide
  coastal cron ingestion, NOT more code. Rating overlay confirmed correct live (24/24 spot‑id intersection).
- `8f1ce966` (2026‑06‑28 later) — **P2 #1 STARTED: period‑dependent breaker index** (`breaker_index(Tp)` in
  `surf_transform.py`) replaces the fixed γ=0.78. Keyed to PERIOD (not height) so the depth‑limited cap stays
  size‑independent; long‑period groundswell now breaks taller (plunging, γ_b→1.05), windchop lower (spilling,
  γ_b→0.62), centred 0.78 at ~10.5s. 34 tests. NEXT in P2: bed‑slope→Iribarren breaker TYPE (needs per‑cell
  slope), then refraction focus/defocus.
- `1f65c39b` (2026‑06‑28 later) — **P5 STARTED: buoy calibration harness** (`buoy_calibration.py`). Measure‑first
  model‑vs‑NOAA‑NDBC ground truth: pure `parse_ndbc_realtime`/`compare_obs_to_model`/`aggregate_residuals`
  (MAE/bias) + `calibrate_spots` loop (resolves the offshore model at each spot with a `noaa_buoy_id`, compares
  to the buoy's WVHT/DPD). CI hook flag‑gated `BUOY_CALIBRATION=1` (writes L2 report); `GET /api/weather/buoy-calibration`
  reads it. Additive, never changes a rating. 9 tests. NEXT: enable the flag on the cron → read the live MAE/bias.
- **FORENSIC BLOCKERS found this session (data/ops, not code):**
  - **Tide (`tide_fit`):** CO‑OPS fetcher EXISTS (`surf_conditions.get_noaa_tide_data`) but is US‑station‑only AND
    there is NO per‑spot tide‑station mapping (`SurfSpot` has `noaa_buoy_id`, no `noaa_tide_station`; the only
    station dict is hardcoded slugs that don't map to DB UUIDs). UNBLOCK = add+populate a `noaa_tide_station`
    column (US first), then apply tide_fit in `rate_one_spot` (precompute path, gated `RATING_TIDE`). Neutral for
    non‑US spots until a global tide model is ingested.
  - **Finer bathymetry → Iribarren breaker TYPE / refraction:** needs GEBCO (~450m, multi‑GB) to build a
    coastal slope asset; ETOPO 0.25° slope is shelf‑scale (redundant with shelf_dissipation). UNBLOCK = a cron
    job that downloads GEBCO, builds a downsampled COASTAL slope npy (like `build_bathymetry_asset.py`), bundles
    it; then `bed_slope_at` → Iribarren ξ → `breaker_type_quality`. (Local disk was 100% full — can't fetch now.)
  - **Worldwide coastal coverage (the remaining clamp visuals):** OPS — dispatch the `forecast-ingest` Action with
    `WORLDWIDE_REGIONS_PER_CYCLE` over many cycles to warm regional tiles globally; storage/cost implications.

---

## 1. THE VISION (agreed)
A **two‑layer map** backed by a **two‑stage, physics‑first rating** with **forecaster tuning**:
- **Layer A — ambient field (honest, all zooms):** the raw SWELL heatmap. Never a fabricated quality value.
- **Layer C — intelligence (per spot):** animated rating glyphs computed by the engine below.
- Beats the industry by being **physics‑first + location‑specific for EVERY spot globally + explainable +
  skill‑aware + forecaster‑tunable + calibrated to buoys/reports** — vs forecaster‑tuned scores for premium
  spots only.

---

## 2. THE RATING LOGIC (two stages; tags are PRIORS, physics leads)
**Stage 1 — Nature transforms the offshore swell into the LOCAL breaking wave** (objective; per‑location;
precomputable from bathymetry/coastline; tide applied live):
```
depth, bed-slope      ← bathymetry at the verified pin (ETOPO now; GEBCO/finer later)
Kr  refraction        ← swell dir vs depth-gradient/shore-normal  → focus on points/reefs, defocus in bays [10][5][1]
Ks  shoaling          ← Tp, depth                                  (have: surf_transform.shoaling_coefficient)
friction              ← shelf width                                (have: surf_transform v2 cross-shelf friction)
γ(s0, kh) breaker idx ← offshore steepness + relative depth        → replace fixed 0.78 [6]
effective depth       ← still depth + tide(t)                      [7][9]
Iribarren ξ           ← bed-slope + steepness → breaker TYPE (spilling/plunging/surging) [4]
exposure/shadowing    ← coastline fetch in swell direction (Burrows; [1][10])
⇒ Hb (local breaking height), local incidence angle, breaker type, exposure
```
**Stage 2 — Grade that local wave:**
```
rating = size_gate(Hb) × exposure(angle,shadow) × tide_fit(t vs best_tide)
       × ( 0.60·wind_quality(speed, off/on/SIDEshore vs shore-normal)
         + 0.40·period_quality(Tp)
         + w_shape·breaker_type_quality(ξ) )   → 0..100 → 7-level scale, framed by difficulty (skill)
```
- **Tags as priors** (from `models/spots.py`): `wave_type` (beach/point/reef → size tolerance, swell‑window
  width, shape expectation), `best_swell` (validates the refraction window), `best_tide` (calibrates
  `tide_fit`), `difficulty` (skill framing). Physics computes; tags refine/sanity‑check.
- **Confidence** = f(model spread, bathy resolution, `accuracy_flag`/`is_verified_peak`, forecaster‑verified).
- **Explainability**: return a structured `why` (e.g., "Good — clean 8kt offshore, 14s SW on this spot's
  window; mid‑tide + size keep it from Epic").
- **Skill stratification**: beginner/intermediate/advanced read the same conditions differently; SAFETY‑gate
  (never rate a 10ft reef "epic" for a beginner).

---

## 3. NATURE VARIABLE TAXONOMY (have / add)
HAVE: water depth (`bathymetry.shelf_depth_at`), depth‑limited breaking (`surf_transform` γ=0.78), shoaling Ks,
shelf‑width friction (v2), shore‑normal (`shore_normal_at`), swell exposure (`swell_exposure`, just added).
ADD (priority): **γ(s0,kh)** breaker index [6] → **bed‑slope→Iribarren breaker type** [4] → **refraction
focus/defocus** [1][5][10] → **shadowing/diffraction** [1][10] → **tide×depth** [7][9] (needs a tide source) →
seabed morphology (from `wave_type`) → local‑wind modification / currents (advanced, defer).

---

## 4. ARCHITECTURE
- **Precompute on the cron, NOT the serve box.** Hook per‑spot rating computation into the `forecast-ingest`
  GitHub Action (`backend/scripts/ingest_forecast_ci.py`, `.github/workflows/forecast-ingest.yml`) → write a
  small per‑spot rating timeseries to Supabase L2 → serve‑only Render (`DISABLE_FORECAST_SCHEDULER=1`) just
  READS. (1‑CPU serve box must not compute this live.)
- **Per‑spot "nature signature"** precomputed ONCE from static bathymetry/coastline (shore‑normal, bed‑slope,
  shelf width, a refraction/exposure response curve vs swell direction, a γ(s0,kh) table). Store per spot.
  Pattern = NSW Nearshore Wave Tool transformation matrix (WW3 → 10/30m contours, 250m alongshore, 10k+ points) [8].
- **Serving:** new `GET /api/weather/spot-ratings?bbox=&time=` (reads the precomputed L2 timeseries; falls back
  to live `compute_surf_rating` at the spot's `/point` if not precomputed). Glyphs render this — NOT the coarse
  grid sample they use today (that's why remote glyphs are currently inaccurate).
- **Two layers in the engine:** gate the shader's `u_surfMode` rating‑coloring on the rendered grid actually
  being a rating grid (`diagnostics.surf_transform`/`value_kind==surf_rating`); otherwise show the honest swell
  field. (This is the "Option A" fix — see Bug #2.)
- **Model stays `surf_rating.py` (source of truth) ⇄ `surfRating.js` (mirror)**; Stage‑1 physics extends
  `surf_transform.py` + `bathymetry.py`.

---

## 5. FORECASTER TUNING (new — admin tab)
- New table `spot_rating_overrides`: spot_id, optional condition scope (swell dir/size band), **bounded** score
  offset and/or level cap, author, reason, created_at, **expires_at**. Admin‑gated (`caller_role=='admin'`,
  BRAIN_RULES §15; audit trail §15/§20).
- Blend: `final = clamp(physics_score + bounded_offset)`; if a hard level override is set, clamp to ±N levels of
  physics so it can't fully diverge. Surface a **"forecaster‑adjusted"** badge + the reason in the infobox.
- Backend: extend `routes/surf_spots/admin_spots.py`. Frontend: a tab in `components/admin/AdminSpotsPanel.js`
  (+ `AdminSpotEditor.js`) — also expose editing the spot priors (orientation/best_swell/best_tide parsed).
- Also lets forecasters correct the **nature signature** (fix a bad shore‑normal / swell window) — high value.

---

## 6. VALIDATION / CALIBRATION (proves it's right)
- Calibrate Stage‑1/Stage‑2 against **NOAA buoys** (`SurfSpot.noaa_buoy_id` already exists) and **surf
  reports / check‑ins** (`routes/surf_data/*`, `spot-drawer/SpotReportContent.js`).
- Golden test cases: the typhoon W‑Pacific case, a wide‑shelf beach (FL), a steep point break, a reef. Assert
  the rating ordering matches expectation. Keep py⇄js parity tests for every new factor.

---

## 7. PHASED PLAN
- **P0 — BUGS (do first; testing depends on it):** #1 clamp, #2 coarse‑overlay shader gate (Option A), #3
  confirm/repair the global‑grid transform throw. (Details in §8.)
- **P1 — Accurate per‑spot serving:** `/api/weather/spot-ratings` + precompute hook in `ingest_forecast_ci.py`
  → L2; re‑point glyphs to it (point‑based, not coarse‑grid sample); render Layer A honest field + Layer C
  glyphs. Confidence output. Flag `SPOT_RATINGS_V2`.
- **P2 — Nature physics depth:** γ(s0,kh) [6] → bed‑slope/Iribarren breaker type [4] → refraction focus/defocus
  [1][5][10] → shadowing/fetch exposure [1][10]. Extend `surf_transform.py`/`bathymetry.py`; precompute the
  nature signature. Flag `NATURE_TRANSFORM_V2`.
- **P3 — Forecaster tuning + admin tab** (§5). Flag `FORECASTER_OVERRIDES`.
- **P4 — Tide + finer bathymetry:** integrate a tide source (NOAA Tides/model) → `tide_fit`; GEBCO (~450m) for
  slope/refraction. Flag `RATING_TIDE`, `RATING_GEBCO`.
- **P5 — Calibration loop + skill stratification + explainability polish** (§6, §2).

---

## 8. BUGS TO FIX (carry forward — verify each LIVE on a VISIBLE tab; see [[marine-raf-hidden-tab-confound]])
1. **Heatmap CLAMP / freeze (P0, real frontend wedge). ⏳ INSTRUMENTED + guarded recovery shipped (needs ORGANIC
   live verify).** Forensics localized it: the freeze escapes ALL 3 recovery paths — `releaseStaleMarineLock`
   (`useMarineDataFetcherCore.js` L64) + the auto‑redrive timer (L298‑302) are BOTH `isFetching`‑gated, and the
   blank/clamp backstop (`useMarineScrubSettle.js` L254) needs `!pending` AND engine‑empty/clamp (near FL the
   regional grid loaded + covers → neither). Best‑fit cause (matches "only Waves off→on recovers"): a stranded
   `__MARINE_FETCH_PENDING__` (non‑null, isFetching false, governor idle) — it disables runScrubSettleCheck's
   bypass (L117‑126) AND the backstop, while the isFetching watchdog is silent. SHIPPED: a freeze‑state recorder
   (`window.__MARINE_FREEZE_DIAG__`, reasons `stranded_pending` + `stale_not_tracking`) + pure
   `evaluateStrandedPending` + a govIdle‑guarded pending‑lease watchdog that clears the stranded pending and
   re‑drives (telemeter `__MARINE_PENDING_LEASE_RELEASE__`). Green: 12 watchdog tests + build. NEXT: deploy →
   ORGANIC repro on a VISIBLE tab → read `__MARINE_FREEZE_DIAG__` to CONFIRM the cause (or rule out stranded‑pending
   if `stale_not_tracking` fired instead → render/commit freeze, different fix). ⚠️ Delicate subsystem — no further
   orchestrator surgery without the capture. See [[heatmap-freeze-stranded-pending-2026-06-28]],
   [[marine-stranded-fetch-lock-wedge]], [[marine-zoomout-clamp-live-2026-06-25]].
2. **Coarse/global overlay = FAKE rating (P0). ✅ FIXED IN CODE (pending live verify) — Option A.** ROOT CAUSE
   (forensics): the frontend marine conformers (`mapNormalizedGridToWebGL` in
   `backendWeatherServiceClientHelpers.js`; the EURO builder in `backendCopernicusServiceClient.js`) built
   `result.grid` field‑by‑field and **dropped `diagnostics`** → `waveGrid.diagnostics` was undefined, so the
   shader/glyphs had NO signal to tell a real rating grid from a raw‑height frame. FIX: plumb a `ratingMode`
   boolean (`grid.diagnostics?.surf_transform?.value_kind === 'surf_rating'`) through BOTH conformers, then gate
   the shader band (`WebGLMarineEngine.js` ~L417: `surfModeVal=0` unless `waveGrid.ratingMode`) AND the glyphs
   (`useSpotRatings`→pure exported `computeSpotRatings`, returns `{}` unless `grid.ratingMode`; +5 tests). Rating
   mode now shows the HONEST swell field where no real rating exists. Green: 25 JS + 31 py + prod build.
3. **Why the transform doesn't run on the global grid (P0). ✅ ROOT CAUSE FOUND + FIXED.** The deployed
   instrument PROVED it (live `surf_skip_reason` on the global frame): **`OverflowError: math range error`** —
   `shoaling_coefficient` (`surf_transform.py`) called `math.sinh(2*kd)` UNGUARDED (its siblings
   `shelf_dissipation`/`shelf_factor` guard kd first). On the coarse global frame a coastal-classified
   deep-ocean cell (big depth + short period → huge kd) overflowed → `rating_transform_grid` aborted → the
   WHOLE grid fell back to raw height. Regional frames have shallow shelf depths → no overflow → worked. FIX:
   (a) `shoaling_coefficient` `if kd > 20: return 1.0` (deep-water Ks≈1 anyway; +regression test); (b) keep the
   ambient field HONEST at global/coarse zoom on purpose (plan §1) — `grid_resolver` now SKIPS the rating
   transform when the grid span ≥ 350° (`surf_transform: {skipped:'coarse_extent'}`), so the frontend Option-A
   gate shows the swell field there and per-spot glyphs (P1) carry rating accuracy. ⏳ pending live re-verify on
   the next deploy (expect global `surf_skip_reason` gone, `surf_transform.skipped='coarse_extent'`).
   (Original investigation note retained below.)
   ⏳ INSTRUMENTED (truth on next deploy):
   Could NOT decide throw (H2) vs skipped‑gate (H1) from static code: `rating_transform_grid` already wraps every
   per‑cell helper EXCEPT `estimate_surf`/`compute_surf_rating`, and the math helpers all guard `sinh` with kd
   cutoffs; the local `backend/diagnostics.log` is stale 2026‑06‑14 client data (NOT the prod log). So rather than
   guess, added `grid.diagnostics["surf_skip_reason"]=f"{type(e).__name__}: {e}"` in the `grid_resolver.py` `except`
   (~L601) — the NEXT live `/grid?surf=true` on the global frame reveals WHY. Deliberately did NOT add per‑cell
   try/except yet: if the cause IS a cell throw, hardening would silently make the global frame emit COARSE ratings
   (a behavior change; this section leans "leave coarse unrated"). Decide after the instrumentation result.
   See [[rating-option-a-gate-2026-06-28]].
4. **(Shipped — verify after deploy):** infobox accuracy `f0d2b6f4`, arrow revert `aab77b0f`, swell‑angle
   exposure `e0d334ec`. Verify: Pacific point infobox reads ~2.7ft/SW (not 9.3ft/ENE); arrows toward shore.

---

## 9. RULES / TESTS / FILE MAP
- **Parity:** every model change → update BOTH `backend/services/weather_pipeline/surf_rating.py` AND
  `frontend/src/components/map/surfRating.js`; add py (`backend/tests/test_surf_rating.py`) + js
  (`frontend/src/__tests__/surfRating.test.js`) tests. Keep RATING_COLOR ⇄ shader `getRatingColor*` synced.
- **Kill switches:** `SURF_RATING`, `SURF_TRANSFORM` (exist) + new per‑phase flags above. Render serve‑only;
  precompute on the cron Action only.
- **File map:** model `surf_rating.py`(+`surfRating.js`); physics `surf_transform.py`, `bathymetry.py`
  (ETOPO; `shelf_depth_at`/`shelf_width_km`/`shore_normal_at`); grid serve `grid_resolver.py`
  (`rating_transform_grid`,`_build_wind_sampler`); glyphs `useSpotRatings.js`,`MapMarkerLayers.js`,
  `useSpotClusteringData.js`,`MapWebGL.js`; shader `WebGLMarineShaders.js`,`WebGLMarineEngine.js`; infobox
  `forecastCardCompiler.js`,`MapForecastOverlay.js`,`backendWeatherServiceClientPoint.js`,`useExactPointFetch.js`;
  spots `models/spots.py`,`routes/surf_spots/admin_spots.py`,`routes/surf_spots/conditions.py`; admin
  `components/admin/AdminSpotsPanel.js`,`AdminSpotEditor.js`; ingest `scripts/ingest_forecast_ci.py`,
  `.github/workflows/forecast-ingest.yml`,`scheduler/forecast.py`,`prefetcher.py`; ground‑truth
  `routes/surf_data/*`,`spot-drawer/SpotReportContent.js`,`SurfSpot.noaa_buoy_id`.

---

## 10. DATA DEPENDENCIES / OPEN QUESTIONS
- **Tide forecast source** (none ingested yet) → blocks `tide_fit`; neutral until added.
- **Finer bathymetry** (GEBCO ~450m or 10/30m contours) → needed for trustworthy slope/refraction; ETOPO is
  fine for depth/shelf/shore‑normal only.
- **Free‑text priors** `best_swell`/`best_tide` → parse to numeric windows once, or derive orientation from the
  verified pin's coastline (more objective).
- **Level scale:** keeping 7 (very_poor..epic). User floated an 8th ("very good") — confirm before changing
  (ripples colors/shader buckets/tests).

## Memory links
[[surf-rating-overlay-2026-06-28]] · [[rating-glyphs-and-infobox-retry-2026-06-28]] · [[live-test-findings-2026-06-28]] ·
[[surf-breaker-model-coastal-band-2026-06-28]] · [[marine-stranded-fetch-lock-wedge]] · [[decoupled-ingestion-github-action-2026-06-27]]

## Science refs (Consensus / journals)
Espejo 2014 (multivariable surf index); Goda 2010 (breaker stats); Zhang 2021 breaker index r=f(s0,kh);
Zhang 2017 wave‑front slope/Iribarren; Li 2023 coastal transformation (refraction/diffraction/shoaling);
Wang 2022 energy focus/defocus; Li 2023 tide‑modulated breaking; Jackson 2022 beach state (Hb,tide,Ω);
Gomes 2016 bathymetric control on breaking; Doyle 2025 NSW Nearshore Wave Tool (transformation matrix).
