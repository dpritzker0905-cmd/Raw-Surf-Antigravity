# HANDOFF 2026-07-23 (Opus 4.8) — EURO marine "wrong colors / storm vanishes on zoom-out" arc

**STATUS: USER-REPORTED, STILL PERSISTING after 6 commits. HEAD = `29aef7b4` (== origin/dev).**
This was a long single-session arc. Each fix was correct but incomplete; the user re-reported ~5×.
The last probe (below) shows the most likely remaining cause we have NOT yet addressed. Read §4 first.

## 0. BINDING RULES (were applied; keep applying)
forensics-not-guessing · Jacobian (isolate the ONE variable) · study memory + 3mo commits before
touching a subsystem · instrument + kill-switch + A/B · unit AND live tests · **probe the served DATA
at the exact cells, never a proxy** · use `zoomlab.js` (real-gesture video) for marine zoom, NOT
static jumpTo (settled-state ladders can't see mid-gesture clamping — user mandate).

## 1. THE USER SYMPTOM (marine heatmap, model = EURO, zooming OUT)
Zoomed in: TS Bertha (a compact storm, eastern Gulf ~28°N 88°W) renders. Zooming out: the storm
"clears" and the Gulf shows "wrong colors" (an inflated flat wash). Later reports: at continental zoom
a "grid shape" appears and animations clear in patches. GFS/ICON do NOT show the wrong colors — it is
**EURO-specific**.

## 2. THE ONE ROOT (finally understood): the coarse tier masks EURO's enclosed-sea Gulf
The marine heatmap has THREE zoom tiers (by viewport SPAN, served by `grid_resolver.resolve_grid`):
- **fine 0.25°** (close zoom, regional tiles)
- **2° `global_mid`** (`mid_res_tier.py`, full-global 2° product clipped to viewport) — the "storm
  detail" tier
- **10° `global_coarse`** (world/continental zoom)

EURO's coarse `waves` (ECMWF-WAM/CMEMS) **structurally MASKS enclosed seas** (Gulf of Mexico, Med,
Black Sea, …): those cells serve `is_valid=False` → the frontend inflates the holes from distant
open-ocean cells = the **wrong colors**. GFS/ICON's mask carries the Gulf (why they're fine). At 10°
a compact storm is also block-averaged away.

The tier a request lands in is set by the viewport SPAN vs a ceiling (`__RAW_MARINE_GLOBAL_SPAN__`
front / `MARINE_MID_RES_MAX_SPAN` back). Zooming out crosses the ceiling → drops from 2° mid to 10°
coarse → the mask bites.

## 3. WHAT WE SHIPPED THIS SESSION (all on origin/dev, all deployed + tested)
| Commit | What | Verified |
|---|---|---|
| `555d2eb6` | mid-band ceiling 15→40 (storm stays 2° to ~z5) | served-data + zoomlab |
| `f50f80bc` | proportional mid-clip overhang (coverage headroom) | unit + zoomlab |
| `06b3dbc2` | engine bridge/reject HOLD the mid in-band (killed EURO coarse-FLASH); arbiter synced via `ctx.midBandCeil`; differential + 37k-seq harness 0 divergences | 401 FE tests |
| `6c206234` | ceiling 40→120 (2° mid out to ~z3) — **later reverted** | tests + zoomlab |
| `29aef7b4` | **THE ROOT FIX**: serve-time coarse GFS-fill (`coarse_gulf_fill.py`) + ceiling **back 120→40** | 6 fill tests + live probe |

### The definitive root-cause finding (why the INGEST fill failed 6× before this)
The intended repair (`_fetch_common.fill_masked_waves_from_gfs`, ingest-side) filled **0** across 6
bakes. Completed-bake DIAG (`gh run view 29959504226 --log | grep GFS-fill`):
`cell_hit:612, cell_miss:0, time_miss:0, gfs_masked:4615, filled:0`. Cells + times align, but the
ingest reads the **RAW stashed GFS grid** whose Gulf partitions don't reconstruct — while the
**SERVED** GFS product (post-normalizer) DOES carry a valid Gulf. **No ingest-side fix can win.** So
`29aef7b4` fills at SERVE time from the served GFS coarse product (`coarse_gulf_fill.py`, hooked once
in `routes/weather.py get_grid` — grid_series reuses it per frame). ⚠️ The ingest
`fill_masked_waves_from_gfs` is now DEAD CODE (superseded; harmless; cleanup candidate).

## 4. ★ WHY IT STILL PERSISTS — the leading suspect we have NOT fixed
**The 2° MID tier ALSO masks some Gulf cells, and the serve-time fill only covers the COARSE tier.**
Live probe RIGHT NOW (02:55Z, post-`29aef7b4`), EURO `waves`:
```
mid  z5.35 (30° bbox):  spacing 2°,  Gulf(30,-90)=0.00 MASKED   (28,-88)=2.74 OK
coarse z4 (60° bbox):   spacing 10°, Gulf(30,-90)=1.65 OK       (28,-88)=1.65 OK   ← fill works
GLOBAL coarse:          spacing 10°, Gulf(30,-90)=1.65 OK       valid 548/629      ← fill works
```
So the COARSE fill is LIVE and correct. But at the **mid tier** (z5-8, the normal zoom), the EURO 2°
product still serves `(30,-90)=MASKED` (Mississippi-delta / near-coast cell). Bertha (28,-88) is fine,
but a masked delta cell = a residual inflated-color hole the user likely still sees.
→ **NEXT STEP #1 (highest probability — CONFIRMED FEASIBLE):** extend the serve-time fill to the MID
tier too — fill masked EURO/ICON 2° `waves` cells from the served **GFS 2° global_mid** product (same
pattern as the coarse fill; `coarse_gulf_fill.py` currently guards `span≥350` = coarse-only — relax
that guard and pick the donor by the recipient's spacing: GFS `global_mid` for a 2° recipient, GFS
`global_coarse` for a 10° recipient). **VERIFIED 02:57Z:** GFS mid `(30,-90)` = `0.00 VALID` (calm
delta), EURO mid `(30,-90)` = `0.00 MASKED` → filling EURO from GFS mid gives the honest calm value,
not an inflated hole. Donor lookup: `region_id=='global_mid'` (mirror `_load_gfs_coarse_waves`, which
uses `region_id=='global_coarse'`). ⚠️ the mid product is baked per-hour + full-global — load it once
per served frame (store LRU caches it) like the coarse path.

### Other live suspects to rule out (in order)
2. **Stale browser tab.** The :3009 SERVER chunk HAS the code (verified: map chunk contains
   `Number(window.__RAW_MARINE_GLOBAL_SPAN__)||40.0`, `_midBandBridgeWide`, `midBandCeil`). But the
   user's open TAB may hold a cached chunk — a big engine-module HMR often needs a HARD reload. Ask
   the user to hard-reload (Ctrl+Shift+R), or load :3009 fresh in the Browser pane and re-check.
3. **EURO fetch latency.** EURO's Copernicus mid fetch is slow (~15-30s at wide zoom). On zoom-out the
   coarse bridge (now correct-colored via the fill) shows for that window, THEN sharpens to 2° mid.
   If the user isn't waiting, they read the transient as "persisting". GFS/ICON are immediate.
4. **True world zoom (>120° span, z<~2.5):** still coarse (now filled → correct colors, storm smoothed
   — user explicitly chose "correct colors, smoothed storm" for far zoom, so this is EXPECTED).
5. **Which frontend is the user on?** Their original screenshots were `localhost:3009` (a dev server
   in THIS working tree, run by another chat). If they're on a DEPLOYED frontend instead, it needs a
   build. Confirm the surface before more debugging.

## 5. CURRENT ARCHITECTURE (post-`29aef7b4`)
- Mid-band ceiling = **40°** in FIVE lockstep sites (tune via `__RAW_MARINE_GLOBAL_SPAN__` / env
  `MARINE_MID_RES_MAX_SPAN`; kill=15): backend `mid_res_tier.py:134`; frontend
  `backendWeatherServiceClientCoverage.js` `_globalSpan` (~L383, GFS/ICON) + `_euroGlobalSpan` (~L179,
  EURO); engine `WebGLMarineEngine.js` `_midBandBridgeWide` (~L3414, the bridge+reject "wide" test);
  arbiter `marineCommitArbiter.js:191` reads `ctx.midBandCeil` (NOT window — decideMarineCommit passes
  it from the same `w` the guard reads; keeps guard==arbiter — the differential + sequence harnesses
  enforce it, DO NOT let them diverge).
- Serve-time coarse fill: `backend/services/weather_pipeline/coarse_gulf_fill.py`
  (`fill_coarse_enclosed_sea_from_gfs_served`), hooked in `routes/weather.py get_grid` (~L128). Kill:
  `MARINE_COARSE_GULF_FILL=0`. Nearest-cell (grids differ 25 vs 37 cols), 8° cap so true-land stays
  masked. Donor = GFS only (never a recipient).
- Result: z5-8 → 2° mid (Bertha sharp, but SOME mid cells still masked — §4#1); z<5 → 10° coarse
  (Gulf now filled → correct colors, storm smoothed).

## 6. TOOLING / HOW TO VERIFY (all used this session)
- **Served-data probe (fastest truth):** `node` + `https.get` to
  `https://raw-surf-antigravity.onrender.com/api/weather/grid_series?model=EURO&domain=marine&layer=waves&bbox=W,S,E,N&hours=0`
  — parse `frames[0].vectors[]`, check `is_valid` + `speed` at exact cells. Scripts in
  `AppData/Local/Temp/claude/.../scratchpad/` (probe_bertha.js, poll_*.js).
- **zoomlab (real-gesture video + per-frame trace):** `frontend/scripts/zoomlab.js`. New this session:
  `zoomto` scenario (wheel to `ZL_TARGET_ZOOM` then long settle) + env `ZL_CENTER`, `ZL_START_ZOOM`,
  `ZL_GLOBAL_SPAN`. Run: `ZL_MODEL=EURO ZL_BASE=http://localhost:3007 ZL_CENTER=-88,28
  ZL_START_ZOOM=7 ZL_TARGET_ZOOM=4 node scripts/zoomlab.js zoomto <outdir>`. TIER = span/cols
  (2°=mid, ~10°=coarse), NOT cols alone (a wide mid has many cols).
- **Browser pane** reaches BOTH :3007 (our verify server) and :3009 (user's). Enable Waves + EURO via
  the weather panel buttons (text 'Waves'/'EURO'). Engine state: `window.__MARINE_ENGINE__._waveData`,
  `__MARINE_RENDER_SOURCE_DIAG__`, console `[FORENSIC-SNAP]` lines (zoom/dims/span per commit).
- Deploy cadence: push to origin/dev → Render auto-deploys backend ~4-6 min. Serve-path changes
  (fill, ceiling) activate on deploy — NO re-bake. Poll a served-data probe until it flips.

## 7. LANDMINES
- **The commit-arbiter zone is fortified** (differential test + 37,268-interleaving sequence harness).
  Any change to the bridge/reject/arbiter "wide" logic MUST keep guard==arbiter (pass the ceiling via
  `ctx.midBandCeil` from the same `w`). Both harnesses assert 0 divergences.
- **`_midBandBridgeWide` test fixtures straddle the ceiling** (wide fixtures >120°, mid-band <40°), so
  the ceiling value can move 40↔120 without breaking them — but a NEW ceiling outside [36,150] would.
- **EURO mid commit lags ~15-30s** at wide zoom (slow Copernicus) — always settle before judging.
- **Provider label lies:** served `provider:'open-meteo'` is a normalizer artifact even for direct-GRIB.
- **The served product ≠ the raw ingest grid** (the whole reason the ingest fill failed). Probe the
  SERVED `is_valid`, never the ingest cache.
- Dev server (:3007) wedged twice from many HMR recompiles of the huge `WebGLMarineEngine.js` — restart
  it (preview_stop/preview_start) if navigate/JS times out.

## 8. OPEN QUEUE (do in order)
1. **Extend the serve-time fill to the MID tier** (§4#1) — the leading cause of "still persisting".
2. Confirm the user's SURFACE (:3009 dev tab vs deployed) + hard-reload; rule out stale bundle (§4#2).
3. Live zoomlab EURO zoom-out on the user's actual surface, settled at each notch, screenshot the Gulf.
4. (cleanup) delete the dead ingest `fill_masked_waves_from_gfs` + its stuck fix bake `29963037253`.
5. Related memory: [[marine-storm-vanishes-zoomout-midtier-ceiling-2026-07-22]],
   [[euro-coarse-ingest-anatomy-gulf-fix-2026-07-22]], [[euro-gulf-0fill-and-rectangle-2026-07-22]].
