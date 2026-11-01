# 2026-10-27 · lead (claude, session local_d6b521eb) · #610 #600 #590 #608 merged; INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS ON; #610 live read

## The owner's word
2026-10-27 12:34Z (08:34 EDT): "Merge #610 once CI is green, plus #590, #600 and #608. Then flip
INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS per #600's runbook and read #610 back on dev."

## Merges, one at a time (ledger.d/claude--prune-protect-flip.jsonl lines 1-7)
- #610 (EURO's 6-hourly half-step by model step, client words only, ON, kill `__RAW_DISABLE_LATTICE_MODEL_STEP__`): green and
  clean, squash 89a494aca at 12:39:48Z. Closes the commitment at `ledger.d/claude--tail-download-flip.jsonl:9`.
- #600 and #590 last ran CI on 10-26 ~21:15-21:47Z, before seven dev merges, including #603, which moved the estate floor. Each
  got `git merge origin/dev`, a local run of its tests, a push and a fresh CI run before its merge:
  - #600 -> 859af1aea. No chain test landed since its derivation, so the projection held: chain lane "collected 2976 tests
    across 182 files -> 2976 passed" (run 40507434530). Squash 706657c19 at 13:24:38Z.
  - #590 -> 4d51214ff. Guards "collected 3418 tests across 213 files -> 3351 passed, 67 skipped" = its projection (run
    40508255379). The lanes are disjoint: `ci_test_lanes.py` puts `test_prune_shared_objects.py` in chain only. A merge-tree of
    dev-with-#600 and the branch is clean, with floors guards 3351, chain 2976, estate 3376, so #590's CI holds on the combined
    tree. Squash f179f495b at 13:28:40Z. `MANIFEST_ONE_ENTRY_PER_OBJECT` and `RESOLVER_SKIP_MISSING_OBJECT` stay OFF until the
    owner's word.
- #608 was CONFLICTING on SCOREBOARD.md: both sides had only appended rows. Kept all five in time order (diff vs dev: 3 added
  rows, 0 removed), d19461fd5, CI green, squash 4bd90d0d9 at 13:39:25Z.

## INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS=1 (lines 8-9)
- Baseline: core run 40476828243 (08:54Z dispatch). Its prune deleted **52** distinct EURO `global_coarse` estimated objects
  ("Pruned unreferenced product file"), 13 in each of waves, swell_1, swell_2 and wind waves. The sweep line read "pruned 25
  superseded products". There were 0 "Retained referenced object" lines. This is the 51-54 per cycle shape from the #590 log.
- 13:34:49Z: repo variable set, read back by `gh variable list`. All four lanes run on dev, the default branch, where #600's
  wiring now is.
- 13:35:25Z: Render env set (merge mode). Its deploy of dev f179f495b went live at 13:38:50Z. Health at 13:40Z: healthy,
  version f179f495b, 455 MB, 0 5xx of 27.
- Read-back is owed (commitment line 11, due 21:00Z). The 12:54Z core run started before the flip, and its env is read when
  its job starts. So the first prune with the variable set belongs to the next core run, the 16:54Z slot (its prune lands at
  about +55 min). No extra run was dispatched: core runs take 1.5-3 h here, and an extra one would only queue the 16:54Z slot
  behind it. The check is the baseline's instrument: 0 EURO `global_coarse` estimated objects deleted (baseline 52), at least
  one "Retained referenced object during prune", and no storage DELETE within ~10 min of a PUT for those objects.

## #610 live read (13:41-14:08Z, one scenario, dev--rawsurf, EURO waves, z9.0 Florida east coast)
- Health before (13:40Z): 0 5xx of 27. After (14:08Z): healthy, 0 5xx of 687, 640 MB.
- The bundle carries #610: chunk `1345.657383a5` holds the kill switch, and `__MARINE_DRAWN__` publishes `runMs` (the 06Z run) on
  a native frame.
- Probe in the page: Home, PageUp x5 to h120, then ArrowRight one hour at a time to h156. At each hour it records 2.5 s of
  the status words, the drawn frame and the time to settle.

| hours | what the status line did | drawn frame |
|---|---|---|
| 120-140, between frames | "Showing X: the nearest stored forecast (estimated)" in **50-84 ms** | the 3-hourly estimated frame |
| 123, 126, 129, 132, 135, 138 | "Loading" for **576-980 ms**, then the exact frame | same frame, store=false (`/grid`) |
| **141-155** | **"Loading X… still showing Mon, Nov 2, 4 AM" at all 15 hours** | stays 11-02T09Z |
| 156 (after the probe) | "Showing Mon, Nov 2, 10 PM: the nearest stored forecast (estimated)" | 11-03T03Z |

- **Found:** at z9, EURO hours 141-155 (11-02T11Z to 11-03T01Z) never draw.
  - Every step's `/grid` answered 200 in 123-776 ms (13:58:19-13:59:01Z), so this is not a network stall or a stuck request.
  - The CDN set EURO waves `global_mid` (run 00Z) has 11-02T06Z, 12Z, 18Z and 11-03T00Z built. At z9, though, EURO does not
    read the store: frame-store misses `crop_only_set` 24, and every step was store=false.
  - Not diagnosed live, because that would mean repeated asks of the box. Next, in the offline harness: find which served
    time `/grid` returns for EURO z9 asks at 11-02T11Z-23Z, and why the client does not commit it.
- **Verdict on #610:**
  - The wording is honest at every hour. "Loading X… still showing Y" names the frame on screen, so 0 silent mislabels.
  - The case #610 targets (native 6-hourly frames, model step past 144) did not arise here. Past h120, the z9 frames are
    estimated, with `runMs` null, so the rule used its timeline-hour fallback.
  - The stall above is a different defect, in EURO's z9 data path.

## INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS read-back (fulfils ledger line 11)
- First core run with the variable set: 40522297562 (scheduled, created 14:33:49Z, success 16:42:47Z; env line `INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS: 1`).
  - **0** "Pruned unreferenced product file" lines (baseline 52).
  - **56** "Retained referenced object during prune" at 16:07:34Z. The sweep line reads "pruned 56 superseded products": manifest entries were dropped and the objects kept.
  - So the cycle-end sweep no longer deletes a listed EURO coarse estimate, as #600's runbook says.
- Render logs 13:40Z-20:05Z: no `Dynamic L2 download failed` / `Stored product path not found` for any EURO object.
  - This is weak evidence: the box served about 2 requests per 5 min.
  - Eight such lines name GFS regional and `global_mid` objects for 10-27T00Z/03Z at 15:27Z. Those are past hours, another family.
- Health: 0 5xx (reads at 20:19Z and 23:37Z).
- **The storage clause of the check fails, on a second path that predates the flip.** Supabase edge logs, 13:35Z to 10-28 00:00Z: 56 EURO coarse estimated objects had a DELETE within 10 min after an upload of the same object.
  - Two sampled objects show the cycle: POST 15:33:40 (first writer) -> DELETE 15:33:45 -> POST 16:03:15 (second writer); again POST 17:42:05 -> DELETE 17:42:11 -> POST 17:53:02.
  - The pre-flip run has the same shape: POST 09:37:44 -> DELETE 09:37:46 -> POST 09:47:19.
  - These slots now miss for 10-30 min per cycle instead of ~3.5 h.
  - 7 objects were deleted with no later upload in the window. Whether the manifest still lists them was not readable (private bucket, no key).
  - The fix for this shape is #590's `MANIFEST_ONE_ENTRY_PER_OBJECT`: one object, one registrant, so a save never deletes a twin's file. Its serve-side net is `RESOLVER_SKIP_MISSING_OBJECT`. Both are merged dark and wait on the owner's word.
- Verdict: keep the flag ON; it removed the ~3.5 h gap. The remaining 10-30 min gap goes to the owner with #590's flags.

## Correction: the "z9 EURO h141-h155 never draw" finding (ledger line 10)
- The live tab's churn log shows the FPS guardrail tripped at **13:58:14Z** (`marine_webgl_fallback`, cause `fps_guardrail`, fps 1). That is 5 s before the probe's steps (13:58:19-13:59:01Z).
  - It recovered at 14:04:04Z. It also tripped at 13:52:28Z and 14:04:57Z.
- While tripped, `useWebGLGuardrail` swaps the WebGL marine layer for raster tiles, so nothing updates `__MARINE_DRAWN__`. The status reads "Loading X... still showing Y", which is exactly the observed stall.
- An rAF probe in the same tab at 20:28Z read **1.1 frames/s, maxDelta 1,015 ms, with `visibilityState` visible and `hasFocus()` true**.
  - Chrome was throttling the window. The guardrail reads that as a slow device, since 1 s deltas pass its 2,000 ms suspend gate.
- The z9 data-path diagnosis went to session `z9-euro-scrub-stalls-h14`, which was told the premise is now in doubt and to reproduce offline first.

## Test round 2026-10-27 (owner 16:40Z: "the most tests you've ever done ... erratic actions ... log everything")
- **Helpers:**
  - researcher session `researcher-instant-2`;
  - subagents: offline regression re-run on the tip, seeded erratic fuzzer, infobox-vs-heatmap audit, forensics/flags/Jacobian, E2E diagnosis.
- **Reviews:**
  - Reflection (Beam) reviewed the plan. Its five gaps went into the agents' briefs: real CDN path, real-browser timings, failure injection, golden values, rendered pixels.
  - Context7 (MapLibre docs): a frame counts as drawn on the next `render` after the commit, not on `idle`.
- **Hosted CI on dev 4bd90d0d9:**
  - frontend Jest: 562 suites, 7,245 tests;
  - marine composition guards: 144;
  - chain 2,976; guards 3,351 (67 skipped); estate 3,376;
  - lint/build green.
- **E2E has been red on every dev push since 2026-10-24.** The cause is a test fixture bug, not the app.
  - The seeded session has no token.
  - #496 bound `/api/compliance/violations/user/{id}`, and `ViolationBanner` asks for it on every page.
  - The 401 signs the session out two seconds later.
  - So hosted E2E has not exercised the map since 10-24. Fix: PR #617 (test-only).
- **Live scenario** (23:35Z SCOREBOARD row; one session, health-gated). The PC was loaded, so timings are pessimistic. Findings that do not depend on load:
  - **Request amplification:** 40 `/grid_series` + 11 `/grid` in about 10 actions.
    - Logfire server spans, last day: `/grid_series` n 151, p50 2.6 s, p95 24.5 s, max 29.4 s; `/grid` n 97, p50 0.9 s, p95 7.6 s, max 21.3 s.
    - This session's slowest series span took 22.96 s server-side (23:11:20Z).
  - **EURO/ICON at z9 go to `/grid`, not the store.** ICON waves ON took 4.6 s; the ICON->EURO switch took 5.3 s, with honest hold words.
  - **EURO swell_1 at z9 is drawn from a 10.313 deg coarse grid** (HUD "COARSE 10.313° GRID", CMEMS source). No user-facing words say so.
  - **"Estimated forecast: estimated"** showed for ~1.9 s after band OFF, on a transient estimated frame at a native EURO hour.
  - **The guardrail tripped 3 times** under main-thread load (tasks up to 7.0 s). After the third trip, EURO swell showed a **blank sea** under "Simplified wave layer - reduced graphics mode".
  - **Stale idle tab** (open since 13:41Z): the wheel label moved with the clock (+156 = 11-03T08Z) while the drawn frame stayed at 11-03T03Z. Its words gave a wrong reason: "beyond EURO's range".
- **Infobox audit** (subagent, offline at 4bd90d0d9; tests on local branch `claude/infobox-audit-1027`).
  - Verified: surf height and rating come from the one chain, and offshore height is never shown as surf.
  - **P1, client words/time** (fix session `infobox-honesty` started):
    - P1-C: no hour in the header, and the served frame is dropped.
    - P1-D: during a scrub the last settled hour shows unlabelled.
    - P1-E: hour math uses local wall-clock time. US DST ends 11-01, so values are one hour off past it.
  - **P1, served numbers (owner's call):**
    - P1-A: at EURO/ICON boundary hours (147, 153, ..., 243; ICON 171) the point serves the estimate while the heatmap serves the authoritative frame 3 h away (`MID_RES_EXACT_TIME_ESTIMATE` is dark).
    - P1-B: for ICON past wheel 168 the infobox blends in the browser, while the heatmap draws the stored D-055 estimate.
    - P1-F: size without quality by default (the rating toggle is off by owner decision, 2026-07-05).
  - **P2:**
    - EURO/ICON between nodes: the box reads up to 26% lower than the paint (vector-averaged direction; `SAMPLER_SCALAR_HEIGHT` is GFS-only).
    - Dark-theme height is floored to a byte and capped at 10 m.
    - The rating can come from an older run.
    - A client 0.96/0.97 bias factor acts as a second forecast path.
    - Decimals are inconsistent.

## #590's flags flipped (owner 2026-10-28 05:15Z / 01:15 EDT)
- Owner's word: "Flip MANIFEST_ONE_ENTRY_PER_OBJECT and RESOLVER_SKIP_MISSING_OBJECT per #590's runbook, then read them back on the next core run."
- Where each flag goes, per the registry in `backend/routes/admin/surf_forecast.py`:
  - `MANIFEST_ONE_ENTRY_PER_OBJECT`: the three manifest writers (forecast-ingest, forecast-ingest-pilots, precompute); "Render never writes".
  - `RESOLVER_SKIP_MISSING_OBJECT`: Render env.
- Done (ledger `claude--manifest-flags-wiring.jsonl` 1-4):
  - 05:39:12Z, Render env `RESOLVER_SKIP_MISSING_OBJECT=1`, plus `MANIFEST_ONE_ENTRY_PER_OBJECT=1`, which is inert on Render. Deploy dep-dbgol049v7es73b16j9g of dev 890623110 went live 05:42:17Z. Health after: healthy, 0 5xx.
  - 05:43:12Z, repo variable `MANIFEST_ONE_ENTRY_PER_OBJECT=1`, read back. **It is inert until PR #621 merges**: no workflow passed the flag, the same gap #600 closed for the prune flag.
  - The `RESOLVER_SKIP_MISSING_OBJECT` repo variable was set at 05:43:26Z, then deleted, because no workflow reads it (Render only).
- Baseline: the SCOREBOARD 05:39Z row.
- Read-back owed (commitment line 4, due 10-29 06:00Z), on the first core run created after #621 merges:
  - 0 save-time twin deletes;
  - `One entry per object` lines in the run log;
  - `Listed product(s) absent ... serving` on the box where a 404 followed before;
  - 0 5xx.

## Forensics at dev 4bd90d0d9 (subagent, read-only, reported 2026-10-28 ~08:30Z)
- **No fix since #387 has been undone by a later merge.** It checked the 133 marine commits since #387:
  - Every kill switch they added is still read in source. The four exceptions are intended: LIGHT_CREST_V2 (D-041),
    SWR_RETRY_CAP (superseded by #441), BEACH_CREST_STYLE (removed by D-045), SETTLE_RELOAD_GUARD (moved by #505).
  - Every pin test still exists; none is skipped or has fewer cases or asserts than at its merge. All 112 pins named in
    REGRESSION-MATRIX §4 are present.
  - #596-#610 extend earlier fixes rather than reverse them (read line by line).
  - origin/dev has since moved to 890623110; the three new commits are docs, ledger and CI only.
- **Weak spots (not regressions), each worth a guard:**
  - Six kill switches that no test exercises: BLEND_BOTH and CALM_WASH_HOLD (#430), WIND_SCRUB_GATE (#388),
    WIND_SAME_TARGET_JOIN (#393), WIND_PREBUILD (#468), RASTER_OWN_PREWARM (#511).
  - Three "kills" that tests clear but no source reads: COARSE_BASE_TIME_KEY, BEACH_CREST_V2, BAND_HOLD_LEGS.
  - `test_flag_lane_parity.py` checks lane drift only for names starting RATING_, SURF_, MARINE_, SPOT_RATINGS_,
    SHORE_NORMAL_ or ECMWF_. Drift in FRAME_*, GFS_*, INGEST_*, MANIFEST_* or RESOLVER_* goes unseen.
  - SAMPLER_SCALAR_HEIGHT and FRAME_WIND_GFS_HOURLY change served numbers but are not in `_RATING_FLAGS`.
  - `REACT_APP_ICON_STORED_TAIL` is set only for dev branch deploys (`netlify.toml`), so D-055's ICON tail frames help
    dev only until production gets it.
  - GRID_SERIES_PAGE_MEMO behaves as on live but has no flip record (commitment 1459 is overdue).
  - REGRESSION-MATRIX said FRAME_TAIL_DOWNLOAD was "not yet flipped". That was true when the matrix ran; both lines now
    carry the D-055 flip time (this PR).
- **Cells still on the slow `/grid` path (code at 4bd90d0d9), ranked by effect on what the owner reported:**
  1. Band ON: every scrub leaves the frame store (`staticFrames.js` refuses surf, `marineFramePack.js` refuses rating
     mode). Live: band ON 4.4 s, and band ON plus a switch took the box to 1,056 MB.
  2. EURO and ICON at z7 and closer (span 12 degrees or less): regional bundles are GFS only (`REGIONAL_MODELS`), and
     crops need at least 12 degrees. Live z8 switches: ICON 894 ms, GFS 491 ms.
  3. Swell and wind-wave layers never become GPU-resident (`marineFramePack.js` refuses non-waves): 0.2-0.8 s per step.
  4. EURO swell_1, swell_2 and wind_waves have no 2-degree product, so they have no frame set.
  5. GFS regional past h116 in 16 of 19 pilot boxes (the pilots publish 5 days).
- **Unverified candidate, to test offline before blaming it:** #610 taught EURO's 6-hourly steps to the readouts only.
  Three gates still use 1.5 h: the series nearest-frame tolerance (`marineGridSeries.js`), `SAME_STEP_TOL_MS`
  (`marineStaleHour.js`) and `EXACT_UPGRADE_HOUR_TOLERANCE` (`marineExactUpgrade.js`). The 10-27 z9 stall was the
  guardrail (correction above), so this is a separate question.
- A read-only live script (S1-S11, about 30 owed read-backs) was written but not run: it is longer than the one short
  live scenario the rules allow.

## Offline regression re-run at dev 4bd90d0d9 (subagent, 2026-10-27 20:10Z to 10-28 14:55Z)
- **No matrix row regressed.** Where timing was in doubt, a same-window control build at 4b8563851 agreed with the tip.
  - Run size: 148 driver runs and 321 browser sessions. 0 requests reached the live backend: 17,894 onrender.com asks
    were answered locally. Jest 7,233/7,245 (one environmental timeout); pytest 253 passed.
  - New rows pass against their controls:
    - #601: EURO/ICON mid-zoom drags 12/12 vs 1/12.
    - #602: 0 blank frames vs 387 at a held switch.
    - #610: 96/96 EURO 6-hourly band hours, p95 41 ms, 0 stuck vs 6 stuck.
  - All four owner cases pass on the tip: band_off 27 ms, icon_far 2-17 ms, euro_switch 0 blank, euro_240 every step
    exact in 41 ms or less. euro_240's scenario exit is an instrument criterion.
- **Infobox vs heat map: three problems, all present in both builds (not regressions):**
  1. **ICON card goes blank** ("Offshore swell height --", `no_coverage`, no `/point` ask, no recovery) whenever the
     nearest stored ICON frame is earlier than the selected hour. Likely cause: the `iconLimit` gate in
     `forecastSamplers.js`, introduced 2026-06-08. Routed to the infobox-honesty session as a separate PR.
  2. **EURO and ICON cards under-read** where wave directions diverge. `/point` reports the height as |bilinear(u, v)|
     while the heat map shows the scalar height. At 15.5 N, 108.5 W the card read EURO 4.00 m vs map 7.85 m and ICON
     3.47 vs 6.82. `SAMPLER_SCALAR_HEIGHT` covers GFS only (on since 10-17), so this is live for EURO/ICON. It is an
     owner decision.
  3. **Past ICON's native range** the card blends anchor fetches in the browser while the heat map draws the stored
     D-055 tail: +23% at h250 and +11% at h300 at 21.5 N, 118 W (infobox P1-B, owner decision).
- **z9 open ocean (EURO and GFS alike), hours 141-155:** offline steps take 3.8-8.3 s, with honest
  "Loading ... still showing" words, because each waits on the dynamic viewport `/grid`. It is neither EURO-specific
  nor new (the control matches). Florida z9 draws from the store in 1-20 ms. Same root as the forensics slow-path
  cell "outside any pilot tile at z7+".
- **Instrument faults found and fixed on the harness branch (not pushed):** silent-word regexes lacked "Holding" and
  "not arriving"; `scn_static_parity` gained a `SETS_RE` filter. Still open: euro_240's relabel criterion, series-frame
  dating on a 3-hourly hour 0, `__MARINE_SOURCE_PARITY__` UNSAMPLED on every row, and the offline store missing the live
  GFS `SAMPLER_SCALAR_HEIGHT=1`.

## #590 flags read back on the first core run after #621 (fulfils wiring fragment line 4)
- **Merges, on the owner's word:**
  - 13:10Z message: #621 (f54e9e7cb, 13:16Z), #615 (4d870741e, 13:25Z), #617 (072fdc78d, 13:32Z).
  - 15:54Z message: #613 (f6bc565f3), #625 (431a3bcc1), #622 (e44b93fd4) and #612 (ea9608095).
  - Each was squash-merged pinned to its tested head.
- **Dev E2E is green again:** run 40697429549 on 072fdc78d passed 67 tests with 9 skipped, the first green dev E2E
  since 10-24.
- **The run:** forecast-ingest 40712941855 was created 15:08:36Z on dev 395a927bc (after #621) and finished with
  success. The run that started 12:57Z began before the merge and does not count.
- **Every clause of the check passes:**
  1. The run's env line reads `MANIFEST_ONE_ENTRY_PER_OBJECT: 1`.
  2. At 16:28:01Z the run logged `One entry per object: dropped 56 older registration(s) of objects just rewritten`.
     56 is the twin count the 05:39Z baseline measured.
  3. 0 EURO coarse estimates were deleted within 10 min after an upload of the same object (baseline 56). Instrument:
     Supabase `storage_logs` lifecycle events, `ObjectRemoved:Delete` joined to `ObjectCreated:*` on `objectPath`,
     15:08Z-17:20Z. Example: `euro_marine_waves_global_coarse_20261107T030000Z_estimated.json` was rewritten at
     16:05:50 and only its overwrite cleanup followed. It was not deleted.
  4. The box logged 0 `Listed product(s) absent` lines and 0 `Stored product path not found` lines from 05:42Z to
     18:15Z (Render logs). The baseline was 39 not-found lines in the 24 h before. Traffic was light, so the serve-side
     net never had to fire.
  5. Health at about 18:10Z: 0 5xx of 3,218 requests since the 16:25Z restart (backend e44b93fd4).
- **A separate, older gap, not this flag's shape:**
  - EURO coarse ingestion's save prunes superseded products: 42 waves and 27 each of swell_1, swell_2 and wind_waves
    (`Manifest L2 uploaded submit after pruning N superseded products`, 16:05:44-16:05:56Z). It deletes the previous
    run's estimated tail files.
  - 112 objects were removed at 16:05:52-16:06:32Z, created at 13:54Z by the pre-merge run.
  - The estimates stage re-creates them 22 min later (POST, 16:28:19Z onward).
  - These entries leave the manifest with their files, so nothing listed went missing (0 `absent` lines).
  - For about 22 min each cycle, EURO tail hours past the new run's GFS extension have no estimated product on the
    `/grid` path. The CDN tail frames (D-055) are separate objects and unaffected.
  - Candidate fix, not built: prune superseded estimates only after the estimates stage writes their replacements.

## Offline erratic fuzzer at dev 4bd90d0d9 (subagent, 2026-10-27 to 10-28)
- **Run size:** 126 seeded sequences × 60 actions (63 phone, 63 desktop; 8 profiles); 1,649,580 rendered frames checked
  against 8 invariants, plus run-rollover scenarios and about 40 repro/shrink replays.
  - The live box was never touched: 28,465 onrender asks were answered by a local proxy and 1,719 sockets closed.
  - Each worker had its own offline backend, and those still answered `/grid` at p50 2-11 s. So `/grid`-path timings
    are not client claims.
- **inv8 timing, last input to first exact rendered frame:**
  - GPU frame store: p50 9 ms, p95 44 ms, 0 over 500 ms.
  - Series: p95 8.4 s. `/grid`: p95 11.4 s.
  - Only 9% of settled steps came from the store. Layer toggles went to `/grid` 106 of 123 times.
- **Distinct defects (minimal repros 3/3 unless noted):**
  - **D1 Silent mislabel: the background wash comes from another hour or run** than the frame drawn over it, in 75 of
    84 sequences. Offset p50 42 h, max 327 h; lasts p50 6.3 s, max 81 s; once it mixed the 00Z wash under a 06Z
    tile.
    - Example: GFS Florida z8, PageUp ×2 → the h48 regional tile over the h0 world wash, worded "the nearest stored
      forecast".
    - Likely cause: the coarse-base LRU key has no hour or run (`WebGLMarineEngine.js` `coarseBaseLruKey`,
      `pickCoarseBaseLruKey`), and blend-both engages on model and layer alone.
  - **D2 Blank sea for 5-21 s** after a camera move plus a time step, while the status says "Loading X… still showing
    Y". The engine clears its frame, and `__MARINE_DRAWN__` has no clear path for marine.
    - Repro: phone, ICON Florida z5.2 → h191 → ease to SoCal z6.1 → Home.
    - The ICON world frame was resident on the CDN but not used as a fallback.
  - **D3 Cold veil:** the heatmap is fully transparent for about 3.9 s after the first frame arrives (219 episodes),
    under "Showing …" (`resolveColdVeil` 4 s grace). By design, but it is not instant and is not worded.
  - **D4 The infobox shows another model's numbers under the selected model's name** (4/4 with a slowed `/grid`).
    - `/point?model=EURO` was sent with a GFS `grid_product_id`, and the backend answered GFS 1.1309 m under a "EURO
      Forecast" header. EURO's own value was 1.1987 m.
    - `useExactPointFetch.js` and `useOpenMeteoForecast.js` pass the grid's product id without checking its model and
      layer, and the backend accepts it.
  - **D5 Surf Rating OFF race** (about 1 in 10, not reproduced 0/10): a late rating grid committed after OFF, then
    "Loading wave heights…" stayed with nothing in flight for about 30 s. The fetch intent carries no Surf Rating
    flag.
  - **D6** After a phone rotation, the now-visible desktop panel's Surf Rating button reads OFF while the band is ON.
    Each panel keeps its own `useState`.
  - **D7 Surf Rating grids are labelled estimated:** `/grid?surf=1` returns `is_estimated: true` with no basis
    (`grid_resolver_surf.py`), so an hour-0 frame reads "Estimated forecast: estimated".
  - **D8** EURO's "nearest" rule is 3 h for every layer past step 144 (`latticeNearestMaxHours` keys on the model
    only): 92 episodes, one held 22.5 s.
  - **D9** 118 bursts of the same successful ask ×3 or more within 30 s. Owner not pinned.
  - **D10** A `/point` flood while scrubbing a non-marine layer (`useOpenMeteoForecast`: no debounce, 1-3 asks per
    wheel hour). It also pairs the user's location with the view's `grid_bbox`.
  - **D11** After a WebGL context restore: one blank frame plus one frame at opacity 0 (142-324 ms).
  - **D12** Intentional aborts are logged with `console.error` (over 100 per batch). One page error: `getLayer` of
    null in an `OceanMask.js` deactivation timer, after Wind on plus context loss.
- **Rendered pixels** match the legend colour in 393 windows (error ≤ 12/255; the positive control reads 40-80).
- The harness (`scn_erratic_fuzz.js` and its probe, pixels, report and selector-loop backend) is on local branch
  `claude/erratic-fuzz-1027` (fc033f5c1), not pushed.
- **Routing:** D1, D2, D3, D5, D6, D11 and D12 went to the z9/guardrail session (engine and drawn-frame context).
  D4, D7, D8 and D10 went to the infobox-honesty session (point and words context). D9 is open.
