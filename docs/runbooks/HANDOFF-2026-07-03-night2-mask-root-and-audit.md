# HANDOFF — Night 2: the all-black mask root, deep audit, satellite lead (2026-07-03, ~05:15 UTC)

**Standing order unchanged: dev-only, NO main pushes.** dev = `30b4d864`. Netlify prod still pinned
to the June-4 deploy (user-dashboard unlock pending; main still carries the two walked-back defaults
from `984c6745` — do NOT re-release main until dev's corrections are included).
Companion reading: the night-1 handoff (`HANDOFF-2026-07-03-wave-direction-and-patches.md`, incl.
the §0A BUILT addendum) + memory `deep-audit-2026-07-03` + `land-aware-seam-coherence-2026-07-03`.

Serving backend product at handoff: still the FUSION-era field (worst directions). The gate rebuild
(run **28637733899**, headSha `7b159ab0` ⊇ the revert — sha check PASSED) started 04:07 UTC and was
still in_progress at 05:09 UTC. §3 is the first job of the next session.

---

## 1. What shipped tonight — six fixes, each BEFORE → AFTER

### 1a. `28e0f16a` — land-aware seam coherence (encoder dilation + validity gate + fade ON)
- **BEFORE**: the seam fade measured coherence as bilinear |waveVec|, but no-direction texels
  encoded as the zero vector — every coastline had up to a coarse-cell-width of faded/culled ocean
  ("missing patches all over"). A SECOND costume found live: coarse products mirror `v.waves` to the
  top level WITHOUT `is_valid`, so land arrived as `{direction:0,u:0,v:0}` and the direction
  synthesis stamped a phantom due-SOUTH vector on every landmass (fake seams against northish seas).
- **AFTER**: `dilateDirectionField` BFS-fills a unit direction from the nearest direction-bearing
  cell into every zero-direction texel (direction ONLY — height/period/mask untouched); the
  synthesis is gated on `isOcean`, which now consults `v.waves.is_valid`. Coherence collapses only
  at true direction seams → the fade defaults ON at 0.7. Live: coarse 37×17 encodes `filled: 4`
  (deep-continental interiors only), crests to every coastline (FL/Gulf/Cuba).

### 1b. `9836f75f` — seam DIM-not-kill + confused-sea drift damping
- **BEFORE**: the fade CULLED (advect core-drop + draw core-discard + zero-alpha ramp). At the Baja
  divergence hotspot the fusion-era rows are 177° apart → coherence ≈0 over a strip degrees wide
  exactly at the user's GPS → total crest dead zone z3.74–6.9. First correction (flat 0.3 floor, no
  culls) produced "split paths": half-bright crests streaming opposite directions across the seam.
- **AFTER**: conflict zones render as dim SLOW shimmer — ADVECT drift damps to 0.35× toward the seam
  core (a crossing sea has no clean propagation direction); DRAW dims two-segment (floor..1 over
  [0.5f, f]; the floor itself 0..`u_seamFadeFloor` over [0, 0.5f]) so only the thin anti-parallel
  core line nears invisible. CPU coherence map of the served product: 4.3% drop + 21.8% fade over
  the Baja z5 viewport, 0%/8% at FL — the treatment is local to genuine conflicts.

### 1c. `bd61afda` — dup-skip stranding (state-authoritative dedup + guard fail-open + stash)
- **BEFORE**: commitMarineData deduped against a side ledger that records commits the ENGINE may
  reject downstream (the no-downgrade guard racing a render-loop-written `_lastZoom`, which treated
  UNKNOWN zoom as zoomed-in). Ledger≠state wedged the display permanently: live 3Hz commit loop ran
  40 min in the user session; a 3° regional rectangle stranded across the whole band until an hour
  scrub. Rejected grids were silently dropped.
- **AFTER**: dedup requires the incoming signature to match PREV STATE's own signature; unknown zoom
  fails OPEN (a wrong accept costs one particle reset and self-heals; a wrong reject was permanent);
  rejected grids are stashed and re-evaluated every render frame with current zoom/viewport
  (`__MARINE_NO_DOWNGRADE__.selfHealed`). Live: the z9→z5 wedge recipe recovers in seconds, no scrub.

### 1d. `7b159ab0` — sidebar-collapse dead strip + map resize
- **BEFORE**: the map page container was `md:left-[200px]` at EVERY width ≥768px, matching only the
  xl sidebar. Tablets/15" laptops (64px rail) had a 136px dead black strip the map never reclaimed.
- **AFTER**: offsets track the rail per breakpoint (`md:left-16 xl:left-[200px]`), and a
  ResizeObserver on the container calls `map.resize()` (rAF-coalesced) for container box changes
  that arrive without a window resize. Verified at 828px (canvas flush at x=64) and 1280px (x=200).
  Hover-expand remains an overlay by design (user confirmed).

### 1e. `caee7f9a` — deep-audit fixes (3)
- **geoCache validity key**: surf-banded vs plain products of identical shape shared one cached
  mask/bath/chl entry (first encoder won). Now keyed +oceanCount and FIFO-capped at 12 (was unbounded).
- **/point unavailable → NULL**: the Gulf of Mexico has no regional tile and every surrounding 10°
  coarse center is LAND → `/point` returned `unavailable` ZEROS → infobox showed a confident
  "0.0 ft / N 0" (Texas live report). Now conformed to null → infobox shows "--" (live-verified).
- **Dedup escape hatch restored**: the audit caught that 1c's prev-sig dedup broke the deliberate
  `lastCommittedSigRef = null` recovery paths (engine-empty §2b, toggle re-feed, model switch — 7
  call sites force identical-content re-commits to re-fire the upload effect). Skip now requires
  BOTH authorities to agree (content==prev AND ledger not invalidated). New tests cover both the
  wedge case and the hatch.

### 1f. `899373d5` — ★ THE ROOT: per-polygon mask culling (all-black regional ocean mask)
- **BEFORE**: `renderMaskToCanvas` culled land by FEATURE bbox. The 10m land GeoJSON (loaded
  2026-07-02 — the bug's birthday) has ~10 CONTINENT-scale MultiPolygons whose bboxes overlap ANY
  regional target; their far-side member polygons (Eurasia for a Florida tile) project through
  `wrapLngRelative` with ±360° x-jumps near the anti-center meridian and the filled path sweeps the
  ENTIRE canvas → regional mercator ocean masks came out ALL BLACK → `oceanFlag=0` → advect dropped
  every particle, draw discarded every crest, the regional heatmap masked itself out (only the
  coarse wash showed). Dead at close zoom until any bounds-CHANGING commit rebuilt the mask — the
  true root of the whole "particles cleared / came back briefly / cleared again" family.
- **EVIDENCE**: wave texture at the viewport center healthy ([24,51,26,95] = 1.02m/7.5s); the mask
  texture FBO-read = 0 at known-ocean texels; isolated renderer replica: FL tile drew 9/10 features
  → 0.0% ocean vs global control 63.8% (replica faithful). U2 stratified-reseed dead-strata theory
  DISPROVEN live (`__RAW_STRATIFIED_RESEED__=0` did not revive).
- **AFTER**: each member POLYGON is culled by its own cached bbox against the padded target
  (`getPolygonBbox`/`polygonOverlapsTarget`, unit-tested with the exact Eurasia-vs-Florida
  geometry). Live: the reliably-dead recipe (clean boot → Waves → z9 offshore Cocoa, 13×13
  resident) renders dense land-clipped crests. 495/495 tests green.

---

## 2. ⚠️ NEW, OPEN: satellite layer black land patches (repro'd, not yet rooted)
- User report ~05:05 UTC; repro'd live: Satellite (cloud-cover) layer, ~z5.66 (also z7.85),
  Sahara/Mali (~18.09, 2.14): a bounded GREY RECTANGLE containing jagged BLACK silhouette blobs over
  land. Screenshot in the session transcript.
- Facts established: renders via the **FCE/GPU-dispatcher RASTER path** (HUD Render Mode: Raster;
  globals `__FCE_FIELD__`, `__FCE_RENDER_PLAN__`, `__GPU_DISPATCHER__`, `__RASTER_DEBUG__`,
  `__RASTER_PROBE__`). The MARINE engine was INACTIVE at repro → NOT the marine canvas or the §1f
  mask. `window.activeMarineLayer` stays stale-'waves' while satellite is active (check if cosmetic).
- Next forensics: probe `__RASTER_DEBUG__`/`__RASTER_PROBE__`/`__FCE_DIAGNOSTICS__` at the repro;
  read raw field values under a black blob (FBO-probe the FCE field texture — toolkit §6); study
  the raster/FCE lineage (`git log -- frontend/src/engine`, LayerRegistry's satellite entry — the
  code name is likely cloud/cloudcover, which is why a naive "satellite" commit search finds nothing).
  Candidates: NaN/negative values in one fetched tile; a land-mask channel misapplied in the raster
  shader; a palette bug at a specific value.

## 3. FIRST JOB NEXT SESSION — verify the gate rebuild (task #1)
1. Run 28637733899 completes (started 04:07 UTC; core ~57min + calibration + 2 worldwide regions).
   Render re-pulls L2 ≤30 min after upload. Producing-run sha ALREADY verified (`7b159ab0` ⊇ revert;
   all commits after the revert are frontend/docs — the product is pure R_d-gate).
2. Re-run the global scan — scratchpad `global_dir_scan.js` (recipe in memory: bulk open-meteo 90
   coords/req 0.8s spacing; ⚠️ backend vectors carry `speed` = height, NO `height` field pre-mapper).
3. **Same-script pass bar: 18.8°/21/12 (measured fusion baseline) → expect ≈13°/~11/~4.**
4. User re-checks: Baja directions (east of −115 ≈ NNE; (20,−120) stays GFS-honest WSW pending the
   confidence work), the 25°N/−115° 4-cell-corner seam (should relax — the fusion 177° seam becomes
   ~77°, above the 0.7 fade threshold), and close-zoom crests wherever they roam (§1f).

## 4. Queued BEHIND the verification (backend freeze lifts after §3)
1. **Gulf/Texas `/point` coverage**: point resolver should build/prefer the 0.25° viewport product
   (Baja demonstrably gets `viewport_gfs_marine_waves_*.json` with cm-level parity vs pinned GFS);
   also fix the `coverage_status: inside_regional_tile` mislabel while serving global coarse.
2. **§0B-a confidence export**: per-cell direction confidence in the coarse product → crest
   confidence fade for the ~10 GFS-divergence blocks (design in night-1 handoff).

## 5. Other open items (frontend, safe any time)
- **Surf/plain frame mixing**: localStorage `__SURF_MODE__`='true' surf-bands every boot until the
  window flag is written; retained frames never revalidate against the mode (night-1's z7.12
  "heatmap cleared"). Design: mode into frame identity end-to-end + revalidate retained on toggle.
- **Inflight registry**: foreground entry stays `active` after `detached_cache_completed` →
  `fetchPending` wedged true.
- **Re-drive cadence**: the hour-mismatch re-commit driver (formerly 3Hz) was never identified;
  the dedup makes it settle after one commit, but find the driver.
- **Orchestrator ledger-only dedups** at `useMarineOrchestrator.js` ~394/~509/~562 — same divergence
  class as the fixed one (they commit without prev access).
- LCP bundle attribution, NW-Pacific (30,150) confidence cells, codebase-memory BM25 — parked (night-1 §4).

## 6. New kill switches / telemetry / toolkit (tonight)
- Dilation: kill `__RAW_DISABLE_DIR_DILATION__`; echo `__MARINE_DIR_DILATION__{filled,cols,rows,isGlobal}`.
- Seam dim: `__RAW_DIR_COHERENCE_MIN__` (0=off), `__RAW_SEAM_FADE_FLOOR_ALPHA__` (0.3 default,
  echo `__RAW_GPU__.anim.seamFadeFloor`); drift damping rides the same gate.
- No-downgrade: kill `__RAW_DISABLE_NO_DOWNGRADE__`; `__MARINE_NO_DOWNGRADE__.selfHealed`.
- Dedup: `__committedSig` stamped on committed frames; ledger now telemetry + invalidation-hatch only.
- **Forensic toolkit (reusable, proven tonight)**: wrap `engine.setWaveData` to capture gl → commit
  SYNTHETIC grids (`__ORIG_SET_WAVE_DATA__(gl, grid, null)`) for deterministic A/B independent of
  SWR; FBO-attach + readPixels GPU textures (⚠️ regional masks 2048×1024, global 1024×512;
  out-of-bounds reads return silent zeros); replicate canvas renderers in-page against the live
  geojson WITH a global-bounds control; CPU coherence map (`baja_coherence_map.js` recipe in memory).

## 7. Landmine additions (beyond night-1 §5)
- ⚠️ Backend marine vectors: `speed` IS wave height; `height` exists only post-mapper. Burned twice.
- ⚠️ Preview-tab code bisection is UNSOUND (SWR serves different tiles per boot) — use synthetic
  grids or a fresh profile per version. Clean-load doctrine held again tonight.
- `map.jumpTo()` STICKS now (old "reverts" note obsolete). Scrubber: `input[aria-label="Timeline
  scrubber"]` + native value setter + input/change events.
- `data_committed` logs BEFORE the dedup decision — paired with `duplicate_commit_skipped` it means
  nothing was committed.
- HMR edits reboot the user's open tab mid-interaction — coordinate before editing while they test.
