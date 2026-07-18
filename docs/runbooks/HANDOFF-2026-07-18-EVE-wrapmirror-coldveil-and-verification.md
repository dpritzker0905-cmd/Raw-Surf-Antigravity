# HANDOFF 2026-07-18 EVE — wrap mirror + cold veil, the trim-classifier cascade, and the verification sweep

## ⚡ PART 2 ADDENDUM (same session, user round 2) — five more ships, HEAD `34993e0c`
1. **`8adf332f` MANIFEST-TILE CLIP + TIGHT RE-DRIVE — the rating-toggle DIRECTION-SHIFT root.**
   Live-pinned (probe_rating_direction, Jupiter z9.31): unrated lane rode a 5×4 `global_mid`
   (2°/cell) while the rated lane got the 0.25° FL tile → 44-49° direction + 2-4× speed jumps on
   toggle. Chain: legacy close-zoom bbox (gesture pad + 1° snap, modeling the 07-04 backend) turns
   a 1.4° viewport near a tile edge into -82..-78 → crosses `florida_east_coast`'s -79 edge →
   resolver demotes to mid; clamp re-drives inherited the same bbox ("no progress after 3
   re-drives" = the user's console). Ladder probes: crossing 3° → mid; in-tile 1.4-2° → 0.25°.
   FIX: at spans ≤2.5°, when a REGIONAL manifest tile fully contains the raw viewport, request the
   padded bbox CLIPPED to that tile (0.25°-quantized). Kill `__RAW_DISABLE_MANIFEST_TILE_CLIP__` ·
   re-drive kill `__RAW_DISABLE_TIGHT_RESHARPEN__`. VERIFIED: unrated resident = fine 13×9 from
   the direct fetch; off→on deltas 0.0°. NOTE #17 intersect-prefer history: this is CLIENT-side
   request shaping (server behavior untouched) — not the reverted server intersect-serve.
2. **`28d0c8a1` CLOSE-ZOOM GESTURE PAD 0.3→0.75 — the band pan-ahead blank.** probe_band_pan
   step-4 captured a TOTAL blank (pan crossed the resident north edge pre-refetch). ¾-viewport
   headroom per side ≈ trivial payload at 0.25°; re-probed 6-step 2° coastal pan = no blank step.
3. **`e65d87df` NEARSHORE GATE for Surf (est.)** — backend `surf_nearshore` = is_coastal(radius 1
   ≈ ±0.25°) on every marine point; compiler strictly hides on false, fail-open on absent (deploy
   skew). Anchors: Cocoa/Pipeline/New Smyrna true; 0.5° offshore false. Glyph popup already
   carries per-spot surf height + period + tide (4dfce257) — the user's "glyph popup" half was
   already live.
4. **`34993e0c` SURF v3.2 SLOPE-AWARE BREAKER INDEX** — Weggel b(m) center with shelf-slope proxy
   depth/width; flat shelves byte-identical (FL anchors untouched), steep shelves cap toward
   plunging-reef γ (ceiling 1.25). Kill `SURF_V3_SLOPE_GAMMA=0`. Literature (Consensus search):
   Harris 2018 (reef γ>0.85, no universal γ) · Lin 2017 · Chen 2022 · Zhang 2021 · Weggel 1972 ·
   Kaminsky 1994. RESEARCH-BACKED QUEUE: tide-phase-modulated inlet magnets (ebb +≤20% at the
   mouth — Dodet 2013; ebb-delta refraction focusing — Ridderinkhof 2016; already have tide state
   in the ratings payload) · per-spot `break_type` data · report_calibration sweep vs anchors.
5. **Dead-line + FL-edge verdicts**: pilots bake RESTORED live ~14:40Z — ALL FL lanes east col
   -79 now 29/29 (was 0/29); full row/col scan of every FL product = ZERO dead lines. The user's
   Jupiter–Stuart east-west dead-animation line = the pre-heal data class; a hard refresh clears
   client caches. If a line recurs on FRESH data: suspect client-side stitch seams of dynamic
   products (queued watch item).
6. **§5b toggle wedge reproduced IN-HARNESS** (probe_rating_direction runs 4+5: rating click →
   `ratingMode` never true for 60 s; run 2 activated fine) — the queue-#2 pinning instrument now
   has a repro vehicle.
Probes live in the session scratchpad; rebuildable from this doc + the EVE session memory.

## ⚡ PART 3 (user round 3) — band battery, the z6.5 flap, science verification, STRUCTURAL REVIEW
1. **Multi-zoom band pan battery** (probe_band_multizoom, z6.5-11.5, N+W pans, rating on): N-pan
   leading edge painted at z8.5-11.5 post pad-raise ✓ (W-pan zeros = Florida landmass, geography
   not bug). FOUND at z6.5: the band FLAPS (paints ↔ vanishes ~2 s cycle).
2. **z6.5 FLAP root** (probe_flavor_loss, full provenance): TWO lanes fight — scrub-settle's
   "rendered hour=undefined" verification loop re-commits a BOOT-ERA cached UNRATED
   `global_coarse` (recycled TraceID `c052e65d`, `per_model_hour_cache_exact`) every ~2 s, while
   the sharpen lane restores the RATED clipped mid. Shipped half: **mid-ceiling snap guard**
   (spans 4-14° never pad past the 15° mid band; kill `__RAW_DISABLE_MID_CEILING_SNAP__`) — the
   direct lane now serves the RATED mid once caches roll. BANKED half (NEXT ARC, minefield ×3:
   scrub-settle × controller cache × display gate): kill the hour=undefined loop driver (stamp
   `hourOffset` on every commit, or guard the verification branch) + flavor-check the zoomed-out
   recovery reassert. probe_flavor_loss = the repro; §5b toggle wedge likely = the same starved
   rated lane.
3. **SCIENCE VERIFIED LIVE (prod, post-deploy)**: glyph↔point surf values agree within 2-14%
   (bake-vs-live frames) at 5 Cocoa-area spots · **New Smyrna Inlet 0.89 m vs Flagler control
   0.64 m = 1.39× (the designed 1.40× magnet, = the user's own anchor)** · Pipeline/Sunset
   shore-normals 325°/335° live · `surf_nearshore` live (all real breaks true) · animation
   direction ≡ data direction (engine-vector A/B) · infobox ≡ point (2.0 ft == 0.60 m).

### ⚡ PART 4 — STABILIZATION ARC SHIPPED (structural items #2/#3/#4 done)
- **`53b1ec66` COMMIT-STAMP INVARIANT** (structural #3): commitMarineData stamps hourOffset +
  `__commitLane` on every direct-lane commit. THE z6.5 FLAP IS DEAD — probe_flavor_loss run 3:
  settles RATED mid, HOLDS through pans, zero hour=undefined loop lines; only residual = the
  DESIGNED §2b engine-empty fallback during a 6-viewport pan into a data gap, self-heals to
  rated mid in ≤12 s. Wire capture: direct fetches now surf=1 at sub-ceiling bboxes.
- **`(this commit)` MARINE NIGHTLY NET** (structural #2+#4): `frontend/scripts/ladder-contract.js`
  (T1 fine / T2 mid-never-coarse / E1 ±180 seam / E2 FL edge; first live run 12/12 PASS ×3 models)
  + `.github/workflows/marine-nightly.yml` (data-contract job + zoomlab staircase battery with a
  budgeted verdict: >3 findings or any SETTLED_STEP fails; artifacts 14 d). zoomlab's playwright
  require made portable for CI.
- STILL OPEN from the review: #1 commit ARBITER (the big refactor — design it as its own arc
  with the lane inventory from this session's probes) · #5 wrapped-copy particles (chip) ·
  #6 nearshore 1 km bathymetry + break_type · #7 report-calibration loop.

### STRUCTURAL REVIEW — what the marine sim is missing (ranked, evidence-backed)
1. **A single COMMIT ARBITER for the marine resident.** ~6 lanes (direct fetch, series sharpen,
   §2b recovery, blank backstop, clamp re-drive, SWR) each call setMarineData, arbitrated by
   accumulated guard flags (no-downgrade, rating-grace, flavor-mismatch, hour-verification…).
   Today's z6.5 flap IS two lanes disagreeing forever; the 07-09 lesson "THREE scrub pipelines,
   fixes don't transfer" is the same disease. Replace with one arbiter: every commit carries
   {lane, productId, tier, flavor, hourOffset}, one priority function decides, decisions logged
   to a ring buffer. Converts every ping-pong class into a single debuggable decision point.
2. **Client↔resolver CONTRACT TESTS.** Both snap-overshoot bugs (fine-tile crossing `8adf332f`,
   mid-ceiling `this commit`) were the client's STALE MODEL of the backend ladder (07-04-era
   assumptions). Add a fixture-backed contract suite: for request spans/positions × tiers,
   assert the served tier AND assert every client snap/pad output stays inside its tier
   boundary. Runs in CI; silent tier demotion becomes impossible.
3. **Commit-stamp INVARIANTS at the choke point.** Every committed grid MUST carry
   hourOffset + ratingMode + productId + lane; enforce in a setMarineData wrapper (dev-mode
   assert + prod telemetry). The "rendered hour=undefined" loop class dies permanently.
4. **zoomlab verdict battery IN CI** (nightly + PR-gated with a findings budget): the engine +
   verdict already exist; today it only runs when a session remembers to run it.
5. **Wrapped-copy particle domain** (chip spawned earlier — heatmap wraps, particles don't).
6. **Nearshore PRECISION data**: 0.25° ETOPO is shelf-scale. Bake ~1 km nearshore bathymetry
   (GEBCO subset) for tiles containing spots + a per-spot break_type/beach-slope table —
   unlocks the already-written Iribarren `breaker_type()` (needs real slope,
   `build_bathymetry_asset.py --slope` is referenced in-code) and quantitative reef vs beach vs
   inlet physics beyond the magnet seeds.
7. **Report-calibration LOOP**: automate a periodic compare of baked ratings/surf vs user
   condition reports + buoys per region to tune SURF_V3_JACK_MAX / SHELF_CF / magnets from
   data instead of sessions.

## ⚡ PART 2 CLOSE-OUT — bakes verified, stripe re-battery verdict
- **+180 HEALED AT SOURCE** (~16:1xZ, core `29646402826`): 18:00Z globals — east col 180 = exact
  WEST mirror on GFS/ICON/EURO waves (16/16/13 of 17), GFS wind 17/17, ICON swell_1 16/17 (all
  were 0/17). Both ends closed (client mirror + baked normalizer).
- **FL edges healed live** (~14:40Z): all lanes -79 col 29/29; zero dead rows/cols in any FL product.
- **CI + Lighthouse green** through `202b3486`.
- **Stripe re-battery (queue #3) post-bake: 4 findings → 3** — the east-side persistent band
  (cols 32-35) VANISHED with the bake ✓. The surviving cluster (cols 4-13, xFrac 0.10-0.35,
  z2 tail) maps to lng ~136E→-134W = the WRAPPED WORLD COPY left of -180 at the FL-centered z2
  view, and appears IDENTICALLY in pre-fix + baseline traces → NEW SHARPENED HYPOTHESIS:
  **crest particles do not animate in wrapped world copies at far zoom** (heatmap wraps via
  maplibre; the particle tile/advection domain doesn't — check the wrap-cull `f8d4f3fa`
  lineage + the §7i tile clamp before touching). This is the remaining "dead zones" residual;
  traces: zl-staircase-{postfix,baseline,postbake} in the 07-18 EVE session scratchpad
  (verdict JSONs quoted in the session memory).

**START HERE for a fresh context.** Supersedes `HANDOFF-2026-07-18-DEEP-AUDIT-fencepost-head3-and-state-of-the-sim.md`
(read that second — it carries the three-head fencepost story + audit table). FINAL HEAD `fa46502f` on `dev`
(the doc is LAYERED: §0-7 = part 1 at `2c3d9dd7`; the ⚡ PART 2/3/4 sections at top were appended as the
session continued — read the ⚡ parts FIRST for the latest state). Every claim is probe-proven.
END-OF-SESSION RE-VERIFICATION (fresh runs at close): frontend 1154/1154 · backend surf/weather 40/40 ·
ladder-contract PASS vs prod · ±180 seam mirror live on 18:00Z products · cold veil 9/9 world frames at
hm=0 (max in-window color jump 2.4, was 84) · rating off→on direction deltas 0.0° on the fine FL tile.
KNOWN MINOR: the toggle-OFF path can briefly ride a 5×4 mid before re-sharpening (self-heals; the
user-reported off→ON jump is the fixed one).

## 0. TL;DR
The user reported three sim defects: (a) first marine toggle after hard refresh flashes a wrong-colored
heatmap ~1 s before the proper one, (b) the infobox "estimated surf" is gone, (c) blocky heatmap over land
at far zoom + a vertical clearing line over the mid-Pacific. Forensics found ONE keystone under (a)+(c):
the 07-17 client dead-edge trim (`167f3787`) x the unbaked +180 dead column (fencepost head #3) shrank
EVERY world grid to ~350° and silently reclassified it "regional" across all `span≥359` predicates.
Shipped `2c3d9dd7`: antimeridian WRAP MIRROR at the trim (client twin of normalizer `f60e765d`) + a
COLD-ACTIVATION COARSE VEIL for the flash. (b) was NOT reproducible at HEAD — the row renders on all
three models + scrubbed; it hides by design for open-ocean points/non-waves layers.

## 1. SHIPPED — `2c3d9dd7` (frontend-only, engine)
1. **WRAP MIRROR** (`trimDeadEdges`, WebGLMarineEngine.js): full-wrap grids with a dead ±180 edge column
   get the live seam column MIRRORED across the antimeridian (distinct objects, lng rewritten; bounds/dims
   unchanged) instead of trimmed. Regional trim (the FL stripe defense) untouched.
   - HEALS the mid-Pacific vertical clearing CLIENT-SIDE ahead of the bake: live A/B probe, date-line px
     [93,117,126] dead gray (mirror off, ICON/EURO) → full heatmap colors (mirror on, all 3 models).
   - RESTORES every `span≥359` classifier while world products still carry the dead column:
     `isCoarseGlobalGrid` (cold veil, z≥7 crest suppression, no-truth wash guard), `isRegionalTile`,
     `WebGLMarineMaskRenderer` isGlobalTarget, `WebGLMarineTextureEncoder` isGlobal (extrapolation wrap,
     dir dilation, getMarineGeoData mask channel), `marineSharpenTrace` classes, `useMarineDataFetcher`.
   - Kill: `__RAW_DISABLE_WRAP_MIRROR__` (restores legacy trim for world grids — the A/B lever).
2. **COLD VEIL** (`resolveColdVeil` + setWaveData stamp + render apply): on a COLD commit (nothing
   resident — fresh activation or post-model-switch clear) whose resident is coarse-global at a coastal
   viewport (<15° span, non-rating), the heatmap draws at 0 opacity until the regional sharpen lands
   (measured window ~3.2 s), then a 350 ms smoothstep reveal. GRACE 4 s reveals the coarse regardless
   (mid-ocean/no-finer-supply viewports — the 06-29/07-04 "blank heatmap" lessons are honored; never an
   unbounded fade-to-zero). Wide-zoom + rating cold paints take the never-engaged fast path (<50 ms) and
   stay pixel-identical. Crests were ALREADY suppressed in this window (07-14 tightening) — the veil is
   the heatmap's matching guard. `_lastHeatmapOpacity` stores PRE-veil so the sharpen-ease chain is
   untouched. Kill: `__RAW_DISABLE_COLD_COARSE_VEIL__` · grace: `__RAW_COLD_VEIL_GRACE_MS__` ·
   telemetry: `__RAW_GPU__.coldVeil`.
3. **HARNESS** `frontend/scripts/firstpaint-lab.js`: per-frame PNG strip + color trace + in-page
   commit-log correlation of the FIRST marine activation (the thing zoomlab's trace installs too late
   for). `FP_BASE`/`FP_FLAGS`/`FP_THEME` env, verdict = color-jump list vs commit ladder.

## 2. EVIDENCE CHAIN (what proved what)
- **Flash fingerprint** (firstpaint-lab, dev cold): activation → global coarse commits at z9
  (`spanLng 350→360`, speeds to 8.3 m, mean 6.0 ft) painted hm 0.53 → regional 7×7 (max 0.7 m, 1.6 ft)
  ~3 s later. ΔRGB 66-84 at the coarse paint. With veil: hm 0 through the window, first visible paint =
  regional; kill-switch A/B restores the flash (ΔRGB 63).
- **Trim cascade discovery**: veil no-op'd because `isCoarseGlobalGrid` returned false on the
  TRIMMED 36-col/350° world grid (`cv:"null"` at the first world frame). `grep 359` mapped the blast
  radius (6 sites). The mirror is the one-choke-point restoration.
- **Battery**: `staircase_full` verdict — both features OFF = **20 findings** (7 dead bands + 13
  settled-step flips); both ON = **4 findings**, all in the known bake-pending supply-stripe class
  (cols 6-12 + antimeridian neighborhood; queue #3 of the DEEP-AUDIT handoff). Baseline ran warm
  (cache advantage) and still scored 5× worse. Unit: 1145/1145.
- **Far-zoom land ("blocky over land")**: NOT reproducible in dev — 0/20 then 0/15 deep-inland points
  show ANY waves-on/off pixel delta at z2 (GFS; ICON/EURO spot-checked clean), cold AND after the
  user's close-zoom→staircase-out trajectory, mirror on AND off. Shader mask debug (`__GPU_DEBUG__
  .mode='mask'`) samples correct at Arctic land points. Remaining suspects for the user's sighting:
  production-only state (stale SW bundle; unbaked products), DPR/real-GPU (dev ran swiftshader DPR 1),
  or Arctic sea-ice/archipelago wash reading as "land". FALSIFICATION NEXT: after deploy + bake, have
  the user re-look; if it persists, get a screenshot + `window.__RAW_GPU__.maskId/overlayMask` +
  `__MARINE_RENDER_SOURCE_DIAG__` from their console.
- **Infobox "estimated surf"**: NOT missing at HEAD. probe_infobox_surf (long-press marker via
  `window.setLongPressLocation`) renders "Surf 2.0/2.2/3.1 ft (est.)" on GFS/ICON/EURO + ICON+3h scrub.
  Backend /point live-probed: `surf_height_m`/`surf_regime`/`shore_normal_deg` present on BOTH the
  generic and grid-pinned paths. Row hides BY DESIGN: `open_ocean`/`calm`/`unknown` regimes (deep water:
  surf == offshore Height) and non-waves layers; transiently absent during no-coverage windows. The
  user was inspecting the mid-Pacific at far zoom (open-ocean) + component layers when they noticed.
  Science chain reviewed: linear dispersion (Newton), Ks shoaling, period-keyed breaker index
  (Galvin/Battjes/Goda), Iribarren typing, v3 exposure/magnets/shore-normal overrides — sound; the
  07-17 audit's live anchors stand. Known open item: global +15-25% hot bias (user-call trim lever
  `SURF_V3_JACK_MAX`, queue).

## 3. PIPELINE STATE + WATCHERS
1. **Core ingest `29646402826`** (manual dispatch ~13:34Z, runs `0b8072f2` = carries normalizer
   `f60e765d`): monitor armed. On completion + ~30 min L2 restore tick: re-probe globals (no bbox) —
   east col +180 must go 17/17≈west (probe_edge_cols.js pattern, scratchpad; also re-check FL bboxes).
   Client mirror makes the UI correct EITHER WAY; the bake fixes the data at source.
2. **Pilots `29644720299` completed success ~14:1xZ** (carries `951bba42`): FL wind/ICON/EURO east col
   `-79.0` still probed 0/29 at 14:1xZ = serve-box L2 restore lag (the overnight watcher saw the same
   pattern before heal). Re-probe `bbox=-85,24,-79,31` after the tick; north row 31 = inland-Georgia
   partial validity is GEOGRAPHY, not fencepost.
3. **Zoom-out stripe re-battery** after both bakes land: the 4 remaining verdict findings should
   shrink/vanish (queue #3 carried).
4. Push of `2c3d9dd7` + this doc = the batched dev push (Render restarts on push — batch rule).

## 4. QUEUE (carried, updated)
1. z8 halo (unchanged, minefield notes in DEEP-AUDIT + memory). 2. §5b toggle wedge. 3. stripe
re-battery post-bake (watcher above). 4. light-mode crest palette (USER CALL). 5. v3 hot-bias trim
(USER CALL). 6. mini-hoist to prewarm — NOTE: if a prewarm ever commits pre-toggle, the cold-veil's
`!oldWaveData` stamp condition must be revisited (a warm resident at toggle bypasses the veil BY
DESIGN today). 7. Peniche offshore sampling. 8. a11y debt. 9. security debt (LOCKED). 10. REST caps.
11. NEW: consider surfacing the Surf (est.) row during transient no-coverage windows via the
provisional-marker machinery (sticky last-known + `…` dim) — UX polish, low priority.

## 5. TOOLING NOTES
- `firstpaint-lab.js` = first-activation forensics (see §1.3). The Browser-pane screenshot cadence
  (~1 s) cannot catch this class; the lab captures EVERY frame.
- PowerShell trap: `<cmd> | Select-Object -First N` TERMINATES the pipeline — it killed a lab run
  mid-dump. Redirect to a file, then read.
- zoomlab-verdict takes the trace FILE (`trace_staircase_full.json`), not the outdir.
- The in-app debug lever `window.__GPU_DEBUG__.mode='mask'|'uv'|'grid'|'mercator'` renders mask/uv
  diagnostics through the heatmap program — fastest way to see what the shader's mask sampling sees.
- `window.setLongPressLocation({lat,lng})` places the infobox pin programmatically (probe hook).
