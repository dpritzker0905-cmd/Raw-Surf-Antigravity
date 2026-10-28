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
