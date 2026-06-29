# HANDOFF — Surf‑Rating Toggle: full feature AUDIT + "no visual change" forensics (2026‑06‑28)

> **START HERE for a fresh context whose job is to make the surf‑rating overlay actually SHOW + be good.**
> User report: *"I am not seeing any visual changes taking place when activating the [Rating toggle on the] map."*
> This doc is a forensic audit of the feature as built, WHY it looks invisible, what THIS session changed that
> bears on it, and the prioritized next steps. Branch `dev`. Don't push `main` (§22). Companion forward‑plan:
> `docs/runbooks/HANDOFF-2026-06-28-surf-rating-engine-PLAN.md` (the physics/quality roadmap P2–P5).

---

## 0. TL;DR — the most likely reason it looks invisible (forensically grounded, not a guess)
The data path is CORRECT end‑to‑end (toggle → `surf=1` fetch → backend rating grid → `ratingMode` → render).
The overlay has **two independent render layers**, and BOTH are gated such that they show **nothing** at the
viewports the user most often sits at:

1. **The shader BAND** renders only when the loaded marine grid is a *genuine* rating grid
   (`waveGrid.ratingMode === true`, i.e. backend `diagnostics.surf_transform.value_kind === 'surf_rating'`).
   The backend now produces that **only on REGIONAL grids** — it deliberately SKIPS the rating transform on the
   global‑coarse frame (`{skipped:'coarse_extent'}`, this session's Bug #3 fix). And regional grids are *often
   not warmed* (the zoom‑in clamp / coarse‑resolution issues). ⇒ at a global/zoomed‑out or cold‑regional
   viewport, `ratingMode=false` ⇒ the shader shows the **honest swell field** (no rating colours) ⇒ "no change".
   **This is a direct, correct consequence of this session's Option‑A gate** — it removed the *fake* rainbow band
   that used to paint on coarse grids, but because a real regional rating grid is frequently absent, the band is
   now invisible most of the time, which *reads as "the feature is broken."*

2. **The per‑spot GLYPHS** render only when `surfMode && spotRatings[cluster.id]` AND the spot is an *individual*
   (non‑cluster) marker. At zoomed‑OUT views the spots are CLUSTERED ⇒ no glyphs. At regional zoom they should
   show (fed by the `/api/weather/spot-ratings` endpoint, independent of the grid) — **this is the reliable
   visibility path** — but it needs the live verification in §5 (spot‑id match + endpoint return + clustering).

**Net:** the feature is "working" but its visibility is bottlenecked by (a) the band requiring a warmed regional
rating grid, and (b) the glyphs requiring individual (un‑clustered) spots at a regional zoom. The fix direction
is to make the GLYPHS the dependable visual (they don't need the grid) and to let the band be a bonus when a
regional rating grid exists. This session's clamp/warming fixes (§4) make the band appear more often too.

---

## 0b. LIVE TEST 2026‑06‑28 (later session, post‑`dda208f3` deploy) — what the diag PROVED
Captured on `dev--rawsurf`, FL east coast, GFS waves, zoom 7–10:
- **Endpoint + telemetry WORK:** `[spot-ratings] 24/24 rated · src=live · -81.5,28,-79.75,28.75` — all 24 in‑view spots
  rated. Tighter box → `0/0` (no spots there). So the rating DATA path is fully healthy end‑to‑end.
- **Why "nothing happens to the heatmap":** (1) the BAND is honest‑swell at coarse BY DESIGN (Option‑A) and the
  **clamp pinned the viewport on coarse/global** (`Render backstop: … grid at zoomed‑in viewport … willSharpen:false`,
  `regional_too_small fw:999.0 covers:false`) → the band never became a rating band. (2) At zoom 7–9 the 24 rated
  spots are **CLUSTERED** → they render as orange count‑bubbles, not glyphs → the per‑spot rating was invisible.
- **Fix shipped (`6e5189c7`):** **cluster rating tinting** — `computeClusterRatings`/`aggregateLeafRatings`
  (pure, tested) tint each cluster bubble by the BEST rating among its leaf spots, wired MapWebGL→MapMarkerLayers.
  Now toggling Rating recolours the map at EVERY zoom (clustered bubbles + individual glyphs), not just at
  spot‑level zoom. Falls back to orange when a cluster has no rated spot.
- **CLAMP ROOT FOUND + FIXED (`<clamp commit>`):** the `regional_too_small` / `found:false` clamp was a
  FRONTEND bug, not backend. Proven by curl: the backend returns a CONTAINING tile for the exact viewport
  (`-82,27,-79,29` contains south 27.96). But the frontend's 0.5° `viewportKey` snap groups viewports, and the
  served tile cached under that key fails `getMarineSeriesFrame`'s STRICT `bboxContains` for a later same‑key
  viewport that straddles a whole‑degree boundary (live: viewport south 27.96 vs cached tile south 28.0), while
  the TTL dedup refuses to re‑fetch → clamp pinned for the 5‑min TTL. FIX: `padRegionalBbox` pads the
  grid_series request outward by 0.5° (regional spans only, so it can't cross the 15° wide threshold) → the
  served tile contains the viewport + any same‑key pan. Cache key + coarse‑preview detection still use the
  unpadded viewport. 15 series tests green. ⏳ pending live verify (clamp should stop; band can then sharpen).
- **RATING OVERLAY CONFIRMED CORRECT (live):** `/surf-spots` and `/spot-ratings` return the SAME 24 FL spot ids
  (intersection 24/24) — the glyph/cluster spot‑id match is proven, not assumed. "Don't see cluster tinting"
  was a stale‑bundle tab (deployed `007fb3ed` is correct) — a hard reload shows it.

---

## 1. THE FEATURE (as built this session) — two layers
- **Map "Swell ⇄ Rating" toggle** (`MapWeatherControls.js` L82‑89): flips `__SURF_MODE__` (localStorage +
  window), updates local `surfMode`, dispatches `window` event `rawsurf:surf-toggle`. The legend label flips
  Swell→"Surf Rating" and the gradient swaps to the 7‑level palette (L561‑578). Only for `SURF_TOGGLE_LAYERS`.
- **Layer A — shader BAND**: the marine heatmap recoloured by the 7‑level rating palette (`getRatingColorSmooth`)
  when the loaded grid is a rating grid.
- **Layer C — per‑spot GLYPHS**: pulsing coloured dots at each surf spot (`MapMarkerLayers.js` L70‑158), colour =
  the spot's rating level. Hover tooltip appends "· <level>".
- **Infobox**: a Rating badge (`MapForecastOverlay.js`) computed by the JS mirror `surfRating.js`.

---

## 2. DATA FLOW (verified file:line — all links present + correct)
```
[toggle click]  MapWeatherControls.js:86-89  setSurfModeFlag(next) + dispatch 'rawsurf:surf-toggle'
   │
   ├─►(re-fetch) useMarineDataFetcher.js:178-184  onSurfToggle → enqueueMarineUpdate('manual')   ← toggle DOES re-fetch
   │     └─ grid URL:    backendWeatherServiceClient.js:499   ...&surf=1   (when getSurfModeFlag())
   │     └─ series URL:  marineGridSeries.js:202              ...&surf=1   ; cache key surf|swell @ L130
   │
   ├─►(reactive)  MapWebGL.js:143-149  'rawsurf:surf-toggle' → setSurfMode(...)  (drives glyphs + clustering)
   │
   ▼ BACKEND  /api/weather/grid?surf=1  →  grid_resolver.py surf block (L569+)
       • REGIONAL grid → rating_transform_grid → diagnostics.surf_transform = {value_kind:'surf_rating', ...}
       • GLOBAL-coarse grid (span≥350°) → SKIPPED → {skipped:'coarse_extent'}   (this session, fc/ecd commits)
   ▼ FRONTEND conformer  mapNormalizedGridToWebGL (backendWeatherServiceClientHelpers.js)
       • ratingMode = (json.grid.diagnostics.surf_transform.value_kind === 'surf_rating')   ← Option-A signal
   ▼ RENDER
     BAND:  WebGLMarineEngine.js ~L417  surfModeVal = (toggle) && waveGrid.ratingMode  → u_surfMode
            WebGLMarineShaders.js getRatingColorSmooth (continuous 7-anchor palette + u_time shimmer)
     GLYPHS: useSpotRatings.js  → fetch /api/weather/spot-ratings (primary) + grid-sample fallback
            → MapMarkerLayers.js:70  rating = surfMode && spotRatings[cluster.id]  → pulsing dot
```

---

## 3. "NO VISUAL CHANGE" — root‑cause analysis (verified vs. to‑verify)
**VERIFIED true (read the code + curled the backend):**
- The toggle re‑fetches (`enqueueMarineUpdate('manual')`) and the fetch carries `surf=1`. So a fetch DOES happen.
- The backend returns a real rating grid for a **regional** `surf=true` request (`value_kind:'surf_rating'`,
  e.g. FL: 82 rated cells, wind:true) and **None** for the **global‑coarse** frame (`{skipped:'coarse_extent'}`).
- The conformer carries `ratingMode` only when `value_kind==='surf_rating'` (Option‑A). The shader forces
  `u_surfMode=0` unless `waveGrid.ratingMode` (so it shows honest swell, not fake colours, when no rating grid).
- ⇒ **The BAND is structurally invisible at any viewport whose loaded grid is global‑coarse or an unwarmed
  region.** Given how often the heatmap sits on global‑coarse (the clamp/coarse‑resolution issues), the band is
  invisible most of the time. THIS is the leading explanation for "no visual change."

**TO VERIFY on the live app (the fresh context's first job — see §5 for how):**
- Do the **glyphs** render at a regional zoom over a spotted coast (e.g. Florida)? They should, from the endpoint.
  If NOT, suspects in priority order:
  1. **Spot‑id mismatch**: glyph looks up `spotRatings[cluster.id]`; `useSpotRatings`/`mapSpotRatingsResponse`
     key by the endpoint's `spot_id` (= `SurfSpot.id`, a UUID). Confirm the frontend spot list's `cluster.id`
     is that SAME UUID (it should be if spots load from the same DB) — if the frontend uses a different id, NO
     glyph ever matches. **Check first** (cheap, high‑impact).
  2. **Spots clustered**: at the test zoom are the spots individual (glyph‑eligible) or clustered? `useSpotClusteringData`
     was changed to surface spots in surfMode — confirm it actually yields non‑cluster entries at that zoom.
  3. **Endpoint empty for the viewport**: `/spot-ratings?bbox=…` returns only spots in‑bbox with a non‑null score;
     a flat/no‑surf hour yields `score=null` → no glyph (correct, but looks empty). Verify with a known‑surf coast.
  4. **`marineData.grid` null on first paint**: the grid‑sample FALLBACK needs a grid; the endpoint path doesn't,
     but confirm the hook's deps fire on toggle (it keys on `surfMode`,`mapInstance`,`activeModel`,`timeOffsetHours`,moveNonce).

---

## 4. WHAT THIS SESSION CHANGED THAT BEARS ON RATING VISIBILITY (all on `dev`, pushed)
- `266984cd` **Option‑A gate (Bug #2)** — band/glyphs only on a genuine rating grid (`ratingMode`). *This is the
  change that made the fake coarse band correctly disappear — and thereby exposed that a real regional rating
  grid is usually absent.* Net‑positive for correctness; net‑negative for "always shows something."
- `ecd258f8` **Bug #3 overflow fix + coarse stays unrated** — global‑coarse `surf=true` now returns honest swell
  (no fake rating). Verified live.
- `9fd61953` / `22693bce` / `fc20fa14` **Zoom‑in clamp fixed (3 layers)** — frontend no‑progress cap + exact‑key
  prefers the warmed regional tile + backend `grid_series` warms the regional viewport tile (verified live
  360°→2°). **These make a regional rating grid available more often ⇒ the BAND should appear more often now.**
- `90342eb3` **Glyphs re‑pointed to `/api/weather/spot-ratings`** (incr 2) — the glyphs no longer depend on the
  grid being a rating grid; they fetch precise per‑spot ratings. **This is the reliable visibility path.**
- `99460f29` **GFS/ICON series fast path** (flag `GFS_ICON_SERIES_FASTPATH`, default OFF) — full‑range regional
  fetch so a zoomed‑in SCRUB renders regional for all hours (also helps the band persist across scrub).
- Endpoint live‑verified: `/api/weather/spot-ratings?bbox=<FL>` → 15 spots, sensible (all very_poor in flat onshore).

---

## 5. HOW TO REPRODUCE + DIAGNOSE (do this FIRST in the fresh context)
On `dev--rawsurf.netlify.app` (or local dev → Render backend, see [[local-dev-frontend-setup]]), VISIBLE tab
(rAF‑hidden‑tab confound — [[marine-raf-hidden-tab-confound]]):
1. Marine layer = GFS waves, zoom to **Florida** (regional, spots individual), wait for the heatmap to render.
2. Toggle **Rating**. Then in the console capture the truth:
```js
(() => {
  const eng = window.__MARINE_ENGINE__, wg = eng && eng._waveData && eng._waveData.waveGrid;
  const sr = window.__SPOT_RATINGS_DIAG__; // ✅ now exposed by useSpotRatings (§6.1 DONE, commit pending)
  return { surfMode: window.__SURF_MODE__, ratingMode: wg && wg.ratingMode,
           gridScope: wg && wg.coverage_scope, gridCols: wg && wg.cols,
           spotRatings: sr, /* {status,source,fetched,rawCount,mergedCount,eligibleSpots,ratingGrid,sampleIds,levels,lastBbox,error,ts} */ };
})()
```
   **Reading `__SPOT_RATINGS_DIAG__` (the new telemetry):** `status:'ok'` + `fetched>0` ⇒ the endpoint returned
   rated spots → glyphs SHOULD paint; if you still see none, it's a spot-id mismatch or clustering (check
   `eligibleSpots` — 0 means every spot is clustered at this zoom → zoom in). `status:'ok'` + `fetched:0` +
   non-empty `rawCount` ⇒ spots returned but all unrated (`score:null`, flat/no-surf) → correct-but-empty; test a
   known-surf coast. `status:'error'` ⇒ read `error`. `levels` tallies the glyph colours (e.g. `{very_poor:15}`).
   - `ratingMode:true` + you see a coloured band ⇒ band works (you were just at a coarse viewport before).
   - `ratingMode:false` ⇒ the loaded grid isn't a rating grid (coarse/unwarmed) ⇒ band correctly hidden ⇒ chase §3.
3. For glyphs: in the Network panel confirm a `GET /api/weather/spot-ratings?...` fires on toggle and returns
   spots with non‑null `score`; then confirm those `spot_id`s equal the on‑map spots' ids (the §3 spot‑id check).

---

## 6. PRIORITIZED NEXT STEPS (the fresh context's plan)
**P0 — make the overlay reliably VISIBLE (the user's actual complaint):**
1. ✅ **DONE (code, commit pending) — glyph/rating debug telemetry.** `useSpotRatings.js` now exposes
   `window.__SPOT_RATINGS_DIAG__` = {status, source, lastBbox, lastValidTime, lastModel, rawCount, fetched,
   mergedCount, gridFallbackCount, eligibleSpots, ratingGrid, sampleIds, levels, error, ts} + a one‑line
   `console.debug('[spot-ratings] …')` per fetch (pure `summarizeSpotRatings`/`writeSpotRatingsDiag`, 19 tests
   green). Mirrors the `__MARINE_*__` pattern. See the §5 capture for how to read it.
2. ✅ **VERIFIED (static) — the glyph spot‑id match is CORRECT.** `MapMarkerLayers` keys `spotRatings[cluster.id]`;
   for an individual spot `cluster.id = feature.properties.spotId = spot.id` (`useMarkerClustering.js:114`,
   sourced from `/surf-spots`). The endpoint returns `spot_id = str(SurfSpot.id)` (`spot_ratings.py:85`) and the
   live route queries the SAME `SurfSpot` table; `mapSpotRatingsResponse` keys `out[sp.spot_id]`. Both are the
   `surf_spots.id` UUID as a string ⇒ they match (no id‑mapping shim needed). Re‑confirm LIVE via §5: the diag's
   `sampleIds` should equal on‑map spots' ids — but no code change is expected here.
3. **Decide the BAND policy at coarse/unwarmed viewports**: either (a) accept it's glyph‑only there (and make the
   glyphs unmistakable — bigger, animated, a legend hint), or (b) show a *clearly‑labelled* coarse rating band at
   global zoom too (would require backend to rate coarse — reverses Bug #3's "leave coarse unrated"; only if the
   coarse rating is honestly labelled "approx"). Recommend (a) — glyphs are the per‑spot truth.
4. Confirm the clamp/fast‑path fixes (§4) now let the band appear at warmed regional zooms (should, post‑deploy).

**P1 — quality of the rating itself** (so a visible rating is also a GOOD rating): pick up the physics roadmap in
`HANDOFF-2026-06-28-surf-rating-engine-PLAN.md` §2/§7 (γ(s0,kh) breaker index, Iribarren breaker type, refraction
focus/defocus, shadowing, tide×depth) + the precompute go‑live (`SPOT_RATINGS_PRECOMPUTE=1` + dispatch
`forecast-ingest` → `/spot-ratings` `source` flips live→precomputed) + forecaster tuning (admin) + buoy/report
calibration.

**P2 — polish:** glyph density/declutter at medium zoom; the 8th level ("very good") the user floated; theme‑aware
glyph colours; an explainable `why` in the infobox/tooltip (the endpoint already returns `why`).

---

## 7. KEY FILE MAP (rating overlay)
- Toggle/legend: `components/map/MapWeatherControls.js` (L82‑89 toggle, L561‑578 legend).
- Surf flag + URLs: `backendWeatherServiceClient.js` (`getSurfModeFlag` L143, GRID surf=1 L499), series
  `marineGridSeries.js` (L130 key, L202 url). Toggle re‑fetch: `useMarineDataFetcher.js` L178‑184.
- Backend rating grid: `services/weather_pipeline/grid_resolver.py` (surf block L569+), model `surf_rating.py`
  (`rating_transform_grid`, `compute_surf_rating`), physics `surf_transform.py` (`estimate_surf`), bathymetry
  `bathymetry.py` (`shelf_depth_at`/`shore_normal_at`).
- Conformer ratingMode: `backendWeatherServiceClientHelpers.js` + `backendCopernicusServiceClient.js`.
- Band shader: `WebGLMarineEngine.js` (~L417 gate), `WebGLMarineShaders.js` (`getRatingColorSmooth`).
- Glyphs: `useSpotRatings.js` (+ `spotRatingsClient.js`), `MapMarkerLayers.js` (L70‑158), `useSpotClusteringData.js`,
  `MapWebGL.js` (L206 hook wiring). Endpoint: `routes/weather.py` `/spot-ratings`, `services/weather_pipeline/spot_ratings.py`.
- Infobox badge: `MapForecastOverlay.js`, `forecastCardCompiler.js`, mirror `surfRating.js`.

## Memory links
[[rating-option-a-gate-2026-06-28]] · [[p1-spot-ratings-endpoint-2026-06-28]] · [[heatmap-freeze-stranded-pending-2026-06-28]] ·
[[surf-rating-overlay-2026-06-28]] · [[rating-glyphs-and-infobox-retry-2026-06-28]] · [[live-test-findings-2026-06-28]]
