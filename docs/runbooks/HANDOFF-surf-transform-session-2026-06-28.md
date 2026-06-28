# Handoff — Surf transform (Option-2→3) + marine-stability session (2026-06-28)

> Fresh-context pickup. **Read the brain first:** `MEMORY.md` (active-handoff line + linked memories), `BRAIN_RULES.md`
> (forensics-not-guessing, smallest targeted fix, don't DoS the 1-CPU/2GB Render box, §22 git rules), and the prior
> handoff `docs/runbooks/HANDOFF-post-decoupling-followups-2026-06-27.md`. This session continued from there.

## 0. State (2026-06-28 ~02:30Z)
- **Branch `dev` = `58a66c51`** (DEFAULT branch; Render + Netlify auto-deploy from dev). **All pushed.** Working tree clean
  except incidental churn (`.claude/launch.json`, `backend/diagnostics.log`, untracked `.codebase-memory/`).
- **`main` = `4583c39b`** = release baseline. **§22:** never push to main autonomously; even when the user authorizes it,
  FIRST ask *"Are you sure you want me to push to main?"* and wait. Push to main ONLY for working-version releases.
- **`prep/icon-coverage-valid-nn` = `1a1134ec`** = a LOCAL, UNPUSHED branch (a coarse-fetcher coverage fix). It is
  **MIS-TARGETED — likely ABANDON** (see §3). Don't push it without re-deciding.
- **`gh` NOT installed** → use the GitHub API with the git credential:
  `TOKEN=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill | sed -n 's/^password=//p')` then curl the API.
  Repo is PUBLIC → Actions free. Render = `https://raw-surf-antigravity.onrender.com`.
- **pygrib has NO Windows wheel** → GRIB-decode fetchers are CI/Render-verified only. Surf physics + bathymetry ARE
  Windows-testable (pure math + numpy); 12 surf tests + 5 bathymetry tests pass locally.

## 1. What shipped this session (all on dev, pushed)
**Marine-stability fixes (decoupling bug class):**
- `46672025` **A1** — GFS regional marine pilot direct from NOAA (FL+SoCal 0.25°), off open-meteo. The pilot was the last
  GFS path on open-meteo → failed on the ephemeral CI runner → zero regionals. ✅ VERIFIED (regionals landed).
- `f67fcd35` **CI-timeout fix** — regional pilot runs LAST + CI timeout 90→120 min. A1's slow NOAA regional fetches
  lengthened the cycle; reorder means a timeout can only cost the nice-to-have regionals, never a core global layer.
  ✅ VERIFIED (run `28304147938` completed all jobs in ~100 min; EURO/Copernicus alone took ~41 min — the long pole).
- `dfa56bff` **mid-cycle partial-manifest fix** (the big one) — `ingest_forecast_ci.py` now `restore_from_supabase()`
  BEFORE ingesting, so the ephemeral run accumulates instead of rebuilding the manifest from empty. ROOT of "EURO
  components + ICON marine intermittently won't load": the run rebuilt the manifest progressively from zero over the
  ~76-min cycle and Render's periodic L2 restore caught PARTIAL snapshots. **⚠️ UNVERIFIED — see §2.**
- `8702e275` **ICON swell_2 Gulf/Antarctica fix** — the GFS+EURO blend anchored on GFS + an exact `(lat*100)|0` key, so
  when GFS swell_2 came back coarse/misaligned (e.g. 60 vec) while EURO returned a rich grid (629 vec, 348 nonzero Gulf
  cells), EURO's real secondary swell was DROPPED → the "square of no swell_2". Fixed: anchor on the fuller grid +
  tolerant ~0.5° lookup + per-cell use whichever source has secondary swell. Frontend; user to verify live.
- `2717c182` **swell_2 drop-probe** — temporary diagnostic; the swell_2 issue turned out to be manifest-flux + the blend
  bug, NOT the render-gate race. **TODO: REVERT this probe** (dead code: `window.__SWELL2_LAST_DROP__` / `[SWELL2_DROP]`).

**Option-2 → 3: bathymetry SURF transform (the feature):** offshore swell → nearshore breaking ("surf") height via
shelf bottom-friction + depth-limited breaking, from a bundled 0.25° ETOPO1 depth grid. Shelf-scale, `is_estimated`,
kill switch `SURF_TRANSFORM=0`.
- `aa29cc18` `surf_transform.py` physics (shoaling Ks, depth-limited breaking, `shelf_factor`, `estimate_surf`,
  `surf_transform_grid`). Pure math, 12 tests.
- `50c6d8c1` `/point` surf + `bathymetry.py` (`shelf_depth_at` = windowed-median) + bundled
  `data/etopo_depth_0p25.npy` (2.1MB) + `scripts/build_bathymetry_asset.py`. ✅ LIVE-VERIFIED on `/point`
  (FL ~0.66–0.79×, Outer Banks 0.88×, Mavericks/Hawaii/deep 1.00×).
- `0f1df6bd` infobox "Surf X ft (est.)" row (carry surf through fetchBackendExactPoint → selectExactPointHour →
  forecastCardCompiler).
- `a1e8cfc5` `/grid?surf=1` per-cell surf transform (resolve_grid `surf` flag). ✅ LIVE-VERIFIED (28 FL cells reduced).
- `1b60d3f9` **Swell↔Surf map toggle** UI near the marine color key (MapWeatherControls) + a `surfMode` flag
  (`window.__SURF_MODE__`/localStorage, getSurfModeFlag/setSurfModeFlag in backendWeatherServiceClient).
- `58a66c51` **wired surf through `grid_series`** (the heatmap's REAL data path — it renders `/grid_series`, not `/grid`)
  + `pageKey` cache now separates surf/swell (the stale-on-toggle root) + infobox "Surf · estimate" badge under the
  header. **⚠️ Render deploy still building when handed off — see §2.**

## 2. ⚠️ PENDING VERIFICATION — do these FIRST
1. **`dfa56bff` restore-at-start has NEVER run in CI.** The last ingest run (`28304147938`) was on `f67fcd35`; the 00:15Z
   cron did NOT fire (GitHub schedule delay/skip). **Action:** dispatch a manual run on dev and verify the log shows
   `Pre-ingest L2 restore: N products carried over from last cycle` AND that `/api/weather/products` stays COMPLETE
   throughout the ~80-min cycle (no winds-only/partial window). Dispatch:
   `curl -X POST -H "Authorization: Bearer $TOKEN" .../actions/workflows/forecast-ingest.yml/dispatches -d '{"ref":"dev"}'`.
2. **`grid_series?surf=1` (58a66c51) Render deploy was still building.** At handoff, a live
   `/api/weather/grid_series?...&surf=1` returned frames with `diagnostics.surf_transform = None` (not yet transforming).
   **Action:** once the Render deploy lands, re-check — the first frame's `grid.diagnostics.surf_transform` should be
   `{transformed: N, shelf: N}`. (`/grid?surf=1` was already verified live.)
3. **The Swell↔Surf toggle — USER live-verifies** (needs Netlify frontend + Render grid_series-surf both live; hard-reload
   for the SW cache): toggle on a coast → heatmap actually changes (shelf cells drop, NOT stale); infobox shows the green
   "Surf · estimate" badge + the "Surf X ft (est.)" row; scrub stays surf. The user reported "stale heatmap" + "infobox not
   updated" on the PRE-58a66c51 build — `58a66c51` is the fix for both; **confirm it actually resolved them live.**

## 3. Known caveats / MVP gaps (Option-2 toggle)
- **Toggle is on the MAIN legend block only** (`MapWeatherControls.js` ~L535). Two other legend layouts (`:~589`, `:~659`)
  don't have the button yet — replicate once the main one is confirmed.
- **EURO surf** uses the slower per-hour series path (the EURO/Copernicus fast-path is bypassed when `surf=1` so the
  per-hour resolve_grid transform applies). GFS/ICON are fast.
- **It's a SHELF-SCALE estimate** (0.25° bathymetry): visible on wide-shelf coasts (Florida), mild at the true surf zone.
  Finer worldwide COASTAL bathymetry/tiling + per-model **refraction (Kr)** are the deferred Option-2 "v2" (shoaling +
  friction + depth-limited breaking only, no refraction yet).
- **`prep/icon-coverage-valid-nn` (1a1134ec) is MIS-TARGETED — likely ABANDON.** It adds `build_regular_nn_valid`
  (nearest-valid-ocean coarse sampling) to the NOAA/DWD fetchers for "Gulf/Antarctica holes", but forensics later showed:
  ICON==GFS at global zoom, the Antarctica cutoff at −60° is PHYSICAL sea ice, and the Gulf swell_2 hole was the BLEND bug
  (fixed in `8702e275`), not the coarse fetcher. Don't push without re-confirming it fixes a real, current bug. (15
  `_fetch_common` tests green; it's a sound general improvement, just not the fix for what was reported.)

## 4. Remaining / deferred work (priority order)
1. **Verify §2 items** (dfa56bff, grid_series surf, the toggle).
2. **REVERT the swell_2 probe `2717c182`** (dead diagnostic).
3. **Option-2 toggle polish:** add the toggle to the other 2 legend layouts; watch for any residual scrub staleness
   (if seen, add an explicit cache clear on toggle in the `rawsurf:surf-toggle` listener in `useMarineDataFetcher.js`).
4. **A2** (task #2) — make `/point` + heatmap prefer the FINEST covering product. `point_resolution` PATH 2 already
   prefers smallest-bbox; the gap is PATH 1 (it honors the passed `grid_product_id`). Now unblocked (A1 regionals exist).
   Highest regression risk = heatmap clamping; gated + live-verified.
5. **Option-2 v2:** finer worldwide COASTAL bathymetry (current 0.25° is shelf-scale) + refraction (Kr). Bigger.
6. **B** [[tiered-forecast-window-14d-2026-06-27]] — tiered 14d via estimator.py (wind/pressure clear past native).
7. **C** [[provider-vs-provenance-labeling-2026-06-27]] — Debt #2 provider un-overload (isolated frontend-lockstep PR;
   LANDMINE #1, don't casually rename `provider`).
8. L2 GC; migrate fetcher BODIES to `_fetch_common`.

## 5. Key facts / landmines for a cold start
- **The marine HEATMAP renders `/grid_series` (multi-hour), NOT single `/grid`.** Critical: any heatmap change must go
  through grid_series (`marineGridSeries.js` ⇄ `grid_series_helper.build_grid_series` ⇄ per-hour `resolve_grid`). The
  per-hour `resolve_grid` is the SINGLE injection point for surf (and is shared with `/grid`).
- **Marine cache key = `pageKey(model, layer, bounds, page)` in `marineGridSeries.js`** (now includes surf/swell).
- **Surf kill switch `SURF_TRANSFORM=0`** (backend). **Surf UI flag `window.__SURF_MODE__` / localStorage `__SURF_MODE__`**.
  The toggle dispatches `window` event `'rawsurf:surf-toggle'`; `useMarineDataFetcher` + `MapForecastOverlay` listen.
- **Bathymetry asset:** `backend/services/weather_pipeline/data/etopo_depth_0p25.npy` (+ `.meta.json`), built from NOAA
  ERDDAP `etopo180` (ETOPO1) by `scripts/build_bathymetry_asset.py`. Loaded mmap (serve-only safe, no runtime fetch).
- **EURO marine global = `is_estimated` BY DESIGN** (`estimated_after_index=0`, "capabilities contract") and relabeled
  authoritative at serve (`grid_resolver.py` EURO block). Do NOT "fix" the estimated label. [[provider-vs-provenance-labeling-2026-06-27]]
- **ICON swell_2 = frontend-synthesized** GFS+EURO blend (`backendWeatherServiceClient.js`); backend `/grid` returns
  "unsupported" for it. The render-gate guard `componentLayer===activeMarineLayer` is truth-safe — don't loosen it.
- **Decoupled ingestion:** CI Action (`.github/workflows/forecast-ingest.yml`, cron `15 */3 * * *`) → Supabase L2 →
  Render restores (serve-only, `DISABLE_FORECAST_SCHEDULER=1`, periodic L2 restore every 30 min). Cycle ~76–100 min;
  EURO Copernicus ~41 min is the long pole. The GitHub cron is UNRELIABLE (delays/skips) — dispatch manually to verify.
- **Masked GRIB:** `np.ma.filled(..., np.nan)` then sanitize-clamp (fill-value-leak gotcha). [[copernicus-mask-fill-leak-2026-06-26]]
- Verify recipe + proven fetcher pattern: `docs/runbooks/HANDOFF-off-openmeteo-campaign-2026-06-27.md`.
