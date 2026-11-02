# 2026-11-01: ingest items 13, 14, 15 and the EURO boundary-hour gap (Claude, side session of the lead)

Session started by the lead (`local_d6b521eb`). Base: `dev` 340e70c07. All work is ingest-side and DARK; nothing was
dispatched, flipped or pushed (pushes held for Codex PR664). Instruments were read-only: GitHub Actions run logs
(`gh run view --log`) and read-only SQL on `storage.objects` (names and timestamps only, no object bodies).

## 1. EURO boundary-hour gap (+147 / +153 h): verified, and the cause is NOT the one expected

**Measured (storage, 2026-11-01 ~23:40Z, EURO run 11-01T12Z):**
- EURO waves natives at both global tiers are three-hourly to 11-07T12Z (+144 h), then six-hourly (11-07T18Z,
  11-08T00Z, ...), as ECMWF open data publishes.
- There is NO object at 11-07T15Z (+147) or 11-07T21Z (+153) at `global_coarse` or `global_mid`, estimated or not.
  The only EURO waves objects at those times are the two regional estimates (florida_east_coast, socal).
- Every in-band slot is empty: the `_estimated` objects at both global tiers start at 11-11T15Z (the 10-14 d tail).

**The lattice fill skipped them.** Its summary line, per core run (`[Lattice Fill] In-band lattice fill complete`):

| run | time (Z) | interpolated frames saved |
|---|---|---|
| 41010951572 | 10-30 06:52 | 32 |
| 41077298522 | 10-30 16:14 | 36 |
| 41126274808 | 10-30 23:11 | 32 |
| 41174097170 | 10-31 07:16 | 34 |
| 41210667209 | 10-31 15:34 | 32 |
| 41244954940 | 10-31 22:46 | 32 |
| 41275131520 | 11-01 05:52 | **3** |
| 41309033192 | 11-01 13:52 | 28 |
| 41347283478 | 11-01 21:32 | **2** |

(Every third successful run sampled.) A full cycle is ~32: 16 EURO waves slots (+147..+237 h) at each global tier. A
synthetic lane with ECMWF's cadence gives 16 slots from `find_fill_slots`, first 147 and 153.

**Why it skipped:** run 41347283478's EURO coarse prune (21:11:33Z) tried to delete last cycle's fill product
`euro_marine_waves_global_coarse_20261107T150000Z_estimated.json` and storage answered `NoSuchKey` (21:11:41Z,
`L2 delete failed ... Object not found`): the manifest was listing an object that was already gone. 45 such failures
this run (21 EURO waves coarse, 2 waves mid, 4 components). 20 min later the fill still treated the slot as filled.
The core lane (20:31-22:15Z) and the pilots lane (20:29-21:53Z) ran at the same time and both publish the manifest;
`absorb_published_head` folds the other writer's head back in, so an entry one lane pruned returns from the other's
publish. The exact path of the re-entry is inferred, not traced (the manifest is a private object and was not read);
what is measured is a listed entry whose object is absent, and a fill that skipped the slot.

**Codex's 10-19 cause (stride 3, nine-hourly tail) is real on current dev too, but it is a different gap.** The same
run logged 9 `NON-fillable hole` lines, all 9 h: EURO swell_1, swell_2 and wind_waves `global_coarse`,
11-16T09Z..11-17T12Z, the end of the 10-14 d tail past the extended-estimates reach. Waves coarse estimates end
`... 1116T06 1116T12 1116T21 1117T06` (9 h spacing). Codex's fix exists dark (`EURO_MARINE_NATIVE_TAIL_CADENCE`) but
was not in any workflow.

## 2. Item 15: prune before replace (mechanism read in code)

`prune_superseded_products_helper` (copernicus_validator.py) supersedes an estimate as soon as the lane holds ANY
newer estimated generation. The EURO coarse save writes a short GFS-ext tail (16-18 files), so its prune drops the
whole previous estimated generation; the extended-estimates stage rewrites those hours ~17-22 min later (this run:
coarse prune 21:11:33Z, estimates saved 21:28:58Z). The 10-27 log measured 112 objects deleted at 16:05:52Z and
re-created from 16:28:19Z.

## PR 1 (draft, branch `claude/euro-estimate-continuity`): three dark flags

- `INGEST_PRUNE_ESTIMATES_AFTER_REPLACE` (both ingest lanes, default 0): an estimate is superseded only when a
  replacement exists AT ITS VALID TIME (an authoritative product, or an estimate of a newer run). Estimates are
  time-keyed, so the rewrite overwrites the same object; `INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS` (on since 10-28)
  keeps the object when a newer registration names it. Inert when `INGEST_PRUNE_PRESERVE_ESTIMATES=0` (the purge lever).
- `LATTICE_FILL_REFRESH_STALE` (both lanes, default 0): the fill counts its OWN interpolations
  (`source_dataset == estimated_interpolation`) made from an older native run than the lane's newest as missing, and
  regenerates them. Extension estimates (the 14-day contract) are never displaced. Global tiers only.
- `EURO_MARINE_NATIVE_TAIL_CADENCE` wired into `forecast-ingest.yml` at '0' (Codex's code, unchanged).
- The first two are needed together: with prune-after-replace alone, a stale fill would be kept and never redone.
- Tests: `tests/test_estimate_continuity.py`, 12 (chain lane; floor 3019 -> 3041, set from 3047, files 185). Local run
  of it plus the fill, prune, lattice, recovery and flag-parity suites: 224 passed (local env lacks 4 declared
  packages; hosted CI is the authority).
- **Served numbers:** none while dark. Flipping the first two restores products that should exist (no new values);
  flipping the cadence flag adds three-hourly EURO 10-14 d estimates where nine-hourly ones are served today, so it
  needs a SCOREBOARD row and the owner's word with evidence (D-001).
- **Not fixed here:** the two-writer manifest re-entry itself. The flags make the outcome self-healing each cycle; the
  root fix (a writer folding back another writer's pruned keys) is a manifest-protocol change for the lead.

## 22:10-23:05 EST: flipped ON by default (owner's word, D-060)
- The owner (via the lead, 22:10 EST): measured features ship ON with a kill switch. All three #675 flags now default '1' in code,
  `_RATING_FLAGS` and both ingest workflows; '0' (repo variable of the same name) is the kill switch.
- **The flip found a defect in the dark build:** `_replaced` let any native at an hour replace an estimate there, even a native of an
  OLDER run. `tests/test_manifest_one_step_absorb.py` P5 (natives at r1, another writer's estimate at r3 under the same key) went red:
  the prune deleted that writer's fresher object. Fix: a native replaces an estimate only from a run at least as new.
- Tests that pinned the old est-vs-est rule now set the kill switch explicitly (`test_prune_duplicate_valid_times.py` x2, my own off
  test); `test_local_forecast_recovery.py`'s unset row now expects the no-op classification. Local: 630 + 289 passed.
