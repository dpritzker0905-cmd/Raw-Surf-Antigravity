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
