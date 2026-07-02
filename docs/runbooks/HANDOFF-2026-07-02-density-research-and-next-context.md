# HANDOFF — Wave-animation density research + next-context to-dos (2026-07-02, context rollover)

> **★ RELEASED (2026-07-02 EVE): main ff `4583c39b`→`e925eb5e`, 154 commits** (user-directed §22 handshake;
> gates green: 472/472 FE + prod build + backend 463 passed/0 failed offline). Same push: z2.7–3.0 density
> second pass (+0.0076 localized, 16.2% @z2.89 verified; user console showed LCP 2368ms good, was 5.8s) and
> dead deck.gl/GPUWaveLayer removal (5 package entries; moment gone from the tree). Prod verification when
> netlify finishes: bundle-marker check first (e.g. `u_coarseNearestDir` / `MARINE_ZOOMED_OUT_MAX_ZOOM` echo
> `__MARINE_ZOOM_THRESHOLDS__` in the MapPage chunk), no deploy loop-polling.

## 0-PM2. SECOND PASS (2026-07-02 PM, user feedback round) — ALL remaining §3 items closed
1. **z2.91 "+5% density"** (`da19437b`): legacy low-zoom curve floor 0.120→0.128 (+5.1% at z2.91); diag
   mirror was LINEAR vs the shader's smoothstep (said 32% at z4, truth 24%) — now formula-exact.
2. **"Waves roll out to sea"** (`bd43d84d`): DATA verified honest (our GFS propagation at reference parity at 12
   coastal points; the offshore regions — off-NJ, Portugal — are offshore in open-meteo TOO: real windsea). The
   render root: the TROCHOIDAL warp had lead/trail SWAPPED vs quad geometry (anchored by the verified 06-29 roll
   fix: cornerUV.y=+1 = +waveDir) → sharp face painted on the TRAILING side = backwards-facing crests, visible
   since Natural defaults enabled trochoidal 0.7 (07-01). Sharp face now leads. AWAITING user motion re-check.
3. **z6.4–7.6 transition** (`d951bd0b`): marine zoomed-out boundary aligned with the crest-band top —
   `marineZoomThresholds.js` = single source of truth (7.0), replacing 6.5 in 8 marine sites incl. the engine
   no-downgrade guard (which was REJECTING the coarse commit at 6.5–7.0 whenever a covering regional was
   resident — the stuck zone). Truth echo `__MARINE_ZOOM_THRESHOLDS__`. Wind keeps 6.5 (own lineage). Live
   round-trip verified: z9→6.56 coarse+nearest promptly; →7.72 sharpens regional back.
4. **Surf toggle** (session-verified): pill Swell→Rating works, 34 ratings merged `source=precomputed`
   (0 grid-fallback), rating legend gradient live. Band visual polish still needs user eyes.
5. **Backend suite offline-green** (`5e9564ea`): conftest gates the ~100-file live estate (skip when
   `REACT_APP_BACKEND_URL` unset), ASGI client fixture now runs `ensure_database_tables()` (ASGITransport skips
   lifespan → 'no such table: galleries'), test_single_request env-gated + real assert.
6. **LCP quick wins** (`991bd372`): removed unpkg maplibre-css (redundant + version-drifted 4.7.1-vs-5.24.0;
   bundled copy verified) and cdnjs font-awesome (zero usage) — both were render-blocking on every route; added
   preconnect to the Render origin. REMAINING candidates: main 1.1MB / maplibre 1.09MB / MapPage 1.0MB minified;
   source-map-explorer blocked by CRA column-Infinity quirk; dead deck.gl dep flagged as spawn-task.
**Gotchas added:** CRA serves `public/index.html` from startup — template edits need a dev-server RESTART;
narrow preview viewport ⇒ mobile UI breakpoint ⇒ engine boots with the MOBILE particle pool (particleRes 192,
36,864) — check `__CREST_DIAG__.particleRes` before judging density; preview explicit-resize can break the
screenshot buffer (use the native preset).

**Branch `dev` = `1105f625`** (all pushed). Read `MEMORY.md` top lines + `[[vortex-data-root-blockmean-2026-07-02]]`
+ `[[verify-bundle-hash-first]]` (bundle-marker check — MANDATORY before diagnosing any "still broken").

## 0. State: what got FIXED and verified today (do not re-investigate)
1. **The vortex's visible-spin mechanism** (`1105f625`): `prevHighZoom` stale-hardcoded `> 6.0` vs
   `isHighZoom > tileZoomMin(4.0)` → `reinitParticles()` EVERY FRAME for z∈(4,6] — exactly every reported vortex
   band. Fixed + live-verified (0 reinits/6s at z5.95, was ~60/s). Telemetry `__MARINE_ZOOMSTATE_REINITS__`.
2. **Data root** (`27b946e5`/`87a7d65a`/`b6db704b`): coarse direction fields now energy-mean (partition-blend for
   GFS) — verified AT PARITY with open-meteo's reference field at identical 10° sampling. ICON/EURO ports shipped.
3. **Land-bleed z8.39–9.12**: hi-res mask threshold 9→8 + 2048×1024 regional mask canvas (`1105f625`).
4. **Dead-:8000 trap #3** removed (`LayerAccessResolver` hardcoded localhost branch).
5. Earlier today: coverage clamp family (revision-stamped scrub-settle commits `21b8f88a`), Natural anim defaults +
   tuner V2 (`386ab799`), nearest-cell band mode (`efd3624a`), `.env.local`→Render, SW guards (both paths).
6. **USER CONFIRMED "it looks better"** after `1105f625`. Remaining visual nit → §1.

## 1. z3.02–3.93 crest SPARSITY — **RESOLVED (2026-07-02 PM): tileZoomMin default 4.0→3.0 SHIPPED**
**Experiment ran as designed (zero-code first, then shipped).** Live results on 3001 (preview harness, wheel-zoom
recipe): baseline z3.4 = legacy curve 25.7% over world-scattered pool (visibly near-empty Gulf/Atlantic);
`__RAW_TILE_ZOOM_MIN__=3.0` → density solve active across the whole band (densityBase 0.15–0.53, holds 1650
exactly; echo live at z3.33/3.4/3.61/3.66/3.94). **Zero reinit on the live flip** (both zooms above the new floor →
flag never toggles; uniform pos remap is distribution-neutral). **Zero reseeds panning 6.5° in-band** (tile = HALF
the world at z3.x → recenter threshold effectively unreachable). Exactly ONE reinit per z3.0 crossing (the cliff
moved below the reported band, into the deliberate globe-thinning zone — z2.7 verified uncluttered). No solve-clamp
saturation. SHIPPED: engine default 3.0 (`WebGLMarineEngine.js` tileZoomMin block), tuner `def: 3`, PLUS a one-time
localStorage migration in `MarineAnimTuner.loadVals` (every slider edit persists the FULL blob → a stored `4` is
the captured old default; dropped once + blob rewritten so re-set 4s stick. Verified live: seeded blob {4, 1.2} →
{1.2}, GPU echo 3). Tuner is localhost-only so prod always had the engine default. U1 (continuous blend) remains
the "no cliffs anywhere" upgrade if the z3.0 boundary ever bothers; U2/U3 unchanged in §2.
**⚠️ Forensic note for future sessions:** a mid-boot Waves double-toggle (automation clicking while
`__MARINE_BOOT_DIAG__` still initializing) can strand the engine on a stale regional texture WITH cache HITS for
`global_coarse` (upload never lands) — looks exactly like a data bug. Clean toggle after full boot + staged
zoom-out with dwells self-heals normally (blank-backstop fired once at z6.21, global committed on dwell — the
known OPEN item 4 transition polish, NOT a regression).

## 1-old. Original analysis (kept for the record)
**Report:** particles noticeably sparser in z3.02–3.93 than everywhere else.
**Mechanism (documented, HANDOFF-2026-06-30 §3.1):** `tileZoomMin = 4.0` is the floor of the constant-density
regime. Above it: particles seed in a camera-anchored tile (2^backoff × screen) and the engine SOLVES the cull
fraction so ~`partTarget` (1650) crests stay on screen (`u_densityBase`). At/below it: particles seed across the
WHOLE data domain → a viewport sees only its area-fraction of the 87,616 pool, further thinned by the legacy
per-zoom curve (crest diag `densityCurve_v58`: ~32% at z4 → ~12% at z2). The June-30 fix moved this cliff from z6
to z4 and left the note "lower the default if the user wants consistency further out." z3.02–3.93 IS the cliff.
**Zero-code experiment (do FIRST, with the user watching):** tuner → "Tile zoom min" slider → 3.0 (or console
`window.__RAW_TILE_ZOOM_MIN__ = 3.0`). If z3–4 becomes consistent with no regressions while panning (tile reseeds
on drift) and no clutter at z3, ship the default change (one constant + shader-matching uniform default,
`WebGLMarineEngine.js:468` + tuner `def`).
**Caveats:** (a) at z3 a tile = 8×screen covers a huge area — reseed-on-pan jumps are the risk the backoff exists
for; (b) below ~z2.5 you WANT thinning (globe-scale clutter); the legacy curve's 12%-at-z2 is deliberate. So the
likely end-state is `tileZoomMin=3.0` + keep the global thinning below it, possibly with a smoothstep BLEND of
`densityBase` → legacy curve across z2.5–3.5 instead of a binary regime switch (the real "no cliffs anywhere"
fix — see §2 upgrade U1).

## 2. RESEARCH — density/seeding best practices + upgrade menu
Grounding: our engine descends from the mapbox/webgl-wind architecture (fixed particle pool in a state texture,
advect FS + draw pass) — see [How I built a wind map with WebGL](https://blog.mapbox.com/how-i-built-a-wind-map-with-webgl-b63022b5537f)
and [mapbox/webgl-wind](https://github.com/mapbox/webgl-wind). Key practices found:

- **Uniform IMAGE-SPACE density is the canonical quality criterion** for flow visualization — the classic
  [Jobard & Lefer "Creating Evenly-Spaced Streamlines of Arbitrary Density"](https://link.springer.com/chapter/10.1007/978-3-7091-6876-9_5)
  controls density by a single separating-distance parameter in SCREEN space, and the modern successors do it
  **view-driven** ([Interactive view-driven evenly spaced streamline placement](https://www.researchgate.net/publication/253843183_Interactive_view-driven_evenly_spaced_streamline_placement),
  [image-based variants for surfaces](https://web.engr.oregonstate.edu/~zhange/images/imagestreamline.pdf)).
  Our constant-screen-density mode (partTarget → solved cull fraction) is exactly this practice; the defect is only
  that it has a FLOOR (tileZoomMin) below which the regime switches to domain seeding. **Best practice = one
  continuous screen-space density function of zoom, no regime cliffs.**
- **Zoom-parameterized everything**: [astrosat/windgl](https://github.com/astrosat/windgl) exposes particle
  properties as zoom-interpolated style expressions (speed, count, size) — the pattern for our engine is the same:
  make `partTarget` itself a smooth function of zoom (e.g., 1650 at z≥5 tapering to ~400 at z2) instead of
  constant-then-cliff. Our tuner + `__RAW_*` globals are the equivalent live-tuning surface.
- **Fixed pools + screen-space reseeding** (mapbox lineage, up to 1M particles at 60fps; canvas-era earth.nullschool
  used ~5k CPU particles) — we're at 87,616 GPU particles; headroom exists if density targets rise.
  ([raster-particle-layer example](https://docs.mapbox.com/mapbox-gl-js/example/raster-particle-layer/),
  [low-cost custom layer writeup](https://medium.com/@zifanw9/a-low-cost-custom-wind-particle-motion-layer-in-mapbox-gl-js-9a51978e3ffb))

**Upgrade menu (none implemented — pick with the user):**
- **U1 — Continuous density (fixes §1 properly):** replace the binary tile/global regime with a blended density
  function: `targetSeeds(z) = lerp(globalTarget≈400, partTarget=1650, smoothstep(2.5, 4.5, z))`, and extend the
  camera-tile seeding down to ~z2.5 (tile width clamps at world size anyway). Removes ALL cliffs. Effort: engine
  density block + ADVECT/DRAW threshold uniforms already exist (`u_tileZoomMin`); mostly re-deriving `densityBase`
  from a zoom-shaped target. Medium risk (reseed-on-pan at low zoom) — verify with the wheel-zoom preview recipe.
- **U2 — Screen-space Poisson/jittered reseeding:** current reseed is uniform-random in the tile → visible clumps
  at low density. Jobard-Lefer-style minimum-separation (approximated by stratified/jittered grid seeding in the
  reseed shader) gives even coverage at every density. Effort: reseed logic in ADVECT_FS drop/respawn path.
- **U3 — Density-aware crest size:** when density drops (far zoom), scale crest length/thickness up slightly so
  coverage FEELS constant (the v5.8 zoomScale already does some of this — tune the low-zoom end).
- **U4 — Perf guardrail:** if targets rise, add a device-tier cap (mobile already halves particleRes 296→192).

## 3. TO-DO LIST for the next context (priority order)
1. **§1 sparsity**: run the zero-code tuner experiment (tileZoomMin→3.0) with the user; if good, ship the default;
   if cliffs still bother, implement U1. Then U2/U3 as visual-quality passes with user sign-off per step.
2. **User visual re-test of `1105f625`** (if not yet re-confirmed after hard reload): steady crests at z4–6 dwell,
   coast-hugging animation at z8.4/z9.1, `__MARINE_ZOOMSTATE_REINITS__` frozen while dwelling.
3. **Release (§22)**: gates were green at `76e1cd1b` (prod build + 472/472 + clean ff). Re-run the quick gates on
   current HEAD (`craco build` + full test suite), then ask the codified question: "Are you sure you want me to
   push to main?" — user dismissed once (not a no — timing).
4. **z6.4–7.6 zoom-out transition polish (OPEN, deprioritized)**: while actively zooming out, clamp visuals show
   until dwell (series revalidation + §2b coarse fallback self-heal on ~3s dwell); the display-gate threshold
   (6.5) vs suppression band top (7.0) leaves a 6.5–7.0 zone where regional is rejected but coarse+nearest is fine.
   If the user still dislikes it, consider aligning gate/band thresholds or committing the coarse base preemptively
   on zoomstart. Regression-prone lineage — evidence first.
5. **Verify ICON/EURO direction fields** — ✅ **DONE (2026-07-02 PM)**: neighbor-delta on served 18:00Z coarse
   grids (all from block-mean-fixed runs; producing-run headSha checked ⊇ `b6db704b`): GFS mean 33.4°/N-Atl 43.1°,
   ICON 31.0°/43.3°, EURO 34.6°/53.5° — all at GFS/reference parity (pre-fix pathology was 41.2° mean, 15.3%>90°;
   now 7.9–9.2%>90°). Grid payload shape: `grid={bounds,cols,rows,vectors,diagnostics}`, vectors flat row-major.
6. **Verification debt** (shipped, never eyeballed): rating-band fixes (`4fb2359f`/`0755fc2d`/`b623c39d`), stranded
   -pending freeze recovery. One live session with the Surf toggle.
7. **codebase-memory MCP read-path broken** (all read tools reject the listed project; reindex doesn't heal) —
   needs the MCP server process restarted (full app restart). trevec + Grep/Read are the fallbacks.
8. **Pre-existing test hygiene**: NOAA-buoy/tide social tests need network fixtures (fail offline). Low.
9. **Perf note from user log**: LCP 5.8s (poor) on /map cold load — unrelated to weather; candidate for a perf pass.
10. **Disk**: root cause of the two 0-byte fills was found/cleared by the user (425GB free now) — if it recurs,
    check whatever they removed.

## 4. Landmines / recipes for the new context (read before touching anything)
- **BUNDLE-MARKER CHECK FIRST** on any "still broken": the app is ROUTE-SPLIT — grep the **MapPage chunk** (enumerate
  `/asset-manifest.json`), NOT `/static/js/bundle.js`. `curl -s localhost:3001/asset-manifest.json` → grep the
  `src_components_MapPage_js-*` chunk for a fix marker (e.g. `u_coarseNearestDir`). Corrupt-webpack-cache vector:
  kill server, delete `frontend/node_modules/.cache` + `build`, restart.
- **Preview harness CAN drive zoom**: desktop viewport + WheelEvent bursts (deltaY ±120, ~130ms apart) on
  `.maplibregl-canvas`; `map.jumpTo` REVERTS (react-map-gl controlled). Chrome-MCP tabs are HIDDEN (rAF paused) —
  do NOT force-render loops (froze the tab once); use the preview harness for anything render-dependent.
- **Backend**: serve-only Render re-pulls L2 every 30 min; data fixes need a `forecast-ingest.yml` run (gh CLI,
  ref dev) — a queued workflow_dispatch gets REPLACED by the next scheduled run (check the producing run's
  `headSha` before attributing results). `/grid` needs manifest-snapped `valid_time` (`valid_time_start` field).
- **Tuner** = the live experiment surface (`__RAW_TUNER_VALUES_V2__`, Natural defaults baked; "Flat (legacy)" for
  A/B). Engine anim echo `__RAW_GPU__.anim` is the truth readout; `__CREST_DIAG__` has the density curve numbers.
- All §22 rules, provider-contract rules (`provider` stays 'open-meteo'), and "never label Surfline" still apply.
