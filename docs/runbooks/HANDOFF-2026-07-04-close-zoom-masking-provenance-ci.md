# HANDOFF → next context (2026-07-04, dev = `b88bb0ce`)

**Standing order unchanged: dev-only, NO main pushes.** Netlify prod = `main`, far behind dev.
⚠️ Bundle checks = the **MapPage CHUNK**; verify chunk markers before live-behavior conclusions.
Memory: `infobox-poison-watchdog-colormap-2026-07-04.md` (4 parts) mirrors this file.

## 0. Read order for a fresh context
1. This file. 2. Memory index START-HERE block. 3. `docs/audits/AUDIT-2026-07-03-weather-system.md`
(architecture map). The 07-03 handoffs remain the deep background.

## 1. The day's 14 commits (all tested; FE 517/517, BE 486/486 at close)

| Commit | What |
|---|---|
| `461c2cdf` | Watchdog kill-loop: governor is BLIND to backend-redirect fetches → spare live `__MARINE_INFLIGHT__` foreground entries; hard lease 25s still heals; stale-lock timer re-arms |
| `f45f0c0b` | Infobox cached-failure poisoning: terminal no-data responses now 30s TTL (was 10 min); ICON swell_2 blend re-throws aborts (was caching 'unsupported'); `selectExactPointHour` point-authoritative over grid diag + layer match + empty-time crash guard |
| `183b6257` | Colormap v5: anchors ON legend ticks (0.6/1.2/2.4/5m = 2/4/8/16ft); c1 → green family (dark spring green, light sea green); surf mode byte-identical; ladder navy/green/cyan/azure/violet/purple/pink |
| `0f01f83c` | Coarse scalar block aggregation: heights block-RMS + periods H²-weighted (WW3 partition flicker made exact-0 potholes; (-60,-50) read 0.0 vs reference 7.64m). Kill `NOAA_COARSE_SCALAR_BLOCKMEAN=0` |
| `7b89eadf` | **PROVENANCE TRUTH**: native Copernicus save loop stamped `estimated_after_index=0` on REAL CMEMS (all 108 EURO products `_estimated`-named); 3 serve-time overrides whitewashed GENUINE estimates as native in PROD ONLY — all removed; labels flow from product truth in every env |
| `1a878214` | Recycled forecast_cache wind (time-shifted stale snapshot) now saves ESTIMATED (was unlabeled live forecast). Mock audit: all generate_mock_* sites verified prod-unreachable |
| `9f5a95ee` | Hermetic wind fallback tests (`hermetic_om_wind` conftest fixture) — the 4-failure family was live open-meteo network |
| `b4bbf338` | `store.prune_duplicate_valid_times()`: newest run per (model,domain,layer,region,valid_time); coverage-safe; wired guarded at end of ingest_forecast_ci (cancelled runs never pruned → GFS 763/layer) |
| `df33483d` | Follow-up: native-basis attaches ONLY when estimated_after_index is None (ICON pressure <120h pin) |
| `56465397` | Zoom flash: `handleRegionalGridClearing` null → RETAIN-STALE stamp (once, identity-stable); truth-tracker lineage product-scoped (no more console.error MISMATCH on coarse↔regional swaps → no false HUD violations) |
| `c47f7a81` | Land bleed roots: ENCODER-level mask authority (regional bounds always prefer `__LAND_GEOJSON_HIRES_CACHE__` — commits raced the 50m→10m swap; last-mirror lesson); OceanMask style-fill 10m wiring (never wired before); BLEND-BOTH wash damp z8→9.5 (world mask ~39km/texel); 4096×2048 mask canvas <10° span |
| `646e127b` | **BASEMAP-WATER TRUTH mask**: viewport patch repainted from the basemap's own water polygons (ocean/sea class only → canals/marinas stop carrying swell); hole rings re-assert black (overzoomed parent tiles erase small islands — the Venice regression); re-applied in `safeUploadWaveData` (backstop/sharpen commits have no map event/revision). Kill `__RAW_BASEMAP_WATER_MASK__=false` |
| `d6861232` | Coarse WORLD grid at z≥8 suppresses crest particles (dirCoherenceMin=2) until sharpen lands — the "waves over Venice z7.67-22, fixes itself" transient |
| `b88bb0ce` | **CI pilot split**: measured phases core ~45m / pilots ~67m (marine 21m, wind 2/18/26m) = the 165-min timeout root. `INGEST_PILOTS` include\|skip\|only; core=skip; NEW `forecast-ingest-pilots.yml`=only at :45 offset, **SAME concurrency group** (manifest uploads last-writer-wins — concurrent workflows clobber) |

## 2. OPEN — DO NEXT (priority order)

1. **Verify ingestion run 28690149295** (dispatched from `df33483d`; was queued behind the
   in-flight cycle — check `gh run list --workflow=forecast-ingest.yml`). On completion:
   ① GFS wind_waves exact-0 potholes gone — recipe: our `/grid` 3-model cell-diff → open-meteo
   marine API (`models=ncep_gfswave025,...`, multi-point) → our own `/point` direct ladder as
   third referee. Cell (-60,-50) was the worst case.
   ② EURO marine products named WITHOUT `_estimated`; HUD reads AUTHORITATIVE NATIVE for native
   hours and ESTIMATED only for the GFS 10→14d tail + live fallbacks.
   ③ Manifest GFS counts ~763→~130/layer (duplicate sweep log line in the run output).
   ④ First `INGEST_PILOTS=skip` core run finishes well under 90 min; first
   `forecast-ingest-pilots.yml` run exists, queues AFTER core (same group), completes.
2. **Venice/Lido live confirm** of the hole-reassert (`646e127b`): with a regional/viewport grid
   resident at Venice z11-12, `__GPU_DEBUG__={mode:'mask'}` must show Venice+Lido+Murano black.
   Verified against a replication canvas only — live confirm owed.
3. **Sharpen re-drive root-cause**: at a fresh site the coarse WORLD grid can stay resident for
   MINUTES (observed: Venice post-reload, inflight=0, pending=false, no backstop log) before the
   viewport product loads. `d6861232` hides it for crests; the heatmap still shows coarse. Find
   why "Render backstop: coarse_global at zoomed-in viewport + idle ≥3s" doesn't always re-drive
   (dedup guards? `locks.lastHash` 5-min window? backstop trigger conditions in
   useMarineScrubSettle ~L409).
4. **User decision — ferry routes**: the "lines in the water" = labeled Catalina Express ferry
   routes (basemap truth, worldwide). If unwanted on a surf map: visibility none on `ferry`,
   `ferry-auto`, `ferry-aerialway-label` (+ re-hide after style reloads — OceanMask's styledata
   path is the precedent).
5. **User eyeballs owed**: colormap v5 ladder on LIGHT + BEACH themes (dark verified); real
   long-press infobox recovery (EURO waves + ICON swell_2 blend); Baja 4-corner seam (from 07-03).
6. **Residual watch** (no action without live repro): toggle-mid-fetch surf-key race; satellite
   black patches ([[satellite-black-patches-triage-2026-07-03]] first); `/products` manifest
   payload size on boot; `backend/diagnostics.log` perpetually dirty (gitignore candidate);
   apiClient debug-log spam floods the preview console buffer in <1 min (forensics obstacle —
   consider quieting in dev).
7. **Upgrade queue unchanged** (audit §6): encoded marine data tiles (off main thread) → hourly
   texture time-interpolation → basemap-truth mask beyond viewport (currently viewport-patch only).
8. **Docs**: `frontend/system-brain/weather-simulation-system.md` still stamped stale.

## 3. Forensic levers learned today (add to the toolkit)

- `window.__MARINE_ENGINE__` — the live engine: `_waveData.waveGrid.bounds/cols/rows`,
  `_cachedMaskTex/_cachedMaskBounds/_cachedMaskGeoJSON`, `_coarseBaseData`.
- `__GPU_DEBUG__ = {mode:'mask'}` + triggerRepaint — renders the heatmap's land mask on screen
  (cracked both Palos Verdes and Venice). Modes: uv/mask/grid/mercator.
- FBO readPixels on `_cachedMaskTex` — ⚠️ SIZE-AWARE: world 1024×512, <30° span 2048×1024,
  <10° span 4096×2048.
- Console-hook capture recipe (KEEP/SKIP regex wrap of console.*) — survives buffer flooding;
  DIES on HMR full reload (non-component module edits full-reload the page).
- `queryRenderedFeatures` box query = layer census; weather-canvas-off A/B isolates basemap vs ours.
- The marine layer is a CUSTOM layer INSIDE the maplibre canvas but `map.getStyle().layers`
  OMITS custom layers — use `map.style._order` + `map.getLayer('webgl-marine-particles')`.
  Marine renders ABOVE `ocean-mask-fill` — the GPU mask is the ONLY land cover for waves.
- `querySourceFeatures` returns polygons from EVERY loaded tile LEVEL — overzoomed parents lack
  small holes; any painter must re-assert holes last.
- `git stash` A/B does NOT revert already-COMMITTED bugs (the elif lesson).
- Grep caller-searches with head_limit can hide the real caller (the "never wired" false alarm).

## 4. Levers / kill switches added today
`NOAA_COARSE_SCALAR_BLOCKMEAN=0` (block-RMS heights) · `INGEST_PILOTS=include|skip|only` ·
`__RAW_BASEMAP_WATER_MASK__=false` · wash damp rides `__RAW_BLEND_BASE_WASH__` ·
world-grid crest suppression rides `__RAW_DISABLE_COARSE_CREST_SUPPRESS__` ·
failure-TTL rides `_exactPointCache` per-entry `ttl` · echo `__RAW_GPU__.basemapWaterMask`.
