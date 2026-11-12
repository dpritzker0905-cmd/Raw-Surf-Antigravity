# 2026-11-11: commitment 217, big-swell bias per coast on a disjoint held-out week (offline, measurement only)

Session: Claude Code (Opus 5.5), a subagent of the lead session, branch `claude/big-swell-holdout-217` (from `dev`
`10b4ef4c`). One writer for this file. **No served number moves. No live backend call, no Storage read or write, no
key, no env change, no workflow dispatch.** Every new number below comes from public, key-free archives and is
cached; the script is `backend/scripts/big_swell_holdout_offline.py`; aggregates are in
`docs/weather-program/evidence/2026-11-11-big-swell-holdout/`.

## The commitment (ledger seq 217, OVERDUE since 2026-10-08)

"By_forecast_by_region for atlantic_ne and atlantic_se (equal mean, 24/48/72 h) on a report whose held-out week is
disjoint from 2026-09-23..09-30; build a dark regional calibration only if the same coast exceeds ~0.2 m with n >= 30
in BOTH weeks." The brief for this session added: extend the read to every coast, bin by FORECAST height, and use a
week later than the first one.

## Why forecast-binned, not observed-binned

`by_forecast` selects the hours where a forecast itself called >= 3 m and asks what came. That is the calibration a
surfer relies on ("when it says big, is it big?"), and it is the only selection a calibration can act on, because at
serve time only the forecast is known. Selecting by the OBSERVED height instead picks the hours where the truth
happened to be high; any forecast with real scatter regresses toward the mean on those hours and reads LOW even when
it is perfectly calibrated. The observed view is still fair for comparing two forecasts on the same hours (the paired
block), never for sizing a correction.

Null control (`--null-control`, synthetic, 200,000 hours): a CALIBRATED forecast, obs = forecast + N(0, 0.35 m).
Forecast-binned >= 3 m bias **-0.001 m** (n 12,741); observed-binned **-0.162 m** (n 14,299). The observed-binned
under-read is manufactured by the selection alone. The real data show the same thing: in every week and coast below,
the observed-binned equal-mean bias is more negative than the forecast-binned one (e.g. week C atlantic_se
-0.67/-0.80/-0.99 observed-binned vs -0.62/-0.70/+0.03 forecast-binned; pacific_ne -0.32/-0.33/-0.32 vs
-0.16/-0.16/-0.10). The "every model reads 0.3-0.8 m low on 3 m+ days" line behind STATE item 5 is the
observed-binned view and must not size a calibration.

## Data paths considered

1. The ledger's own report (`/api/weather/buoy-calibration`, `forecast_skill_consensus.by_lead[*].big_swell`) is
   served only by the live backend: not called (brief). No saved copy exists on this machine (searched the temp
   scratchpads, Downloads and the project transcripts for `forecast_skill_consensus`: none).
2. The scored rows sit in Storage behind the service key; the one-off `scored-rows-gate.yml` (#357) prints coast x
   forecast-band tables for served vs GFS_SCALAR only, not the equal mean's own >= 3 m calls. Not dispatched.
3. **Already on the record, ledger-grade:** the 2026-10-17 session read report R (generated 2026-10-16T23:20Z, held-out
   window 10-09T23:20Z..10-16T23:20Z, disjoint from 09-23..09-30) and wrote its `by_forecast_by_region` into
   `log/2026-10-17-served-height-gap.md` (commitments table), but never ledgered it, so 217 stayed open.
4. **Public reconstruction (new, this session):** Open-Meteo marine `wave_height_previous_day{1,2,3}` (value predicted
   24/48/72 h before the valid hour) for the three ledger members at each buoy's coordinates (`ncep_gfswave025` =
   served GFS-Wave lane, `ecmwf_wam025` = EURO lane, `dwd_gwam` = ICON lane), NDBC WVHT via NOAA CoastWatch ERDDAP
   (`cwwcNDBCMet`, nearest report within 30 min), 2-hourly targets (~ the ledger's 12 precompute runs a day), every
   member present on every pair, binned by the ledger's own `skill_consensus._by_forecast_by_region` (imported).
   Population: the in-region stations that report WVHT in NDBC's `latest_obs.txt` (the candidate set
   `map_spots_to_ndbc_buoys.py` maps spots from): 121-126 stations, against the ledger's ~58 spot-matched buoys.

## Table 1: the two named coasts, ledger-grade (equal mean / served, own >= 3 m calls, 24/48/72 h)

| Week | Source | atlantic_ne | atlantic_se |
|---|---|---|---|
| A: 09-23T18:55Z..09-30T18:55Z | ledger report, pass 2026-09-30T20:57Z (log 2026-09-30-c188, seq 216) | -0.201 / -0.126 / -0.205 (n not recorded; "at the threshold") | "very low for both models", n < 30 |
| B: 10-09T23:20Z..10-16T23:20Z (disjoint) | ledger report R (log 2026-10-17, commitments table) | served n 7 / 5 / 2, equal n 0 / 0 / 0 | served n 5 / - / 2, equal n 3 / - / 0 |

**Verdict on 217 as written: NOT TRIGGERED.** Neither named coast reaches n >= 30 in week B (the equal mean made no
>= 3 m call on atlantic_ne at all), so "the same coast beyond ~0.2 m with n >= 30 in BOTH weeks" cannot hold. No
regional calibration is built. atlantic_ne's week-A -0.2 m was one stormy week; the next disjoint week had no big
calls to calibrate.

## Table 2: every coast, PUBLIC RECONSTRUCTION (served / equal, forecast-binned >= 3 m, bias m (n); thin cells n only)

| Coast | Lead | Week A 09-23..09-30 | Week B 10-10..10-17 | Week C 11-03..11-10 (new, disjoint) |
|---|---|---|---|---|
| atlantic_ne | 24 | -0.036 (491) / +0.059 (521) | +0.175 (23) / -0.097 (13) | n 2 / n 2 |
| | 48 | -0.150 (457) / -0.010 (514) | -0.019 (14) / -0.177 (10) | n 2 / n 2 |
| | 72 | -0.308 (399) / -0.141 (473) | n 5 / +0.093 (12) | n 2 / n 2 |
| atlantic_se | 24 | +0.175 (78) / +0.168 (79) | n 4 / n 4 | -0.502 (24) / **-0.617 (32)** |
| | 48 | +0.019 (71) / -0.002 (65) | n 2 / n 4 | -0.441 (21) / -0.704 (20) |
| | 72 | -0.100 (61) / -0.117 (56) | n 2 / n 4 | +0.554 (30) / +0.034 (27) |
| gulf | 24 | none | -0.420 (10) / -0.201 (12) | none |
| | 48 | none | +0.700 (10) / +0.172 (14) | none |
| | 72 | none | +0.337 (14) / +0.477 (14) | none |
| hawaii | 24 | -0.095 (198) / +0.157 (246) | n 4 / -0.262 (23) | **-0.345 (85)** / -0.055 (196) |
| | 48 | -0.124 (180) / +0.032 (231) | -0.332 (10) / -0.217 (23) | **-0.301 (81)** / -0.067 (193) |
| | 72 | -0.125 (153) / +0.093 (237) | -0.370 (12) / -0.162 (21) | **-0.216 (102)** / -0.021 (184) |
| pacific_ne | 24 | +0.144 (269) / +0.073 (289) | -0.004 (537) / +0.022 (560) | -0.153 (1085) / -0.159 (1159) |
| | 48 | +0.269 (304) / +0.102 (311) | +0.043 (523) / +0.032 (550) | -0.119 (1096) / -0.159 (1163) |
| | 72 | +0.104 (209) / -0.091 (250) | +0.051 (500) / -0.005 (525) | -0.011 (1128) / -0.099 (1182) |

Pooled equal mean, forecast-binned: week A +0.091 / +0.031 / -0.073; week B +0.001 / +0.019 / +0.003; week C
-0.154 / -0.153 / -0.086.

## Table 3: positive control (does the reconstruction reproduce the ledger where the ledger has a number?)

| Cell | Ledger | Reconstruction (wave-reporting set) | Reconstruction, CDIP-nearshore 462xx subset |
|---|---|---|---|
| Week A, pooled equal | -0.09 / -0.04 / -0.02 (16:31Z pass, overlapping window) | +0.091 / +0.031 / -0.073 | - |
| Week A, atlantic_ne | -0.201 / -0.126 / -0.205 | equal +0.059 / -0.010 / -0.141; served -0.036 / -0.150 / -0.308 | - |
| Week A, hawaii equal | +0.44 to +0.67 (n >= 62) | +0.157 / +0.032 / +0.093 | - |
| Week B, atlantic_ne n (served / equal) | 7/5/2 and 0/0/0 | 23/14/5 and 13/10/12 | - |
| Week B, pacific_ne equal | -0.340 / -0.234 / -0.370 (n 135/157/140) | +0.022 / +0.032 / -0.005 (n 560/550/525) | -0.160 / -0.205 / -0.190 (n 74/71/72) |

**The positive control FAILS.** The reconstruction reproduces the ledger's counts in shape (atlantic_ne quiet in week
B) but not its biases: gaps of 0.1-0.4 m, sometimes the opposite sign, which is larger than the 0.2 m threshold the
rule tests. Two causes, both visible: (1) POPULATION: restricting pacific_ne to the CDIP nearshore buoys moves the
week-B equal mean from +0.02 to -0.16..-0.21 m, most of the way to the ledger's -0.23..-0.37 (the ledger's buoys are
the ones nearest a surf spot, mostly CDIP nearshore; ~23 in pacific_ne against 60 here, sized from the #357 gate's
pair counts); (2) INPUTS: the ledger's lanes are our regridded tiles sampled by our sampler, not Open-Meteo's grids.
Per member on week A (diagnostics file): Open-Meteo's GWAM reads +0.54..+0.65 m on its own Hawaii >= 3 m calls, the
same "ICON high" the ledger reports, but the ledger's equal mean over-read Hawaii far more than this one does.
**So Table 2 is not decision-grade for a 0.2 m rule.** It is reported because it is the only every-coast view, and
because its signs point at where the ledger should look next.

## Extension to every coast: what can and cannot be said

- **pacific_ne:** the only coast where a ledger number exceeds 0.2 m with n >= 30 (week B equal -0.340/-0.234/-0.370,
  n >= 135). Its week-A value was never recorded, so the BOTH-weeks rule cannot be applied from the record. The
  reconstruction's CDIP subset reads -0.29/-0.04/-0.21 (week A) and -0.38/-0.33/-0.28 (week C, n ~300): consistent
  with a real nearshore-buoy under-read at forecast >= 3 m, but not decision-grade (Table 3).
- **hawaii:** week A ledger equal over-call +0.44..+0.67 (n >= 62); the reconstruction's equal mean is near zero in
  week C (-0.06/-0.07/-0.02, n ~190), while the served GFS lane reads -0.35/-0.30/-0.22 (n 81-102) there. Under the
  dark Hawaii-only rule (`CONSENSUS_SERVE_KEEP_GFS`) the served lane is the one that matters in Hawaii; it is not
  graded by `by_forecast_by_region` in the ledger for week B (not recorded).
- **atlantic_se:** week C equal -0.617 (n 32) at +24 h only; the other leads are n 20-27 or sign-flipped (+0.034 at
  72 h). Week A and week B n < 30. Not triggered.
- **gulf:** n <= 14 every week. Not triggered.
- **atlantic_ne:** see Table 1. Not triggered.

## Verdict

1. **Commitment 217 (as written, the two named coasts): fulfilled, rule NOT triggered**, on ledger-grade evidence from
   two disjoint weeks (A and B). No dark regional calibration is built.
2. **The every-coast extension is UNDECIDED.** The only key-free path (public archives) fails its positive control by
   more than the threshold. pacific_ne is the one candidate worth a ledger-grade read (and hawaii's served lane, if
   the Hawaii-only rule is ever flipped).
3. STATE "Next fixes" item 5 stays deprioritised; this session changes nothing there.

## What the decision-grade read needs (BLOCKED on the owner's word; not done)

Any ONE of:
- (a) the ledger report for a week after 2026-10-17: one cached `GET /api/weather/buoy-calibration` (the read the
  monitor itself makes; live backend, so the owner's word), reading
  `forecast_skill_consensus.by_lead[*].big_swell.by_forecast_by_region` for every coast; or
- (b) a dispatch of `scored-rows-gate.yml` after adding an equal-mean `by_forecast_by_region` table to
  `scored_rows_analysis.py` (code + the owner's dispatch word); or
- (c) a small monitor change that prints `by_forecast_by_region` (aggregates, n >= 10 cells only) to the scheduled
  Forecast Accuracy Monitor's public log: no dispatch and no key in a session's hands, the next scheduled run reads it.
  (c) is the cheapest standing instrument and is the recommendation.

The re-read rule for pacific_ne, pre-registered here: take two disjoint ledger weeks after 2026-10-17 (week B's
-0.34/-0.23/-0.37 does NOT count as one of them, since it prompted the question); build a dark calibration only if
pacific_ne's equal-mean forecast-binned bias is beyond 0.2 m in the SAME direction with n >= 30 at the same lead in
both.

## If a calibration is ever triggered (described, not built)

Dark, default off, behind its own flag (`BIG_SWELL_REGION_CAL`, unset = no change), registered in `_RATING_FLAGS`:
for the triggered coast and lead only, scale the served height above 3 m by a factor fitted on the training weeks'
own >= 3 m calls (`obs / forecast` median, clamped to 0.8-1.25), continuous at 3 m (linear ramp 2.5-3.5 m) so no
height crosses a band edge discontinuously. Graded held-out against the uncorrected lane before any flip; a
SCOREBOARD row at the flip.

## Records

- SCOREBOARD row: 2026-11-12 05:50Z (this branch; the file is named for the session's start day, as the brief set).
- Ledger fragment `ledger.d/claude--big-swell-holdout-217.jsonl`: line 1 fulfils seq 217 (rule not triggered);
  line 2 a commitment for the every-coast extension (pacific_ne), due 2026-11-25, gated on (a), (b) or (c).
- Code: `backend/scripts/big_swell_holdout_offline.py` (new, offline research script; GET-only to public hosts; no
  test added, it imports the tested `skill_consensus._by_forecast_by_region` for the binning).
- Network this session: marine-api.open-meteo.com, coastwatch.pfeg.noaa.gov (ERDDAP), www.ndbc.noaa.gov
  (`latest_obs.txt`); GitHub Actions logs read with `gh run view` (precompute 43120065518, scored-rows gate
  41389448778). Nothing else.
