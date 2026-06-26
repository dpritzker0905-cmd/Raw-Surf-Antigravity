# Handoff — Weather Sim Scrub/Toggle Sync Stabilization (2026-06-26)

> Fresh-context onboarding for the marine/wind heatmap **scrubbing + layer/model switching**
> responsiveness work. This is a **sync stabilization, not a rewrite**. Read the brain memory
> (`marine-model-switch-stale-and-snappiness`, `scrub-snappiness-root-2026-06-25`,
> `marine-zoomout-clamp-live-2026-06-25`) alongside this.

Branch: `dev` (deploy: push → Netlify [frontend] + Render [backend] auto-deploy). HEAD at handoff: `3dce8d50`.

---

## 1. The mission
User report (recurring): scrubbing the timeline and toggling marine layers / switching models is
**laggy, not real-time/snappy**. Goal: make scrub + toggle **effective, efficient, stable, real-time**
on the existing stack. Hard constraint: the backend is **1-CPU / 2GB Render** — cold fetches are
slow and concurrency storms it (don't DoS it).

## 2. ★ THE ROOT CAUSE (found + fixed this session — `3dce8d50`)
**The series cache (the correct instant-scrub mechanism) was aborting its own warm during scrub.**
Both warming effects — marine (`useMarineOrchestrator.js`) and wind (`WeatherEngine.js`) — had
`*SeriesPageForHour(timeOffsetHours)` in their `useEffect` **deps**, while the cleanup calls
`controller.abort()`. A fast multi-page scrub crosses the 3-hourly **page boundaries** (141↔144,
285↔288) repeatedly → effect re-runs → **aborts the in-flight prewarm every crossing** → the series
**never warms** → during-scrub re-index + scrub-settle net both miss `getMarineSeriesFrame` /
`getWindSeriesFrame` → **per-hour `/grid` fetch storm** (`[SCRUB-SETTLE] … Triggering fetch`).

It warmed fine at a **stable** viewport (preview diag: `loads>0`, `hits>0`) — which is why every prior
fix looked right in isolation but real-tab fast-scrub stayed laggy. **It was an effect-lifecycle bug,
not a data/GPU/backend bug.** Fix = remove the page from both deps arrays (`prewarm*Series` already
loads all pages; a real model/layer switch still aborts the stale warm = correct).

**Lesson (in the brain):** *when a cache "warms but never helps," check whether its warming effect's
cleanup aborts on a dep that changes during the very interaction it serves.*

**Scope (verified):** ONLY marine + wind use the `grid_series` page-warm. Raster layers
(rain/satellite/pressure/fog/precip) use Open-Meteo **CDN tiles** + scrub-suppress
(`useOpenMeteoTileUrls.js:405`) + debounced settle — **no analogous bug.**

## 3. What to verify (post-deploy, on a VISIBLE tab)
1. Activate marine (or wind), **pause ~2s so the warm completes**, then scrub fast across far hours
   **on ONE model** → `[SCRUB-SETTLE] … Triggering fetch` lines should largely vanish; heatmap tracks
   the slider. Capture: `JSON.stringify(window.__MARINE_SERIES_DIAG__)` → expect `loads>0, hits>0`.
2. Wind: same, `window.__WIND_SERIES_DIAG__`.
3. Remaining cold case = the first ~1–2s right after a **model switch** (new model's warm still
   loading) — that's the 1-CPU ceiling, not a bug.

## 4. Everything shipped this session (all on `dev`)
Frontend (Netlify):
- `3dce8d50` — **scrub no longer aborts its own series warm** (THE root; marine+wind).
- `3433b519` — scrub-settle commits the warmed series instead of a per-hour fetch.
- `f6f2fc00` — wind scrub tracks at global zoom (stable `'global'` series key).
- `9573c587` — instant global-zoom marine scrub (stable `'global'` key + normalized longitude + served bounds).
- `13c9749e` — model-switch coalesce 600→350ms (the "snappier before" regression; storm now contained downstream).
- `34f771c7` — HUD no longer shows EXPECTED EURO Copernicus abort as a `model_error`.
- `317c0b01` — sharpen cold coarse-global the moment regional data lands (event-driven, not 3s poll).
- `0646772c` — never serve a non-covering series frame + faster coarse revalidation.
- `54e289b5` — revalidate cold coarse-preview→regional (z6.5–8 clamp fix).
- `4a1def6c` — finer 10m land mask at z12+ (waves stop bleeding over barrier islands).

Backend (Render):
- `5e5bf3e4` — **restore EURO Copernicus shield** (`asyncio.shield` in `grid_series_helper.py`) so the
  slow CMEMS fetch completes + warms its 10-min cache → EURO serves NATIVE marine (incl. real
  swell_1/swell_2) on the 2nd request. It was lost collateral in the 06-23 00:56 batch revert.

## 5. Verified architecture truths (don't re-derive)
- **Series cache is the instant-scrub mechanism** (marine `marineGridSeries.js`, wind `windGridSeries.js`),
  default-ON, model-keyed, persists across model switches. `prewarm*Series` warms all pages on
  settle + scrub-start. `getMarineSeriesFrame` snaps to nearest ±1.5h (3-hourly frames).
- **Caches PERSIST across model switch** — `_perModelHourCache` (LRU 50, `marineControllerCache.js`) +
  the series. Only OM-Protocol raster tiles get wiped. So **switch-BACK is already instant**; the
  "struggle" is the **cold FIRST fetch** of a model = 1-CPU-bound.
- **EURO marine**: `waves` = real ECMWF WAM (`ecmwf_wam025`, labeled "estimated" per a capabilities
  contract). `swell_1/swell_2/wind_waves` global-coarse = GFS fallback because **ECMWF WAM exposes
  no swell partitions** (`open_meteo_provider.py:261`). Native EURO swells come ONLY from CMEMS
  Copernicus (regional/dynamic, slow) — now reliable again via the shield (`5e5bf3e4`).
- **z6.5–8 "clamp" band**: backend serves regional only for viewports ≤~2°; wider gets a global-coarse
  `coarse_preview` (SWR) that revalidates to regional — handled by the clamp commits above.
- **The 1-CPU/2GB backend is the ceiling** for cold ops. Frontend caches make WARM ops instant.

## 6. Open items / next levers (NOT done — deliberate)
1. **Cross-model prewarm** (warm the other 2 models on idle so cold-switch is instant) — EXISTS but
   default-OFF (`c4acc908` marine, `3a5435c3`/`prewarmSiblingModelWind` wind). Held back: warming 3
   models on 1-CPU = the documented 503 storm; sibling-prewarm was reverted twice (cache pollution,
   `38b17b38`). Only enable with strict concurrency + layer-isolated per-model writes + live verify.
2. **EURO 404 `no_copernicus_coverage`** on open-ocean bboxes during scrub — expected coverage gaps,
   noisy; could tighten the pre-fetch out-of-coverage guard.
3. **ICON marine CORS-less 500 → safe-zero (blank) grid** during far-hour scrub — backend should mirror
   `cc03c5ce` (graceful no-coverage, never a CORS-less 500) for marine as it did for wind.
4. **3-hourly series vs 1-hourly scrubber**: series gives ±1.5h approximation during drag; the exact
   hour still fetches at settle for some hours. Acceptable, but if pixel-exact hours matter, that's the
   remaining per-hour fetch.

## 7. Forensic methodology (what worked / gotchas)
- **Preview is hidden-tab** → rAF paused, `setTimeout` throttled → reliable for **LOGIC** (series
  `loads`/`hits`/`misses` counts, engine grid bounds) but NOT for absolute timing/repaint cadence.
  Drive the map with **`flyTo`** (NOT `jumpTo`/`setZoom` — react-map-gl reverts those).
- **Console logs do NOT show `grid_series` calls** — check `window.__MARINE_SERIES_DIAG__` /
  `__WIND_SERIES_DIAG__` (loads/hits/misses) instead. The user's Chrome blocks pasted snippets until
  they type "allow pasting".
- Useful globals: `window.map`, `setActiveModel`, `toggleLayer`, `setTimeOffsetHours`,
  `__MARINE_ENGINE__._waveData.waveGrid`, `__MARINE_SERIES_DIAG__`, `__WIND_SERIES_DIAG__`,
  `__MARINE_GOVERNOR_STATE__`, `__MARINE_SCRUBSETTLE_SERIESHIT__`, `__MARINE_SHARPEN_DIAG__`.
- **Verify before fixing**: curling the backend disproved a "fetch-bbox is wrapped" hypothesis (the
  backend clamps `west=-227` → ±180 fine) — saved a wrong fix.
- Backend probe pattern: `curl '<render>/api/weather/grid_series?model=GFS&domain=marine&layer=waves&hours=0,24&bbox=…'`.
  Heavy probing slows the shared Render box for minutes — verify on a rested backend.

## 8. Operating rules (BRAIN_RULES.md §Weather)
Do NOT rewrite. Map the pipeline → add observation → identify the EXACT mismatch → smallest targeted
fix. Don't DoS the 1-CPU box. **dev branch only.** Diagnostics live in the `TruthOverlay` HUD; route
new telemetry through `WeatherTelemetry`. Runbook: `docs/runbooks/debug-weather-engine.md`.
