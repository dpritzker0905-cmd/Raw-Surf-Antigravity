# 2026-11-17 — opus: PRODUCT_RUN_KEYED_NAMES and FRAME_WIND_GFS_HOURLY ship ON (the owner's yes)

Session: the frame-carry side session. The owner answered in this session at 08:36 EST: "Yes, both". He was asked whether to
turn on hourly GFS wind and run-keyed product names, after being told that the run-keyed rollout changes a Render setting first
and then watches storage cleanup. Written 13:55Z.

## PRODUCT_RUN_KEYED_NAMES, in the order of its own rollout (log 2026-11-01-claude-run-keyed-products.md, "Migration")

1. **Render env first (done).** `PRODUCT_RUN_KEYED_NAMES=1` was set on srv-d7fhiu7lk1mc73debje0 at 13:47Z.
   - It triggered deploy dep-dbu5lurm8hqs73e6s6dg, live 13:50:10Z, at 2fcbd8153 (#1003).
   - The previous live deploy was 38c9060fc (#1000). The only server change carried along is 5 lines in the offline
     wind-hindcast `ens_wind_fetch.py`.
   - `/api/health`: 200 in 1.28 s at 13:46:28Z (before), 200 in 0.69 s at 13:51:24Z (after).
   - On the box, the flag drives only the disk sweep, which sheds run-keyed files the manifest no longer names. It is
     harmless while no run-keyed names exist.
2. **The writers (this PR).** forecast-ingest, forecast-ingest-pilots and precompute default `'1'`; the kill switch is the
   repository variable `PRODUCT_RUN_KEYED_NAMES = '0'`, which is David's word, or a revert of this PR.
   - `test_only_the_canonical_on_value_enables_it` proves '0' (and unset at code level) saves the legacy name, the
     pre-flip output.
   - The code default (`product_run_keys.enabled`, the registry's "0") stays off. Only the three writers and the box turn
     it on, so tests and local runs keep legacy names.
3. **Measure after merge, as the rollout says** (owed; this session does it):
   - one GFS pilot box on the live box across two runs: its `run_time` follows the manifest within one restore;
   - `Product object GC: {...}` in the ingest log;
   - the storage object count flat across cycles;
   - 0 "Stored product path not found" for run-keyed names.
   **Rollback:** the repo variable to '0'. The Render flag may stay on. Leftover run-keyed objects stay until
   `scripts/sweep_orphaned_l2.py --delete --yes`.
   **Storage before:** weather-products 60.55 GB / 25,288 objects (read-only aggregate, 2026-11-17 ~06:45Z).

## FRAME_WIND_GFS_HOURLY: its own PR, under D-065

It moves a served number: the wind between the 3-hourly steps becomes NOAA's own hourly field to f120, so the ratings that
read wind at those hours move too. So it ships with its code default ON, a kill switch, its registration in `_RATING_FLAGS`, a
SCOREBOARD row, and the default-on history filter before merge. It also adds about 80 hourly wind frames to the FRAMES
step, inside #996's 1,500 s. The first pilots run after it merges rebuilds the wind set with new hours, so under the
frames-budget plan's item 3 it is excluded and named before its gate lines are read.

## 16:20Z: step 3 written before merge (the advisor's condition, 16:17Z), and a blocker found while sizing it

### Peak storage: measured, and it does not fit the GC as configured

Read-only SQL over `storage.objects` (bucket weather-products, production project), ~16:30Z:

| weather-products | objects | GB | rewritten in the last 4 h | new names created in 24 h |
|---|---|---|---|---|
| top-level product objects (the GC's domain) | 21,803 | 9.04 | 18,262 (8.30 GB) | 1,961 |
| nested (snapshots, manifests, calibration, ...) | 3,327 | 51.56 | 242 | 289 |

- **Today**, each 4-hour cycle overwrites about 18,000 product objects IN PLACE under the same legacy name. Storage stays flat.
- **With run-keyed names**, every such write whose run or content changed is a NEW object. The old one waits for the GC.
- **The GC deletes at most `PRODUCT_GC_MAX_DELETE` = 500 objects a sweep.** It sweeps only in `ingest_forecast_ci.py` (core every
  4 h, pilots every 8 h), so about 750 deletes per 4 hours. No workflow raises the cap.
- **Projected growth**, if 25-100 % of the 18,262 writes per cycle carry a new run or content:
  - +4,600 to +18,000 objects and about +2 to +8 GB per 4 hours, against 750 deletes;
  - so about **+12 to +50 GB a day**, from 62.6 GB of the Pro plan's 100 GB included;
  - the allowance is passed in about 1 to 3 days.
- The design log's own reopen line, "storage growth exceeds one extra run of objects", would trip within the first day.
- **The expected peak with a GC that keeps up:** each superseded object lives two sweeps a grace apart, so legacy + current +
  marked coexist, about 9.0 + 2 x 8.3, so about **26 GB of top-level products (+17 GB), about 79 GB in all**. That is only
  reachable if the cap is at least the number of objects superseded per sweep.

**So #1005 must NOT merge as it stands.** The fix is a decision for the advisor and David, not made here:
- raise `PRODUCT_GC_MAX_DELETE` in the env of the GC-running lanes (forecast-ingest, forecast-ingest-pilots) to at least twice the
  objects superseded per cycle (about 40,000), with the head-size, 95 % and grace guards unchanged;
- or sweep in batches.
Either way, the change deletes up to tens of thousands of production objects per sweep (only unreferenced and already marked
ones). First measure the real new-object rate: one cycle with the flag on in ONE writer, counting `created_at` per cycle.

### The trip rule (a kill = the repository variable PRODUCT_RUN_KEYED_NAMES = '0', David's word, or a revert)

Any one of:
- one "Stored product path not found" for a run-keyed name in an ingest or box log;
- the top-level product object count not back within one run's worth (about +18,000) of its pre-flip 21,803 after two sweeps;
- the bucket total rising more than 10 GB above 60.55 GB;
- a GC summary showing `deleted` pinned at the cap two sweeps running.

### The served fact this fixes (SCOREBOARD row added)

A pilot tile's `run_time` on the box. The Cocoa Beach GFS tile served the 10-30T18Z run for 51 h while storage and the manifest
had moved on (log 2026-11-01-claude-run-keyed-products.md). After the change: it follows the manifest within one restore.

## 22:13Z: the blocker fixed: a 25,000 cap with two fuses, and batched deletes (David: "fix and rechain and merge and push #1005")

David, typed in this session 2026-11-17 16:23 EST: "We need to fix and rechain and merge and push #1005 and more". Then:
"Also others that have conflicts too".

**The fix** (`product_object_gc.py`, per the advisor's 16:39Z condition that a higher cap needs a second fuse in the same change):
- **The cap:** `PRODUCT_GC_MAX_DELETE` default 500 -> 25,000, just above the ~21,800 live top-level product objects.
- **FUSE A, the head shrank:** the whole sweep is refused when this sweep's referenced set is under
  `PRODUCT_GC_MIN_REFERENCED_RATIO` (0.8) of the previous sweep's. The previous count is now kept in the marks blob. This catches
  a manifest read empty, truncated or partial.
- **FUSE B, too much at once:** the whole sweep is refused when the planned deletes exceed `PRODUCT_GC_MAX_DELETE_SHARE` (0.6) of
  the listed product objects. In steady state a core sweep deletes the previous cycle's ~18k superseded objects of ~58k listed,
  about 31 %.
- **Both refusals** log "[Product GC] sweep refused: FUSE A/B: ..." and leave the marks unchanged. A refused sweep only delays
  deletes.
- **A stale but complete published head** cannot delete current objects: the sweep unions it with the writer's own manifest. That
  is unchanged.
- **Deletes are batched,** 1,000 names per Storage bulk-delete REST call, behind the designated-writer gate. A failed batch falls
  back to one DELETE per object. This was added because 18,000 sequential DELETEs would add many minutes per cycle.
- **Tests:** +5 in `test_product_run_keys.py` (chain lane, fragment +5):
  - FUSE A trips at 79/100 and passes at 80/100, unarmed with no previous count;
  - FUSE B trips at 7/11 and the cap clips first at 6/11;
  - bulk batches of 1000/1000/500, the per-object fallback, and no bulk call without the writer gate;
  - the previous count is read back;
  - the defaults.
- **Mutants**, each 1 red: Fuse A removed, Fuse B loosened to 0.99, the gate dropped from the bulk path.

**Still owed, at the first forecast-ingest cycle after merge** (David is reachable; this session watches it):
- the `[Product GC]` summary: listed, referenced, marked, deleted, bulk_batches, or a FUSE refusal;
- the top-level object count against 21,803 and the bucket against 60.55 GB;
- 0 "Stored product path not found".
The trip rule above stands. A kill is the repository variable PRODUCT_RUN_KEYED_NAMES = '0' or a revert.
