# HANDOFF — 2026-07-05 NIGHT: Cron Healed (3 layers), Coastline Truth (2 causes), OOM Root, 14-Day Contract

**dev HEAD at handoff: see git log (16 commits tonight, all pushed, CI+Lighthouse green, full local
regression pass clean: backend 505 passed / frontend map 226 passed).** Render API access now
exists (key in `backend/.env`, service `srv-d7fhiu7lk1mc73debje0`, plan STANDARD 2Gi) — pull
events/metrics BEFORE trusting "backend healthy" (recipes in memory
`render-oom-root-product-cache-2026-07-05`).

## 1. What shipped (each fix kill-switched/override-able, test-covered, live-verified)

| Commit | What |
|---|---|
| `ab45f3e8` | **CRON layer 1**: WEATHER_PROXY_URL empty-secret shadow (`.get(key, default)` returns the CI-injected empty string) → `resolve_weather_proxy_url()` or-fallback; 221 protocol errors → 0 |
| `220cbbdd` | **14-DAY CONTRACT locked** into BRAIN_RULES.md: GFS 14d NATIVE; ICON >168h anchor blend; EURO 241-336h stored estimated; tiers guest 3d / basic 7d / premium 14d via LayerAccessResolver ONLY; horizons via capabilities ONLY (live-verified premium slider max 336) |
| `be907edd` | backend/diagnostics.log untracked (perpetual dirty file) |
| `d43eedc1` | system-brain weather doc REWRITTEN to current architecture (was FCE-era/stale) |
| `8549270d` | precompute cap 30→60 (bridge; drop back once batching lands) |
| `2d7df7d8` | **Low-height crest self-contrast**: "hard line below LB — animations don't cover heatmap" = dashes wash-camouflaged at h<0.75m over the REAL Catalina/San-Clemente swell shadow; height-keyed `max(band, lowH·(1−smoothstep(0.75,1.05,v_wave_height)))`; kill `__RAW_DISABLE_LOWH_CREST_CONTRAST__` |
| `669ccc56` | **OOM root fix**: 29 oomKilled@2Gi on 07-05 alone (zero 06-28→07-04); 128-COUNT product cache × ~12MB parsed mid products = the measured 1.4-1.9GB plateau → PRODUCT_CACHE_VECTOR_BUDGET (120k vectors) LRU. ⚠️ RSS plateau still reads ~1.7GB post-fix (allocator retention vs hidden cache — INCONCLUSIVE; zero kills since 20:16Z under load, so watch, don't engineer yet) |
| `7b2ff38b` | **Cell-size no-downgrade guard**: z7.38→7.54 lattice = 2°/cell mid clip displacing a covering 0.25° fine tile (30% fetch-pad pokes past the 6° socal tile → resolver hands mid; old guard was coarse-GLOBAL-only). ≥2× cell downgrades now rejected under the same safety predicate |
| `ea488c5a` | **Coastline cause 1**: ocean-mask-buffer's bright per-layer colors (cyan .70) exposed through the coarse grid's masked nearshore band → theme-ocean color always (`resolveBufferColor`; legacy via `__RAW_MARINE_BUFFER_SCALE_COLORS__`) |
| `7cfa3808` | apiClient per-request debug opt-in (`__RAW_API_DEBUG__`) — console flood killed |
| `ba5fa06b` | **Coastline cause 2**: WORLD mask tier 1024→4096 (`maskCanvasWidthForSpan` exported ladder; 0.35°→0.088°/texel; band 15-25px→~4px at z4.9; override `__RAW_WORLD_MASK_WIDTH__`) — verified z2.8 + z4.93 |
| `beffc5d0` | **CRON layer 3**: CMEMS throttles under serial per-point volume (138 × full 25s subprocess timeouts = 57.5 of 60 min in run 28754458502) → `POINT_SKIP_NATIVE_COPERNICUS=1` in precompute + forecast-ingest (live /point keeps native-first) |
| (this commit) | GPU mask-texture memory telemetry uses recorded dims (was hardcoded 1024×512 → +31.5MB drift/rebuild after the 4096 change); WebRTC signaling logs silenced after 3 attempts (was ∞ trio) |

## 2. The verdicts that matter

- **CRON GREEN**: precompute run `28756749018` SUCCESS in **5m25s** (first green since 07-03 20:43Z;
  8+ cap-deaths in between). Gate fired 854× (real point volume = 854, not ~300 — healthy-CMEMS
  serial ≈ 81 min, throttled ≈ 5.9h: cap raises could NEVER win). "Spot-ratings precompute
  complete: 1000 spots × 3 frames → L2" — **glyphs fresh again**. Next: confirm the next SCHEDULED
  core run finishes inside 165 (the calibration tail now skips native CMEMS too).
- **Island "shadow" = REAL oceanography** (item CLOSED): the mid tier smears it (texel-wide
  bilinear), sharpen self-heals <1 min. DO NOT add a shader fade
  (memory `island-shadow-verdict-real-data-2026-07-05`).
- **Render**: 29 OOMs mapped hour-by-hour to the mid-serving era; OOM-triad guards ended the
  17-18Z storm; zero kills 20:16→22:30Z through 4 deploys + load tests.

## 2b. NEW user report, DIAGNOSED-CANDIDATE (not yet fixed): "odd little rectangles — cleared
areas that populate on zoom-in, correct on zoom-out"

> **⚠️ CORRECTION (2026-07-06 ~00:30Z, next session): candidate 1 is DISCONFIRMED — do NOT ship
> the normalizer fix.** End-to-end probes: ALL 65 L2 socal frames + live /grid + /grid_series
> (plain+surf) flag land correctly (544 is_valid:false, ZERO valid-zero); both recent pilots runs
> were NOAA-direct; open-meteo returns nearest-ocean values or nulls inland, never exact 0.0; no
> backend GridVector construction site can emit valid-zero land. The "134 valid-zero / zero
> is_valid:false" probe signature matches inspecting MAPPER-rebuilt vectors (which carry isOcean
> ONLY — is_valid is dropped by mapNormalizedGridToWebGL) with a snake_case is_valid check.
> truthTag now carries invalidCount/validZeroCount at both ends (`d0e4d834`) so the next live
> occurrence is attributable from the HUD alone. Candidate 2 (the `8a0260ca` mask-patch class)
> remains the open suspect — still need the user's exact spot/zoom. Full forensics:
> memory `cleared-rect-validzero-verdict-2026-07-05`.

Scripted-gesture repro attempts (LA/Huntington z8.4→11.4 step bursts) did NOT deterministically
reproduce discrete rectangles, so the fix is parked as chip **task_51b3c132** with two evidenced
candidates rather than a guess:
1. **PRIMARY (hard data evidence)**: regional 0.25° products carry land-masked GFS-Wave cells as
   `is_valid:true` + speed EXACTLY 0.00 (live probe: 134 such cells in the socal fine grid, ZERO
   `is_valid:false` anywhere — while the global_mid product for the same region flags them
   properly). The encoder only extrapolates polygon-LAND cells, so valid-zero OCEAN cells render
   as ~cell-sized dark/cleared rectangles at close zoom; zoom-out heals because coarser grids
   replace fine. Fix = normalizer/regional-ingestion sets is_valid:false for model-mask fills
   (compare marine_mid_res_ingestion.py which gets it right); mind the is_valid conform landmines.
2. Secondary (rule out while testing): basemap-water mask patch rectangles applied while water
   tiles are mid-load (the `8a0260ca` rect-holes class) — but the `41bfebca` sourcedata re-drive
   should self-heal those IN PLACE; "heals only on zoom-out" points to candidate 1.
Ask the user for the exact spot/zoom of a live occurrence to close the loop. Related observation
at z11.4 Long Beach: bay wash ~absent (plausibly the valid-zero class) while MARINA basins animate
green patches — the latter is the pre-existing open item ② (lagoon/sheltered-water animation).

## 3. OPEN — next session, in order
0. **Zoom-in cleared rectangles** (LIVE user report, chip task_51b3c132): §2b above — start from
   the valid-zero candidate; get the user's exact spot/zoom first.
1. **Copernicus spatial batching** (chip task_2d50cd81): one regional subset per group of spots →
   restore native-CMEMS authority to batch lanes AND drop the precompute cap back toward 30.
2. **Cold-start hardening** (chip task_e618f9ff): first mid grid_series after a restart returns
   frame_count:0 (PER_HOUR_TIMEOUT 10s vs cold L2 restore) + client 25s stale-lock loop.
3. **RSS plateau question**: watch Render memory under real use; if kills stay zero it's allocator
   retention — no action. If it climbs past ~1.9GB, next levers: warm-on-boot RAM pressure,
   streaming parse, instance upsize.
4. **Eyeballs owed (user)**: colormap v5 light/beach; real long-press infobox; Baja 4-corner;
   close-zoom coast re-sweep; crest-contrast look on light/beach themes (new fix, dark-verified only).
5. "matched 0 reports" in report-calibration persists (sparse surfer logs — pre-existing).
6. Backlog unchanged: sheltered-water exposure design; encoded marine tiles; wind_waves potholes;
   EURO un-`_estimated` HUD-native; manifest size.

## 4. Landmines (additions tonight)
- Preview tab HIDDEN = RAF throttled: "2 FPS"/frozen frames/screenshot timeouts are TAB
  VISIBILITY (`document.hidden`), not perf.
- `preview_stop`+`preview_start` may return `reused:true` (npm child survives) — the served-chunk
  STRING CANARY (fetch the MapPage chunk, grep for your new symbol) is the reliable new-code proof.
- gh run timing: read the JOB's startedAt/completedAt; runs queue behind shared concurrency groups.
- Render events API retention ≈ 10 days; memory metrics resolutionSeconds=60 works.
