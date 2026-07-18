# HANDOFF 2026-07-18 EOD — the Jacobian marathon: 8 ships, verdict engine, SOTA gap analysis

**Fresh context: read this + memory `session-2026-07-18-jacobian-arc` (+ its 07-17 predecessors) first.**
All ships CI-green on `dev`; HEAD `1846cd39`.

## 1. Shipped this session (each forensically pinned, kill-switched, live-verified)
| Commit | What | Kill |
|---|---|---|
| `85e107db` | Hour-0-first paint lane (fine paint ~2s vs 4.2s; storm-proven) | `__RAW_DISABLE_HOUR0_FIRST__` |
| `79d34611` | NOAA `_coarse_axis` endpoint fencepost (dead east col/north row in EVERY NOAA-direct tile) | revert |
| `167f3787` | Client dead-edge trim (healed the user's vertical line live, pre-bake) | `__RAW_DISABLE_DEAD_EDGE_TRIM__` |
| `07f73d86` | Surf v3.1 shore-normal overrides (Pipeline 325°/Sunset 335°) | `SURF_V3_NORMAL_OVERRIDES=0` |
| `450bc855` | **zoomlab verdict engine** (anim-density columns + typed findings + CI exit) | — |
| `1846cd39` | **DPR backing-store sync** (oversized/blurry crest root) + national-park-only order pin | `__RAW_DISABLE_DPR_SYNC__` / `__RAW_DISABLE_INLAND_ORDER_PIN__` |
| (07-17 tail) | infobox marker `2da69161` · opacity flatten `6141d30c` · sharpen ease `983d5b3c`+`30846e38` · surf v3 `e1d88df6` · §5i coherence gate `5764588d` · NaN guard `93086581` | see memory |

**Standing rules earned this session:** every zoomlab run ends with `node zoomlab-verdict.js <trace>` ·
check `content_type` on every localhost curl (CRA HTML fallback trap) · `getStyle().layers` omits
custom layers · `map.getPixelRatio()` reads live DPR — compare the CANVAS BACKING ratio ·
batteries after ANY opacity/commit-path change.

## 2. OPEN (Jacobian-ranked)
1. **Fencepost bake verification** — ingest run 29629584506 (fix-carrying) was IN PROGRESS at close;
   watcher `b83bu39g0` armed → on completion re-curl the FL tile per-column (expect -79.0 valid) +
   pane screenshot + re-check the §5i Ft Pierce seam (likely same root, may close it).
2. **Task #14 truth re-stamp** — mini/series commits bypass `orchestratorCommit` stage stamping →
   MISMATCH console spam + TruthOverlay render storm (React Scan ×173). Fix in the mini/series
   commit lane; quiets two symptoms at once.
3. **z8 overlay coverage-gap halo** — proven flag A/B (z8 `coverage_gap/cov:false` vs z8.5
   `cov:true`); dig why the overlay rebuild leaves the gap; escaped-mask family.
4. **§5b toggle wedge** — re-observed ×2 (hour-0 exonerated by discriminator); traces banked
   (`h0-batt-on*/`); next wedge → §5f-2 pinning instrument.
5. **Zoom-out transient stripe flash** — verdict engine's DEAD_BAND_TRANSIENT detector is built for
   it; needs a real-GPU capture lane (SwiftShader ~3fps under-samples).
6. Mini-hoist to prewarm (+0.7s) · v3 global hot-bias trim (single lever `SURF_V3_JACK_MAX`, USER
   CALL — changes displayed numbers) · Peniche offshore sampling · anim-source independence ·
   security co-drive (BOLA path-param + buckets) · a11y debt.

## 3. SOTA GAP ANALYSIS (researched 2026-07-18: Open-Meteo features/Ensemble API, Copernicus
GLOBAL_ANALYSISFORECAST_WAV, Surfline/Windy/Windguru/Buoyweather class)
**Already at/above class:** wave partitions ingested+displayed · nearshore breaker physics (v3
Komar+exposure+magnets — most apps DON'T model this) · per-spot local-climatology ratings · WebGL
animated field (Windy-class) · radar+lightning nowcast · truth-lineage instrumentation (rare) ·
multi-model GFS/ICON/ECMWF+CMEMS.
**GAPS, ranked by value/effort:**
1. **TIDES (biggest gap, lever already built!)** — `RATING_TIDE=1` env gates `tide.py`/`tide_norm_at`
   + spot `best_tide` priors, shipped OFF. Surfline/Windy ship tides; surf quality is tide-critical.
   Flip-and-verify arc: validate tide source coverage, A/B on FL anchors, then surface tide state
   in the infobox/timeline UI.
2. **Ensemble/probabilistic bands** — Open-Meteo Ensemble API (GFS/ECMWF/ICON members) → p10-p90
   wave-height bands in the timeline + confidence in ratings. Differentiator vs deterministic-only
   competitors; moderate effort (new ingest lane + UI band).
3. **Ocean currents** — CMEMS currents products (we already auth CMEMS for EURO marine); layer +
   point lane. Boaters/paddlers + rip context.
4. **Model-blend default** — a per-spot "best" blend (we have per-model toggles; competitors ship a
   blended headline). Could ride report_calibration/buoy-calib seeds toward ML bias correction.
5. Offline downloads / chartplotter sync — the 2026 marine-app trend; PWA seeds exist; low priority.

## 4. Deep-forensic state at close
FE 126 suites/1113 · backend 750 + surf/rating/point 226 · CI green through `1846cd39` · final
zoomout battery + verdict running at close (bkyrbpf7n — check its output; PASS expected, the
WEATHER_TRUTH CONSOLE_ERROR finding persists until #2 lands) · fencepost watcher armed · preview
pane verified: DPR-correct from boot, parks away, stripe healed, crests correct size.

## 5. FINAL BATTERY RESULT (the close's proof the testing system works)
`zoomout_ratingoff` at HEAD + verdict engine: **1 finding — DEAD_BAND_TRANSIENT cols 8-12
(x 0.20-0.33), 4 frames, t 16.6-18.2 s (zoom-out settle)** — the machine now auto-detects the
user's "line appears on zoom-out then gets covered" residual (open item #5) with typed geometry
+ timing. First run of the engine on a live trace catching the live residual = the system
validated end-to-end. (Also: one earlier battery attempt died silently because its log went to
/dev/null — NEVER discard probe logs; capture then tail.)
