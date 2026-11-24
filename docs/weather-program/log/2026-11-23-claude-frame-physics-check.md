# 2026-11-23 · check lane: publish-time frame physics check (report-only) + P0 fix plans

Session: the check lane started by the director (local_d6b521eb) after the owner chose "Start check lane
(Recommended)". Evidence: the inspection lane's data-and-physics rescan (side notes
`SOTA-RESCAN-DATA-AND-PHYSICS-2026-11-23.md`). Branch `claude/frame-physics-check`.

## Step 1 · the check (built, report-only, ON, kill `FRAME_PHYSICS_CHECK=0`)
- `backend/services/frame_physics_check.py` (pure rules), `backend/scripts/frame_physics_report.py` (reads
  latest.json, the GFS / ICON / EURO world marine indexes and a frame sample: lead 0, then every 24 h), new step in
  `forecast-ingest-pilots.yml` after both frames steps, `continue-on-error`, artifact `frame-physics-report-<run>`.
- Rules: R1 partition Hs <= total + 0.05 m; R2 sum(p^2) <= 1.1 H^2 (cells with total > 0.25 m); R3 no valid cell at
  0 m with 0 s / no period; R4 one source and one run per model button over authoritative + native_time_interpolation
  frames (the locked tail blends are listed, not failed; an interpolation's `estimated_interpolation` label is not a
  second source).
- Never blocks or changes a value: it writes nothing to any bucket and exits 0 on any finding or failure (pinned by
  tests: the published tree is byte-identical after a run; a missing credential becomes `error` in the report).
- Tests: `backend/tests/test_frame_physics_check.py`, 23 tests, a planted violation and a clean twin per rule, run
  twice from `backend/` (23 passed both times). Mutation check: breaking each rule's comparison turns 4 / 3 / 2 / 1
  tests red.
- Workflow-reading tests (52 files): 27 fail locally both with and without this change (Python 3.14, packages
  absent); the same 27 with the base workflow file, so none is from this PR. Hosted CI is the authority.

## First real read (public bucket, anonymous GETs; the live API box was not called)
Run against `v1/latest.json` written 2026-11-23T23:31:06Z: 162 frames, 10,220,794 bytes.

| Model | R1 swell <= total | R2 energy closure | R3 valid zeros | R4 one source + run |
|---|---|---|---|---|
| EURO | 14,323 / 126,607 cells (11.3 %), worst 23.7 % @ 12-07T12Z | 22,836 (18.0 %), worst 31.6 % @ 12-07T12Z | wind_waves 4,522 / 119,535 (3.8 %) | 2 sources (ecmwf_wam025 total, CMEMS MFWAM partitions), 5 runs |
| GFS | 3,572 / 142,536 (2.5 %), worst 2.9 % | 31,362 (22.0 %), worst 25.1 % | 0 | ok |
| ICON | 16,341 / 143,800 (11.4 %), worst 28.2 % @ 12-06T12Z | 21,082 (14.7 %), worst 36.5 % @ 12-05T12Z | waves 7.7 %, swell_1 6.9 %, wind_waves 7.9 % | ok |

This reproduces the rescan's findings 1, 2, 4, 5 and 11 with an independent instrument. EURO runs: 12Z (65 frames),
00Z (227, the CMEMS partitions), and 4 frames each from the 11-20, 11-21, 11-22 12Z runs (finding 4's
interpolations).

## Step 2 · fix plans (no code)
`docs/weather-program/research/P0-PHYSICS-FIX-PLANS-2026-11-23.md`: tail closure projection (blend untouched), EURO
partition source (step 0: does ECMWF open data carry partitions; else label + run alignment, closure dark), MOP jack
cap (interim dark patch, target: linear shoaling to breaking). All three are BLIND to today's replay (GFS-only, no
partitions or MOP archived), so each ships dark under D-090 rule 4 as well as under the advisor's ruling.
SubQ and Reflection: APPROVE WITH CHANGES on all three; their changes are in the plan's amendments. LongCat not
sent (its submit needs the owner's approval of the payload hash). Checked with the repo's own
`shoaling_coefficient`: Ks dips to 0.913 (6.5 s, 10.5 m), so SubQ's "Ks >= 1 always" was wrong; recorded.

## 2026-11-24 · advisor limits applied (commit 27866dc79)
- The physics step now reads the PUBLIC frames bucket anonymously (`--public-base`). `SUPABASE_SERVICE_ROLE_KEY` is no
  longer in its env; the script's Supabase sink needed the key, so the read path changed instead of just the env line.
- The step is the LAST step of the ingest job, after every raster publish; a test pins both (24 tests, twice).
  The `steps.budget.outputs.go` gate (#1228) is not on `dev`, so the step was moved instead of gated.
- Plan notes: Plan 2 B1 needs a Codex or David release of `MapWeatherControls.js`; Plan 1 changes served tail
  partitions, and David must be told that at flip time.

## 2026-11-24 · GFS R2 at 22 %: native GRIB says it is OUR aggregation, not physics
Asked by the director after the advisor's read. Offline and read-only: NOAA's public AWS GFS-Wave GRIB2
(`gfs.20261123/12`, `global.0p25`, byte ranges by `.idx`), decoded with `gribberish` under Python 3.12 (pygrib has no
Windows wheel). Same rule constants as the check. Scripts and output: `evidence/2026-11-24-gfs-native-r2/`.

| Arm (served layers swell_1, swell_2, wind_waves) | lead 24 h R1 / R2 | lead 72 h | lead 168 h |
|---|---|---|---|
| native 0.25 deg | 0.08 % / 1.21 % | 0.07 % / 1.28 % | 0.07 % / 1.07 % |
| 2 deg, centre point of each layer | 0.03 % / 0.35 % | 0.06 % / 0.41 % | 0.03 % / 0.31 % |
| 2 deg, block RMS over finite subcells (the fetcher's method) | 2.64 % / **22.81 %** | | 2.73 % / **21.83 %** |
| 2 deg, block RMS with a masked partition counted as 0 where the total is valid | 0.00 % / 0.97 % | | 0.01 % / 0.93 % |

(served, read 2026-11-23: GFS R1 2.5 %, R2 22.0 %.)

- **Native passes.** R2 1.1-1.3 % at the pre-registered 10 % tolerance (sum p^2 / H^2 median 0.99, p99 1.11-1.15).
  The rule stays as written; no tolerance change.
- **Cause:** in today's GFS-Wave GRIB an absent partition is MASKED (bitmap), never 0.0: where the total is valid,
  swell_1 is masked in 10 % of cells, swell_2 23-24 %, wind_waves 34-37 %, and exact 0.0 in 0 %. The fetcher turns the
  mask into NaN (`noaa_gfs_wave_fetcher.py:481-482`) and `energy_mean_height_block` / `height_block_batch` take the
  RMS over FINITE subcells only. Its docstring assumes absent partitions arrive as exact 0.0 and are counted; they
  are not, so each partition is averaged only over the subcells where it exists, and its 2-deg height is inflated
  against a total averaged over every subcell. Counting a masked partition as zero energy where the total is valid
  brings the 2-deg result back to the native rate.
- This is a SERVED-NUMBER defect (GFS world partition heights read high in partially covered blocks), outside this
  PR. Not checked: the regional tiers' reduction paths, the native-cell path (`_fetch_native_cell`), and the DWD GWAM
  fetcher that shares `energy_mean_height_block` (ICON R2 14.7 % may be the same mechanism).

## 2026-11-24 · Plan 4 written (owner: "Yes, plan it here")
The masked-partition fix plan is appended to `research/P0-PHYSICS-FIX-PLANS-2026-11-23.md` as Plan 4. New measurement
(`evidence/2026-11-24-gfs-native-r2/tiers.py`, lead 72 h): the inflation grows with block size. R2 as built is
6.65 % (0.5 deg), 24.5 % (2 deg) and 63.2 % (10 deg), against 1.42 / 1.05 / 0.63 % with masked partitions counted as
zero. At the 2-deg tier the served wind-wave height is 2.41x the corrected one at p90. The fix is planned dark (BLIND
to the replay): flag `PARTITION_MASKED_AS_ZERO`, plus a separate `PARTITION_COVERAGE_MASKED` for the
direction-confidence denominator. Not yet panel-reviewed.

## 2026-11-24 · Plan 4 BUILT: GFS_PARTITION_MASKED_AS_ZERO (branch claude/gfs-partition-masked-zero, stacked on #1264)
Owner's ruling, relayed by the director (local_d6b521eb): "Ship ON with guard (Recommended)". Must NOT merge before #1261
(the manifest fail-safe), per the advisor.
- Step 0: ICON's DWD GWAM never masks a partition (0.0 % NaN where the total is valid; absent = 0.0), so the fix is inert there
  and no ICON flag was built. `SURF_PARTITIONS` is '0' in every lane, so no surf height or rating moves. CMEMS not read
  (credentials only CI holds; EURO is Plan 2's).
- Code: `services/_fetch_partition_mask.py` (fill, `keep_absent`, `old_reduction`, `payload_value`); the GFS fetcher fills the
  three partition heights where the total is valid and re-checks only exact-0.0 results against the unfilled reduction, so a
  block with no train stays no-data while a real 0.0 is kept (caught by `test_regrid_native_cell`: a first "0.0 -> no-data"
  rule would have erased genuine zeros). Fix B: the partition confidence counts zero-filled subcells in its denominator
  (`support="height"`). The flag is resolved by the PARENT (`noaa_marine_service`, `runtime_flags.flag`) and passed in the
  fetcher payload; no fetcher reads it from the environment.
- Guard: `flag_guardrail` coverage class PHYSICS. Rails pre-registered: WORSE above R2 5 % / R1 0.5 % (2 strikes over >= 24 h),
  breach above R2 15 % / R1 2 % (disabled at once). Frames registered before the guardrail first saw the flag ON are never
  judged. In a shadow run a PHYSICS flag holds (its check cannot see a fix that is off): the owner re-enables (D-087).
- Tests: `tests/test_gfs_partition_masked_zero.py` (20), plus one native-cell test; the native-cell suite runs its oracle with
  the fill off. Mutations of the fill, the no-train rule and Fix B each turn a test red. 274 neighbouring tests pass.
- Offline measurement (SCOREBOARD row 2026-11-24 06:00Z): R2 0.75-1.10 %, R1 <= 0.02 % at every lead from 0 to 336 h.

## 2026-11-24 · #1267: the advisor's two guard gaps fixed
- (a) A PHYSICS UNTESTABLE now KEEPS the strike counter and `first_worse_at` (`decide` returns `keep_watch`, `next_watch`
  keeps it). Only a judged NOT_WORSE clears them, so WORSE, UNTESTABLE, WORSE disables. UNTESTABLE alone never disables.
- (b) Fresh layers are judged on their own. `frame_physics_report.run_check(fresh_since=...)` skips layers registered before
  the flag was first seen ON and names them (`stale_skipped`), and the verdict's reasons list them.
  Consecutive UNTESTABLE runs are counted. At 4 (~24 h) the run writes a GUARD-BLIND line (summary, warning annotation,
  `guard-blind.txt`), and `flag-guardrail.yml` opens ONE issue. It closes that issue on the next judged run
  (`guard-judged.txt`). It only reports.
- Tests: 26 in `test_gfs_partition_masked_zero.py`. Run twice with the 5 guardrail suites, the physics check and runtime
  flags: 138 passed both times. Mutating either the strike-keeping branch or the blind trigger turns a test red.
