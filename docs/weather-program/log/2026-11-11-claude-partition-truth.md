# 2026-11-11 (claude, partition-truth): observed swell trains from buoy spectra, the S3 diagnosis, and a rating-truth options paper

Session: Claude Code (Sonnet 5.5), a side session of the advisor's "move 5" (owner, 2026-11-11: "lets move through your 5 moves").
Branch `claude/partition-truth-instrument` from `origin/dev` `a7c41dd2a` (#784). One writer for this file. DRAFT PR against `dev`.
Times are UTC. **This change moves no served number.** It adds an offline instrument, a README, tests, and writing. No flag was
touched, nothing was armed, merged or deployed, no Raw Surf service was called except one `gh` read of run logs.

## 0. What was checked first, and one premise that was wrong

- Recorded state read: SCOREBOARD S3 row (line 19), S8 rows, STATE "Owner-only", the gap map (PR #787), the existing
  `backend/scripts/nearshore_validation/partition_spectra.py` (an earlier MEM + steepness-watershed script that needs a
  separate `wavespectra` venv and has no controls) and the 2026-11-02 swell-partition-tracking log.
- Open work checked: no open PR or log measures swell **trains** against spectral truth. S8 (direction MAE 24.4 / 25.3 / 32.4 deg at
  +24 h; 24.1 / 22.9 / 25.5 on the held-out week) grades the served MEAN direction against the buoy's bulk MWD only.
- **Wrong premise, found in Part B:** the S3 schedule "has never been armed" (SCOREBOARD line 19) is stale. See section 3.

## 1. The instrument (Part A)

`backend/scripts/partition_truth/` (README there): `partitioner.py` (pure numpy), `ndbc_spectra.py`, `gfswave_partitions.py`,
`score.py`, `run_partition_truth.py`, `synthetic.py`; tests `backend/tests/test_partition_truth.py` (12 cases).

**Method, named:** watershed partitioning of the (f, theta) spectrum (Gerling 1992; Hanson and Phillips 2001) with saddle merging
(ratio 0.80), a direction merge for touching partitions within 20 deg, and wind sea by wave age (1.3 x U10 x cos). Direction model:
per-frequency alpha1 with the Kuik spread.

**Two defects found by the controls, fixed before any score was taken (recorded because the wrong version is the evidence):**
1. The Maximum Entropy Method (the repo's earlier script uses it) turned ONE synthetic swell into TWO partitions 20-30 deg either
   side of the truth whenever r2 < r1^2 (known artifact, Benoit 1992). The synthetic single swell at 355 deg came back as 340 and
   10 deg. The default is therefore the first-moment model; MEM stays behind `--model mem` and the test that pins the split.
2. On real 30-minute spectra the first version returned five partitions inside 4 deg of direction (spectral ripple). A second merge
   (touching partitions within 20 deg and a saddle of at least 0.5 of the lower peak) cut that to the real structure (for
   example 13.7 s / 258, 9.1 s / 254, 4.2 s / 258 deg at 46025).

**Controls (12 tests, all pass):** positive: two swells with known Hs/Tp/direction recovered; energy conserved; wind sea labelled by
wave age, swell not; north wrap; trains apart in period and direction separated. Null: one swell is one partition; empty spectrum has
none; no wind means no label. **Pinned limit:** 13 s and 11 s trains 100 deg apart share frequency bins, and come back as one train.

## 2. First reading (S8P), 2026-11-12 03:50Z

Window: GFS-Wave cycles 2026-10-12 00Z to 11-08 12Z (00Z and 12Z), leads +24/+48/+72 h, 168 of 168 (cycle, lead) files read; targets to
11-11. NDBC realtime2 buoys: 31 of 32 asked answered with spectra; 29 contribute pairs; **15 independent station blocks** (complete linkage
500 km); 28 UTC days. All are OFFSHORE or basin buoys (no nearshore table exists here; the advisor's #781 point, a buoy and a spot in
different swell windows, is why this table must never be read as nearshore). Model = GFS-Wave 0.25 deg slots at the nearest valid cell.
Persistence = the observed train of the same rank at the issue time. CIs: moving 3-day-block bootstrap over UTC days (2000 resamples) of
the mean of |model error| - |persistence error|; they do NOT model the 15-block spatial correlation, so read them as optimistic.
Gates: observed primary Hs >= 0.5 m; second swell and wind sea >= 0.3 m. Matching rule: RANK (primary vs slot 1, second vs slot 2, wind sea vs
wind sea); no peeking at the best slot.

| Train, lead | n (buoys) | Direction MAE model / persistence (deg) | Period MAE (s) | Height MAE (m) |
|---|---|---|---|---|
| Primary swell +24 h | 1,343 (29) | 29.5 / 27.9 | 1.64 / 2.29 | 0.42 / 0.58 |
| Primary swell +48 h | 1,330 (29) | 28.6 / 33.9 | 1.62 / 2.60 | 0.42 / 0.67 |
| Primary swell +72 h | 1,333 (29) | 30.2 / 37.1 | 1.64 / 2.73 | 0.45 / 0.75 |
| Second swell +24/+48/+72 h | 880 / 868 / 842 | 61.0 / 51.4, 62.0 / 59.4, 63.4 / 59.9 | 3.74 / 4.00, 3.68 / 4.39, 3.67 / 4.37 | 0.30 / 0.32, 0.32 / 0.37, 0.35 / 0.39 |
| Wind sea +24/+48/+72 h | 476 / 472 / 463 | 13.5 / 26.4, 14.0 / 34.7, 16.8 / 38.2 | 2.02 / 1.64, 2.09 / 1.77, 2.12 / 1.88 | 0.75 / 0.71, 0.77 / 0.81, 0.80 / 0.87 |

Reading (each tied to a number above, none to a flag):
- **Primary swell direction does not improve on persistence at +24 h** (+1.6 deg, CI -2.4..6.7) and is flat across leads (29.5, 28.6, 30.2).
  Persistence degrades with lead, so the model wins at +72 h (-6.9 deg, CI -12.2..-1.8). The S8 bulk-direction number (GFS 24.4 at +24 h) and this
  one measure different things (bulk MWD includes every train; this is the primary train alone), so they are not comparable and neither is
  restated as new.
- **A consistent -9.5 to -10.6 deg bias** (model direction is smaller than the observed train's). Unexplained: it can be the model, the
  buoy-side first-moment reconstruction, or the nearest-cell sampling. **Open; not a finding about GFS-Wave until the partitioner's own bias is
  bounded against a second buoy product (CDIP's own partition, not read here).**
- **Direction convention checked:** flipping the model by 180 deg gives MAE ~150 deg for the primary swell, so "from" is right.
- **Period is a real skill over persistence** (1.6 s against 2.3 to 2.7) and the model reads ~0.4 s long; **height reads 0.28 to 0.29 m low** for
  the primary train.
- **Slot identity costs:** the buoy's primary swell is closer in direction to model slot 2 or 3 than slot 1 in 26% of pairs (368 / 1,418 at +24 h);
  in 6.6% slot 1 is over 45 deg off while another slot is within 25. The second swell (slot 2) is no better than persistence in direction (61 deg),
  consistent with rank mismatch, not proof of it.
- Wind sea direction is good (13.5 to 16.8 deg, against 26 to 38 persistence); wind-sea period reads 1.6 to 1.7 s long and height 0.6 to 0.7 m high.
- **Unmatched shares** (observed trains at the gate that were not scored): primary 4% (model slot empty 56 of 1,418) plus 1% (no persistence
  train); second swell 7% plus 10% to 12%; wind sea 10% to 15% plus 23% to 24%. Low MAE on matched pairs only is not skill: these shares are in the JSON.
- **Sensitivity:** merge ratio 0.7 and 0.9 change primary direction MAE by at most 0.4 deg and period MAE by at most 0.04 s. Removing the three
  Southern California basin buoys (46025, 46086, 46054; sheltered) leaves 28 buoys and the same MAEs (29.5, 28.1, 30.3 deg). The MEM
  variant was started and stopped: its spurious double peaks make the merge loop too slow to finish (not scored).
- **Evidence:** `docs/weather-program/evidence/partition-truth-2026-11-11.json`.

**Can `SURF_PARTITIONS` now be judged?** Partly. There is now an instrument that scores GFS-Wave's train height, period and direction against
observed trains at offshore buoys, with persistence and a slot-identity diagnostic. It cannot yet judge the flag's served effect, which is the
nearshore height and rating: that needs the nearshore arm (#773/#784) with `hb_proxy`, and `SURF_PARTITIONS` is not replayable in the eval
harness (`eval_replay.UNREPLAYABLE`). The first reading says the gain case for partitions is period and wind-sea direction; the direction case
for the primary train is not shown at +24 h.

## 3. Part B: why the S3 schedule "graded nothing" (read at `dev` `a7c41dd2a`, runs read with `gh run view --log`)

**The premise is stale.** `NEARSHORE_VAL_ENABLED` is `1`, set 2026-10-08T23:23:06Z (repo variable list), six minutes after #270 (the
VA-03 change) merged at 23:17Z. Of the scheduled runs since, 101 of 106 titled "Nearshore requested" concluded success (= GRADED, exit 0)
and 5 failed. The 85 runs that graded nothing (2026-09-20 to 10-08) were the armed-off runs, and that is the whole cause of "85 runs".
SCOREBOARD line 19 and STATE "Owner-only: Arm the nearshore judge hourly" still say it is unarmed. A recent GRADED run, 43108259188
(2026-11-11 22:02Z): 169 spot-hours, 87 station-hours, 11 live stations, GEOMETRY mae 0.217 m, obs/model 1.38.

**The five refusals** (2026-10-10 01:00Z, 10-10 19:20Z, 10-30 19:56Z, 11-09 00:59Z, 11-09 11:49Z):
- Four read `STATIONS live=2 dead404=0 infra=20` and `REFUSED: too thin to grade: station-hours=9..16 (min 30)`. `probe_stations`
  (`run_nearshore_validation.py:131-147`) makes ONE attempt per station with 8 parallel workers and counts any non-404 failure
  (timeout, 5xx, URLError) as infra. When CDIP THREDDS stalled, 20 of 22 stations failed in one pass, 2 survived, and the run was
  REFUSED (exit 1) rather than INFRA (exit 2), because the runner only calls it INFRA when ZERO stations answer (line 12 and 210).
  The 11-09 logs also show `point-api miss ndbc:42035 ... HTTP Error 404`, the same day the box was killed for memory (STATE).
- One (10-10 01:00Z) read live=11, `station-hours=29 (min 30)`: one station-hour short.
- The 11 `dead404` stations are retired CDIP deployments (live=11, dead404=11 on every healthy run): half of the pair table
  makes a request that always 404s.

**Exact change that would stop thin infra runs from reading as a verdict (not made; the owner's call, it edits the judge):**
1. `probe_stations`: retry the infra-classified stations up to 2 more times after 20-30 s, with 4 workers instead of 8; keep 404 as
   a per-station skip.
2. When live stations < half of the non-404 pair table, exit 2 (INFRA) with the counters instead of exit 1 (REFUSED), so a CDIP
   outage is not recorded as the judge refusing the data.
3. Remove or flag the 11 permanently 404 stations in `backend/data/nearshore_validation_pairs.json` (separate PR; the generator
   `build_nearshore_pairs` owns that file).
4. Docs only: correct SCOREBOARD line 19 (a new correcting row, never an edit) and STATE's Owner-only line. Arming needs nothing.
Expected effect: about 5 of 106 runs (4.7%) stop being red/refused; the graded sample per day rises by about 1 run. It does not change
the judge's verdict on a graded run. **Not verified:** that the THREDDS stall (not the runner's worker count) is the root cause of
the 20 infra stations; the logs show the count, not the exception text, for those 20 (only the NDBC 404s print).

## 4. Part C: an observation source for the 0-100 rating (options paper; the choice is David's)

Today the rating has no observation. The only in-product hooks are `rating_confirmation.py` (user `surf_reports`, 1-5 stars; 4 rows,
newest 2026-03-19; unreadable by `service_role` until a grant migration, STATE Owner-only) and the photographer `condition_reports`
table (wave_height_ft, conditions_label, wind_conditions, crowd_level, media, 24 h expiry). The rating mixes offshore height 37%,
direction 33%, wind 19% and period 10% of its variance (S10), so a judge must observe the COMBINATION a surfer feels.

| Option | Resolves | Cannot resolve | Sample per week | Bias risks | Cost | Terms and legal checks |
|---|---|---|---|---|---|---|
| A. In-app user condition reports (1-5 stars, per spot) | the rating's overall level at the spots users actually surf | height in feet; fine level boundaries (5 stars is a feeling) | 4 rows ever; at 1% of 1,000 weekly users reporting, about 10 | self-selection toward good days; each user's own scale; skill level; crowd mood; the app's own rating shown before the report (anchoring) | small: a grant migration and a prompt | own data; consent and retention under the privacy policy |
| B. Photographer condition reports (structured: feet, label, wind, crowd, with a photo) | height AND wind condition, with media as an audit trail | the 0-100 itself; only labels | few today (pro photographers; sessions) | photographers shoot good days; label scale differs by coast; height in feet is eyeballed (Hawaiian face versus Hawaiian scale) | low: already collected | own data; media licence per upload |
| C. CDIP MOP nearshore height (partial proxy) | breaking-height error at the California CDIP stations the S3 arm already uses | wind, period feel, crowd, anything outside California; it is a MODEL forecast, not an observation of the surf | thousands of station-hours | a model's errors are not independent of ours (both read GFS/WW3 boundaries) | zero (already ingested) | CDIP data-use terms: read and cite before relying on them (not checked in this move) |
| D. Surf cameras (computer vision on public cam feeds) | wave count, break position, whitewater, a surfer count; the strongest candidate for a labelled "what it looked like" | exact height without calibration; night, fog, glare | depends on how many operators agree; unknown today | camera angle fixed per spot; a classifier trained on our labels is also a model | high: vision pipeline, labels, storage | most cam feeds are copyrighted and their terms forbid scraping or analysis; needs written permission per operator |
| E. Public surf reports (forecaster text, e.g. Surfline-style "2-3 ft, fair") | a professional's rating-like label at hundreds of spots | independence: forecasters read the same models; scale conventions differ (Hawaiian, face versus wave) | thousands | ADVISOR anchoring on the same GFS; paywalled; the label is the competitor's rating | medium | copyright; terms prohibit scraping; do not use without a licence |

**Recommendation: B first, with A as the cheap complement.** The photographer structured report is already collected, carries height
in feet plus wind and crowd labels plus a photo that an auditor can re-read, and can be mapped to a sub-score (height band, wind
class) per spot without asking anyone to rate "0-100". A needs the grant migration and a prompt design; its value is the rating's
level, but at 10 reports a week it takes months to reach the 100 pairs the harness requires. C is the cheapest partial proxy but
already judged by the nearshore arm; E is a terms-of-use problem; D is the best long-term instrument and the most expensive, and
needs permission first. **Gate before any use:** the harness's own rule (at least 100 pairs, 14 UTC days) and a per-observer
calibration (a photographer's offset is estimated on that photographer's other reports, not pooled). **Not verified:** the photographer
table's real row counts (needs the database; not read), and NO source's terms of use were read in this move (nothing was scraped): every legal cell above is a question to check, not a finding.

## 5. Not done and not verified

- **Not verified:** the -10 deg primary-direction bias (model, partitioner or sampling); the partitioner against CDIP's own partitions or a
  second method (the only validation is synthetic controls plus the sanity of real spectra); EURO and ICON partitions (not scored: no public
  partitions, CMEMS needs credentials); nearshore stations (none scored; keep a separate table); bulk-direction lane alignment with the director's
  measurement agent (asked for its branch, no reply yet; this instrument builds no bulk lane); the MEM variant (stalled); a window beyond
  NDBC realtime's ~45 days; hosted CI (the new tests ran locally only: 12 passed; the guards lane takes 15-25 min).
- **Part B not verified:** that CDIP THREDDS (not the runner's 8 workers) caused the 20 infra stations.
- **Not changed:** no workflow, runner, flag, variable or schedule. The exact S3 change is described in section 3 for the owner.
- A bad shell command of mine (`taskkill` on every python.exe) was refused by the harness and not retried; I stopped my own background jobs with
  TaskStop instead. No other session's process was touched.

## 6. Addendum 2026-11-12 04:30Z: reconciliation against the buoy's MWD (asked for by the #790 design, §2 step 5)

One-off check, not a committed script: 1,799 sparse buoy-hours (31 buoys, every 6th half-hourly record, cached NDBC files, MWD from the
`.txt` column, buoy WVHT >= 0.5 m). Partition-derived direction minus MWD: **energy-weighted over all partitions: median -1.0 deg, mean +4.3,
MAE 20.8, p90 |d| 49.4; the largest partition alone: median +0.8, mean +4.9, MAE 18.1.** Reading: the partitioner has no systematic offset
against the buoy's own bulk direction (convention "from" holds on real data, not only on synthetic), and it scatters about 18 deg from MWD, which
is the cost of partitioning a multi-train hour against a single-number product. So the -10 deg primary-direction bias in section 2 is NOT a
partitioner-wide offset; it remains unexplained between the model and the cell sampling. #790's two-mode band approach (alpha2/r2 per bin) is not built
here; my default uses mode 1 only, which is the stated limit. Not committed as a script: n sparse, one pass.

## 7. Alignment with the S8 bulk lane (draft PR #794, head `7a217b4a2`), 2026-11-12 04:45Z

Read from #794's log only (its module was not run). Same pairing idea: (buoy, valid hour, lead 24/48/72) with the verifying observation at that hour.

| | S8 bulk lane (#794) | S8P partition lane (this PR) |
|---|---|---|
| Truth | buoy bulk MWD / DPD / APD, NDBC realtime2 | primary / second swell and wind-sea trains rebuilt from NDBC spectra |
| Buoys | 92 direction, 108 period (within 100 km of a catalogue spot, so some nearshore) | 31 asked, 29 contribute; deep-water / basin buoys only (list in `run_partition_truth.STATIONS`) |
| Forecast | Open-Meteo archived previous runs of GFS-Wave, ECMWF WAM, DWD GWAM | NOAA GFS-Wave 0.25 swell slots 1-3 and wind sea, byte ranges (same ingest source); no EURO/ICON |
| Window | graded 2026-10-19..11-09 | cycles 2026-10-12..11-08; `--target-start/--target-end` now restricts targets |
| Nulls | persistence, per-buoy climatology | persistence only (no climatology) |
| Significance | buoy-cluster bootstrap | 3-day-block bootstrap over days; 15 spatial blocks reported, not resampled |

On #794's window (targets 2026-10-19..11-09, 22 days, 29 buoys, 15 blocks) the partition numbers are unchanged in substance:
primary swell direction MAE model / persistence 29.6 / 26.6, 28.2 / 33.4, 30.7 / 38.0 deg (n 1,045 / 1,030 / 1,032); period 1.6 / 2.3, 1.6 / 2.6,
1.7 / 2.7 s; wind-sea direction 14.0 / 25.0, 14.3 / 35.4, 17.5 / 39.5. **These are not comparable to #794's 22.3 / 22.4 / 23.1 deg**: its
truth is the bulk MWD (the dominant-period direction), mine is the primary TRAIN, and the stations differ. What is comparable: both lanes find
the GFS-Wave direction no better than persistence at +24 h. The next alignment step (owed, not done): run both on the intersection of buoys and
join on (buoy, hour, lead) to see how much of the 29 deg is the train definition and how much is the forecast.

## 8. The join with the S8 bulk lane (#794), 2026-11-12 05:10Z

**What could and could not be joined.** #794's evidence folder holds the buoy list (108, with coast) and aggregates (`s8_offline.json/.md`), not its
365,819 per-row forecasts, so a row-level join on its pairs is not possible. I joined the other way: keep MY keys (buoy, cycle, lead, verifying hour) and
read #794's truth (the buoy's bulk MWD, standard-met column, observed Hs >= 0.3 m) at the same hours. New script
`backend/scripts/partition_truth/mwd_decomposition.py`; rows are identical across columns. Window: targets 2026-10-19..11-09, as #794.
**Intersection:** 18 of my 31 buoys are in #794's set (13 pacific_ne, 3 atlantic_se, 2 hawaii: 46025 46026 46042 46054 46086 46013 46014 46022 46027
46050 46041 46029 46087 51201 51202 41004 41008 41025). The 13 others (46059 46002 46005 46006 51001-51004 51101 41002 41010 41043 41047 41049) are
open-ocean buoys farther than 100 km from a catalogue spot, so #794 does not grade them.

GFS-Wave slot-1 direction MAE (deg), identical rows, +24 / +48 / +72 h:

| Set | n (buoys) | vs observed primary TRAIN | vs buoy MWD | train vs MWD (the two truths) | persistence vs MWD |
|---|---|---|---|---|---|
| Intersection with #794 (16 buoys with pairs, 7 blocks) | 567 / 555 / 558 | 18.2 / 18.7 / 18.3 | **23.1 / 22.9 / 22.1** | 13.6 / 13.4 / 13.7 | 24.2 / 31.1 / 34.5 |
| All my buoys (29, 16 blocks) | 1,061 / 1,046 / 1,057 | 29.5 / 27.9 / 30.3 | 33.0 / 31.2 / 32.7 | 16.7 | 31.1 / 36.5 / 41.1 |
| Complement (13 open-ocean buoys, derived) | about 494 at +24 h | about 42.5 at +24 h | | | |

Findings (each tied to a number):
1. **Cross-check holds.** On the shared buoys my slot-1 direction against MWD is 23.1 / 22.9 / 22.1 deg, the same band as #794's published GFS 22.3-23.1
   (different forecast fetch and row set, so agreement to about 1 deg is a consistency check, not an identity).
2. **The 29 deg is not the train definition.** On identical rows the model is CLOSER to the observed train than to MWD (29.5 vs 33.0 at +24 h; 18.2 vs
   23.1 on the intersection). The two truths differ by 13-17 deg themselves, but swapping to the train does not make the model look worse.
3. **The 29 deg is a buoy-set effect.** Open-ocean buoys that #794 excludes carry about 42 deg at +24 h (derived from the two rows: (1061 x 29.5 - 567 x
   18.2) / 494); the buoys near catalogue spots carry 18 deg. A direction number from the near-spot set cannot stand for the open ocean the global
   layers show. Cause not examined (mixed seas far from land, or the nearest-cell sampling, or ranking of slots).
4. Against MWD the model is no better than persistence at +24 h on either set (all buoys +1.9 deg [-4.2, 6.5]; intersection -1.1 [-5.2, 2.9]) and better at
   +48/+72 h on the intersection (-8.2 [-16.0, -1.0], -12.4 [-20.7, -5.0]). The block bootstrap resamples days, not the 7 / 16 spatial blocks.
5. The primary-direction bias against the train (-5 deg intersection, -11 all) shrinks against MWD (-2, -7): part of the "-10 deg" is the
   train-versus-bulk definition, the rest is the open-ocean set.

**Not done:** a row-level join on #794's pairs (needs its per-row file, not committed); the cause of the 42 deg on open-ocean buoys.
