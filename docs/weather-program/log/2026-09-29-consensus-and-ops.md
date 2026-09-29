# 2026-09-29 · consensus builder, dispatch token, a glyph bug from the failed runs

Owner: the worktree session (`raw-surf-wt`). Append-only; only this session writes this file.

## ~08:30Z · start-of-context checks
- `dev` = `e82f59c8` (#153), healthy; every data lane green since the night; MOP ingest recovered at 06:10Z after the
  23:30Z CDIP 403s. `workflow_dispatch.armed: false` (no token yet).
- Ledger `by_band` and `by_region` published for the first time (numbers in SCOREBOARD, 11Z row, and D-006's flip
  caveats). Decision D-006 unchanged; Hawaii and small seas are the flip caveats.

## ~09:00Z · #161 (consensus PR A) opened
- `consensus_product.build_equal_mean(gfs, euro, icon)`: a copy of the GFS waves product carrying the equal mean
  where all three members answer, with GFS's period and direction; diagnostics carry members, counts and the
  consensus/primary ratio; mismatched inputs are refused. `equal_consensus` moved from the judge module so the judge
  and the builder share one definition.
- **Correction of the handoff:** "sampler 0.16 ms/sample, no cache needed" held only for small tiles. The sampler
  rebuilt its grid index (and resolution) on every call: 2.66 ms/sample on a 5,917-cell Brazil tile, ~25 s per frame.
  `PointSampler(memoize=True)` (opt-in; guarded to the builder) → 0.15 s. (LESSONS L-S9)
- 21 tests, 9/9 mutations red, chain floor 128/1495.

## 13:27Z · #161 merged on the owner's word (`e4c27fd7`); owner set the token
- Hosted chain 128 files / 1501 passed, exactly as projected.
- After the owner's manual deploy and the #161 deploy: `workflow_dispatch.armed: true` (13:30Z).

## ~13:35Z · failed runs triaged (owner asked "check logs to see what runs failed")
1. **Sim Parity 11:24Z = a real served-number bug.** 32/48 spots a level apart with heights within ~1%;
   `glyph_reference_size_m` null on all 48 (present on all 48 at 02Z). The 02:43Z precompute's GFS pass logged
   "0 spots have a size reference": at 02:48:41Z the prefetcher drew Supabase Storage 429s, the climatology read got
   the same 429 → None → every spot rated on the global default, served ~9 h (Trestles 63.4 vs 38.7). 1 pass in 90
   over 5 days. → **#162** (LESSONS L-F1).
2. Sim Parity 22:33Z on 09-28: glyph frames still on the pre-#146/#120 chain; the 23:01Z rebake fixed it, #150
   automates it. No action.
3. Forecast Accuracy Monitor 06:48Z: **false alarm.** Ledger passes 34-37 min after the previous one scored 0
   (scored vs gap: 3 h → 1,282; 66 min → 36; 34 min → 0; 37 min → 0; 11:57Z → 1,005). (LESSONS L-F4) Fix queued.
4. Marine Nightly zoomlab 13:14Z (and 09-28): 12 consecutive MULT0 frames (~7 s); 09-28 was 15 s API timeouts. n=2
   with different signatures: recorded, not diagnosed.

## ~13:40Z · #162 opened
- Status-aware climatology loader (failed vs absent), retries 3 s / 6 s, the precompute refuses the pass and the
  model keeps its previous frames. 20 tests incl. a replay of the 02:48Z 429-then-200 sequence; 7/7 mutations red
  (+1 equivalent). Chain floor 129/1515. Residual: the live `/spot-ratings` fallback.

## ~13:45Z · memory moved into git (D-008)
- This folder created: README (protocol), STATE, DECISIONS (D-001..D-008), SCOREBOARD (seeded with the measured rows
  above), LESSONS (migrated from agent-local memory, without infrastructure IDs), and this log.
- The untracked `audit/weather-simulation-15.0/HANDOFF.md` on the main machine is frozen history from now on.

## ~13:55Z · #162 merged; D-009
- #162 merged on the owner's word (`f18c7ab8`); hosted chain 129 / 1521 exactly as projected.
- Designing consensus PR B surfaced two flaws in rewriting GFS tiles in place: the pre-flip evidence would come only
  from the judge's approximation, and the ledger/judge would lose their GFS baseline (their equal arm would count
  EURO and ICON twice). Asked the owner once with a recommendation → **D-009: shadow product first.**
- Found for PR B: the point resolver's live marine fallback runs only for GFS/ICON/EURO, so a `CONSENSUS` point reads
  the manifest or answers unavailable (no upstream calls); `/point` and `/grid` accept only GFS|ICON|EURO (the
  judge arm needs that widened in PR C); the ICON regional pilot covers 2 days and the four GFS-only regions have no
  EURO/ICON tiles, so members come from their coarser tiers via `manifest_point_selection`.

## ~14:10Z · #164 opened: consensus PR B, the shadow (D-009)
- `consensus_ingest.py`: a pilots-lane job after the three members' regional passes builds the equal mean of every
  GFS regional waves frame (latest run per region) as model `CONSENSUS`. Each member is answered per cell by the
  point resolver's own pick (`point_candidates` → `choose_for_point` → `load_product`, its 3 h window included,
  offsets counted). Unanswerable cells are masked; frames that blend nothing are not saved. Hour-major, so a global
  member file loads once per hour for every region (not once per region: the fan-out behind today's 429s).
- One switch (`CONSENSUS_INGEST`, `'0'` in all three lanes) registers the job and adds the `raw_surf:CONSENSUS`
  ledger lane; the prefetcher never warms shadows; a `CONSENSUS` point reads a stored product or answers 404
  `no_backend_coverage` with no upstream call (pinned end to end).
- 16 tests, 530 nearby pass, 11/11 mutations red, chain floor 130/1531. No served number changes, armed or not.
- Next: arm it (all three lanes) on the owner's word, then PR C grades the shadow in the ledger against the served
  lane and the computed equal mean (a positive control), and widens `/point` for the judge arm.

## ~14:15Z · the dispatch token lacks Actions WRITE (403)
- Render logs, 13:46Z (the first pass after arming): `forecast-ingest.yml: error: RuntimeError: dispatch HTTP 403`,
  `forecast-ingest-pilots.yml: … dispatch HTTP 403`, `mop-nearshore-ingest.yml: slot 12:40Z served by run 36574129754`.
  The runs listing worked (the decision was reached), so the token reads Actions but cannot write them. The
  dispatcher's decisions were right: the core 12:15Z slot and the pilots 11:45Z slot had no run.
- Owner action: edit the fine-grained token → Repository permissions → **Actions: Read and write** (the token value
  does not change, so Render needs no update). `last` in /api/health is in memory and resets on each deploy; the
  Render log lines `[workflow-dispatch]` are the durable record.

## 14:30Z · CORRECTION: the first two headings of this log are 4 hours off
- "~08:30Z · start-of-context checks" was really **~12:30Z**, and "~09:00Z · #161 opened" was really **13:06:13Z**
  (`gh pr view 161` createdAt). I read this machine's local clock (EDT, UTC-4) as UTC. The headings from 13:27Z on
  came from `date -u` and GitHub and are right. The wrong headings stay as written (append-only); this entry, and
  ledger line 16, correct them.

## 14:28-14:40Z · #164 and #163 merged; accountability built (owner: "be accountable for every action you do")
- #164 merged on the owner's word at 14:28:05Z (`09cbca84`; hosted chain 130 / 1537 = projection); #163 at 14:31:20Z
  (`9358324d`, docs only). Both read back with `gh pr view`.
- **The action ledger** (`ACTIONS.jsonl`, BRAIN_RULES §23): one line per state-changing action or correction, with
  the authorizing words, evidence, read-back verification and rollback; SHA-256 chained; STATE publishes the head;
  CI (`weather-program-ledger.yml`) runs a selftest (15 tamper cases, each caught by its OWN check, including a
  re-chained rewrite of history that only the anchor or the base prefix can catch), verifies the chain and, on a PR,
  requires the base ledger to be a byte-exact prefix. Removing any of the verifier's 11 checks fails the selftest.
  Seeded with today's 17 actions, reconstructed from GitHub, Render and the logs (flagged `reconstructed`).
- **The memory check-over** (`memory_audit.py`, first run 14:24Z): 12 of 12 local memories had no record of when
  their facts were last checked → each now carries an honest `metadata.verified` (today only where re-checked
  today). The index, links and frontmatter were sound. BRAIN_RULES §21 mandates Mind/Memstate/Trevec, none of which
  this session has (§23 names the git record as the shared memory). `.antigravityrules` §22 has drifted from
  BRAIN_RULES §22 (no authorized main-push exception): recorded, not changed.
- **Correction** (ledger line 16): this log's first two headings are 4 h off (local EDT read as UTC).
- Verified at 14:39Z: `action_ledger.py verify` → 20 entries OK; `memory_audit.py --memory-dir …` → 0 FAIL, 0 WARN.

## ~14:42Z · #166 opened: the accuracy monitor judges liveness on the archive
- The 06:48Z page came from judging only the latest ledger pass. Measured basis for the new bound: 127 successful
  calibration passes (precompute + core ingest) over 14 days, gap p50 2.0 h / p90 5.2 h / p99 7.1 h / max 8.6 h,
  so dead = no scored target newer than 16 h (~1.5x the worst healthy ~10.6 h). The archive unreadable keeps the
  old rule; last month's archive is read near a month boundary. 8 tests, 7/7 mutations, guards floor 174/2118.
- After merge, verify by dispatching the monitor and reading its new `skill ledger liveness:` line (the real
  newest-target age, which the 16 h bound assumes is ~2 h behind the last pass).

## 14:50-15:05Z · #166 and #165 merged; a pre-arming bug; the arming change prepared
- #166 merged 14:58:11Z (`0b169692`; hosted guards 174 / 2124 = projection), #165 14:59:05Z (`f080ad90`; the ledger's
  own `verify` job green). The ledger is on `dev`.
- The owner reported the dispatch token fixed (~14:50Z). The last pass before it (14:45:48Z) still got HTTP 403; the
  merges redeployed the backend, so the first verifying pass is ~15:18Z (ledger seq 26, `verified: pending`).
- **Asked what arming the consensus shadow needs, I checked the real consumer first**: the ledger's CONSENSUS lane
  also resolves WIND at every buoy, and the wind direct fallback was the one branch not gated on GFS/ICON/EURO, while
  the provider maps an unknown model to gfs_seamless. Arming as-is would have scored real GFS wind as consensus wind
  (~177 upstream calls a pass). Fix: one `UPSTREAM_MODELS` membership read by all three fallbacks; 4 tests (incl. an
  end-to-end `calibrate_spots` for the CONSENSUS lane and a GFS positive control), 4/4 mutations, 420 resolver tests
  pass, chain floor 130/1535. My #164 claim is corrected in ledger seq 28.
- The arming change (`CONSENSUS_INGEST: '1'` in the three lanes + the parity test) is committed on
  `claude/arm-consensus-shadow`, stacked on the fix, unpushed: it goes up only after the fix merges and on the
  owner's word.

## 15:00-15:40Z · the token works; #167 and #168 merged; the shadow is ARMED; the first armed pilots run queued
- **The dispatch fallback works.** Its first pass after the owner's token fix (15:00:50Z) DISPATCHED the missed core
  ingest 12:15Z and pilots 11:45Z slots (runs 36586921881 and 36586926594 on `f080ad90`, read back from GitHub); the
  next pass (15:22:48Z, a fresh instance) declined to stack duplicates while they ran. The owner's later permission
  update (~15:12Z) had no separate observable effect.
- Pre-arming checks, done before merging #168: a ledger lane row with no forecast height is skipped (a CONSENSUS miss
  is a skipped row, not a crash), and the consensus report averages a FIXED member list (the shadow never enters the
  mean it is graded against).
- #167 merged 15:30:00Z (`b16dbb5d`; hosted chain 130 / 1541 = projection). #168 merged 15:30:45Z (`de72c81c`)
  WITHOUT a rebase: a trial `git merge-tree` onto the new dev changed exactly the 4 arming files and kept all 32
  ledger lines (GitHub's own file list was stale). All three lanes read `CONSENSUS_INGEST: '1'` on dev.
- Pilots run **36590800405** dispatched 15:31:05Z on `de72c81c`, pending behind the unarmed 36586926594. Its
  `[Consensus] shadow build complete: N frames ...` line is the verification (ledger seq 38, pending).
- PR C (the shadow's instruments) opened next: ledger `shadow` block with a construction check, judge SHADOW_AB with
  BUILT_VS_COMPUTED, `/point` accepting CONSENSUS.

## 18:00-18:30Z · #169 merged; the shadow verified; the same-model gap located
- #169 merged 18:00:20Z (`afa19a52`; hosted chain 130 / 1549 = projection).
- **The shadow works:** the first armed pilots run built 874/882 frames across 18 regions in 8.5 min, and the next
  precompute ledgered +137 CONSENSUS rows (ledger seq 42).
- **The next fix, found by measurement.** The same-model gap (Open-Meteo's GFS-Wave 0.25 beats our GFS lane by
  +0.020..0.027 m against buoys) is pipeline loss by definition. The ledger's attribution is 98% `unknown`, so I built
  a forecast-to-forecast probe. Its first draft re-derived the control and reported +0.128 m (wrong: coastal 0.0s);
  mirroring the ledger's own control lane gave bias +0.008, MAE 0.074 at 56 buoys, same 12Z cycle. Varying one
  thing at a time: no coordinate shift (9-offset scan), and our 0.25-deg node equals Open-Meteo's north-west 2x2
  mean to 1 cm on 72% of rows. Cause in code: `half = max(1, round(res/0.25/2))` = 1 at native resolution, and the
  block is rows [r-1, r+1) x cols [c-1, c+1), in all three wave fetchers (ledger seq 43).

## 18:30-19:00Z · the GFS native-cell regrid, built dark
- `services/_fetch_native_cell.py` + `noaa_gfs_wave_fetcher.py`: with `REGRID_NATIVE_CELL=1`, a region whose
  resolution IS the native 0.25 deg reads its exact cell through the unchanged production reductions (a doubled
  view for the batch forms, a 1x1 slice for the scalar ones). Coarser tiers are untouched; the flag off is
  byte-identical (the 16 existing loop/parity tests pass unchanged). Design and the rejected half=0: ledger seq 45.
- Tests on the REAL `fetch_global_coarse` loop over a stub 0.25-deg GRIB: flag off pins the defect (a node = the
  NW 2x2 RMS); flag on, every height/period/direction is the native cell and every confidence the reductions'
  single-cell answer; the 1.0-deg tier is byte-identical; vector and per-point paths agree. 14 tests, 12/12
  mutations red. Chain floor 131/1554 -> 132/1568 from #170's hosted 131 / 1560; local lane 132 files / 1574 passed (= projection).
- Scope checked: the same rule is in `dwd_gwam_fetcher.py:224` and `ecmwf_opendata_fetcher.py:305` (next);
  `copernicus_global_fetcher.py:210` is a longitude-only span on the coarse tier (half_cols >= 3), not this defect.
- Flip evidence to gather after the owner's word: the parity probe's node-vs-native-cell MAE should fall from
  0.045 m to rounding, and the ledger's same-model gap to Open-Meteo should close by the same amount.

## 18:58-19:04Z · #171 widened to ICON and EURO (ledger seq 47)
- ICON (`dwd_gwam_fetcher.py`) carries the same half rule on all nine variables and the total-sea confidence; EURO
  (`ecmwf_opendata_fetcher.py`) block-means only its heights, so under the defect a EURO point carried a height
  from the NW 2x2 beside a direction and period from its own cell. Both now read the exact native cell under the
  same switch: one flip for all three, because the consensus shadow averages them.
- 7 more tests (21 in the file) on the real ICON and EURO loops, including the EURO member spread; 10/10 new
  mutations red (22/22 for the PR); 139 neighbouring fetcher tests pass. Chain floor 132/1575.
- CORRECTION (19:04Z): the section above headed `18:30-19:00Z` was written at 18:54Z; its end time, and the
  `Updated 19:00Z` it put in STATE, were estimates, not clock readings. The ledger then refused an entry
  whose guessed `acted_at` (19:05Z) was later than its own `at` (L-P10).

## 19:40-19:51Z · #170 and #171 merged; a churn audit; #171's by-path import regression caught pre-ingest
- #170 merged 19:40:14Z, #171 19:40:24Z (hosted chain 132 / 1581 = projection; dev's tree == #171's head).
- **Churn audit (owner's ask), ledger seq 50:** 11 PRs merged today, ONE changed a served number (#162). S2 has not
  moved since 2026-08-10. The biggest measured win (the equal mean, S1) has no serving switch yet, and its evidence
  lands ~2026-09-30 17Z. Next: turn dark builds into served ones (regrid flip; consensus serving switch).
- **Regression (ledger seq 52):** the real-GRIB parity job, dispatched to prove the regrid flag before offering
  its flip, failed at the first fetch: `No module named 'services'`. Production spawns the fetchers by path;
  #171's inline `from services._fetch_native_cell` import breaks every GFS/ICON/EURO fetch, flag on or off.
  Impact so far zero (no ingest since the merge; no Render error). Hotfix PR with a test that is red on dev.

## 20:10-20:21Z · #172 merged before ingest; the flip priced on real GRIB; the land fallback
- #172 merged 20:10:50Z (owner: "merge when green"), four minutes before the 20:15Z core ingest slot.
- **Priced the flip on real GRIB (run 36622286406):** vector == scalar on 115,600 values; heights move mean 0.022 m
  (p90 0.052), directions 5.2 deg (p90 10). **It would blank 20 of 425 coastal nodes** (own cell land). Not offered.
- **Fix, dark:** a land node answers from its centred 3x3 (symmetric; a superset of the legacy 2x2). The first
  version used a second batch pass at half=3 and differed from the scalar path on 1 real value in 115,600 (a
  rounding tie on quantized data, run 36624144116); land nodes now use the same scalar reduction in both paths,
  pinned by a structural test that is red on the old code. Gate run 36625244679: success: vector == scalar on 115,600 values (IDENTICAL); FLIP_COVERAGE OK (0 total-height values lost; 544 gained at 32 coastal nodes); wave_height mean|d| 0.0244 m p90 0.0552 max 0.6127; direction mean 5.93 deg p90 12.0; swell 207 values empty at sea cells GFS reports without a swell partition.

## 20:47Z · the regrid flip prepared (owner: "Merge #173 and prepare the regrid flip PR")
- The flip PR: `REGRID_NATIVE_CELL: '1'` in forecast-ingest.yml and forecast-ingest-pilots.yml, the lane test's
  expected value, D-010 and a SCOREBOARD row with the priced movement (run 36626767710). Its merge is the flip.
- After the merge, measure: the parity probe's node-vs-native gap (0.045 m before) once the regional tiles
  re-ingest (pilots every ~8 h; worldwide regions every ~32 h); the ledger's same-model gap (S2 NCEP line) over
  24-72 h of scored rows. Split ledger analyses at the flip: the consensus shadow's members change with it.

## 21:16-21:24Z · #173 and #174 (the regrid FLIP) merged; the consensus serving switch
- #173 merged 20:56:30Z, #174 21:16:33Z (`4c8c991d`): **REGRID_NATIVE_CELL is ON** in both fetch lanes.
- **The next fix, built dark:** `consensus_serve.ServedStore`, a serving view of the store wrapped at
  `routes.weather.store` and `_make_point_resolver` only. With CONSENSUS_SERVE=1 a GFS regional waves frame loads
  as its same-run CONSENSUS twin (GFS kept at unblended cells); ingest keeps its own store, so the consensus is
  never built from itself. A `raw_surf:GFS_RAW` ledger lane keeps the GFS baseline. End to end, /point GFS in
  Florida: 0.8 m off, 1.0 m on, 0.8 m raw. 27 tests; 15/15 mutations (the first pass left 3 survivors; each got a
  test). Ledger seq 69-71.
