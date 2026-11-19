# 2026-11-19 Fable: pre-registration of the coastal band's buoy comparison (REGISTERED)

Session: Fable repair lead (`e372475c`). Branch `fable/coastal-band-buoy-prereg`. A pre-registration only: no code,
no data read, nothing dispatched. No served number moves.

## 2026-11-19 00:28Z Registration

**Asked for by David**, typed in this session: "Bounce this off of reflection. Then write the buoy comparison
pre-registration and send it to the advisor". The advisor read version 2 in full and passed it as a
pre-registration subject to three wording fixes (the multiplicity sentence, the label-swap null, the exact low-bias
rule), "exactly as below and you may commit it without sending it back". Those three fixes are in the text below.

**Registered by this commit.** No buoy observation, no band value and no served value had been read when it was
committed. Two addenda exist as drafts and are NOT registered here: a DWD European regional arm (the advisor has
not passed it) and a three-model consensus arm (with the advisor). Each will be its own document.

One question is open with the advisor and does not change this text: whether the wave-size split should use
forecast terciles instead of observed ones. It stands as written (observed) unless a later, separately registered
amendment says otherwise, made before any number is read.

---

## What it decides

Whether the point path may read the coastal band, ON, for a model. It is the primary evidence for a change at up to
728 of 1,769 active spots (and at most of a grown catalogue), where the forcing moves from a 2 or 10 degree cell, or
from Open-Meteo's copy of the model, to the agency's own 0.25 degree values.

It also sets one design number: how old a band run may be before the band steps aside.

## What it cannot decide (keep this in view when reading a PASS)

- **There is no nearshore truth in this test.** Buoys are offshore and mostly in deeper water than a break. The test
  cannot see an error within a cell of land where no buoy sits, and an offshore "not worse" result can pass a change
  that is wrong nearshore. I have no nearshore truth I am allowed to use: the program's rule is no USACE data, which
  rules out the CDIP nearshore buoys. This limit is OPEN. A PASS here is a PASS on offshore inputs only.
- Whether the surf height at a spot is better. This compares the OFFSHORE inputs the band changes (significant
  height, peak period, direction). The conversion to breaking height is unchanged by the band and is not tested.
- **Where the evidence comes from.** NDBC stations are mostly in United States waters. The result is measured there
  and extended to other coasts BY ARGUMENT (same model, same grid, same reduction), not by measurement.

## Population

- **Primary:** EVERY NDBC station that reports significant wave height and lies in a band cell at the width under
  test, whether or not a regional box covers it. The comparison is band against WORLD GRID, and that does not depend
  on a tile existing at the station, so T-grid is FORCED to the stored world product at every station.
- **Stratum, reported:** the stations outside all 14 regional boxes (the population the band actually serves).
- **Inside-box stations serve twice:** in this comparison, and in the plumbing gate against the regional tile.
- A station census (positions only, no observations) is run first and reported: stations at widths 1, 2 and 3, by
  region and by inside/outside a box. Regions are fixed now: North America Pacific; North America Atlantic and Gulf;
  Hawaii and Pacific islands; Europe; everything else.
- **Minimum sample:** 20 stations pooled and 10 three-day blocks. Below either, the verdict is INCONCLUSIVE. A region
  with fewer than 5 stations is reported and NOT tested.

## Arms, per model (GFS, ICON; EURO has its own section)

At the same station, valid hour and model run:

- **T-grid:** the stored world product's answer at the station (forced, see above).
- **T-fallback:** the Open-Meteo copy's answer, at the stations where today's path would fall back. Reported apart
  from T-grid and never pooled with it.
- **B:** the band answer from the newest run.
- **B-lag:** the band answer from runs 8, 16, 24, 32 and 48 hours older, at the same valid hour.

How the values are produced: offline, in CI, from stored products and the agency fields, through the real point path
with the band reader. No call to the live backend. No private scored row is read on a developer machine; the job
prints aggregates only.

## Window and lead bands

- **Window:** at least 30 consecutive days, which is the 10 three-day blocks the minimum sample requires. A bootstrap
  on fewer blocks is not run. The dates are fixed when the collection workflow is first dispatched and recorded in the
  ledger. No day is dropped afterwards except for a missing agency run, which is listed.
- **Lead bands, tested separately:** 0 to 24 hours, and 24 to 72 hours, with Holm across the two.
- **Reported, not tested:** 72 hours to each model's native horizon. The spot hub shows those days.

## Metrics and resampling

For height and period: MAE and mean error per arm, and the PAIRED difference B minus T per station-hour. For
direction (stations that report it): circular MAE and its paired difference.

**Resampling unit: the three-day TIME block, taken across ALL stations together.** Stations share weather; resampling
station-hours, or blocks station by station, understates the interval. A resample draws whole three-day periods with
replacement and takes every station's hours in each. 95% bounds, 10,000 resamples, seed fixed in the script.

## Margins (non-inferiority, fixed now)

The band is "not worse" when the UPPER 95% bound of the paired MAE difference (B minus T) is at or below:

| quantity | margin |
|---|---|
| significant height | +0.02 m |
| peak period | +0.3 s |
| direction | +5 degrees |

- These three numbers are my proposal, chosen so that a planted 0.05 m error is well outside the height margin. They
  are not derived from a served-number tolerance.
- **What the design cannot see:** a true harm between +0.02 m and +0.05 m. Above the margin it is a harm; below the
  smallest planted error nothing proves the test would catch it. The smallest harm this design is SHOWN to detect is
  0.05 m in height, 0.5 s in period and 10 degrees in direction, and only if the planted-error control passes.
- **Big days.** Errors grow with wave size and big days matter most. The split is by terciles of the MEAN of the two
  compared arms' FORECAST height at each station-hour (T-grid and B), which treats the two arms alike. Cut points
  come from the pooled values in the window and are computed before any error is computed. One further tested
  condition: height not worse in the TOP tercile of that mean forecast, pooled.
  The split by OBSERVED height is reported beside it, labelled "descriptive, selected on the outcome, not tested".
  (Binning on the observation selects on the thing being scored; binning on one arm's own forecast works against
  that arm.)

"Better" is a separate, stronger claim: the upper bound is below zero. It is reported; it is not required.

## Controls that must hold before any verdict is read

1. **Plumbing (hard gate).** At inside-box stations, band and regional tile agree within the encoding: 0.0005 m,
   0.005 s, 0.005 degrees on the circle. One violation fails the whole comparison: it is a bug, not a statistic.
2. **Planted errors (power).** Add to arm B, one at a time: +0.05 m, -0.05 m, +0.10 m in height; +0.5 s in period;
   +10 degrees in direction. Each must turn the matching "not worse" into a FAIL. If a planted +0.05 m does not fail,
   the sample cannot see an error of that size: verdict INCONCLUSIVE.
3. **Label-swap null.** Shuffle the B and T labels within each station-hour, 1,000 times. Under shuffled labels the
   true difference is zero. The claim BETTER (upper bound below zero) occurs in at most 7% of 1,000 shuffles, and the
   claim WORSE (lower bound above the margin) in at most 7%. If either rate is exceeded the instrument is void.
4. **Low bias.** Let d = (mean error of B) minus (mean error of T-grid), in height, with its 95% bound from the same
   block resampling. FAIL if the UPPER bound of d is below -0.05 m. This holds even if MAE passes.

## Pass rule

For a model, the band may be read ON when ALL hold:

- the minimum sample is met and all four controls hold;
- height: not worse than T-grid pooled, in each of the two lead bands (Holm), in every tested region (Holm across
  regions), and in the top tercile of the two arms' mean forecast height pooled;
- period and direction: not worse than T-grid pooled, in each lead band;
- T-fallback (the Open-Meteo copy): the band is within the margin of it in BOTH directions. It is the same model at
  the same resolution, so a difference is expected to be near zero.

**If T-fallback differs by more than the margin in either direction,** that is a finding about our own sampling, not
about the band's skill. The next step is to find the sampling difference (which cell, which reduction, which run
time). The verdict is INCONCLUSIVE until it is explained. It is not a FAIL.

Because every condition must hold, no correction is applied across families; the cost is power, so INCONCLUSIVE or
FAIL is more likely as conditions are added. (Holm is applied within the lead-band family and within the region
family, which only makes passing harder.)

Three verdicts only: PASS, FAIL, INCONCLUSIVE. Only PASS turns the band on. The history filter and the owner's typed
word still apply after a PASS; this is evidence, not permission.

## The staleness number: a fixed sequence

The lags are tested IN THIS ORDER: 8, 16, 24, 32, 48 hours. At each, B-lag is compared with FRESH T-grid at the same
valid hour, in height, with the height margin. Testing STOPS at the first lag that is not "not worse". The band's age
limit is the last lag that passed.

- The order and the stopping rule are written here, first, which is why no multiplicity correction is applied. A lag
  beyond the first failure is not tested and not reported as passing, whatever it would have shown.
- Until this is read, the limit is 24 hours. With the pilots pass every 8 hours that tolerates one failed run (about
  18 hours) and steps aside on the second (about 26 hours).
- If the 8-hour lag fails, the band must never serve a previous run, and the design goes back.

## EURO: three arms, its own family

One day of data (`upstream_route_census.py`, 2026-08-03, n=70) had EURO via Copernicus MFWAM at MAE 0.159 m against
ECMWF open-data waves at 0.339 m. It cannot rank them. So, with the same stations, window, metrics and controls:

- (a) ECMWF open-data waves 0.25 degrees; (b) Copernicus MFWAM 1/12 degree sampled on the band cells; (c) ECMWF
  open-data waves 0.1 degrees.
- Each against T-grid for EURO, Holm across the three arms and the two lead bands.
- The EURO band stores the arm with the lowest height MAE among those that PASS. No arm passing means no EURO band.
- If (b) wins, the data under the "EURO" name is Meteo-France's model. The label is the owner's decision and is taken
  BEFORE any EURO band ships; this comparison does not decide it.

## The band width

Not decided by this comparison. It is fixed first, from the count of catalogue spots with four valid corners per model
(the advisor's item 5), and this comparison is then run at that width only.

## What would void this

Reading any observation or band value before this text is committed; changing a margin, a region, a lead band, the
tercile rule, the lag order, the window or the pass rule after; dropping a station or a day for a reason not listed
here; pooling T-grid with T-fallback; resampling anything other than whole time blocks across all stations.

## Second opinion used

Reflection (asked at David's request, 2026-11-19; advisory, not an authority). Taken: split the T arm; margins fixed
in advance; low-bias and period/direction planted errors; the hard plumbing gate; minimum counts with an INCONCLUSIVE
verdict; 24 hours as the interim age limit; the width following spot coverage. Not taken: an independent nearshore
check before turning on, which I cannot meet without data the program rules out; it is the open limit at the top.

## Changes from version 1 (the advisor's seven, 2026-11-19)

1. Population: every NDBC station in a band cell, inside or outside a box, with T-grid forced to the world product;
   outside-box stations are a reported stratum; evidence stated as from where buoys are and extended by argument.
2. Window: 30 days minimum (10 blocks). "At least 15 days" is removed.
3. Resampling: whole time blocks across all stations together.
4. Margins: a tercile split by observed height, a tested top-tercile condition, and the statement of what the design
   cannot see (a harm between +0.02 m and +0.05 m).
5. Age limit: a fixed sequence 8, 16, 24, 32, 48 h, stopping at the first failure.
6. T-fallback: a difference outside the margin is INCONCLUSIVE until explained, not FAIL.
7. Lead bands: 0-24 h and 24-72 h tested separately (Holm); 72 h to the native horizon reported.

