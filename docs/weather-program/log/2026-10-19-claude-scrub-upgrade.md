# Scrub upgrade: every marine layer x model, measured the same way (2026-10-19)

Session opened 2026-10-19T04:13Z (00:13 EDT). The owner, after testing PR387's base in the browser with two pasted consoles:
"we need to handle the wind fetch pile-up on keys and autoplay (T-04), the badge lag (T-05), and the honest time label (W-1)
... I am not really seeing much improvement from loading different weather layers, and then switching between them, and
scrubbing ... It needs to work very precisely and not lag", then "One marine layer did scrub quickly, but after switching
to the next marine layer, it stopped", then "Duplicate your logic and test every single marine layer and its associated
logic against this methodology using jacobian lens", and on the pipelines: "we blended a lot of the logic for the pipelines
to improve the user experience and quality and resolution" / "both EURO and ICON have ways of making them reach the full 14
days". Branch `claude/scrub-upgrade`, stacked on PR387 (`claude/w2-seek-identity`, head 68576a431). Client and harness only.
**No served number changes** (no SCOREBOARD row): the ICON swell 2 series path calls the SAME blend function as the
per-hour path; everything else is a race, a label or animation motion. Everything ships ON with its own kill switch.

## Forensics from the owner's consoles (2026-10-19 ~04:00Z, ICON, light theme)

- ICON Swell 2 scrub "stopped": every step logs `[Backend] ICON swell_2 blend` = two /grid fetches + a main-thread blend per
  hour; the layer never touches the series cache that makes ICON Waves instant (`Instant re-index`). ICON has no swell_2
  product (intended blend, D-003), and the blend lived only on the per-hour path.
- Wind: `Fetching wind (attempt N/5)` retries and per-hour scrub fetches with no cancel; `signal is aborted ... conformed safe
  zero grid` = an abort handed the shared in-flight request's joined callers a safe-zero (held, not drawn:
  `isRenderableWindData`). `maxWindSpeed updated: 30.8 -> 62.4 -> 39.6 -> 42.4` on consecutive frames (see the Jacobian
  finding below).
- `High-resolution land mask texture created (4096x2048)` about 8 times in a short session (regional viewport bounds).
- `[FORENSIC-SNAP]` printed 15+ times identical (a 15 s heartbeat); the console is recorded by PostHog rrweb.

## The method, applied to every marine layer x model (`scn_layer_matrix.js`, new)

The harness backend now serves the production tier availability for all four marine layers and three models
(`serve_synthetic.py --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves`, read from the live manifest
2026-10-19): GFS every layer at global_mid + global_coarse; ICON no swell_2 (the client blend); EURO waves = ECMWF WAM at both
tiers with the 6-hourly band past 144 h; EURO swell_1/swell_2/wind_waves = Copernicus at global_coarse only. Each layer gets
a distinct synthetic partition so a wrong-layer frame is visible. Per model x layer: the switch (time to the new identity on
screen, silent wrong-layer / wrong-model frames), then 1-h steps, day steps, a burst, Home, each measured as time to the
correct resident grid (hour + layer + model + a new texture upload) and the time Jacobian dDisplayedHour/dRequestedHour at
300 ms and at settle (ideal 1), with every mismatched frame counted SILENT or ADMITTED by the on-screen status line.

**Confound found and controlled:** the app's hour 0 is now rounded to the hour, so which targets are on the stored 3-h lattice
changes every UTC hour; a first before/after an hour apart compared different lattices (GFS p50 "2091 -> 51 ms" was the
clock, not the code). The A/B below runs both bundles back to back in the same anchor hour and splits steps by lattice
membership (evidence/scrub-upgrade-layer-matrix-2026-10-19.json; rows carry `lattice`).

## Results (A/B: PR387 head vs this branch; offline, zero latency, desktop headless Chrome D3D11)

| Measure | Before | After |
|---|---|---|
| Silent wrong-hour frames, all 12 combinations | 5,683 | 114 (98% fewer; the rest is the ~1-2 frame React render gap) |
| Silent wrong-layer frames per layer switch | 37-106 | 0-13 |
| Silent wrong-model frames per model switch | 52-81 | 2-3 |
| On-lattice step, first correct field (p50 per combination) | 34-65 ms | 35-58 ms (unchanged) |
| ICON swell 2, on-lattice | 682 ms p50, 0% from series | 567 ms, 50% instant from the series blend |
| EURO coarse swell layers, off-lattice | nearest frame held SILENTLY (986 frames / 2 steps) | same frame, labelled (3) |
| Max long task / max frame gap | 85 / 84 ms | 85 / 83 ms |

Off-lattice "exact" frames still take 2.3-3.4 s (no change claimed): all stored marine data is 3-hourly, the exact /grid for
an off-lattice hour serves the same nearest product relabelled (PR387's F-02 finding), so the honest fix is the label, not a
faster refetch. ICON swell 2's remaining 50% are hours outside the EURO swell_2 page the series holds (EURO series pages
are kept to the current page, see `prewarmMarineSeries`); they take the per-hour blend as before.

## What changed

| Id | Fix | Kill switch |
|---|---|---|
| Swell 2 stall | `iconSwell2Blend.js`: the blend math moved verbatim (pinned by the three existing suites that cover it) and shared; `getMarineSeriesFrame('ICON','swell_2')` blends the cached GFS + EURO swell_2 series frames at the same hour AND valid time (memoized), `ensureMarineSeries` loads GFS (full) + EURO (current page), else the per-hour blend runs exactly as before | `__RAW_DISABLE_ICON_SWELL2_SERIES_BLEND__` |
| T-04 | `latestOnlyGate.js`: the wind scrub fetch runs one at a time, newest waiting, intermediates dropped (no abort: the shared in-flight request would hand joined callers a safe-zero) | `__RAW_DISABLE_WIND_SCRUB_GATE__` |
| W-1 | `marineDrawnFrame.js` (the engine publishes what it drew at each upload) + `drawnFrameReadout.js` (words, compared by INSTANT when known, the #267 rule): the status line under the timeline says "Loading ICON Swell 2… still showing GFS Waves", "Showing Tue 6 AM: the nearest stored forecast", "Estimated forecast: blended from GFS and EURO" the frame it happens, aria-live, three themes | `__RAW_DISABLE_DRAWN_FRAME_READOUT__` |
| T-05 | the point card's stale-hour badge is decided from the same drawn record (shows when genuinely pending, clears otherwise) instead of a status object published a render later | `__RAW_DISABLE_DRAWN_STALE_BADGE__` |
| Jacobian (wind) | the advection gamma normalized speed by hypot of the frame's SIGNED u/v maxima (one-direction wind: ~1.5, gamma off; mixed: ~35, on), so a particle's screen speed changed with wind elsewhere and every hour step; now a fixed 50 kn (`windSpeedRef.js`), motion per knot is local-only; the shader still clamps at the reference; colours unaffected (absolute ramp) | `__RAW_DISABLE_WIND_FIXED_SPEED_REF__` |
| Console | `[FORENSIC-SNAP]` prints on change only (ring still records every 15 s sample) | `__RAW_FORENSIC_SNAP_EVERY__ = true` prints every time |

## Measured and not changed

- Land mask: offline, every layer/model switch REUSED the 4096 x 2048 mask (world frames are covered by the cached mask);
  zoom and pan uploaded nothing. The owner's ~8 rebuilds come from regional viewport frames, which the world-only synthetic
  store cannot produce. A regional-bounds mask cache needs regional fixtures first; not changed blind (its history is
  island halos, bay flicker and close-zoom land, all guarded).
- Off-lattice exact refetch timing (above); EURO swell series pages beyond the current one (backend cost).

## Independent review (Reflection AI Beam, one consultation, redacted packet)

Accepted: require equal valid_time as well as hour when pairing GFS and EURO series frames (added). Rejected with reasons:
memo staleness (series frames are immutable cache objects), EURO-missing null (the per-hour blend is the fallback by design),
gate staleness (the post-fetch hour/model parity check is unchanged; the waiting slot always holds the newest), overspeed above
50 kn (the shader clamps speedNorm at 1), snapshot dedupe hiding history (the ring keeps every sample). Known limit
acknowledged: EURO current-page-only.

## Not verified

Physical phones and touch, Safari/Firefox, real regional data, live latency on the 1-CPU box, the owner's eye on the wind
speed change (one variable, kill switch ready). No SCOREBOARD row (no served number moved).

## Later the same day: merges, a skipped deploy, and the visual lab

- **Merged on the owner's word:** #387 (dev `0607a725`, 12:48Z, 19 checks green, live on dev frontend and backend 12:52Z) and #388
  (dev `697ad069`, 13:14Z, all checks green). The dev site did NOT rebuild for #388: the squash body quoted two branch commits
  titled with a static-site skip marker, so Netlify skipped the merge commit. Receipt PR #390 (ledger seq 1447, no skip markers)
  carries the build when merged. Lesson: never put a build-skip marker on any commit of a PR that must deploy.
- **The owner's check of #387's build** (console 13:13Z, bundle `0607a725`): the wind PRIMARY loop restarts on top of itself
  ("Fetching wind (attempt 1/5, offset: 18h)" three times, each aborting the last -> "conformed safe zero grid" -> retry), the
  backend had just restarted (message-count 15 s timeouts), long jumps waited on the network. #388's fixes were not in that build.
- **Visual lab** (`frontend/scripts/visual-lab/`, owner: "add a test branch that tests everything visually on the map using
  special instruments and tools"): replays the owner's flows (ICON waves scrub, ICON wind scrub, layer switches and model switches
  at a future hour, pan/zoom) on the production bundle over the offline backend, now with synthetic WIND for all three models;
  per step: on-screen identity by instant, time to the correct marine and wind field, particle-blind stale-picture verdict with a
  noise floor, console patterns from the owner's logs, requests (duplicates, failures), pacing; a self-contained report.
- **Findings on dev `697ad069`** (offline; zero latency, then 2.5 s / 0.5 s injected): marine silent mismatches <= 6-10 frames per
  step (W-1 holds); long jumps and pan/zoom instant; layer switch at a future hour 1.5-4.7 s and model switch 0.4-2.7 s (series
  page builds dominate: W-4 session); WIND +26 h 7.8 s with 7 requests, +82/+115 h never reach the exact frame in 8 s and hold the
  nearest one with NO label (wind has no drawn-time readout); zoom to 8 = 243-350 ms long task with 2 land-mask rebuilds
  (land-mask session). The owner's wind abort churn did not reproduce offline (no contention): it needs one bounded live run.

## Evening: #390 merged, wind honest + fast (branch `claude/wind-honest-fast`, stacked on #391)

- **#390 merged** on the owner's word; the dev site rebuilt from it. #391's ledger line re-chained onto seq 1448 (both branches
  had appended from the same base).
- **Wind drawn-time label (W-1 for wind):** `marineDrawnFrame.publishWindDrawn` records what `WebGLWindLayer` hands the engine
  (series frames now carry `valid_time`); `WindTimeStatus` words it under the timeline in all three layouts (through
  `TimelineStatus`, `windOn`), comparing by instant (#267). HRRR under a GFS selection is the lane (D-017), not "loading". The
  "nearest stored forecast" wording is limited to half the wind lattice step (1 h; EURO past 144 h: 3 h): further off is a fetch
  still owed and reads "Loading". The point card's stale badge stays marine-only. Kill `__RAW_DISABLE_WIND_DRAWN_READOUT__`.
- **Primary-loop abort churn:** (1) `windController`: an aborted fetch now REJECTS the shared in-flight promise instead of
  resolving it with a safe-zero grid, so callers that joined it start their own attempt instead of treating the hour as empty
  and retrying. Kill `__RAW_DISABLE_WIND_ABORT_REJECTS__`. (2) `WeatherEngine.attemptFetch`: a re-entry from moveend / dragstart
  / zoomstart for the SAME model|hour|tile joins the fetch in flight instead of aborting it. Kill
  `__RAW_DISABLE_WIND_SAME_TARGET_JOIN__`. `gridCovers` moved to `windCoverage.js` to stay under the file's line baseline.
- **Tests:** `windHonestFast.test.js` (12): drawn record, readout states incl. HRRR lane and lattice limit, coverage helper, and
  the abort rule (the joined caller gets a real grid; the kill switch restores safe-zero). Map + tests trees: 328 suites green
  after classifying the new kill in `windDarkRules.test.js` ORTHOGONAL. ESLint ratchet and LOC ratchet pass.
- **Visual lab A/B** on one build (`LAB_KILLS` = all three kills for arm A), ICON wind scrub, 2.5 s / 0.5 s injected latency:
  run 1 A->B: +18 h 1.8->1.0 s, +26 h 1.9->1.0 s, +42 h 7.9->2.8 s (7->5 requests); +82 / +115 h now say "Showing ...: the
  nearest stored forecast" where they were silent. Run 2 (order reversed) crossed a UTC hour, so lattice membership moved
  (+26 h became off-lattice) and +42 h was warm in both arms (208 ms); its B arm missed +3 h once (one /grid failed behind
  16-20 s series pages on the harness server, with a safe-zero log) and two more B runs did not reproduce it. Read the speed-up
  as a lead (n = 2 paired, clock-confounded), the labels as verified. The live abort churn still needs one bounded live run.
- **Lab knobs added:** `LAB_KILLS` (A arm on one build), `LAB_CONSOLE=<regex>` (matching console lines per flow to a file).
- **Open:** the marine readout uses the same fixed 3 h "nearest" limit, so a marine frame 2-3 h off on a 3-hourly lattice is
  also called nearest: same lattice-aware fix owed there. The B2 safe-zero path after a failed /grid needs the console capture
  from a reproduction. Server-side series contention (old model's pages keep building after a switch) stays with W-4.

## Afternoon: combined preview, W-5, review fixes, the nightly's SETTLED_STEP, Codex handoff (15:05Z)

- **Combined local preview** (`claude/scrub-combined-preview`, never pushed): dev + #391 + #393 + #392 + #389 (memo ON on its
  synthetic backend), regional flagship tiles. Full lab, injected 2.5 s / 0.5 s, dev 2 passes vs combined 3: wave scrub silent
  wrong frames 498-700 -> 30-40 per pass; wind worst 6.9 s -> 2.0 s (last pass); layer-switch worst 5.4 s -> 2.1 s; model switch
  ~2 s unchanged; zoom-8 long task 348 -> 313 ms. Every switch still shows the old field ~2 s ("Loading..." labelled): request
  timing shows the abandoned layer's 48-frame series page still building and starving the new layer's /grid (D2).
- **W-5 / T-09 -> draft #394**: offset-keyed per-hour marine and wind caches drop when the anchor flips (hh:30); a wind result
  fetched across the flip is not cached. T-08 needed no change (coarseBaseOutdatedBy already replaces cross-run bases; adding the
  run to coarseBaseKey broke the 46k-sequence base-hold sweep, reverted). Kill `__RAW_DISABLE_OFFSET_CACHE_ROLL__`.
- **Two independent reviews of the combined diff** (code-reviewer: no >=80 findings; silent-failure hunter: F1-F9). Fixed in #393:
  rethrow only our own abort (a foreign abort through the url-level join gets one fresh attempt), WIND_INFLIGHT owner-only delete
  and re-join, same-target join bounded to 15 s and logged, attemptFetch returns only on its own generation's abort, viewport
  refetch catch logs, wind readout clears on clear/off, one lattice rule (`latticeNearestMaxHours`) for both lines and the badge.
  #392 (F8 rollback leak, no device tier) and #389 (F4 short page served to a late joiner, F5-F7, lost 503) findings sent to
  their sessions.
- **Marine Nightly SETTLED_STEP is not from the scrub PRs:** 10-16 PASS (0) at db45393; `SERIES_THIN_NODE_BOUNDS` flipped
  10-16 21:24Z (ledger 1321), which also activates #347's world-mask cover reuse; then 2 (10-17, z 5.6-5.8), 16 (10-18, z
  10-16, before #387/#388), 23 (10-19, z 12.4-15.7). The metric samples the whole map canvas (basemap included), so basemap tile
  arrival at z12+ is a live alternative. Needs a frozen-data 2x2 (flag x `__RAW_DISABLE_MASK_COVER_REUSE__`) plus a heatmap-only
  arm; the flag-off arm changes served geometry and is the owner's call.
- **Served state 15:4xZ:** backend 0607a725, p95 10 s, p99 93 s, 255/3,520 requests > 5 s; dev frontend = #388 code (served
  chunks carry its kill switches, none of #393's).
- **Reflection (Beam-1.0)** consulted per the handoff: agreed with the order; asked for the controlled A/B, cancellation before
  prefetch, earlier mobile memory checks, capacity isolation.
- **Report** (private artifact): https://claude.ai/artifact/EmsHPfaUehDkybRQUXdnvM. Also noticed: Codex's unpushed wave-palette
  commit ee66317 (10-14) is not in dev; Codex is editing euro_marine_coarse_ingestion.py.

## Merges on the owner's word (16:00-17:25Z): #391, #393, #394

- Owner 11:59 EDT: "Merge. If that's the best path forward toward state of the art. Use Jacobson lens to help decide." Sensitivity
  reading: these PRs move only client time-identity (labels, cache identity, wind fetch semantics), no served number, and are
  independent of the nightly SETTLED_STEP (which predates them), so merging does not confound the D1 A/B as long as every arm
  runs on one fixed build.
- **#391** squash -> `463a4d91` (17 pass, 3 skipping). **#393** rebased onto dev, retargeted, squash -> `a95633c8` (19 pass, 1
  skipping). Retargeting after a force-push started only 2 checks; an empty commit triggered the full suite. Floor-staleness
  REFUSED once because dev's post-#391 run was still in flight; a re-run after it finished passed. **#394** rebased on #393,
  squash -> `9a68b49a` (19 pass, 1 skipping).
- **CI caught what my local runs missed:** `src/__tests__/` (a third Jest tree) holds `windControllerTerminalNocov.test.js`,
  which partially mocks `backendWeatherServiceClient`; `rollOffsetCache` threw there. Fixed in #394 (`readAnchorMs()` returns
  null: no anchor, no roll). Lesson: run the WHOLE frontend suite (`CI=true npx craco test --watchAll=false`, 447 suites / 5856
  tests), not only `src/components/map src/tests`.
- **Served:** dev site carries #393's three kill switches (fingerprint of the served chunks, 17:05Z) and #394's `__RAW_DISABLE_OFFSET_CACHE_ROLL__` (17:29Z). Deployed is not accepted: visual, mobile and live gates are still open.
- Still owed: the D1 frozen-data 2x2 (owner approves the flag-off arm); one bounded live lab run; owner's eye on dev in three themes.

## SETTLED_STEP A/B (owner-approved 13:34 EDT; 17:38-18:46Z, one fixed build: dev 9a68b49a, backend 9a68b49a)

Instrument: `zoomlab.js staircase_full` exactly as the nightly runs it (dev server, mock auth, live backend), scored by
`zoomlab-verdict.js`; plus a continuous read of the same trace: |dL| between consecutive same-zoom frames, split at z 12.
New local knob `ZL_HIDE_BASEMAP=1` (hides non-custom style layers; experiment-only, not committed).

| Arm | Where | Flag | Other | SETTLED_STEP | z>=12 mean / p95 / max | z<12 p95 |
|---|---|---|---|---|---|---|
| CI-on | GitHub run 39297393276 | on | — | **33** (354 frames) | — | — |
| A | local | on | — | 0 | 2.32 / 5.4 / 9.9 | 1.9 |
| B | local | on | `__RAW_DISABLE_MASK_COVER_REUSE__` | 0 | 2.12 / 5.0 / 9.4 | 1.8 |
| CI-off | GitHub run 39300643815 | **off** | fresh instance | **7** (426 frames) | — | — |
| C | local | **off** | — | 0 | 1.93 / **4.3 / 6.4** | 2.0 |
| A2 | local | on (restored) | drift check | 0 | 2.07 / 5.6 / 9.2 | 1.9 |
| E | local | on | basemap hidden | 0 | 2.25 / 5.5 / 8.0 | 1.8 |

Reading:
- **`SERIES_THIN_NODE_BOUNDS` raises the tail of settled high-zoom luminance change** (p95 ~+30%, max ~+45%), reproducibly
  (A2 returns to A's level after the flag-off arm), and only at z>=12 (z<12 unchanged: the control). n = 1 per arm.
- **#347 mask-cover reuse is not the cause** (B ~ A). **Basemap is probably not** (E keeps the tail), but weak: mean L moved
  only 121 -> 126 with the basemap hidden, so the hiding's completeness is unverified.
- **Why CI fails and local passes:** CI samples ~350 frames per staircase vs ~1,000 locally (~3x longer between frames), so
  a change spread over time lands as ~3x bigger per-frame steps; local max ~9-10 becomes CI's 16-33. CI's frame count did not
  change between the passing 10-16 run (350) and the failing runs (~350), so the content changed, not the sampling. The gate is
  per FRAME, not per second, so a small shift in the tail crosses 16 many times (33 -> 7).
- **Health:** every live run raised the /api/health probe from ~0.5 s to up to ~8 s during the run (the box is loaded by one
  zoomlab); it recovered within minutes each time. Flag set 0 at 18:02Z, restored 1 at 18:28Z (ledger 1465, 1466;
  1466's `corrects` field should have said it CLOSES 1465, not corrects it).
- **Open (owner):** the flag fixed the thinned-frame position jump (S21), so turning it off trades one visual defect for
  another. Proposed: keep it on and fix the client's thinned<->exact swap at settled high zoom (hold/crossfade by valid
  instant), and make the gate time-normalized (dL per 250 ms of frame gap) so the CI box's frame rate stops amplifying it.

## CORRECTION 20:00Z: the thin-bounds flag is NOT the SETTLED_STEP mechanism (supersedes the A/B reading above)

- Per settled zoom, the whole-canvas luminance SWING grows with zoom in every arm, flag off and basemap hidden included:
  ~10 at z9-10, ~20-30 at z11, ~40-68 at z12-13, **61 (A, on) / 74 (C, off) / 66 (E, no basemap) at z14**. The earlier
  p95/max difference (n = 1 per arm) is noise-sized against this; CI's 33 vs 7 was largely chance plus that tail.
- In the biggest 1 s windows NOTHING the trace records changes: resident grid (-83,26,-79,30, 17 cols), mask bounds, overlay
  mode (midcarve_replace), heatmap opacity (hm 0.8), mult 1. Luminance ramps smoothly (117 -> 147 in ~1.1 s) and the hue moves
  purple-blue (R138 G86 B196) -> light peach (R190 G158 B174); per-column motion jumps 6.5 -> 169.
- Ruled out: thinned<->exact swaps (no grid change), #347 mask reuse, basemap (E), crest sprites (screen-space, 36-80 px), the
  heatmap's only time term (rating shimmer; rating is off), the offline harness (one 17x17 grid throughout, max windowed |dL|
  6.8 at z14 with the dynamic lane answered synthetically).
- Leading candidate: the viewport fine-detail overlay (dynamic products at narrow zoom) landing and alternating after the zoom
  settles; the trace records only its mode, not its product identity, so this needs ONE instrumented live run.
- The time-windowed gate (#396) stands on its own (machine-independent: CI 8, local 7-8 on the same build).

## The flicker found and fixed (owner-approved live probe 20:2xZ): screen-bounded wave sets, PR #397; gate PR #396

- **Live probe** (`settled_zoom_probe.js`, live mode = the nightly's dev-server + badge stub; health 0.52 s before, 0.50 s
  after): 19,525 frames z 9 -> 14.5; 61 one-second steps at z 11-14.4; ZERO grid / mask / coarse-base / coastline-overlay
  changes at settled zoom (the overlay hypothesis falsified too). At z 14.04 luminance is a smooth periodic oscillation,
  192 -> 120 -> 200 over ~10 s.
- **Mechanism:** the crest shader's wave-train envelope `fract(dot(global_pos, dir) * spatialFreq - t/T)`, spatialFreq
  clamp(800/T^2, 3, 25) per Mercator WORLD unit (one set = 14-120 deg). Zoomed in, the view sits inside a fraction of one
  set, so every crest on screen fades 0.25 <-> 1.0 together with the swell period. Foam roll and orbital pitch share the phase.
- **Fix (#397):** set frequency >= 3 / viewWorldWidth (viewWorldWidth = CSS width / (512 * 2^zoom)); zoomed out unchanged;
  temporal period unchanged; no crest removed. Offline same-build swing per settled zoom 1.7-8.2 -> 0.2-0.6; shaders compile
  and link in WebGL; whole suite 448/5861. Kill `__RAW_DISABLE_SCREEN_BOUNDED_WAVE_SETS__`.
- **Gate (#396):** SETTLED_STEP over a 1 s window; CI on its branch 8 (586 frames), local same build 7-8. CI frame counts
  vary 345-586 run to run.
- Lesson: the zoomlab trace's per-frame engine fields let me rule out swaps without a live run; a 60 fps probe of the signal's
  SHAPE (smooth periodic vs stepped) identified an animation in one run. Read the shape before testing causes.

## Evening 21:00-22:10Z: what the remaining delay is, the deploy decoupling, and a redundant fix dropped

- **Owner stress test 20:52Z ran on a box restarted at 20:50** by #396's merge (CPU 0.25 -> 0.94; series p95 26 s). Every
  frontend merge redeployed the one backend: the live build filter ignores only docs/**, audit/**, **/*.md.
- **#397's Render deploy (461ed695) ended `update_failed`** 1 s after a successful build, reason empty, no server_failed event;
  the old instance kept serving identical backend code. Its post-merge E2E then failed falsely ("backend serving 1596b694, not
  461ed695" x60). Cause of the Render failure unknown; one occurrence.
- **#398 merged (88e762fe): E2E backend gate `--same-backend`** (accepts a served commit with HEAD's newest Render-deployed
  commit; RENDER_IGNORED_PATHS + skip markers), fetch-depth 0, render.yaml records the intended filter. Real history: dev,
  1596b694, 461ed695, 9a68b49a all resolve to dad9f46d. OWNER ACTION OPEN: set the live build filter ignoredPaths to
  ["docs/**","audit/**","**/*.md","frontend/**"].
- **#398's own deploy was skipped:** its commit message quoted "[skip render]" while describing the rule, and Render honoured it
  (event commit_ignored 21:58:02). Harmless (CI-only change; the gate excludes marker commits by design). LESSON (second time,
  after [skip netlify] on #388): never write a deploy-skip marker's text in a commit message, not even quoted.
- **Live erratic run (owner-approved, 21:29Z, health 0.61 -> 2.64 s):** single requests 2-17 s; client long tasks 116-817 ms per
  transition; the 40% stale-hour dim showed only 0.17-0.63 s. Most requests over 5 s were for views already left.
- **Offline A/B, REACT_APP_MARINE_SERIES_WORK_BOUNDS on vs off** (Codex's never-qualified policy; OFF on dev): no measurable
  difference (stale server time 156-232 s both ways; ttc ~2 s). Not the lever.
- **Stale work is the SERVER finishing abandoned builds.** An in-page fetch probe shows the client already aborts the previous
  view's /grid_series 40-70 ms after every model/layer switch. My switch-abort change (claude/series-switch-abort, local only) was
  therefore redundant and is dropped. The lever is #389's server-side cancellation (rebase requested of its session).
  Instrument note: the offline harness logs a request on completion and Playwright routes finish the upstream call even when the
  page aborts, so it cannot show client cancellation; use the in-page fetch probe.

## 20:20 EDT: one-field frame-image proof opened (#399), receipt ledger rebased

- Owner: "Start the one-field proof ... parity vs /grid, measure time-to-correct and server CPU." Opened #399 (dark, serves
  nothing): the GFS marine waves `global_mid` field nearest now as one 8-bit RGBA PNG (height mm uint16 in R,G; 0 = no
  data) in a new PUBLIC bucket `weather-frames`, published by `publish_frame_images.py` after ingest only when the repo
  variable `FRAME_IMAGES_PUBLISH` is `1`; dark browser loader `frameImageProof.js` compares it with `/grid`.
- Offline (real Chromium, real backend over the synthetic store :4103, N=8): parity 15023/15023, max err 0 m; image path
  median 14.9 ms with 0.000 s backend CPU vs `/grid` 461 ms and 0.40 s CPU per request. PNG 6.3 KB vs 1.66 MB JSON
  (synthetic field is smooth; real data compresses less). The browser caught a decode bug (closed ImageBitmap = 0x0).
- Live numbers are owed after merge: the local `.env` holds no Supabase credentials, so the first real publish is a
  GitHub Actions run.
- This branch's ledger lines forked at 1453 from dev's 1454-1461; they were re-appended as 1464-1480 (seq references
  inside them shifted +10, after #392's 1462 and #402's 1463; the GRID_SERIES_PAGE_MEMO repeat commitment is now 1480; pr_open #399 = 1481), backup `backup/receipt-394-pre-rebase`.

## 20:35 EDT: #392 merged

- #392 (two-entry land-mask cache) squash-merged 00:34:59Z as `aaa1adfb`, pinned to `c25200160`, on the owner's
  "Merge #392 if its CI is green". Its first `backend-forecast-chain-guards` run was CANCELLED at the job's
  `timeout-minutes: 20` with 2809/2809 passed: the chain lane now runs at its time limit (follow-up: raise the timeout or
  split the lane before it starts failing PRs for runner speed). The failed-job rerun passed.

## 20:45 EDT: step 2b learnings (one live /grid, encoder read, Reflection review)

- ONE live world `/grid` (GFS waves, valid 00Z, run 18Z) at 00:36Z, health 0.54 s before / 0.47 s after: 1.95 s,
  255 KB on the wire, 2.68 MB JSON (261 KB gzip). The same field as the #399 RGBA PNG: **27.4 KB**, self-parity exact.
  WebP lossless 21.2 KB; height-only 16.8 KB; height+dir+period as PNG pair 34.8 KB vs gzipped raw binary 35.3-39.5 KB.
- The GPU heatmap texture (`WebGLMarineTextureEncoder.js` ~l.337) stores height as `floor(min(h/10,1)*255)`: 3.9 cm
  steps, **saturating at 10 m** (2 live nodes > 10 m, max 12.3 m). Not changed; recorded. Frames for rendering must carry
  period and `dir_confidence` (97% of live nodes < 1; computed at ingest in `normalizer.py`).
- Reflection (Beam) reviewed the 2b design. Adopted: gzipped raw little-endian binary frames decoded in a worker with
  `DecompressionStream` (size is a wash, measured; the gain is no alpha trap, any field count, no host-compression
  dependence), versioned header, run-pinned atomic publish (`runs/<runId>/` then a no-cache `latest.json` LAST), sha256
  per frame, retention current + 1 run, prefetch window +-3 steps on the active model/layer, `/grid` parity as a publish
  gate. Supabase Smart CDN invalidation is Pro-only; immutable paths make it irrelevant.
- Follow-ups recorded, not done: `backend-forecast-chain-guards` runs at its 20-min timeout; the frontend E2E gate's
  same-commit logic for Netlify skip markers.

## 21:10 EDT: #399 merged; SOTA research round 2 with a measured time-interpolation hold-out

- #399 squash-merged 00:45:36Z as `a4a02033` (owner: "Merge #399. I'll set the FRAME_IMAGES_PUBLISH repository variable
  to 1 afterwards"). Render served it from 00:48:56Z (health `version` ends a4a02033...; my wait loop grepped the wrong
  field, the deploy was never stuck). A forecast-ingest run was dispatched at 00:50:53Z (not by me) before the variable
  existed, so the first live publish is the first run after the owner sets it.
- HOLD-OUT on live GFS-Wave world fields (run 18Z; blend 21Z+03Z at t=0.5 vs real 00Z; a 6 h gap; n = 1 triple; 2 more
  live /grid GETs, health 0.59 s before / 0.32 s after): height MAE 3.1 cm, p95 12.5 cm vs holding the previous step
  10.6 / 39.5 cm (3.4x); peak retention in 35 storm boxes min 0.911 (typhoon), median 0.982, none < 0.90; no ghost
  maxima (>= 5 m: 22 real / 22 blend); direction must blend on the unit circle (naive degree averaging: 230 nodes > 90 deg
  off); period must not blend (max error 9.1 s at dominant-system switches).
- Research (three subagents, sources cited in memory `sota-research-2026-10-20`): nullschool does not interpolate in
  time; Windy only radar/satellite; no leader labels interpolated frames; R16F is filterable in core WebGL2 (would
  remove the 3.9 cm / 10 m height cap); WebGL contexts cannot share textures with a worker; Supabase's Content-Encoding
  handling is undocumented (check magic bytes before DecompressionStream).
- Reflection round 2 changed the order: PROFILE the 120-820 ms main-thread stalls first (fetch / parse / convert /
  upload / land mask) - the single measurement that most changes the plan; then binary frames + worker decode + R16F
  texture-array window as one milestone; interpolation only after a many-triple hold-out run from published frames.

## 21:25 EDT: who owns the main-thread stalls (offline profile, PR #400)

- Owner: "profile the 120-820 ms main-thread stalls offline (fetch / parse / convert / upload / land mask) on an
  erratic scrub against the mock backend, and report what owns them." Dev `a4a02033` (with #392) built with source maps,
  synthetic backend :4121, `FLOWS=erratic LAB_TRACE=1` twice, V8 CPU profile with per-step markers, attributed by
  `stall_profile.js` (PR #400, tooling only). No live traffic.
- Mean of 2 runs. Zoom/pan: land mask build 46% (renderMaskToCanvas, suppressShelteredWater, applyInlandWaterGuard,
  overlayBasemapWaterOnMask; #392's cache does not cover a new viewport). Scrubs: native 18%, GPU-sync GL state capture
  (`captureWebGLState` getParameter reads) 17%, manifest scan `getSharedValidTime` + `formatInstant` Intl construction
  visible. Switches: native 18%, state capture 17%, grid -> texture 12%. Load: shader compiles 30%.
- Worst stall per step: zoom 8 695/512 ms, pan 541/247 ms, scrubs <= 423 ms, load 789/1424 ms. Fetch/parse is small
  (fetch/manifest glue 5-10%); texture upload is not separately visible (native GL time bills to the calling JS line,
  and the getParameter sync absorbs queued GPU work).
- Traps hit: Chrome dropped the tracing `disabled-by-default-v8.cpu_profiler` category (use the CDP Profiler domain);
  one trace came back truncated (stalls are now derived from the CPU profile itself); app source paths in the maps carry
  no `src/` prefix.

## 21:50 EDT: Jacobian lens on the scrub plan; outside cross-check; Reflection round 3

Outputs (what the user gets), per scene:
- O1 time-to-correct-field
- O2 worst main-thread stall
- O3 wrong-or-stale frame shown (silent mismatch / stale dim)
- O4 honesty: labels and confidence
- O5 server CPU on the 1-CPU box
- O6 bytes per session / CDN storage

Scenes: S1 time scrub, S2 model/layer switch, S3 zoom/pan, S4 page load, each × desktop/phone × fast/slow net × cold/warm backend.

Levers (inputs) with the measured or inferred partial effect. Signs are relative to today; M = measured, I = inferred.

| Lever | O1 ttc | O2 stall | O3 stale | O4 honesty | O5 server CPU | O6 bytes |
|---|---|---|---|---|---|---|
| L1 CDN frames (2b) | S1/S2 −−− (15 ms vs 461 ms /grid offline; live /grid 1.0-1.95 s) M | S2 **+** unless L2: conversion moves from waiting to client CPU; grid→texture is already 12% of switch stalls M | −− (fewer waits = fewer held frames) I | 0 | −−− (0.000 s vs 0.40 s/request) M | world frame 27-35 KB vs 261 KB gzip JSON M; +46 MB/run storage I |
| L2 worker decode + R16F array | 0/− | S1/S2 −− (removes conversion + JSON from main) I | 0 | +(10 m cap removed: 12.3 m storms drawn true) M | 0 | 0 |
| L3 GL state shadow | 0 | S1/S2 −− (state capture = 17% of scrub/switch stall) M | 0 | 0 | 0 | 0 |
| L4 viewport land mask | S3 − | S3 −−− (46% of zoom/pan stall; worst 695 ms) M | S3 − I | 0 | 0 | 0 |
| L5 manifest index + Intl cache | 0 | S1 − (getSharedValidTime 113-307 ms, formatInstant 75-220 ms per run) M | 0 | 0 | 0 | 0 |
| L6 windowed prefetch ±3 | S1 −−− for nearby steps I | **+** GC/convert bursts unless L2 I | −− I | 0 | 0 with L1 / **+++** without L1 (series pages 5-25 s CPU) M | + I |
| L7 time interpolation (linear) | perceived continuity + | + small (2 texture fetches) I | blend error MAE 3.1 cm vs hold 10.6 cm (6 h gap) M | **needs label** (no leader does it) | 0 | 0 |
| L8 page memo (#389, on) | S2 − (ttc 2.6 → 1.8 s) M | 0 | − | 0 | − (abandoned builds cancelled) M | 0 |
| L9 model-spread confidence | 0 | + small I | 0 | +++ (storms: models differ 29-37%, Solano 47% at the TC) M | 0 (precomputed) | + I |

## What the cross terms say
1. **L1 without L2 moves the stall, it does not remove it.** CDN frames cut the wait and the server CPU, but the client
   still converts every frame on the main thread. Ship frames with worker decode as one milestone (Reflection agreed).
2. **L6 without L1 multiplies server load** (the series pages are the box's heaviest work). Prefetch only from the CDN.
3. **L3, L4 and L5 are independent of everything else**, with no cross terms. Do them now: the two fix sessions are on
   exactly these.
4. **L7 changes O4 by its nature.** It is only honest with a label, and only for height and direction (unit circle),
   never period.
5. **Scene dependence:** L4 matters only in S3; L3 matters in S1 and S2 on every frame; L1 matters most on slow networks
   and a cold backend, where today's world /grid takes 1.0-1.95 s.
6. **Forecast-quality Jacobian:** sensitivity of the served height to the MODEL is largest exactly where heights are
   largest (calm swell 3%, storms 29-37%). A single-model map is least trustworthy where users care most → L9.

## Order the matrix implies
L3 + L4 + L5 (running now) → L1 + L2 together (2b) → L6 (CDN-only) → L7 dark with a label → L9 dark.

Outside cross-check (nausika_marine_forecast = Open-Meteo marine ~0.08 deg; Solano confidence): ours vs outside at 00Z -
30N 130W 2.15 vs 2.08 m (+3%); 50S 144W 6.50 vs 5.04 (+29%); typhoon 16N 136E 12.29 vs 8.94 (+37%), Solano confidence
47% there. n=3, mixed model and resolution.
Reflection round 3: L2's stall effect is inferred (measure next: worker decode + R16F upload on real devices with live
CDN frames, prefetch on/off); the running fixes' cross terms are unproven (re-profile with #400 after each lands); start
model-spread data collection now; gate interpolation by confidence. Rejected one point: the hold-out measured period's
9.1 s max error, so "never blend period" stands.
Process: the two fix sessions started in the main checkout; both were messaged to cut their own worktrees, with file
ownership named. FRAME_IMAGES_PUBLISH set by the owner at 01:25:13Z; the 00:50Z ingest predates it.

## 22:15 EDT: literature, MapLibre source, shader compile

- Paper search: Elicit unavailable (no API access on the plan); used the arXiv API. Relevant: ECMWF AIFS now forecasts
  ocean waves (~1 day more marine skill, 2604.25559); calibrated ensemble spread predicts error spread (2503.21488, the
  basis for #401's spread layer); DL bias correction of ECMWF Hs cut MAE 13-46% (2311.15001); exceedance probabilities
  beat point forecasts for extremes (2206.09821).
- MapLibre 5.24 `draw_custom.ts` re-applies all of its tracked GL state after every custom layer (`setDirty` +
  `setBaseState`, l.42-43 and 60-61), so our capture/restore of those fields is redundant inside the callbacks; only
  untracked state needs cleanup. Sent to the scrub-stall session with the caveat to verify no draw runs outside them.
- Shader compiles (30% of load stall): no `KHR_parallel_shader_compile` anywhere; `createProgram` reads LINK_STATUS at
  once, forcing a synchronous compile. Candidate load fix: poll COMPLETION_STATUS_KHR before first use.
- Side sessions: scrub-stall (rs-hotspots, isolated, A/B profiles running); land mask (working); model spread opened
  draft #401 (MODEL_SPREAD_PUBLISH off; its ledger lines 1463-1464 fork #395's chain: whichever merges second re-chains).

## 22:40 EDT: crest animation physics audit (Jacobian lens) - #397 inverted the period cue from z4

- Wave-train band in DRAW_VS: spatialFreq = clamp(800/max(36,T^2), 3, 25) per world width, then #397's
  max(f, 3/viewWidth); band speed = 1/(T*f). Deep-water dispersion gives speed ∝ T. JS mirror, speed relative to 10 s
  for T = 6..20 s (physics 0.60..2.00): z1 0.60..1.60 then 1.48/1.33 past 16 s; z3 0.72 0.96 1.00 0.83 .. 0.50; z4+
  1.67 1.25 1.00 0.83 0.71 0.63 0.56 0.50 with ALL periods sharing one spacing (speed ∝ 1/T).
- CORRECTION of my #397 (merged 461ed695): its docstring says "the motion keeps its character"; from z4 the per-period
  max() inverts the period cue (chop races, groundswell crawls). It fixed the pulse output and flipped the period output.
- Proposed fix (not built): one zoom factor for every period, f_eff = clamp(f(T)) * max(1, 3/(viewWidth*f(T_max))),
  which keeps >= 3 sets for the longest period (anti-pulse holds) and speed ∝ T at every zoom. Reflection agreed and
  added: floor from a minimum on-screen spacing, T_max from the displayed data, drift ∝ orbital velocity (~πH/T) not
  height alone (drift is min(h, 3 m) today, period-blind); nearshore speed is depth-limited.
- Other sources this round: the mapbox data-visualization skill (basic time-series patterns, nothing to adopt) and
  the Three.js MCP (a scene viewer, not a research source).

## 22:50 EDT: merges (#400, #386, #402), shader compile (#403), PERIOD DEFINITION forensics

- Owner: "merge everything needing merging and pushing!" Merged at tested heads: #400 stall profiler (bde69783),
  #386 audit report (536aad15, subject rewritten without the deploy-skip marker text), #402 main-thread hot spots
  (b240d727). Left alone: #385/#375 (conflicting, unfinished), Codex's #377/#339/#333/#264. #395 re-chained a third time
  after #402's ledger line (receipts now 1464-1492); #401 still needs a re-chain before it can merge.
- #403 (deferred shader status in createProgramBatch, MDN practice): same-bundle A/B, 3 alternating runs per arm,
  batch-compile main-thread 1285/678/741 -> 472/472/435 ms, worst load stall 442/390/346 -> 310/342/211 ms.
- PERIOD FORENSICS (3 live world /grid GETs at 00Z, health 1.20 s before / 0.38 s after the last pair): at nodes where
  heights agree within 15%, EURO/GFS period ratio p50 0.988 but ICON/GFS p50 0.842 (10.94 s vs 8.97 s, n=6433).
  Code: GFS = PERPW, EURO world = pp1d (peak, deliberately "GFS-Wave PERPW semantics"), ICON = DWD tm10 (energy period
  Tm-1,0), Copernicus EURO point path = VTM10 (energy period) although VTPK (peak) exists. Open-Meteo at 30N 130W:
  ECMWF mean 11.0 s vs peak 12.85 s; GFS PERPW 11.65 s; GWAM 10.6 s. surf_transform.py and surf_rating.period_quality
  are written for PEAK period, so ICON (and the Copernicus EURO point path) feed a ~15% shorter period into the
  breaking-height and period-quality math, and the consensus mean mixes definitions. DWD open data has ppts/ppww
  (partition peak periods): Tp ≈ ppts where shts^2 > shww^2, else ppww. Fix must ship DARK (served numbers, D-001),
  validated against NDBC DPD (a peak period) and cross-model at height-agreeing nodes; not built.
- Research this round: BigQuery public data (metadata only, no queries: ICOADS ends 2017; IBTrACS current, with
  34/50/64-kt wind radii), AIFS Waves (Hs, mean period, sin/cos direction, six >10 s period bands like our
  ECMWF_PERIOD_BANDS, ~10% lower Hs RMSE), and the four-parameter cross-assignment of wave systems (2412.09542).

## 23:35 EDT: merges (#403, #395, #401), wave palette audit, PERIOD RATIO science + surf-chain Jacobian, async compile

- Merged at tested heads: #403 deferred shader status (ea4b8cac, 03:06:28Z), #395 receipts (6021c2cc, 03:06:32Z),
  #401 model spread, dark (11d19ef0, 03:31:20Z; its ledger lines re-chained 1463/1464 -> 1498/1499 and force-pushed with
  lease at 8ccca6cac before merge; 18 pass, 1 skipping). E2E Tests on push: success for b240d727 (#402) and ea4b8cac
  (#403), in progress for 11d19ef0.
- WAVE PALETTE AUDIT (coloraide OKLCH / dE2000 + Leonardo APCA, marineWavePalette.js stops 0/0.6/1.2/2.4/5/10 m):
  light ramp L 0.89/0.65/0.59/0.39/0.67/1.00, so calm 0 m (#C7DEF0) and a 10 m storm (#FFFFFF) differ by APCA Lc 18.8
  (dE2000 12.6); beach ramp L 0.44/0.65/0.83/0.65/0.35/0.97, so 0.6 m (#0DA694) and 2.4 m (#E65F31) are the SAME grey
  (Lc 0). Neither is monotonic in lightness, so size reads from hue alone (fails colour-blind and outdoor use; the
  mapbox-cartography skill: outdoor/bright needs higher contrast). Reflection: monotonic L, light->dark on both
  basemaps, hue secondary, colour-blind check on composited renders. Owner started the redesign session (owner A/B).
- WeatherLayers GL (read for technique, not adopted): time blend = image + image2 + imageWeight mixed AFTER spatial
  interpolation, in value space; manual bilinear plus an optional cubic B-spline (16 fetches); alpha 0 unless every tap
  has data (no smearing into land/missing); Contour and HighLow layers. Our heatmap: hardware bilinear on an 8-bit
  height texture (3.9 cm steps, capped 10 m).
- PERIOD RATIO SCIENCE (numerical JONSWAP moments, backend/.venv numpy, 0.01-2 Hz, 400k points):
  Te/Tp (Te = Tm-1,0) = 0.857 / 0.884 / 0.903 / 0.919 / 0.931 at gamma 1 / 2 / 3.3 / 5 / 7 (Tm01/Tp 0.772-0.878,
  Tm02/Tp 0.711-0.829). Bimodal 14 s swell (gamma 3.3) + 6 s wind sea: Te/Tp 0.850 / 0.743 / 0.635 / 0.528 at swell
  energy share 0.9 / 0.7 / 0.5 / 0.3 (Te 7.4 s for a 14 s swell at 0.3). So no constant converts ICON tm10 or
  Copernicus VTM10 to peak: our world median 0.842 is an average over mixed seas, and the error is largest under local
  chop, exactly where a groundswell matters. Sent to the peak-period session with Reflection's advice: feed swell and
  wind-sea partitions separately through estimate_surf_partitioned (not a dominant-by-energy peak), swell-partition
  peak for a scalar fallback, validate against buoy Tp before any consensus change.
- SURF-CHAIN JACOBIAN w.r.t. period (dev 11d19ef0, surf_point.estimate_surf_at + compute_surf_rating offline;
  Trestles / JBay / Pipeline): below the depth cap the v3 path follows Hb ∝ T^0.4 * H0^0.8 (H0 0.8 -> 1.5 m: x1.6535 vs
  1.875^0.8 = 1.654); dlnHb/dlnT = 0.38-0.40 across incidence 0/30/60 deg and Hs 0.5-3 m, 0.20-0.24 where the depth cap
  binds (JBay Hs 3 m, 0.81 * 5 m). Rating +2.7 points/s for 6-15 s (period_quality linear). Mixed-sea impact on the
  ICON member: (7.4/14)^0.4 = -22% height, ~-18 rating points; consensus ~-7% / ~-6 points. Reflection: the exponent
  is model-defined, not an observation; validate against observations. Recorded, not acted on.
- Science gap noted (not for now): the obliquity factor is period-independent (x0.946 at 30 deg, x0.797 at 60 deg for
  every T), whereas real refraction turns long-period swell toward the shore more; spot geometry (shelf width, depth)
  did not change the shoaling result below the cap at these spots.
- ASYNC SHADER COMPILE lever: KHR_parallel_shader_compile (MDN browser-compat-data: Chrome 76, Edge, Safari 14.1, iOS
  Safari; not Firefox) lets the layer poll COMPLETION_STATUS_KHR per frame instead of blocking on the slowest program
  (#403 still waits ~435-472 ms). Reflection: gate drawing only, not all init; timeout to the blocking path; reset on
  context loss; stop polling once done. Proposed as its own session (card), kill switch
  __RAW_DISABLE_ASYNC_SHADER_COMPILE__.
- Tools tried this round: Context7 (MapLibre custom-layer docs: nothing new on state reset), MCP registry (marine:
  solanometeo + Nausika already connected; Xweather tropical tools not connected), claude.ai skill search (none for
  animation/flow), Readwise library and the mem0 store (nothing on waves), HF paper search (no forecast-field temporal
  interpolation work; GLONET and AIFS ocean are the current data-driven ocean systems).

## 04:20 EDT (08:20Z): overnight merge queue, integration test, buoy science

Owner 00:02 EDT: "Make sure to merge everything, test everything. Especially at the end of all the subagents work. Then
push a final product." Then at 00:08 EDT the owner went to bed with "Keep going. Dig deeper and learn more knowledge."

**Merged at tested heads (all green):**
- #404 crest period cue (b689984c3; merged by its own session);
- #405 marine FBO-status cache + teardown skip (edced5395);
- #409 the same for wind (998e9e919);
- #407 CMEMS = Meteo-France MFWAM labels (fc4579a60);
- #408 land-mask fast paths, byte-identical (2f8cf224e);
- #410 KHR_parallel_shader_compile (60fc1954c);
- #412 COPERNICUS_PEAK_PERIOD + ICON_PEAK_PERIOD, DARK with both flags '0' (5cc77db14).

**Ledger forks:** every PR opened at seq 1500/1505. The lead re-chained #405, #407, #408, #410 and #412 in turn, using
scratchpad rechain.sh:
- rebase onto dev, keep dev's ACTIONS.jsonl, re-append each line with acted_at;
- an anchor-only STATE conflict resolves to dev, then the anchor is rewritten;
- remap the PR's own log seq refs;
- push with --force-with-lease pinned to the old head.

#412 had already merged dev once, so a rebase replayed a pre-#407 ci.yml commit; merging origin/dev into it conflicted
only on the ledger.

**Not merged, owner decisions:**
- #411 wave palettes, a draft waiting for the owner's A or B pick (10 m cap kept; widening to 16 m is its own later A/B);
- promoting dev to main (BRAIN_RULES §22 handshake).

**CI catches:**
- #410 failed the LOC ratchet (WebGLMarineEngine.js +10); its session moved the lines out.
- #412 failed 2 chain-lane guards (test_cmems_period_window: wave_period_tm10 had no windowed-height pairing). Its
  session fixed it without weakening the guard, adding a flag-on window test with a mutation check. The chain lane then
  read 2843 tests across 172 files.

**Integration test of the final frontend (dev 60fc1954c; #412 changes no frontend file):**
- Jest src/components/map + src/tests: 340/340 suites, 5,052 tests. ESLint ratchet passes. craco build compiles.
- Offline lab (6 owner flows, synthetic backend :4190, SPA :3190): 0 flow failures, 0 failed requests, marine
  never-correct 0, wind never 3 (3-hourly synthetic ICON wind snaps to the nearest frame, as before).
- Theme x device smoke (dark / light / beach x 1280 px / 390 px DPR 3): 6/6 load the wave field with 0 page errors. The
  4 console errors are offline artefacts (RainViewer aborted, surf spots stubbed).
- WebGL context loss/restore, waves + wind, with and without #402/#405/#409's caches and with #410 on: recovers with
  gl.getError 0 and 0 page errors. Against a no-loss control, the heatmap is back within about 10 s.
- Lab noise: a paired same-hour run of b689984c3 vs 2f8cf224e read 3 vs 2 wind-never and 19 vs 16 silent frames, while
  an unpaired baseline read 8. Compare builds only with interleaved runs, >= 3 per arm.
- Served: dev Netlify served BUILD_VERSION 998e9e91 with the #402-#405-#409 kill switches in chunk 1451 (all 104 chunks
  downloaded and grepped). E2E Tests on push passed for b689984c3 and edced5395.

**Science (external data only; the live box was never touched):**
- PERIOD, 9 NDBC buoys, about 6,250 h (NDBC realtime2 DPD/APD; Open-Meteo marine past_days=30), model/buoy DPD:
  - ECMWF peak 0.979, GFS PERPW 0.975;
  - DWD GWAM mean (= ICON tm10) 0.873 overall, 0.736 when buoy DPD/APD >= 1.6;
  - Meteo-France mean 0.900 / 0.772;
  - flat across leads 1/3/5 d, so the ICON period bias is definitional. #412's own 128-buoy check agrees (blend
    1.816 s vs tm10 2.363 s MAE).
- CONSENSUS by lead (Open-Meteo previous_day1/3/5, same buoys, Hs MAE m):
  - equal mean 0.167 / 0.209 / 0.296 beats the best member, ECMWF (0.172 / 0.223 / 0.321);
  - leave-one-buoy-out skill weights gain only 3.6 / 2.4 / 1.0 % and converge to equal;
  - global per-model bias correction gains -2 to +1 %;
  - spread-error Spearman is 0.09 at day 1 and 0.26 at day 5.
  - The owner's equal-mean decision is supported.
- INTERPOLATION hold-out on real hourly GFS-Wave (Open-Meteo, 3 regions x 72 h, 2 deg):
  - temporal Catmull-Rom beats linear by 15-30 % (MAE and storm core), with peak retention median 0.996-0.999 at 3 h;
  - optical-flow and group-speed advection lose to linear, although a translating-storm positive control shows the
    code works;
  - at 6 h gaps typhoon peaks drop to 0.75-0.78 under any method, so cadence is the storm lever.
- CORRECTION of the 23:35 section's "science gap": on straight parallel contours, Snell refraction is nearly
  period-independent (Kr 0.946 -> 0.934 at 30 deg, 0.745 -> 0.714 at 60 deg over 6-18 s). The real period effect is
  headland/bay focusing.
- LICENCE: CMEMS requires the credit "Generated using E.U. Copernicus Marine Service Information" plus the product DOI
  (10.48670/moi-00017 per the Earth Engine citation; confirm). The app credits nothing. Card task_b201a22c proposed.
- Literature: 2609.30688 (univariate DL Hs forecasting at buoys has hit diminishing returns; covariates are needed).
  Bias correction must therefore be conditional on model fields + wind.
- Reflection (Beam) reviewed the period/Jacobian/async-compile design, the interpolation result and the ranked
  roadmap. Its correction: hourly frames are a bigger storm lever than CDN speed. The lead's coupling note: hourly
  frames need CDN frames first, or they triple the box's load.

Morning report (private): https://claude.ai/artifact/B2SKgyzwwBvuZosdAqyYdQ

## 09:50 EDT (13:50Z): #406 and #411 merged; morning research for the follow-up sessions; Leonardo MCP fixed upstream

- #406 (overnight receipts) merged 08:42:38Z as 0fc67408a. #411 (wave palettes, light A + beach B, D-033) merged
  13:39:31Z as f550d2502 by the palette session on the owner's word (13:35Z, relayed: "Merge #411 into dev once every
  hosted check is green, then read back the deployed build"). Dev serves BUILD_VERSION f550d250 with
  __RAW_DISABLE_WAVE_PALETTE_V2__, light calm 228,230,144, beach calm 195,254,255 and the violet flag 120,26,174
  (palette session's read-back).
- Research sent to the three follow-up sessions (16 m encoding, beach crest colours, async land mask):
  - R16F is filterable in core WebGL2 (MDN raw source; a WebFetch summary had swapped the columns), with steps
    <= 1.6 cm at 16 m. An 8-bit sqrt encoding biases bilinear midpoints up to -50 cm.
  - Beach crest inks: a polarity switch at wash APCA-Y > 0.352 keeps min |Lc| 53 over both ramps. White-only reaches 0
    and navy-only 16-20. Leonardo-tuned tints reach 42-49.
  - Async land mask: OffscreenCanvas in Chrome 69, Firefox 105, Safari 16.4; scheduler.yield not in Safari. The LoAF
    baseline on dev 60fc1954c pan/zoom: 8 frames > 50 ms, worst 126 ms, React scheduler 430 ms, series JSON parse 62 ms.
  - Literature (Consensus):
    - Lindsey & Teller 1990: direction-of-motion is lost at isoluminance, so crests need luminance contrast;
    - Dasgupta 2020, Schloss 2019: monotonic lightness and the dark-is-more / opaque-is-more agreement on bright basemaps;
    - Birkeland 2014: perceived particle speed follows a power law;
    - Ware 2016: crest-like orthogonal animated segments are worst for path tracing.
- Tools:
  - The Chrome DevTools MCP browser crashes on our WebGL map, so ab_lib stays the harness.
  - Mobbin needs a paid plan.
  - Leonardo generate-theme was broken by an MCP structuredContent bug: patched locally (npx cache) and fixed upstream
    with the owner's go-ahead in adobe/leonardo#297 (issue) and #298 (PR; fix + end-to-end test + changeset, 9/9 tests).
    #298 waits on the owner's Adobe CLA.
