# HANDOFF 2026-07-19 EVE — rounds 5–6 verified, the circulation-centre DATA root, and the fine tier

HEAD `abec1570` on `dev`. Full suite **1246/1246** (×3). Session commits:
`c76a3171` (Diagnostics HUD prod gate) · `abec1570` (wind viewport-fine tier).

---

## 0. READ THIS FIRST — the circulation-centre root was DATA, not shaders

The queue item said: "a vortex core renders as still air — a flow-visualisation problem." It is
not. **Every wind grid the engine ever received was the 37×17 global manifest product — 10-degree
cells — at every zoom.** A tropical invest (~300–500 km) is *sub-cell* in that texture: its
rotation is averaged away before the shaders ever see it. Seeding, persistence, curl-detection —
none of it can visualize data that isn't there. (At synoptic scale a 2000 km mid-lat low *does*
survive 10° cells — you can see one rotating south of Greenland in the sweep screenshots — which
is exactly why the defect only bit on meso-scale systems like Invest 91L.)

Why: `clampViewportBbox`'s wind branch ("v3.15: always request global coverage") globalized every
request. The **backend has supported a finer lane all along** — spans ≤ 15° reject the global
manifest and the dynamic viewport lane builds an adaptive 0.25–1.0° product
(`choose_adaptive_resolution`, target 400 pts), self-degrading to the stale global product when
its upstream fails. Marine never had this problem because marine has a precomputed ~2°
`global_mid` manifest tier (`mid_res_tier.py` — marine-only) plus regional pilots.

## 1. What shipped (`abec1570`)

- **clampViewportBbox wind branch:** viewport spans ≤ 13° → the 1°-snapped viewport bbox
  (1° = the server's own GFS `t_sz` snap; snapped span provably < 15.0 so the backend's dynamic
  gate can never silently degrade the tier). The tileId **encodes the snapped bbox** — WIND_CACHE
  keys by tileId; a constant fine id would cross-serve regions within the TTL. Antimeridian
  crossings keep the global product. Kill: `__RAW_DISABLE_WIND_VIEWPORT_FINE__` → bit-exact v3.15.
- **WeatherEngine:** `moveend` refetch when the clamp tile id changes. The global id is constant,
  so wide views never refetch on move (exact old behaviour); the kill switch makes the listener a
  structural no-op.
- **WebGLWindLayer:** `keepTrails` on global↔fine tier swaps (the 07-10 camera-reseed trade) —
  crossing ~z6 crossfades instead of blanking.
- **windController, two cache defects found LIVE during verification:**
  1. A stale fallback grid (rate-limited upstream → backend serves the 10° global with
     `stale:true`) was cached at the full 10-min TTL, pinning users to coarse long after upstream
     recovery → **stale-aware TTL: 2 min for stale entries**.
  2. A cached **world-span** grid satisfies bounds-containment for *every* viewport, and the
     containment fallback's early return **suppressed the fine tier's authoritative fetch** for
     its whole TTL (observed: zoom out then back in → coarse from cache, zero network). A world
     grid no longer *counts as* a fine product in `fetchWindData`; it still warm-renders
     instantly via `getModelSafeWind`.
- **Engine: zero changes.** Regional wind grids already get edge feathering + regional respawn
  (`isRegionalGrid` keys on span < 350°).
- Gate: `windViewportFine.test.js` (7 tests ×3 runs) — enumerates the span space against the
  backend's 15.0° dynamic gate, pins the kill switch bit-exact, the bbox-unique tileId, the
  antimeridian fallback, and marine-branch isolation.

**Live wire proof (3 independent page sessions):** fine bbox at z9 FL (`-82,28,-80,29`) and Gulf
z6.5 (`-94,20,-84,28`); global bbox at z4.2; moveend refetch in both directions; the keepTrails
crossfade log line. **End-to-end fine grid rendered once live: 25×29 `scope:regional` (~0.4°
cells vs 10°) at Gulf z6.5** — the other rounds hit the upstream rate-limit window and correctly
received the stale-coarse fallback.

## 2. Rounds 5–6 verification debt — CLOSED

`probe_wind_themes.js`, 3 zooms × 3 runs × 2 devices × 3 themes × A/B = 108 legs, **FIXED beat
BEFORE in all 54 A/B pairs**:

| zoom | desktop contrast Δ | mobile contrast Δ | densityCV |
|---|---|---|---|
| z3 | +20…+118% | +26…+59% | improved 17/18 |
| z5.5 | +114…+488% | +312…+470% | improved 15/18* |
| z9 | +68…+252% | +30…+51% | improved 18/18 |

*The z5.5 desktop-dark densityCV rise (0.35→0.57, consistent all 3 runs) is the CV of *visible
marks* replacing the CV of a near-empty field (BEFORE contrast 8.7 ≈ nothing rendered) — not
clumping. Eyeballed screenshots confirm: BEFORE light is a featureless wash; FIXED shows real
oriented dashes. Instrument notes: the Diagnostics HUD sat inside the crop for these runs
(constant across both legs — direction-safe, magnitudes understated); a cookie banner could land
in ONE leg (seen once, inflating BEFORE — also the conservative direction). Both fixed for future
runs (probe re-declines pre-screenshot; `__RAW_DIAG__='0'`).

## 3. Also shipped: the Diagnostics HUD was UNGATED in production (`c76a3171`)

`TruthOverlay` — the full HUD — mounted unconditionally in `MapWebGL` for every user: 360px dark
panel over the map, ~full-width on a phone. Now gated exactly like MarineAnimTuner
(`?diag=1` / `__RAW_DIAG__` / localhost default-ON / `'0'` outranks / fails closed). **Render
only** — the truth-violation POST (`/api/weather/client-diagnostics`, real tested route) still
runs for production users. Gate test 5/5 ×3; live-verified both directions with the map mounted.

## 4. Marine DPR audit — CLEAN (queue item closed)

The wind DPR defect does not exist in marine: crest ribbons are quads sized in CSS px and
converted via a live-bound `u_device_pixel_ratio` (v5.3, `WebGLMarineEngine.js:2440`); no
`gl_PointSize` anywhere in the marine pipeline.

## 5. 🔴 STILL OPEN

1. **Vortex shader levers** (R-gated gamma restore / persistence / sub-1kn dash floor in the
   annulus) — designed, NOT implemented; they only matter once fine data flows reliably.
   `probe_wind_vortex_analyze.js` is ready: it takes a `probe_wind_vortex_dump.js` dump, finds
   circulation candidates (curl dominance R = |curl|·L/(speed+s0)), and computes the exact
   shipped-shader lifetime/motion/arc numbers vs the levers. Run it on a real fine Gulf grid
   before writing any shader code.
2. **Backend wind upstream (the reliability gate for #1):** the dynamic wind lane shares the
   open-meteo *forecast* API quota (marine uses the separate marine API — that's why marine works
   while wind rate-limits) and pulls `forecast_days=16` per request. Options, best first:
   (a) wire `noaa_gfs_wind_fetcher.py` (NOAA-direct, no quota) as the dynamic lane's fallback;
   (b) add a wind `global_mid` (~2°) cron product like marine's (kills the quota dependency for
   the z5–6.1 band and mid-lat lows, though 2° still under-resolves an invest);
   (c) cut dynamic-lane `forecast_days` for wind (16→3) — the scrub prefetch has its own lane.
   Note: `upstream_rate_limited` is the catch-all label for ANY dynamic-lane upstream failure
   (viewport_service L510) — don't assume it's literally a 429.
3. **ICON wind ≥ ~5 days** is forced to the manifest (coarse) per `decide_manifest_product` —
   scrubbing an ICON fine viewport past ~120h flips fine→coarse per hour. Pre-existing policy,
   mirrors the raster fallback; just don't chase it as a regression.
4. The flag-gated `__WIND_SERIES__` scrub lane passes RAW viewport bounds (its own bbox policy);
   if it's ever defaulted ON, align it with the clamp or hours may flip resolution mid-scrub.
5. From the earlier arcs, unchanged: `applyThemeWindScale` legend duplication · marine particle
   shader 2-vs-6 theme branches · ARBITER Phase C default flip (stateful harness first) ·
   real-device (iPhone/Galaxy) marine checks.

## 6. Traps this session (don't relearn)

- **HMR strikes again, React edition:** the new `moveend` listener "didn't fire" because the page
  predated the WeatherEngine edit. Hard-reload before concluding a React-effect change failed —
  same lesson as compiled-once shaders.
- **The Bash cwd is not sticky-safe:** two separate failures (`MODULE_NOT_FOUND`, a watcher
  spinning on a relative path that never resolves) came from the working directory silently being
  the repo root. Absolute paths in background commands, always.
- **A grid request's tile identity ≠ its response's coverage:** the stale fallback arrives under a
  fine cache key with WORLD bounds — anything doing bounds-containment on cached grids must
  treat span ≥ 350° specially or a single coarse response will impersonate every product tier.
- **`is_dynamic_viewport_product: true` + 37×17 = the lane TRIED and fell back.** Check
  `fallbackReason`/`stale` before concluding the tier doesn't work.
