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
