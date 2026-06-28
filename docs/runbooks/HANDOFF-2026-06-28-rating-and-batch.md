# HANDOFF — Surf‑quality Rating feature + the unverified backend batch (2026‑06‑28)

> **START HERE for a fresh context.** Single source of current state. Detail lives in the linked memory
> files + the companion runbook `HANDOFF-surf-colormap-and-coldstart-2026-06-28.md` (§1‑8).

- **Branch:** `dev` — **HEAD `f0701ee8`**, everything committed + pushed. Working tree clean (only pre‑existing
  `.claude/launch.json`, `backend/diagnostics.log`, `.codebase-memory/` are dirty — ignore).
- **Default branch is `dev`** (cron + Render serve‑only build/run from it). `main` = release baseline; push to
  main only for releases with the §22 handshake.
- **Tests:** ~50 rating tests (backend `test_surf_rating.py`/`test_shore_normal.py` + frontend
  `surfRating.test.js`) + the marine/scrub/weather suites + a green production build.

---

## 0. ⛔ THE ONE BLOCKER — nothing this session is verified LIVE yet

Everything below is pushed but **unverified in production**. Two deploy gates + one cron action:

1. **Netlify (frontend, auto on push to `dev`)** — should already be deploying. Hard‑reload to clear the SW
   cache. Carries: infobox‑0 fix, focused surf colormap, **rating badge + map overlay + toggle**.
2. **Render (backend serve box)** — confirm it redeploys `dev` (render.yaml has no branch pin; branch is set
   in the Render dashboard — **verify dev vs main**). Carries: `shore_normal_deg` on `/point`, the rating
   grid, the warm‑on‑boot prefetcher, cache 8→128, EURO‑14d wiring.
3. **Cron — dispatch the `forecast-ingest` GitHub Action once** (Actions → forecast-ingest → Run workflow,
   branch `dev`). The 16:50Z manifest still LACKED: regional wind tiles, worldwide coastal tiles, EURO marine
   10‑14d estimates. The new jobs run LAST so a scheduled run may have been cut by the 120‑min timeout —
   a manual dispatch confirms them. Watch the run for `GFS/ICON/EURO Wind Pilot`, `EURO Marine Extended
   Estimates`, a worldwide region (e.g. `hawaii`) → `Ingested N … grid files`, and total time vs 120 min.

**Forensic truth check (any time):** `curl …/api/weather/products` → look for wind `region_id != global_coarse`,
worldwide regions, and EURO marine maxhorizon ~14d. (Serve box is fast WARM, ~45s/timeout COLD — see §3.)

---

## 1. Headline feature — Surf‑quality RATING (the "Surf" toggle is now "Rating")

Full detail: memory [[surf-rating-overlay-2026-06-28]]. The map's Swell↔Surf toggle is now **Swell↔Rating**:
the coastal band is colored by surf QUALITY (very_poor→epic), not height. Plus an **infobox Rating badge**.
We dropped the surf‑HEIGHT *map* band (redundant at our 0.25°/10° resolution — surf‑zone amplification is
sub‑grid); surf HEIGHT stays in the infobox.

- **Model = single source of truth** `backend/services/weather_pipeline/surf_rating.py`; **JS mirror**
  `frontend/src/components/map/surfRating.js` — **KEEP THE TWO IN SYNC** (parity tests both sides).
  `rating = size_gate(height) × (0.60·wind_quality + 0.40·period_quality)` → 0‑100 → 7 levels.
- **Inputs:** `bathymetry.shore_normal_at()` (offshore/onshore — the dominant factor); `/point`
  `shore_normal_deg` (pure bathymetry, no extra fetch); badge computed frontend‑side; grid overlay via
  `grid_resolver` surf→`rating_transform_grid` + `_build_wind_sampler` (wind co‑sample, **knots→m/s**,
  `direction`=meteorological FROM).
- **Value‑encoding trick:** the rating grid packs **score/10** into the marine texture's fixed 0‑10 height
  channel (no encode change); shader `getRatingColor(waveHeight*10)` paints it in an **isolated `u_surfMode`
  branch** (the normal marine/swell render is untouched).
- **Colors:** industry surf‑rating palette (red→orange→yellow→green→teal; rare Good/Epic in PURPLE).
  ⚠️ **NEVER label anything "Surfline"** in code/UI (user instruction; verified none in source). Palette in
  `surfRating.js` RATING_COLOR + `WebGLMarineShaders.js` getRatingColor — keep synced.
- **Kill switches:** `SURF_RATING=0` (backend serves the old surf‑HEIGHT grid; NOTE the shader still
  rating‑colors in surf mode, so a full visual rollback also needs a frontend revert). `SURF_TRANSFORM=0`
  (no surf/rating at all).
- **Commits:** `1ba30f57` model · `561ac2d2` shore_normal · `711dedae` /point · `99ef0c17` badge ·
  `7ff799c7` grid engine · `0a732ba5` backend overlay · `806c9445` frontend overlay · `f0701ee8` docs.

---

## 2. The rest of the 2026‑06‑28 batch (all pushed, pending the gates above)

- **Serve‑only COLD‑START was the root** of frozen scrub / wind‑5min / "all marine layers same" — NOT a
  frontend bug. Fixed: warm‑on‑boot prefetcher now warms ALL models×map‑layers (+wind) + cache 8→128
  (`45a53585`, marine LIVE‑VERIFIED 0.16‑0.38s). [[serve-only-coldstart-root-2026-06-28]].
- **Regional wind tiles** via cron (`5a8b3b96`, NOAA/DWD/ECMWF, `WIND_PILOT_INGEST=1`) — fixes ~20s zoomed‑in
  wind. **Worldwide coastal 0.25° tiles** round‑robin (`85b7f8ea`, `WORLDWIDE_REGIONS_PER_CYCLE`, 8 surf
  coasts).
- **EURO marine 10→14d** extended estimates wired into the cron (`ad17ca46`, `EURO_MARINE_EXTEND=0` switch) —
  fixes "EURO scrub clears after day 10". [[marine-open-repairs-2026-06-28]].
- **Infobox‑0 for marine** fixed (`3f45d004`): `sampleValueFromDecodedTiles` returned `{value:0}` for
  all‑land tile cells, short‑circuiting the `??` chain → now returns null. Backend was healthy.
- **Marine scrub global‑frame‑last‑resort** (`f538321f`) + **focused surf colormap** (`96120177`, now
  superseded on the map by Rating but the infobox still uses the surf‑height number).

---

## 3. Serve‑box behavior to remember
Render disk is ephemeral; `restore_from_supabase` restores only the manifest (lazy product restore). COLD =
first read of each product from Supabase L2 is ~45s/timeout; WARM = 1‑4s. The new prefetcher pre‑warms the
near‑term common set on boot. `/status` + `/products` time out when cold (they're not empty — just slow).
Supabase MCP is DB/logs‑scoped; weather L2 truth is the `/products` endpoint.

---

## 4. STILL OPEN (diagnosed, NOT fixed — priority order)
1. **Infobox stuck "Loading"→"Timeout" under RAPID model switching** (most user‑visible). Root: each
   model/layer switch aborts the in‑flight exact‑point fetch; faster than it completes, the abort‑recovery
   discards every attempt as a stale `requestId` and it lands in `exact_timeout` without re‑firing on settle.
   Lifecycle is in `frontend/src/hooks/useExactPointFetch.js` (250ms switch debounce, 12s fetch timeout,
   `fetchGenRef`/token cancellation) + the `[ABORT RECOVERY]`/stale‑lock logic. Fix idea: on settle (no
   switch for N ms) force one fresh fetch; don't leave a wedged timeout. The sampler fix (`3f45d004`)
   *exposed* this (a `0` used to mask the loading/timeout state).
2. **Surf↔Rating toggle abort thrash** — same lifecycle root as (1).
3. `grid_series` rating scrub does per‑hour O(n²) wind sampling — acceptable, optimizable (cache the sampler).
4. Worldwide coastal & EURO‑14d are evidence‑based; future refinements = **tide** + **skill‑stratified**
   ratings (Espejo/Boqué/Mesa) and a true surf‑HEIGHT map (needs finer GEBCO bathymetry + refraction).

---

## 5. Working rules for the next context
- **Don't label anything "Surfline."** Use "surf‑quality rating / industry‑standard palette."
- **Keep `surf_rating.py` ⇄ `surfRating.js` in sync** (and RATING_COLOR ⇄ shader getRatingColor).
- **Forensics first:** the live backend (`/products`, `/point`, `/grid`) is truth; Supabase MCP for DB/logs;
  Consensus MCP for surf‑science grounding; firecrawl for web; Context7 for library docs.
- **Don't loop‑poll deploys** (memory: deploy‑poll‑preference) — wait for the user's "deployed" then one curl.
- **Backend changes go live only when Render deploys** + cron‑side data needs the Action dispatch.
- Memory index `MEMORY.md` is the map; the rating + cold‑start + open‑repairs memory files have the depth.
