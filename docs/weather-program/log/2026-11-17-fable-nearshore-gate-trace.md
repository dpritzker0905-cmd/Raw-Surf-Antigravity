# 2026-11-17 Fable: why the nearshore surf-zone gate is red. A read-only trace, with its corrections

Session: Fable repair lead (`e372475c`). Branch `fable/nearshore-rows-scorer`. Written to the shared notes first
(05:20Z to 06:20Z) and copied here at 2026-11-17 05:59Z unchanged, corrections included. Read the two correction sections:
where they differ from the text above them, they win.


Asked for by David ("Yes, trace it", 2026-11-16 23:34 EST) and the director. Read-only. Nothing changed, nothing
dispatched, no private row read.

**Instruments.** (1) The `GATE` lines in the job logs of all 129 requested `nearshore-validation.yml` runs since
2026-09-27; the gate exists from 2026-10-17, so 89 graded readings. (2) The public `nearshore_report.json` artifact
of each of those 89 runs. Tables and scripts: scratchpad `nsv/` (copied beside this note: `gate.tsv`, `pull.py`,
`pull_art.py`). Periods below are run dates.

## 2026-11-17 05:20Z The answer in four lines

1. **There is no dated step, and the chain did not change.** Its median factors are the same all month (friction
   1.00, refraction 0.873, shoaling 0.96 to 1.00, exposure 0.90 to 0.95). The ocean changed: California's seas
   roughly tripled.
2. **The red bound was never met reliably.** 0.32 m was exceeded on 23 of the 83 runs (28%) inside the grace period.
3. **The parametric chain's under-read in California grows as the swell grows,** so it is worst exactly when the
   surf is biggest.
4. **A better model for those same rows is already in the reports:** CDIP's MOP grid reads two to three times closer
   at the California stations, every period.

## 1. Correction of my own hand-off

I told the director the error had gone "from 0.16 to 0.45 m, about three times worse". That compared today with the
single reading the bound was built from. The gate's own history:

| period | runs | MAE median (min to max), m | observed over model, median | runs above 0.32 m |
|---|---|---|---|---|
| 10-17 to 10-23 | 27 | 0.272 (0.190 to 0.484) | 1.138 | 8 |
| 10-24 to 10-30 | 21 | 0.320 (0.258 to 0.422) | 1.245 | 10 |
| 10-31 to 11-06 | 18 | 0.259 (0.185 to 0.352) | 1.317 | 2 |
| 11-07 to 11-13 | 15 | 0.241 (0.185 to 0.321) | 1.332 | 1 |
| 11-14 | 2 | 0.345 | 1.381 | 2 |
| 11-15 to 11-16 | 6 | 0.445 (0.373 to 0.510) | 1.512 | 6 |

- All 89: MAE min 0.185, median 0.291, max 0.510 m. The basis figure of 0.162 m is below every reading the gate has
  made. The bound's own comment calls it "ONE reading, provisional".
- The last six runs ARE the worst stretch on record. That part of the alarm is real.
- The ratio (scale-free) rose all month while the MAE in metres fell in the middle weeks. An MAE in metres mixes
  how wrong the chain is with how big the sea is.

## 2. Where it comes from: California, and bigger seas

Median observed over model, per station (1.00 is right; above 1 the chain is low):

| station | region | 10-17..23 | 10-24..30 | 10-31..11-03 | 11-04..06 | 11-07..14 | 11-15..17 |
|---|---|---|---|---|---|---|---|
| 103p1 | California | 1.50 | 1.46 | 1.54 | 1.48 | 1.68 | 1.73 |
| 142p1 | California | 1.33 | 1.35 | 1.29 | 1.33 | 1.45 | 1.37 |
| 153p1 | California | 1.07 | 1.25 | 1.30 | 1.32 | 1.41 | 1.57 |
| 262p1 | California | 1.10 | 1.24 | 1.37 | 1.34 | 1.34 | 1.55 |
| 134p1 | Florida east | 1.21 | 1.32 | 1.47 | 1.38 | 1.35 | 1.84 |
| 143p1 | Florida east | 0.80 | 0.86 | 1.10 | 1.09 | 0.87 | 1.11 |
| 265p1 | Florida east | 1.16 | 1.11 | 1.18 | 1.09 | 1.11 | 1.31 |
| ndbc:42035 | Gulf | 1.77 | 1.50 | 1.59 | 1.67 | 2.14 | 1.90 |
| ndbc:42098 | Gulf | 2.08 | 1.78 | 1.70 | 2.33 | 2.40 | 2.13 |
| 150p1 | mid-Atlantic | 1.40 | 1.46 | 1.75 | 1.41 | 1.55 | 2.63 |
| 433p1 | mid-Atlantic | 1.32 | 1.45 | 1.36 | 1.37 | 1.28 | 1.54 |

Rough observed height at the California stations over the same periods (derived from each station's bias and ratio,
so approximate): 142p1 1.3 to 3.9 m; 153p1 0.7 to 2.0 m; 262p1 0.7 to 2.0 m; 103p1 0.8 to 1.1 m.

- California's share of the n-weighted absolute error went 27% to 62% while its share of rows stayed about 40%.
- At 153p1 and 262p1 the ratio rises with the sea, period after period, starting BEFORE the two California-only
  changes of 11-04 and 11-05. That is a size- or period-dependent under-read, not a merge.
- Outside California the chain reads low at most stations all month: the two Gulf buoys at 1.5 to 2.4 (the chain is
  about half the buoy), the mid-Atlantic at 1.3 to 1.75. Florida east is the closest (143p1 near 1.0, 265p1 near 1.1).
  Florida east's MAE improved over the month (0.31 to 0.14 m) because its seas got smaller.

## 3. The reports already contain a better arm for California

Every report carries `mop_grid_ab`: the same California rows scored with the parametric chain ("bulk") and with
CDIP's MOP grid nearshore sea ("arm").

| period | rows (median) | bulk MAE | MOP grid MAE | bulk ratio | MOP grid ratio | share of rows where MOP is closer |
|---|---|---|---|---|---|---|
| 10-17 to 10-23 | 24 | 0.173 | 0.080 | 1.11 | 0.98 | 0.75 |
| 10-24 to 10-30 | 21 | 0.201 | 0.070 | 1.29 | 0.97 | 0.85 |
| 10-31 to 11-03 | 32 | 0.277 | 0.092 | 1.38 | 1.01 | 1.00 |
| 11-04 to 11-06 | 24 | 0.302 | 0.129 | 1.42 | 1.07 | 0.82 |
| 11-07 to 11-14 | 24 | 0.360 | 0.115 | 1.44 | 1.07 | 0.96 |
| 11-15 to 11-17 | 24 | 0.655 | 0.309 | 1.58 | 1.16 | 1.00 |

- This arm is what `SURF_NEARSHORE_MOP` serves, and it is ON for the EURO member at California spots since
  2026-11-05. **So in California the gate's headline grades a chain that EURO users no longer get.** GFS and ICON
  members there still get the bulk chain.
- Even MOP reads low in the biggest seas (1.16, MAE 0.31 m in the last period).
- The other two built-in arms: `legacy_friction_ab` (friction back on) is worse in the last four periods, so
  friction off stands. `mop_ab` (MOP's validation-point forecast) was better than bulk until 11-03 and is worse from
  11-04 on (0.334 against 0.281, then 0.789 against 0.629). That IS a dated flip and I have not explained it.

## 4. Flaws in the instrument

- **Half the stations are dead.** 11 of the 22 stations on file return 404 on every one of the 89 runs (043p1, 101p1,
  115p1, 116p1, 129p1, 161p1, 172p1, 207p1, 254p1, 261p1, 266p1). The gate has only ever graded 11. The pair table
  was refreshed on 11-08 and still lists them.
- **The reading depends on the hour the cron fires.** Pooled ratio by run hour: 00Z 0.98 (9 runs) against 1.15 to
  1.5 at most other hours. Not explained.
- **A quarter to a third of the validation's point calls fail** on every run (median 13% to 33% by period; 42 of 189
  on the latest). The job grades on what is left.
- **The bound is in metres,** so it goes red when the surf is big even if the chain is no worse in proportion.

## 5. What I would do, in order (none of it done)

1. **Do not treat the red as a regression to revert.** No merge caused it.
2. **Re-base the gate** on its own 83-run history, and add a scale-free bound beside the metre one. This changes a
   registered threshold, so it needs the advisor and the owner; I am not proposing numbers here.
3. **Grade what is served.** The headline should score the MOP arm where MOP is what a member serves, and say which
   member. Otherwise the gate stays red on a number nobody in California on EURO sees.
4. **Decide whether California's GFS and ICON members should also break from MOP.** It is two to three times closer
   on buoy truth for a month. It is an ECMWF-driven product, so it is a mixing decision, a served change, and needs
   the D-065 path. This is the largest gain available with truth already in hand.
5. **The size-dependent under-read outside MOP's reach** (Gulf, mid-Atlantic, and California's parametric path) is
   what the S0 gate's scored read on 2026-12-08 is built to split by factor. Its level-against-pattern test matters
   here: the factors did not change, the under-read did.
6. **Fix the instrument:** prune or replace the 11 dead stations, add Hawaii, explain the 00Z effect and the failed
   point calls.

**Limits of this trace.** Run-level and station-level medians from public reports, not rows. The observed heights
are back-computed and rough. One month, one season. The MOP comparison covers four California stations and about 24
rows a run. I have not opened why `mop_ab` flipped on 11-04, the 00Z effect, or the failed calls.

## 2026-11-17 05:55Z Corrections after the advisor's read (2026-11-17 05:55Z). Where this section and the text above differ, this wins

The advisor recomputed the table from `gate.tsv` and it matches. Its read of the claims changed several of them.
What I checked since is from the validation's own code on `dev` (`backend/scripts/run_nearshore_validation.py`,
`services/weather_pipeline/nearshore_validation.py`, `.github/workflows/nearshore-validation.yml`).

**1. "The chain did not change" is WITHDRAWN as written.** What the evidence supports is narrower: the median
TRANSFORM factors are flat all month. Three things that claim did not cover:
- **The forcing changed on 2026-11-04 at the Bight stations, with no chain-file merge.** The validation's headline
  arm ("bulk") is `model=GFS` from the live `/api/weather/point`, its offshore height put through the validation's
  own transform. `SURF_BIGHT_HS_CONSENSUS` (ON since 11-04) makes the GFS offshore height inside the Southern
  California Bight a GFS and EURO mean. So from 11-04 the bulk arm at the Bight stations is graded on a different
  input. I said the growth "starts before the two California-only changes"; that is still what the ratios show, but
  the baseline is not one thing across 11-04, and I had not noticed.
- **The under-read may sit in the forcing, not the transform.** If the model's offshore height is low in big swell,
  every transform reads low and the factors stay flat. Not split here. The split is the model's offshore height
  against deep-water buoys at the same hours (the accuracy monitor's rows).
- **Refraction is 0.873 at the median every period because it is a constant in the code,** not a computed
  refraction. A constant where the true factor varies with period and direction would produce exactly "the
  under-read grows with the swell".
- `SURF_NEARSHORE_MOP` does NOT change the bulk arm: the validation never asks the backend for a surf height, it
  computes its own from the offshore height. So the bulk arm is the parametric path for the GFS member throughout.
  The flip of `mop_ab` on 11-04 lines up with the Bight consensus changing the baseline; still not explained.

**2. "California's seas roughly tripled" is WITHDRAWN.** It was back-computed from each station's bias and ratio
medians. The stations are public CDIP buoys; the claim should be read off their own record or not made. Not done.
The ratio tables are direct and stand.

**3. "The under-read grows with the swell" is a HYPOTHESIS, and it is one case, not two.** Size, period and direction
rise together in a swell, and 153p1 and 262p1 are neighbours in one swell field. Public medians cannot separate the
three; the private rows can (bins by offshore height, peak period, direction).

**4. "MOP is two to three times closer" must not go near a served decision until INDEPENDENCE is established.** MOP is
CDIP's own product and the truth here is CDIP's buoys. If MOP is driven or corrected by those same buoys the
comparison is partly circular. Not checked. Also:
- The scheduled runs grade the last 24 hours at 3-hour steps (9 target times) and fire every 6 hours, so each target
  time is graded by about four runs. "24 rows a run for a month" is far fewer independent rows than it looks, and
  the same is true of every period median in this note.
- Putting an ECMWF-driven nearshore sea inside the GFS and ICON members changes what those members ARE. The owner's
  rule is that the system puts out NOAA, EURO and ICON from their own free data. That is his decision, not a detail.
  My step 4 above is withdrawn as a recommendation; it is a question for him, after independence is known.

**5. The instrument.**
- The failed point calls are calls to the LIVE backend: about 190 a run, three or four runs a day, a quarter to a
  third failing. That is a standing load on the one shared box, and the failures are unlikely to be at random.
- The 00Z effect is partly confounded: every 00Z run is on or before 11-08, when the seas were smaller. It still
  sits below 23Z and 01Z, which are the same delayed 21:20 cron an hour either side. Not explained. An instrument
  that moves by a quarter with the hour cannot carry a 0.32 m bound; this comes before any re-basing.
- "Re-base the gate on its own history" (my step 2) is moving a threshold after results. Withdrawn. What it needs is
  a new registration whose numbers come from a rule fixed before later runs are looked at, a scale-free bound beside
  the metre one, and the old red left recorded as red.

**6. An expectation for the S0 gate, written now, before any counts-only report exists.** With 11 stations
reporting and not 22, the live stations are: California 4 (103p1, 142p1, 153p1, 262p1), Florida east 3 (134p1,
143p1, 265p1), Gulf 2 (ndbc:42035, ndbc:42098), mid-Atlantic 2 (150p1, 433p1), Hawaii 0. The scorer's cell minimum
is 3 stations. So I expect S0 to be testable pooled, in California and in Florida east, and UNTESTABLE in the Gulf,
the mid-Atlantic and Hawaii. Any served change resting on it would be limited to California and Florida east.

**What stands.** No merge of a chain file caused the red. The bound was exceeded on 23 of 83 runs inside the grace
period. The last six runs are the worst on record. The error is concentrated at the California stations. Eleven of
22 stations have never been graded. Steps 1, 3 and 5 above (no revert; grade what each member serves, and say which;
read S0's verdicts by sea size) were agreed.

## 2026-11-17 06:20Z The 00Z dip, checked: mostly the pooling, not a pairing fault. One run left unexplained

The advisor made this the first open item, because the S0 scorer keeps the LATEST run's row for each target time, so
a pairing fault after midnight UTC would sit inside the scored data. Checked on the 89 public reports only.

**What the gate's headline ratio is.** The median over ROWS, and a row is a spot-hour. Station 143p1 (Cape Canaveral)
has six linked spots, so one buoy reading makes six rows. It supplies a median 28% of all rows (5% to 48% by run)
and reads 0.88 (the chain is HIGH there), while most other stations read 1.2 to 2.4. The pooled row median therefore
sits in a gap between two groups and jumps when the mix shifts a little.

**The test.** Recompute each run's ratio as the median of the per-STATION medians (one value per station).

| runs on or before 11-08 | pooled row median (the gate's) | station-balanced median |
|---|---|---|
| 00Z runs (9) | 0.980 | 1.262 |
| other hours (63) | 1.220 | 1.350 |
| difference | 0.241 | 0.087 |

- About two thirds of the dip goes when stations are weighted equally. The per-station ratios in the 00Z runs match
  the runs either side of them at almost every station.
- The 0.087 that remains is nine runs against a run-to-run spread of 0.118 in the balanced statistic. I cannot call
  it real or noise from public medians.
- **One run is not explained:** 2026-10-28 00:35Z. Its balanced ratio is 1.030 against 1.3 or so in the runs either
  side, with several stations low at once on three coasts (103p1 0.99, 153p1 0.95, 262p1 0.91, ndbc:42098 1.03,
  433p1 0.76). That pattern, across coasts in one run and not its neighbours, is what a pairing or forecast-cycle
  fault would look like. It predates the S0 window and its stored rows. (2026-11-02 00:54Z also reads low, but so
  does the run five hours before it: that one is the ocean, not the hour.)
- **So: no evidence of a standing pairing fault at the day boundary; one suspect run; not disproven.** A direct test
  needs rows with the hour: compare, for the same target times, what a run just before and just after midnight UTC
  stored. The private rows can do that from 2026-11-16 on.

**What this changes about the gate's headline, which is larger than the 00Z question.**

| period | pooled row median (the gate's) | station-balanced median |
|---|---|---|
| 10-17 to 10-23 | 1.138 | 1.301 |
| 10-24 to 10-30 | 1.245 | 1.368 |
| 10-31 to 11-06 | 1.317 | 1.388 |
| 11-07 to 11-14 | 1.346 | 1.414 |
| 11-15 to 11-17 | 1.512 | 1.622 |

Weighted by station, the chain reads 30% to 62% low, not 14% to 51%. The headline ratio, and the n-weighted MAE with
it, are diluted by one over-counted station that happens to read high. Pooled and balanced differ by more than 0.2
on 17 of 89 runs.

**The S0 scorer is not exposed to this.** Its unit is the station-day (one value per station per day), so a station
with six spots counts once. It is exposed only to a true pairing fault, which is the suspect run above.

**One more limit for everything in this note** (advisor): the scheduled runs grade the last 24 hours at 3-hour steps
and fire every 6 hours, so each target time is graded about four times. Every period median here rests on roughly a
quarter of the independent rows its run count suggests. The S0 scorer keeps one row per target time and is not
affected.

**For the scored report's caveats** (advisor): the Bight consensus flag has been on since 11-04, before the S0 window
opened, so it is constant inside the window; "GFS" at the Bight stations is a GFS and EURO mean there.
