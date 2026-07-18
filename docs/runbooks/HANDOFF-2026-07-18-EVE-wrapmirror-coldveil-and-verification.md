# HANDOFF 2026-07-18 EVE — wrap mirror + cold veil, the trim-classifier cascade, and the verification sweep

**START HERE for a fresh context.** Supersedes `HANDOFF-2026-07-18-DEEP-AUDIT-fencepost-head3-and-state-of-the-sim.md`
(read that second — it carries the three-head fencepost story + audit table). HEAD `2c3d9dd7` on `dev`.
Every claim below is probe-proven (probe scripts named inline; scratchpad probes are re-buildable from this doc).

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
