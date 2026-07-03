# HANDOFF — Night 2: the all-black mask root, deep audit, satellite black patches (2026-07-03, ~05:10 UTC)

**Standing order unchanged: dev-only, NO main pushes.** dev = `899373d5`. Netlify prod still pinned (user dashboard).
Read with: memory `deep-audit-2026-07-03` + `land-aware-seam-coherence-2026-07-03` + the night-1 handoff (§0A BUILT addendum).

## 0. Tonight's commits (all dev, all frontend/docs — the backend product is untouched)
| sha | what |
|---|---|
| `28e0f16a` | Land-aware seam coherence: encoder direction-dilation + phantom-south validity gate + seam fade default 0.7 |
| `9836f75f` | Seam DIM-not-kill + confused-sea drift damping (0.35×) — Baja dead zone → dim slow shimmer |
| `bd61afda` | Dup-skip stranding fix: state-authoritative dedup + fail-open no-downgrade guard + self-heal stash |
| `7b159ab0` | Sidebar-collapse dead strip: `md:left-16 xl:left-[200px]` + ResizeObserver→map.resize() |
| `caee7f9a` | Audit fixes: geoCache validity key+cap, /point unavailable→NULL (Texas "--"), dedup BOTH-authorities (escape hatch restored) |
| `899373d5` | **THE mask root**: per-polygon culling in `renderMaskToCanvas` — kills the ALL-BLACK regional ocean mask |

## 1. THE WIN — all-black regional mercator mask (`899373d5`, live-verified)
The whole "particles cleared at close zoom" family had ONE root: the 10m land GeoJSON (loaded
2026-07-02) has ~10 CONTINENT-scale MultiPolygons; `renderMaskToCanvas`'s FEATURE-level bbox cull
passed nearly all of them for any regional target, and far-side member polygons (Eurasia for a
Florida tile) wrap ±360° near the anti-center meridian — their fill sweeps the whole canvas →
regional masks came out ALL BLACK → `oceanFlag=0` → advect drops every particle + the regional
heatmap masks out (only the coarse wash shows) → dead until any bounds-CHANGING commit rebuilds the
mask ("came back briefly, then cleared"). Fix: per-member-POLYGON bbox cull
(`getPolygonBbox`/`polygonOverlapsTarget`, unit-tested). Verified on the reliable dead recipe:
clean boot → Waves → z9 offshore Cocoa → dense land-clipped crests. 495/495 tests.
**Reusable forensic toolkit (memory has details): wrap `setWaveData` to capture gl → commit
synthetic grids; FBO-attach + readPixels GPU textures (⚠️ regional masks are 2048×1024, global
1024×512); replicate canvas renderers in-page against the live geojson with a global-bounds control.**

## 2. ⚠️ NEW, OPEN: satellite layer black land patches (user report ~05:05 UTC, repro'd in preview)
- Satellite (cloud-cover) layer, ~z5.66 (also seen z7.85), Sahara/Mali (center ~18.09, 2.14):
  a bounded GREY RECTANGLE containing jagged BLACK silhouette blobs over land. Screenshot in the
  05:05 session transcript.
- Renders via the **FCE/GPU-dispatcher RASTER path** (HUD: Render Mode Raster; globals
  `__FCE_FIELD__`, `__FCE_RENDER_PLAN__`, `__GPU_DISPATCHER__`, `__RASTER_DEBUG__`, `__RASTER_PROBE__`).
  Marine engine INACTIVE at repro (`marineEngineActive: false`) → NOT the marine canvas/mask leaking.
  Note: `window.activeMarineLayer` string stays stale-'waves' when satellite is active (cosmetic? check).
- The rectangle = one raster tile/field extent; black blobs could be (a) NaN/negative cloud values
  in one fetched tile, (b) a land-mask channel misapplied in the raster shader, (c) a palette bug at
  a specific value. User said "study all the commits" — check the raster/FCE + cloud/satellite layer
  lineage (`git log -- frontend/src/engine frontend/src/components/map/MapWebGL.js` and grep
  LayerRegistry for the satellite entry) — the layer's name in code may be cloud/cloudcover, not satellite.
- Forensic start: `__RASTER_DEBUG__`/`__RASTER_PROBE__`/`__FCE_DIAGNOSTICS__` at the repro; read the
  tile's raw values under a black blob (probe the FCE field texture like the mask was probed).

## 3. Gate rebuild + scan (task #1 — FIRST thing when the run completes)
- Producing run **28637733899**, sha `7b159ab0` ⊇ gate revert ✓ (sha check DONE). Started 04:07 UTC;
  expect completion ~05:10–06:40 UTC; Render re-pulls L2 ≤30 min after upload.
- Then run the scan (scratchpad `global_dir_scan.js`; recipe in memory topic file — fetch
  `/api/weather/grid?...bbox=-180,-80,180,85`, vectors at `body.grid.vectors`, ocean = NOT
  `v.waves.is_valid===false`… note raw backend vectors carry `speed` = wave height, NO `height` field).
- **Same-script pass bar: fusion baseline measured 18.8°/21 >60°/12 >90° → expect ≈13°/~11/~4.**
- Then: user re-checks Baja (east of −115 ≈ NNE; (20,−120) stays GFS-honest ~WSW pending confidence
  work); the fusion-era 177° seam at (26,−119) should relax to ~77° → no fade there.

## 4. Queued BEHIND the verification (backend freeze lifts after §3)
1. Gulf/Texas `/point` coverage hole: no regional tile + all four surrounding 10° coarse centers are
   land → `nearest_ocean_coarse_masked` snaps ~1000 km or returns `unavailable` zeros. Fix in the
   point resolver: build/prefer the 0.25° viewport product (Baja demonstrably gets
   `viewport_gfs_marine_waves_*.json`, cm-parity vs pinned GFS). Also fix the provenance mislabel
   (`coverage_status: inside_regional_tile` while serving global coarse).
2. §0B-a confidence export (per-cell direction confidence in the coarse product) → crest confidence
   fade for the ~10 model-divergence blocks.

## 5. Other open items (frontend, any time)
- **Surf/plain frame mixing**: localStorage `__SURF_MODE__`='true' surf-bands every boot until the
  window flag is written; retained frames never revalidate against mode. Design: mode into frame
  identity end-to-end + revalidate retained frames on toggle. (The z7.12 "heatmap cleared" of night 1.)
- **Inflight registry**: foreground entry stays `active` after `detached_cache_completed` →
  `fetchPending` wedged true (cosmetic-ish, masks real pending state).
- **Re-drive cadence**: the (formerly 3Hz) commit attempts on hour-mismatch — driver never identified;
  dedup now makes it settle, but find the driver.
- **Orchestrator ledger-only dedups** at `useMarineOrchestrator.js` ~394 (instant cache-hit), ~509,
  ~562 (cache remap) — same divergence class as the fixed one; they commit without prev access.
- User seam check at the Baja 25°N/−115° 4-cell corner (after the gate product lands).

## 6. New kill switches / telemetry (tonight)
- Encoder dilation: kill `__RAW_DISABLE_DIR_DILATION__`; telemetry `__MARINE_DIR_DILATION__{filled,cols,rows,isGlobal}`.
- Seam dim: floor `__RAW_DIR_COHERENCE_MIN__` (0=off); alpha floor `__RAW_SEAM_FADE_FLOOR_ALPHA__`
  (default 0.3, echo `__RAW_GPU__.anim.seamFadeFloor`); drift damping rides the floor gate.
- No-downgrade: kill `__RAW_DISABLE_NO_DOWNGRADE__`; self-heal telemetry `__MARINE_NO_DOWNGRADE__.selfHealed`.
- Commit dedup: state-authoritative + ledger co-sign; `__committedSig` stamped on committed frames.

## 7. Landmine additions (beyond night-1's sheet)
- ⚠️ Backend marine vectors: `speed` IS the wave height (`value_kind: wave_height`); `height` exists
  only after the frontend mapper. Two probes were burned on this in one night.
- ⚠️ Preview-tab code bisection is UNSOUND: SWR serves different tiles per boot. Use synthetic-grid
  commits (toolkit §1) or a fresh profile per version.
- `map.jumpTo()` STICKS now (the old "reverts" landmine no longer applies); timeline scrubber =
  `input[aria-label="Timeline scrubber"]` + native-setter + input/change events.
- U2 stratified-reseed dead-strata theory: DISPROVEN live (flag off did not revive a dead field).
- The `data_committed` pipeline event logs BEFORE the dedup decision — a following
  `duplicate_commit_skipped` means NOTHING was committed (misleads forensics).
