# HANDOFF — 2026-06-30 — Rating band (still not painting), particle density, EURO waves, sim-quality plan

Picks up from [[marine-resolution-band-provenance-2026-06-30]] + the long 2026-06-29/30 map-quality session.
Goal of this leg: make the surf-rating overlay top quality. Backend is now verified perfect; the rating BAND
is the one stubborn open bug and it is **100% frontend**. This file is the state to resume from.

---

## TL;DR for the next context
1. **★ RATING BAND DOES NOT PAINT (open).** Backend is PERFECT (curl-verified: FL surf=1 grid → `rating_mode:True`,
   117 cells, **49 carrying real scores 17–20**). The band shader is correct (would paint ~46% translucent if on).
   The break is the **rating grid not reaching the engine as `ratingMode=true`** for the live viewport → the
   Option-A gate forces `u_surfMode=0` → user sees the normal heatmap, no band. A throttled **`[rating-band]`
   console line** now self-diagnoses it (commit `77c08a1d`). **FIRST NEXT STEP:** on `/map`, Surf toggle ON, over
   Florida, read the console `[rating-band] ...` line + `window.__RAW_GPU__.ratingBand` (`{flag, gridRatingMode,
   forcedOff, active, gridCols, fromSeries}`). That pins it (see Hypotheses below).
2. **EURO waves = `open_meteo_fallback` (transient, self-heals).** CMEMS is fine (5/6 recent crons OK); the
   22:20 run timed out (40-min ceiling) and no CMEMS-success cron has run SINCE, so waves is stuck on the
   fallback. The next good cron rewrites `copernicus_native`. Guard `EURO_KEEP_NATIVE_WAVES` prevents FUTURE
   single-failure downgrades but can't un-degrade the already-written fallback.
3. **Particle density at close zoom was TOO DENSE** — fixed (thinned), science-backed (commit `77c08a1d`).

---

## 1. ★ The rating band — full forensic state

**Verified WORKING (do not re-investigate):**
- Toggle → `setSurfModeFlag` → `window.__SURF_MODE__=true` + `rawsurf:surf-toggle` event. Glyphs, band-fetch
  (`marineGridSeries.js:230` appends `&surf=1`), and the shader all read this one flag → consistent.
- Backend `/grid` + `/grid_series` with `surf=1` over a Florida viewport return a **13×9 regional tile,
  `rating_mode:True`, 49 scored coastal cells** (score/10 packed in `vec.speed`). PERFECT.
- The `#1` resolver fix (`MARINE_REGIONAL_OVERLAP_REUSE`, all marine models) is live & curl-verified — the FL
  viewport resolves to the regional rating tile, not the 37×17 global.
- Heatmap shader paints the band when `u_surfMode>0.5` (`WebGLMarineShaders.js:243-268`): `ratingColor =
  getRatingColorSmooth(score)`, `bandAlpha = u_opacity·smoothstep(0.5,4,score)·smoothstep(0.3,0.8,oceanAlpha)`
  ≈ 0.46 at z9 → the translucent glowing band the user expects.
- Engine gate (`WebGLMarineEngine.js:430`): `if (surfModeVal>0 && !(waveGrid && waveGrid.ratingMode)) surfModeVal=0`.
- Series conformer stamps it: `marineGridSeries.js:189 ratingMode: !!frame.rating_mode`; engine reads
  `this._waveData.waveGrid.ratingMode`.

**So the break = `waveGrid.ratingMode` is FALSE on the engine's rendered grid for the live viewport.** Ranked hypotheses:
- **H1 (most likely): the live series request bbox is WIDER than the regional tile** → `resolve_grid` `is_wider`
  branch wins → global-coarse (rating skipped, `rating_mode` false). **MEASURED THRESHOLD (curl sweep):** the
  GFS FL surf=1 grid returns a regional rating tile (`rating_mode:True`) for viewport spans **≤ ~3°** and flips
  to global 37×17 (`rating_mode:False`) at **≥ 4°**. That's roughly **z9+ = band, z7–z8 = no band** (z8 viewport
  ≈ 3.4°, z7 ≈ 6.8°). The frontend also snaps the marine bbox OUTWARD, which can push a z9 view over the edge.
  **Check:** `[rating-band]` shows `cols=37` (global → H1) vs `cols=13` (regional). **FIX options if H1:**
  (a) WIDEN the FL/SoCal pilot tiles to ~5–6° so z7–z8 fit (cron/ingest change — biggest coverage win);
  (b) serve a DYNAMIC viewport fine product when `is_wider` instead of falling to global; (c) tighten the
  frontend marine bbox snapping so a zoomed-in view doesn't balloon past the tile.
- **H2: ratingMode dropped in the data→engine hop** (conformer → `dataRef.current` → `setWaveData(grid)` →
  `this._waveData.waveGrid`). Check: `[rating-band]` `cols=13` (regional) but `gridRatingMode=false`. Then trace
  whether `dataRef.current` is `marineData.grid` (has ratingMode) vs `marineData`.
- **H3: flag not set at fetch time** (`flag:false` in telemetry while glyphs show). Unlikely — same flag.

**Diagnostic shipped:** `[rating-band] OFF — rendered grid is NOT a rating grid (ratingMode=false)...` or
`PAINTING ✓`, throttled 2s, only while surf flag on. Plus `window.__RAW_GPU__.ratingBand`.

## 2. EURO waves provenance
- `copernicus_marine_service.py:278` CMEMS subprocess `timeout=2400` (40 min). Intermittently hits it → EURO
  marine falls to open-meteo; the fallback writes `waves` (ecmwf_wam025 → `open_meteo_fallback`) and supersedes,
  while the GFS-swell fallback only supersedes when GFS data is present → swells keep last-good Copernicus →
  the split. **Self-heals next CMEMS-success cron.** Guard `EURO_KEEP_NATIVE_WAVES` (`scheduler.py`) skips the
  open-meteo waves write when a recent (<6h) `copernicus_native` waves exists. Deeper TODO: find WHY the CMEMS
  subset hangs ~40 min when it fails (per-band timeout? auth? service slowness) — see `copernicus_global_fetcher.py`.

## 3. Particle density (close zoom) — fixed + the science
- `WebGLMarineParticleShaders.js` `closeup` density flipped `+0.06 → -0.30` (z15 ≈ 0.60 vs 0.90 at z10); kept
  the crest-size (+20%) + foam (+50%) boosts. Rationale (flow-viz literature): over-seeding a UNIFORM field
  (close zoom on the 0.25° flow) causes clutter/occlusion; fewer, more salient crests read better. Tunable.

## 4. Sim-quality optimization plan (research-backed)
- **Saliency-based seeding:** seed MORE particles in high-energy / feature regions (swell convergence, nearshore
  breaking) and FEWER in uniform open ocean, instead of uniform density. (Flow-viz: density-by-saliency beats
  uniform.) Big perceived-quality win.
- **Sub-grid detail at close zoom:** the 0.25° flow field is the hard limit (one flat cell fills the screen at
  z13+). Options: procedural curl-noise perturbation of direction at high zoom (organic variation), or finer
  nearshore data. Pairs with the foam/crest boosts already in.
- **Nearshore foam/breaking:** boost whitecap where bathymetry shoals (breaking zones) — couples the surf model
  to the animation. The shader already has `v_whitecap` keyed to wave height; key it to shoaling next.
- **Direction:** v5.5 Mercator y-negate (advection) is CORRECT; the foam reverse-phi was fixed (negate
  acrossCrest). Don't touch advection direction.

---

## Shipped this session (all on `dev`, jest-green, NOT browser-verified — map is auth-gated)
- `MARINE_REGIONAL_OVERLAP_REUSE` (all marine models) — regional tile on viewport overlap → band-data unlock. curl-verified.
- Precompute models `GFS,EURO,ICON` (was GFS-only) — EURO `/spot-ratings` now `src=precomputed`. verified.
- `EURO_KEEP_NATIVE_WAVES` guard; coarse-fade floored 0.7 (heatmap dims, never clears); foam roll direction;
  10m land mask at z9 (was z11); glyph debounce 450→150ms + viewState refetch + accumulate; particle density thin.
- Earlier legs: schema-USAGE grant (precompute 403 root), decoupled precompute workflow + grid-prewarm +
  aiosqlite resolver-DB-decouple + coverage guard, bathymetry workflow YAML fix → slope asset built.

## Kill switches / diagnostics
- `window.__RAW_GPU__.ratingBand` + `[rating-band]` console line (band), `window.__SPOT_RATINGS_DIAG__` (glyphs),
  `window.__RAW_DISABLE_COARSE_FADE__`, `window.__MARINE_HIRES_MASK__`. Env: `MARINE_REGIONAL_OVERLAP_REUSE=0`,
  `EURO_KEEP_NATIVE_WAVES=0`, `SURF_TRANSFORM=0`, `SURF_RATING=0`.
- `gh` CLI: `C:\Program Files\GitHub CLI\gh.exe` (workflow scope). Logs via `gh api .../jobs/<id>/logs` when the
  run-log zip cache is corrupt. Supabase MCP project `jnfbxcvcbtndtsvscppt`.

## References
[[marine-resolution-band-provenance-2026-06-30]], [[rating-overlay-ux-fixes-2026-06-29]],
[[ci-infra-tools-and-decoupled-precompute-2026-06-29]], [[cron-403-schema-usage-root-2026-06-29]].
