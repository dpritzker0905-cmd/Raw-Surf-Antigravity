# HANDOFF 2026-07-23 EOD (Opus 4.8) — marine: 3° REVERTED, 2° live; particle-split + pan-clear + GFS/ICON-coarse OPEN

**STATUS: HEAD = `d2b2576f` (== origin/dev, the 3° revert). 2° everywhere is LIVE. Four items OPEN, all
DIAGNOSED but NOT fixed — each needs a careful, tested pass. Supersedes the earlier
`HANDOFF-2026-07-23-OPUS48-marine-3deg-lod-and-open-items.md` (which pre-dated the revert).** Memory:
[[marine-lod-ladder-3deg-base-2026-07-23]].

## 0. BINDING RULES (the 3° regression taught these the hard way)
forensics-not-guessing · Jacobian · study memory + 3mo commits first · instrument + kill-switch + A/B ·
**unit AND live, BEFORE and AFTER** · **a serve-time GRID transform MUST assert `len(vectors)==cols*rows`
+ be tested across ALL 3 models + the antimeridian + a visual, BEFORE deploy** · probe SERVED data at
exact cells · **do NOT rush fetch/coverage/grid-transform changes** · don't hammer the live map (rapid
jumps + base-eviction wedge the renderer + induce mask artifacts) · the 2400px resize wedged the pane —
keep it ≤~1900.

## 1. WHAT'S LIVE + WHAT WAS REVERTED
- **`41addb91` LIVE — serve 2° global_mid at ALL zooms** (`MARINE_MID_RES_MAX_SPAN` 40→400 in
  `mid_res_tier.py`; frontend globalizes to WORLD bbox at its own 40° ceiling → no clip edge; 5 lockstep
  sites untouched). Fixes the far-zoom "Bertha clears" for EURO (verified: Bertha held 2.74m z6→z2.3).
  Kill: `MARINE_MID_RES_MAX_SPAN=40`.
- **`e05c313e` REVERTED (`d2b2576f`) — the 3° energy-pool wide base.** It SCRAMBLED all models.
  ROOT BUG: `wide_base_decimate.mean_pool_global_grid` emitted a MALFORMED grid — the source 2° global
  has BOTH -180° and +180° antimeridian columns; `ci=floor((lng+180)/3)` maps lng=180→ci=120, a spurious
  121st column beyond `cols=round(360/3)=120` → **6655 output vec ≠ 120×55=6600** (55 stray) → the texture
  encoder row-shifted → geography scrambled (N-Pacific no-data, rectangles, storm gone). My live test
  passed because it checked cols/rows METADATA, not `len(vectors)==cols*rows`, and only EURO/Gulf.
  Reverted → 2° restored + verified (all 3 models 15023 vec, `vec==cols*rows` True, Bertha present).

## 2. OPEN ITEMS (all live-diagnosed 2026-07-23 EOD — fix carefully, test before/after)

### (A) GFS/ICON serve a COARSE 14.4° world base, not the 2° global — Bertha nearly invisible there
**Live check (EOD):** world-bbox `grid_series` → EURO **15023 vec / cell 1.99° / GulfMax 2.44m** (2° OK);
**GFS + ICON 300 vec / 25×12 / cell 14.4° / GulfMax ~1.0m** (coarse — Bertha block-averaged away). Grids
are well-formed (not the scramble). Immediately post-revert GFS/ICON WERE 2°/15k (GulfMax 2.14/2.55), so
it **drifted** → the GFS/ICON `global_mid` (2°) product is stale/missing/superseded so the mid tier can't
serve it → falls to a 14.4° coarse. INVESTIGATE: is `ingest_gfs_marine_global_mid` / `ingest_icon_...`
producing a FRESH `region_id='global_mid'` product? Check the manifest valid_time vs EURO's; check the
ingest cron ran. `pick_mid_item` needs a mid candidate within the time window — if none, no 2°.
**This is why "Bertha gone in GFS/ICON."** Probe: `?model=GFS&...bbox=-180,-80,180,85`.

### (B) Particle-tile SPLIT — ROOTED + safe live-A/B fix found (NOT committed)
At z3-4 the particle tile is `tileWidth=0.5` merc = **180° wide** (`tileZoom=floor(z)-TILE_BACKOFF(2)`,
WebGLMarineEngine.js:1438) vs viewport ~0.19 → **onScreenFrac=0.09** (91% off-screen = sparse) AND the
180° tile straddles the antimeridian for camera |lng|>90° → the sparse seam = "split, flips on pan". NOT
resolution-coupled (2° shift only EXPOSED it — animation now alive at wide zoom). **Live A/B (safe):
`window.__RAW_TILE_BACKOFF__=1` → tile 0.5→0.25, onScreenFrac 0.09→0.36 (4× denser), split resolved**
(antimeridian screenshot even; USER: "improved, not bouncing between tiles"). ⚠️ backoff 2 was chosen
`db363a14` for PAN-STABILITY. FIX = **zoom-gate** (backoff 1 at wide z<~5, keep 2 at close zoom) + verify
pan-stability + all zooms + kill-switch. FRONTEND-only (HMR, no deploy).

### (C) Heatmap CLEARS ON PAN at mid-zoom (the color field, separate from B)
USER panned at z5.46 (Mexico) → blank. `__RAW_FORENSIC__`: resident was a 25×20 mid CLIP (span 48°) →
pan → **`engine_clear`** (cleared the non-covering clip) → **`inflight_skip`** (panMoved, re-fetch
deduped/stranded) → `residentTier:none` = blank. Root: at mid-zoom the resident is a viewport CLIP (not
the global base), cleared on pan before a cover arrives + re-fetch strands. ⚠️ LIKELY WORSENED BY the
far-zoom fix: at span ~48° the frontend served a CLIP instead of globalizing to the covering 2° base —
**why didn't globalize fire at 48° when `__RAW_MARINE_GLOBAL_SPAN__=40`?** (root this). Known guards:
`__RAW_DISABLE_MARINE_STRAND_WATCHDOG__`, `__RAW_DISABLE_MARINE_WARM_COVERAGE__`,
`__RAW_DISABLE_MARINE_REFEED_COVER_GUARD__`. Do NOT rush this fetch/coverage path.

### (D) Gray box + raster-layers clear/reappear (from earlier, still open)
Gray box = stale ocean-mask box (mask FIXED 4096×2048, res-indep); the GIANT one earlier was likely
MY-test-induced (hammering) — needs a clean repro (El Salvador class WebGLMarineEngine.js:3016). Raster
layers (rain/satellite/pressure/temp/water_temp/fog) clear/reappear at zooms = SEPARATE Raster-Queue-
Transition system (not the grid engine). Both need the user's exact zoom+region for a clean repro.

## 3. FORENSIC TOOLS (re-inject after reload)
- `__RAW_FORENSIC__.summary()` — commits, engine_clear, inflight_skip, reject_downgrade, mask_rebuild.
- `__RAW_GPU__.tileCover` {tileWidth,vpW,vpH,clamped} + `.particleDensity.onScreenFrac` — particle tile.
- `window.__RAW_TILE_BACKOFF__` (default 2; =1 denser tile), `__RAW_MARINE_GLOBAL_SPAN__` (globalize=40),
  `MARINE_MID_RES_MAX_SPAN` (backend=400), `MARINE_WIDE_BASE_RES` (dead now, was the 3° kill).
- `__MARINE_ENGINE__._waveData.waveGrid` (resident cols/rows/bounds/vectors), `_coarseBaseData` (base),
  `_tileCenterX/_lastTileWidth` (particle tile anchor).
- Served-data probe (fastest truth): `fetch('https://raw-surf-antigravity.onrender.com/api/weather/grid_series?model=EURO&domain=marine&layer=waves&bbox=-180,-80,180,85&hours=0')` — check `len(vectors)==cols*rows`.
- Deploy polls: `scratchpad/poll_3deg.py`, `poll_revert.py`. Render deploy ~4-6 min on push to origin/dev.
- Enable EURO+Waves after reload: click `EURO` then `Waves` buttons (aria-pressed toggles).

## 4. HOUSEKEEPING
- **MEMORY.md ~20KB (near the 24.4KB read limit)** — compact to <17KB next session (one line/entry).
- The earlier handoff `HANDOFF-2026-07-23-OPUS48-marine-3deg-lod-and-open-items.md` is STALE (pre-revert)
  — this one supersedes it.
- Recovery for the user when the heatmap clears on pan: reload / slight zoom re-triggers the fetch.
