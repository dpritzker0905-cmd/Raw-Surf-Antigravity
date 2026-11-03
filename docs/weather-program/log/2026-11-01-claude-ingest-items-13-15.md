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

## 2026-11-03 UTC (2026-11-02 evening EST): Rollout v2, the safety patch (owner: "Build v2 as a draft")
Authority: the owner's words 2026-11-02 20:47 EST, "Build v2 as a draft" (plan v2 after Codex's independent review of v1). Build
and push to the draft only: not merge authority, no workflow dispatch, no variable flip, no Render/Netlify change.

**Design** (`backend/services/weather_pipeline/rollout_675.py`, `_io.py`, `_finish.py`, `_reader.py`, `_restore.py`;
`backend/scripts/restore_rollout_snapshot.py`). The three #675 flags stay default '1' (kill '0'); in the hosted lanes they now run
only behind these steps:
- **Preflight** (`begin_run`, called by `scripts/ingest_forecast_ci.py` after the pre-ingest restore): BLOCKED unless both
  prerequisites (`INGEST_PRUNE_PROTECT_REFERENCED_OBJECTS`, `MANIFEST_ONE_ENTRY_PER_OBJECT`) are '1' in the lane's own env, the
  verified-cycles bypass is off, the status object and the published head are readable, and the last run left no "entries lost
  after publish", no bounds breach and no RUNNING marker (a run that died before its read-back). Any preflight error = BLOCKED.
- **Dry run per operation** (each prune call, the fill batch, each EURO tail layer): the plan (writes, overwrites, deletes) is
  checked before the operation's first mutation: no filename to delete is named by a retained registration of ANY lane in a freshly
  read published head; every expected slot is covered (prune: each pruned estimate's hour; fill: the slots `find_fill_slots`
  computes; tail: the source cycle's own times x cadence, three-hourly with (3) PROMOTED, nine-hourly otherwise; never a fixed range
  or count). The run's data does not exist at T+0, so the plan is per operation, checked before that operation mutates anything.
- **On pass: snapshot -> write -> publish -> mark.** Every touched object is copied to `snapshots/<lane>/<cycle_id>/<filename>`
  (storage copy API `client.storage.from_(bucket).copy(from_path, to_path)`, checked through Context7; download-then-upload when it
  raises) and READ BACK by sha256, plus the pre-publish head (`_manifest.json`) and an index (`_index.json`), all before any write,
  publish or delete. A snapshot that fails partway = BLOCKED, no mutation. A delete whose stored bytes are a different run than the
  registration being pruned aborts (a torn key). Deletes are only MARKED: `product_object_gc.plan_sweep` (new `only=` scope; its
  guards still read the whole listing) deletes a mark after two sweeps >= 2 h apart while the merged head + local manifest do not
  name it (`product_gc/marks_675.json`). Legacy time-keyed names already fit the GC's product grammar, so no name adapter is needed;
  the only adapter is the scope (the run-keyed GC itself stays off with `PRODUCT_RUN_KEYED_NAMES=0`).
- **Reader proof gates (2) and (3) (PROMOTED); (1) alone runs SAFE.** The EURO marine `/capabilities` row reports `reader_protocol`
  (1), `commit` and `revision_probe` (the canary `ops_rollout675_canary.json` loaded through `ProductStore.load_product`, memo 60 s).
  The owning lane rewrites the canary under the SAME key at the end of every SAFE/PROMOTED run (fixed valid time, new run_time, so
  #684's refresh treats it as a newer registration of the same frame). Run N opens the gate only if ONE 5 s GET shows protocol >= 1
  and run N-1's canary revision, and run N-1's sampled audit (10 touched keys plus the canary, expected run_time + sha256) passed.
  Horizons unchanged (a test pins it). The deployed a8 reader reports none of these fields, so the gate is closed until a deploy.
- **The lane race.** Owner = core (`INGEST_PILOTS=skip`): it writes the EURO coarse estimates (the EURO coarse job runs only there)
  and the in-band fills (the fill runs in pilots only with the dark `LATTICE_FILL_AFTER_PILOTS=1`). The pilots lane runs none of the
  new rules; while any flag is requested its reconcile takes the head's copy of owned entries (no ghost folded back), its prunes and
  duplicate sweep skip them, and it fills no global lane. After publishing, the core lane flushes the publish queue and reads the
  head back: a written key without an entry of our run (or newer) = "entries lost after publish" -> the NEXT run is BLOCKED.
- **Observable states** BLOCKED / SAFE / PROMOTED / RESTORED (+ the RUNNING marker) with reasons and counters in the step summary
  and `ops/rollout_675.json`. Growth (manifest count vs the baseline median, x1.10) and duration (+15 min) are observe-only for the
  first 6 cycles (rolling baseline in the status object); after that a breach blocks the next run.
- With all three flags '0' every hook is inert (no I/O; a test compares manifests and deletes byte for byte). With no run context
  (unit tests, local tools) the flags behave as #675 shipped them.

**BLOCKED scope.** BLOCKED holds the #675 rules only: no estimate is pruned at all (neither the new rule nor the old one), no
in-place fill refresh, the legacy tail stride. The pipeline's pre-#675 behaviour continues (the authoritative prune, normal
writes, the cycle-end duplicate sweep).

**Recovery limits.** No bucket versioning: snapshots keep the last 2 cycles per lane, and only the objects the new rules touched.
The restore script runs on demand only. It refuses (regenerate instead) if the lane has a newer cycle, if the shared head holds on
any touched key an entry of ANY lane newer than the snapshot recorded, or if a touched object's storage sha256 is not what the
snapshot recorded as written; it re-reads the head just before republishing. A reader's stale DISK copies are cleared only by
#684 + `PRODUCT_REVISION_REFRESH=1` or a restart. A cancelled or crashed run leaves the RUNNING marker, so the next run is BLOCKED
once.

**Residual risks (stated, not solved).** (a) No compare-and-swap or lease across the lanes beyond the one-step publish CAS. With
`MANIFEST_PUBLISH_ONE_STEP=1` the pilots merge (and its owned-entry deference) runs inside each CAS attempt against the exact head,
but a loss is still caught one run late, by the read-back. (b) The scoped GC deletes on a head read at sweep time; a registration
landing between that read and the delete is not seen (the same window as #685's GC). (c) The restore's head re-check narrows the
window against a concurrent publish; it does not close it. (d) The canary is a manifest entry (model OPS, domain ops, region
ops_canary): consumers that list every product see one extra entry. (e) Cancelled runs block the next run once.

**Reflection (Beam, high effort) attacked the ordering and the race; changes made:** the RUNNING marker (a run that dies between
its writes and its read-back blocks the next one); the torn-delete check; the canary always audited with its storage sha256 and its
content revision; the restore re-reads the shared head before republishing. Not taken, with reasons: a lane-scoped merge inside the
publish protocol (the owned-entry deference already runs inside each CAS attempt; changing the protocol is the lead's
manifest-protocol item); a flush after every operation (each publish re-downloads the ~15 MB head; the RUNNING marker and the
read-back cover the crash case); a content-hash probe revision (the probe's revision is already read from the loaded bytes).

**Tests:** `backend/tests/test_rollout_675.py`, 41 (chain lane). Floor: dev run 41549383722 read 3172 / 188 files; base 3172 + 53
(this PR: #675's 12 + 41) = 3225, files 190, floor 3219 (`ci.yml` and `_FLOOR_SET_FROM` together). Mutation checks: the BLOCKED
guard off (8 fail), the order swapped (5 fail), mark-before-publish (2 fail), the restore's newer-head check off (2 fail).

**Served numbers:** this patch moves none itself (it gates when the #675 rules run): no SCOREBOARD row. **Approvals still
needed:** (1) the merge of the exact head, on the owner's word; (2) a deploy window for the reader (this build's `/capabilities`
fields, with #684 + `PRODUCT_REVISION_REFRESH=1`) and one read-back of `revision_probe`; without it the gate stays closed and the
core lane runs SAFE (flag 1 only); (3) standing operator authority to run `restore_rollout_snapshot.py --yes` and to set the three
kill variables to '0'.

## 2026-11-03 UTC: restore revalidation fix (Codex recovery review of be474a8b7, P2); corrects "Recovery limits" above
**What was wrong at be474a8b7.** `rollout_675_restore.apply_restore` trusted the operator's earlier plan: it copied the snapshots over
the live keys first and only re-ran `plan_restore` afterwards, and the CLI ran `restore_from_supabase` between the plan and the apply.
A newer write by either lane between plan and apply was therefore OVERWRITTEN by the backup bytes; the late check only stopped the
republish. A byte-only rewrite (same registration, new bytes) was lost too, because the late check kept only "newer entry"/"newer
run" refusals. `test_restore_rechecks_the_shared_head_before_republishing` proved "not republished", not "nothing overwritten".
The claim above that the restore "re-reads the head just before republishing" was true but was not the protection it read as.

**Fix.** `apply_restore` now (1) downloads EVERY snapshot object and checks it against `before_sha256` (reads only); (2) as the last
step before the first write, re-runs `plan_restore` fresh against the current shared head and re-hashes every touched live object
against the sha the snapshot recorded (written sha; for a marked delete, the pre-op sha), and also requires the snapshot index to be
unchanged; any refusal = return with ZERO mutation; (3) then overwrites, reading each key back; (4) keeps the pre-republish head
re-check. The CLI's `restore_from_supabase` now runs before the plan, so nothing slow sits between plan and apply.

**Tests** (`backend/tests/test_rollout_675.py`, now 45; +4): plan -> a pilots-lane newer write -> apply; plan -> a core-lane newer
write -> apply; plan -> a byte-only rewrite of a touched key -> apply; one snapshot corrupted among N. Each asserts zero storage
operations of any kind after the plan and the live bytes preserved byte for byte. Mutation checks: revalidation moved after the
copies -> 5 red (the 3 race cases, the round trip, the pre-republish test); verification interleaved with the writes -> the
corrupted-snapshot case red. Chain floor 3219 -> 3223 (dev 3172 + 57 = 3229, files 190).

**Residual race (stated, not solved).** These checks shrink the window to the gap between the last revalidation and the first
write; they do NOT eliminate the final time-of-check/time-of-use race: a lane that writes inside that gap is overwritten.
Supabase Storage has no conditional PUT and the bucket is unversioned, so no check in the script can make the restore atomic.
**Recommended (not built): an enforced exclusive-writer restore window** - run the restore only while both ingest workflows
(forecast-ingest, forecast-ingest-pilots) and precompute are disabled or held in their concurrency groups, verified before the
plan. It needs no storage migration and matches how the operator already pauses lanes; storage versioning/CAS would be the larger
change.

## 2026-11-03 UTC: the restore fix bound to its exact head
- Code head `761703751` (the restore revalidation fix on top of `be474a8b7`). Hosted CI run 41575644898, all jobs green:
  chain 3229 passed / 190 files (projection 3229), guards 3351 passed (map 3351), estate 3408 (map 3408).
- The tests (`test_rollout_675.py`, 45) and the recovery limits above (snapshots keep 2 cycles per lane; restore on demand only,
  refusing with zero mutation on any change after the plan; the residual last-check-to-first-write race; the recommended
  exclusive-writer window) describe `761703751`. This entry and its ledger line are docs only (no code change after it).

## 2026-11-03 UTC: restore proof cases tightened (Codex review of 451776da4; tests only, no code change)
- `test_a_change_after_the_plan_means_no_live_write_at_all` now parameterizes the restored lane AND the writing lane: restore core
  with a newer PILOTS write after the plan, and restore pilots with a newer CORE write (the earlier "core_newer_write" case was
  core -> core). It adds a corruption of a LATER backup (`w.json`, second in sorted order) while the first (`d.json`) stays valid:
  no destination write happens, which proves every backup is checked before the first write. Mutation check (verification
  interleaved with the writes) turns exactly that case red. `test_rollout_675.py`: 46 tests; chain floor 3223 -> 3224 (3230).
- The residual stands as written above: the final per-key validation -> write race remains across the whole multi-key restore;
  an exclusive all-writer window is recommended, NOT enforced; there is no standing restore authority (it is still an approval
  the owner has not given). The exact head for this entry is the commit that adds it (bound in ledger fragment line 4).
- Bound: the proof cases above are commit `fdcbb352f`; hosted CI run 41658416627 green (chain 3230 / 190 files = projection,
  guards 3351, estate 3408). Ledger fragment line 4. This bind is docs only.

## 2026-11-03 UTC: merged dev dfed518e8 (#695 eval harness); chain floor re-derived
- Floor files taken from dev (3301 / 195 files after #695), then `rederive_floor.py --lane chain --add 58 --add-files 2`: base
  dev's map 3307 + 58 (#675's 12 + rollout v2's 46) = 3365, files 197; floor 3359. No code change in this commit; the hosted CI
  read of this head is recorded in the PR (the next PR's fold binds it in the ledger).
