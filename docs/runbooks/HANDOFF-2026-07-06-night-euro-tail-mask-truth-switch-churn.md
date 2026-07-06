# HANDOFF — 2026-07-06 NIGHT: EURO 4-Day Tail, Mask Truth Guards, Switch Churn, Batching + Cold-Start

**dev HEAD at handoff: `15302d35` + the SimLoop revision-alignment commit after it (see git log).
All pushed, CI green on every push. Suites: frontend 495 tests green (map+engine), backend
targeted suites green (batching 8, cold-start 4, anchor 6, census 3 + adjacents).**

## 1. What shipped (each kill-switched/env-gated, test-covered; live-verified where possible)

| Commit | What |
|---|---|
| `d0e4d834` | **truthTag validity census**: `invalidCount`/`validZeroCount` at BOTH ends (backend compute_truth_tag + frontend tracker, shape-agnostic is_valid/isOcean) — any cleared-rect report becomes attributable from the HUD |
| `5ee86509` | **EURO 4-DAY TAIL REGRESSION FIX**: extended-estimates GLOBAL anchor filter required `is_estimated:true` (relic of the pre-`7b89eadf` mislabeling era) → post-cron-heal re-ingestion pruned the stale estimated tails → anchor pool EMPTY → 241-336h products silently never built (EURO died at ~240h; ICON >168h blend died with it — its blend needs the EURO component). Fix = `euro_estimate_anchor_pool` anchors on NATIVE for every region; empty pool logs INFO |
| `2a894207` | **Bay-flicker on rapid zoom**: mask PATCH CARRY-FORWARD (`maskSmoothing.js`, geo-exact truth-box transplant into every rebuilt canvas; kill `__RAW_DISABLE_MASK_PATCH_CARRY__`) + 50m↔10m hires-swap hysteresis (enter z≥8 / exit z<7.3) |
| `d4f53414` | **Salton Sea / Laguna Salada inland-heatmap leak**: DOC-VERIFIED — Mapbox Streets v8 `water` layer is CLASS-LESS ("single merged shape per tile"), so "no class → ocean" whitened EVERY lake; AND the sheltered classifier skips lonSpan≥10 while the socal tile is EXACTLY 10.0°. Fix = `inlandWaterGuard.js`: basemap water only whitens ≤10km (chamfer) from NE water — "the basemap refines the coastline; it cannot invent new seas". Kill `__RAW_DISABLE_INLAND_WATER_GUARD__`, tune `__RAW_INLAND_WATER_KM__`. Live-verified: Salton z9.5 + Laguna z9.8 CLEAN, Gulf of California control keeps full wash |
| `d7e89335` | **Grey rectangle (El Salvador) + z7→z5.3 zoom glitch**: (a) tile-readiness gate += `areTilesLoaded()`; painter reports `degraded:true` on the parent-vulnerable source-query fallback; degraded paints never hysteresis-lock and never become carry sources; carry never targets ≥30° canvases. (b) LOG-PROVEN field/engine divergence — engine no-downgrade kept regional 10×8 while useSimulationField bound the REJECTED 37×17 into the RK4 field; fix = same predicate + same kill switch (`__RAW_DISABLE_NO_DOWNGRADE__`) on the field side; telemetry `__MARINE_FIELD_NO_DOWNGRADE__` (fired 15× in a 4-toggle smoke — organic validation) |
| `f3b23051` | **CMEMS SPATIAL BATCHING** (chip task_2d50cd81 CLOSED): `copernicus_point_batching.py` — one full-var/full-horizon subset per ~5° spot cluster (~60-100 requests vs ~1000 per-point subprocesses); per-point BATCHED cache entries + batched-key lookup in fetch_euro_marine (own 3h TTL `POINT_BATCH_TTL_SEC`, cap `POINT_CACHE_MAX`). STAGED: precompute.yml flips POINT_SKIP→POINT_BATCH (native EURO point authority restored); forecast-ingest KEEPS skip until proven; contract test pins exactly-one-guard-per-lane |
| `15302d35` (2 commits) | **COLD-START HARDENING** (chip task_e618f9ff CLOSED): `ProductStore._restore_in_progress` flag; grid_series per-hour budget 10→25s during restore + `warming:true` on empty responses; client retries warming-empty series with bounded backoff (never stomps entries with frames). **CLEAR-HOLD**: model/layer switches blink the marine layer inactive; both clear sites now HOLD resident GPU state through transitions (`shouldHoldClearOnDeactivate`; kill `__RAW_DISABLE_CLEAR_HOLD__`, telemetry `__MARINE_CLEAR_HELD__`) |
| (last) | **SimLoop revision alignment**: bindField's evolution clone consumed a revision → SimHealth logged N+1 vs SimLoop's N and the +2 counter stride read as "double-binding" in every log investigation. Evolved revision now = base revision |

## 2. Verdicts that matter (do NOT re-litigate)

- **Cleared-rectangles §2b primary candidate (regional valid-zero land cells): DISCONFIRMED — probe artifact.** All 65 L2 socal frames + /grid + /grid_series (plain+surf) flag land correctly (544 invalid / 0 valid-zero); NOAA-direct both pilots runs; open-meteo returns nearest-ocean or null inland, never exact 0.0. The "134 valid-zero / zero is_valid:false" signature = checking snake_case `is_valid` on MAPPER-shaped vectors (isOcean-only). **Do not ship the old §2b normalizer fix.** The user's actual rectangles = the wide-grid overlay bad-paint class, now hardened (`d7e89335`).
- **Switch-churn item (1) "field rebinds TWICE per commit": FALSE.** One commit = one bind; the rev+2 stride was cloneField burning a counter for the internal evolution copy (now aligned). Adjacent rev lines = two SEPARATE legitimate commits (instant cache-hit + fresher fetch landing).
- **Switch-churn item (3) "cache MISS after instant cache-hit": BY DESIGN (two-phase SWR).** The pre-coalesce fast path commits from the in-memory hourly cache (useMarineOrchestrator ~line 420); the coalesced full path then checks the DIFFERENT backend-switch cache (~line 576) and fetches fresh. The improvement (skip the follow-up fetch when the instant commit already served the same product/valid_time) is in chip task_c5366c79.
- **Switch-churn item (2) OceanMask deactivate-per-switch: REAL, unaddressed** — OceanMask reacts to every raster-queue style transition. Candidate: hold pattern mirroring `shouldHoldClearOnDeactivate`. In chip task_c5366c79.
- **wind_waves (-60,-50) potholes: CLOSED by data probe** — 12 frames across 14d, zero exact-0.0; the 07-04 scalar block-mean healed it.
- **Marine-fetch dead-wedge** (all heatmaps stop, ZERO network requests, "Same-target fetch already in-flight" on every toggle): stranded in-flight marker + style-wait deferral leak; the stranded watchdog is blind to it (requires isFetching=false). Identical code verified working in a fresh session → remedy = hard refresh + SW unregister; root fix is the user's running task task_59bcc036.
- **Manifest measured: 6.1 MB / 6,281 entries, ~991 B/entry — cost is ENTRY COUNT** (GFS marine alone 3,439), no single bloated field. Slimming = design change (slim endpoint or /capabilities migration), not yet chipped.

## 3. PENDING VERIFICATION (first things next session)

1. **EURO 241-336h tail rebuild**: the first scheduled core run (cron `15 */3` UTC) checked out AFTER `5ee86509` rebuilds it. As of 03:30Z the 03:15Z tick had NOT fired yet (GH cron lag). Verify: EURO global_coarse max valid_time ≈ run+336h in the manifest, `is_estimated:true` entries reappear, run log "EURO Marine Extended Estimate ... Saved N>0". Scratchpad recipes: scan_horizons.py / scan_euro_manifest.py (this session's scratchpad).
2. **Spatial batching first live run**: next precompute tick (cron `45 1,7,13,19` UTC) → log "[Copernicus Batching] pre-warm complete: {boxes≈60-100...}" + "BATCHED hit" lines, run inside the 60-min cap. THEN: drop the cap toward 30 and extend batching to the forecast-ingest calibration tail (flip its POINT_SKIP→POINT_BATCH).
3. **EURO un-`_estimated` HUD item**: unverifiable until the estimated tail exists again (zero estimated entries in the manifest at handoff).
4. **User eyeballs owed**: bay-flicker gesture feel, Salton/Laguna, El Salvador rect area, z7→z5.3 feel, model-switch snappiness (`__MARINE_CLEAR_HELD__` + `__MARINE_FIELD_NO_DOWNGRADE__` discriminate which half misbehaves if not) — plus the older colormap v5 light/beach, real long-press infobox, Baja 4-corner.

## 4. Chips / running tasks

- **Running (user started)**: task_57426922 null-island bbox (NOTE: windController.js ~line 301 has the sibling path; check `isStyleLoaded()` synchronously before deferring), task_a1a08217 no-coverage backstop 404-loop damping (priority DOWN post-EURO-fix; still real for aged far-tail hours), task_59bcc036 stranded fetch-marker wedge.
- **Pending chip**: task_c5366c79 switch-churn residuals — REVISED SCOPE per §2 verdicts: (2) OceanMask transition-hold + (3) skip the follow-up fetch after a same-product instant commit. Item (1) is RESOLVED, don't chase it.
- **Not yet chipped**: manifest slimming (measurements in §2); sheltered-water exposure model design; encoded marine tiles.

## 5. Landmines (additions this session)

- **Mapbox Streets v8 `water` is CLASS-LESS** — any ocean/sea class filter is a NO-OP on this basemap.
- **The socal regional tile is EXACTLY 10.0° wide** — mind `>=` vs `>` span guards (the sheltered classifier's `>=10` skip excluded the whole tile).
- **Provenance/label fixes flip the meaning of every filter written against the OLD labels** (the EURO anchor regression) — grep consumers of a flag before relabeling.
- Port 3001 = user's dev server; use launch.json `frontend-verify` (3009) for preview verification; backend CORS allows ANY localhost port.
- A `reused:true` preview server may predate your edits — stop+start (canary must die).
- Probe instruments must match the vector SHAPE of the stage they inspect (mapper camelCase vs series snake_case) — the cleared-rect ghost.
- GH scheduled cron ticks routinely lag 10-40+ min; judge by run list, not the clock.
