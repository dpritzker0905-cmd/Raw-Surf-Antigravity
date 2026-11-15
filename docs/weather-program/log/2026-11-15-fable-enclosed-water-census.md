# 2026-11-15 · fable · census of wave buoys the grid cannot represent: rule fixed before any result

Session: the Fable repair lead (worktree `fable-repairs-ec7369`). The owner typed in this session (2026-11-15 11:05 EST):
"start the enclosed-water buoy census". Offline, public data only: NDBC (station list and observations), NOAA's native
GFS-Wave 0.25 degree fields (NOMADS, already cached: 37 analysis fields, 2026-11-04 00Z to 11-13 00Z, every 6 h). No
backend call, no workflow dispatch, no private row, no served number, no code change in the product.

## 16:07Z Why, and what would come out of it

Buoy 46267 is excluded by name (#852) because the grid has no water at it and the sampler read open ocean 0.73 deg away.
Two geometric rules failed to generalise that. The only evidence that a fallback read is wrong is a buoy. This census
asks which OTHER wave buoys the same sampler path answers from somewhere else, and whether the answer is wrong there.
The outcome is a list of named stations with evidence (the form of the 46267 entry), or "no further station qualifies".
It produces no geometric rule and changes nothing served. Adding a station to the served exclusion is a separate,
owner-approved change.

## The rule, fixed now (no station has been classified and no bias computed at the time of this commit)

**Population.** Every station in NDBC's `latest_obs.txt` that reports a wave height (WVHT) at the time of the pull.
No hand-picked list. Stations are classified, not chosen.

**Classification, by what the sampler does on NOAA's native 0.25 degree mask** (a cell is water when the analysis
field has a value there in the last cached field):
- `open`: all four cells around the station are water.
- `partial`: one to three are water (the sampler blends or takes the wet corners of the station's own cell).
- `none`: no cell is water. The sampler takes the nearest water cell within max(1.5 cells, 1.0 deg) = 1.0 deg. This is
  46267's path. If no water lies within 1.0 deg the station is `unanswered` and drops out.
Also recorded per station: whether it lies inside one of our 0.25 degree pilot boxes (`pilot_regions.py`). Outside
them the product serves a coarser global tile with its own mask, which this census does not replay; those stations are
listed and marked "not our served path".

**Replay.** For each field, the value the sampler would give: bilinear over four wet corners; weights renormalised
over the wet corners for `partial`; the nearest water cell for `none`. Paired with the buoy's WVHT nearest in time,
within 40 minutes. Analysis fields (f000), so this measures where the water is read from, not forecast skill.

**"Wrong water" at a station** (two-sided; I told the director +0.30 m one-sided, and widen it here before any data
because a sheltered cell read for an exposed buoy is the same defect with the other sign): mean(model - buoy) of at
least 0.30 m in absolute value, with a day-block bootstrap 95% interval (2,000 draws, seed 20261115) that excludes 0,
on at least 20 pairs over at least 7 distinct days.

**Controls, both required or the census is INVALID.**
- Positive: 46267 must classify `none` and come out wrong water, with a bias between +1.0 and +2.0 m (the per-buoy
  split measured +1.47 to +1.52 m against best_match on other dates and other leads).
- Null: among `open` stations, the share flagged wrong water by the same test is the base rate of plain model error.
  If it exceeds 10%, the 0.30 m line does not separate wrong water from ordinary model bias and no station is named.

**Verdicts.**
- A CLASS EXISTS (the #883 bake-off gate becomes runnable) only if at least 3 `none` stations inside our pilot boxes
  have enough pairs to judge. Otherwise: NO CLASS, the exposure sweep stays untestable.
- Each judged `none` or `partial` station is reported as WRONG WATER, NOT SHOWN, or TOO FEW PAIRS, with its numbers.
- Limits, stated now: about 9 days in one season; an analysis field, not the served forecast; the global field stands
  in for our regional tiles (the same native cells inside a box, by `REGRID_NATIVE_CELL`); a station's judged bias is
  the model's own error plus the read's error and the null arm is the only thing separating them.

## 16:15Z Result (run on the rule above, `a7b7821c4`)

Instrument: `census.py` (scratch, not in the repo), NDBC `latest_obs.txt` pulled 2026-11-15 about 16:10Z, NDBC
`realtime2` per station, 37 NOAA GFS-Wave analysis fields 2026-11-04 00Z .. 11-13 00Z. Nothing private, no backend call.

**One instrument fix after the first run, disclosed.** My box lookup read two of the four box groups in
`pilot_regions.py` and missed `GFS_MARINE_EXTRA_REGIONS` and `GFS_MARINE_STAGE_B_REGIONS` (which holds
`us_pacific_northwest`). I added them and re-ran on the cached data. Only the box column changed (two stations: 46267,
46244); every count, bias and interval is identical between the two runs. The box list is a lookup, not a threshold.

### Counts

155 stations reported a wave height. 69 `open`, 55 `partial`, 6 `none`, 25 `unanswered` (no water within 1.0 deg).
40 had too few pairs (no usable `realtime2` file in the window).

| class | judged | in our boxes | mean bias | median | positive / negative | flagged by the 0.30 m test |
|---|---|---|---|---|---|---|
| `open` (null arm) | 37 | 25 | -0.199 m | -0.122 m | 6 / 31 | 10 (27.0%) |
| `partial` | 48 | 42 | -0.119 m | -0.130 m | 13 / 35 | 15 |
| `none` (46267's path) | 5 | 3 | +0.765 m | +0.404 m | 5 / 0 | 5 |

### The `none` stations (no water in any of the four cells; the read is the nearest water cell)

| station | where | our box | nearest water | pairs | bias (model - buoy) | 95% interval |
|---|---|---|---|---|---|---|
| 46267 | Angeles Point, WA (Juan de Fuca) | us_pacific_northwest | 0.958 deg | 37 | +2.178 m | [+1.781, +2.532] |
| 44042 | Potomac, MD (Chesapeake Bay) | outside | 0.882 deg | 33 | +0.465 m | [+0.358, +0.574] |
| 44072 | York Spit, VA (Chesapeake Bay) | us_southeast_midatlantic | 0.518 deg | 32 | +0.404 m | [+0.310, +0.515] |
| 44087 | Thimble Shoal, VA (Chesapeake Bay mouth) | us_southeast_midatlantic | 0.381 deg | 37 | +0.392 m | [+0.306, +0.490] |
| 44058 | Stingray Point, VA (Chesapeake Bay) | outside | 0.598 deg | 35 | +0.386 m | [+0.312, +0.455] |
| 46181 | Nanakwa Shoal, BC | outside | 0.930 deg | 0 | too few pairs | |

### Verdict, by the rule as written

- **Positive control: FAILS ITS STATED RANGE.** 46267 classifies `none` and is flagged, but its bias is +2.178 m and I
  fixed the range at +1.0 to +2.0 m. By the letter the census is **INVALID**. I am not widening the range after the
  fact. Why it is larger than the +1.47 to +1.52 m I expected: that figure was against best_match, not against the
  buoy, and (next section) the cell being read is farther out than I had recorded.
- **Null arm: FAILS.** 10 of 37 open-water stations are flagged, 27.0%, against a limit of 10%. A 0.30 m bias line does
  not separate a wrong-water read from ordinary model error in this window. **So no station is named.**
- **Class gate: met in count, exactly.** 3 judged `none` stations lie in our boxes (46267, 44072, 44087). One of the
  three is the already-excluded buoy. A bake-off (#883) could now be run on three, which is the floor.
- **Outcome under the rule: NO FURTHER STATION QUALIFIES. Nothing served changes.**

### What the numbers show beyond the rule (descriptive, found after looking; not a verdict)

- Every judged `none` station reads HIGH (5 of 5, intervals clear of zero), in a population that reads LOW (open
  stations: 31 of 37 negative, mean -0.199 m). Against that baseline the four Chesapeake Bay buoys sit about 0.6 m
  above where an open-water read sits, not 0.4. The absolute 0.30 m line hid this by flagging ordinary low bias.
- The four are one water body: Chesapeake Bay, read from the Atlantic shelf 0.38 to 0.88 deg away. Two of them are in
  a box we serve. No catalogue surf spot was checked against the bay.
- The `partial` flags are mostly Southern California (13 of 15 in `us_west_coast_socal` or `hawaii`), mostly
  negative: the Bight's island shadow and the model's own low bias, which the per-buoy split already attributes to the
  model. Three read high: 46286 Avila Beach Nearshore (+1.177 m, one wet corner), 51211 Pearl Harbor (+0.830 m, the known
  island case) and 46215 Diablo Canyon (+0.490 m).
- **The test that would have been right, proposed and NOT run:** judge each `none` or `partial` station against the
  open-water stations of its own box in the same hours (bias minus the box's open-water median), with the null arm
  drawn as open stations judged against the others in their box. It needs its own rule fixed before it is scored, on
  a window other than 11-04..11-13, since these nine days have now been seen.

## A correction to the record: 46267's nearest water cell is 0.958 deg away on NOAA's field, not 0.729

On NOAA's native analysis field (2026-11-13 00Z; the cached mask file agrees) the cell at 48.5 N, 124.25 W is LAND. The
nearest water is 48.5 N, 124.5 W, 0.958 deg from the buoy, 0.042 deg inside the sampler's 1.0 deg reach. The 0.729 deg
figure is the distance to 48.5 N, 124.25 W, which is water on Open-Meteo's copy of the mask. I carried the Open-Meteo
distance into text that says "NOAA's native mask": the #852 log, its SCOREBOARD row, the director's note, and the
`reason` string of the station entry in `unresolved_stations.py`. Which cell our own stored tile read was never read.
- The decision is unaffected: all four cells around the buoy are land on both masks, the read is open Pacific either
  way, and the entry excludes the station by name.
- Corrected in this PR: the `reason` string and the code comments that quoted 0.73 deg. The merged log and SCOREBOARD
  row are append-only and stay as written; this section and the ledger correction line supersede them.
- What it changes in understanding: the read was barely inside the reach. A grid shift of one cell would have
  produced "no data" by itself.

## 16:24Z The relative test: rule fixed now, to be scored on a window not yet seen

The owner typed in this session (2026-11-15 11:21 EST): "write the rule for the relative test". This section is the
rule only. Nothing below has been computed. No field or observation dated 2026-11-16 or later exists yet.

**What I already know, and how it bears on this rule (disclosed, because a rule written after a look can be bent).**
From the 11-04..11-13 census I have seen: the five judged no-water stations all read high; four are in Chesapeake Bay;
open-water stations mostly read low; Southern California's open stations disagree with each other. I expect the four
Chesapeake stations to be flagged. Two choices below are informed by that look and are marked **[informed]**. The
threshold is not: 0.30 m is the line the first rule already used.

**Question.** Does a station our sampler answers from a neighbouring cell read differently from open water in the same
box, in the same hours, by more than open-water stations in that box differ from each other?

**Window.** NOAA GFS-Wave analysis fields (f000) every 6 h from 2026-11-16 00Z to 2026-11-25 18Z: 40 fields, 10 days,
none overlapping the census. NDBC `realtime2` for the same days. Population and classes exactly as in the census rule
above (stations reporting a wave height at the pull; `open` / `partial` / `none` on the native mask of the last field).

**Box.** The station's pilot box, from all four box groups in `pilot_regions.py`. Stations outside every box are
listed and not judged: they are not on our 0.25 degree served path.

**Baseline, per field time.** The median of (model - buoy) over the box's `open` stations that have a pair at that
time. A time counts only if at least 3 open stations have a pair. **[informed]** A box with fewer than 3 judged open
stations gives its stations the verdict NO BASELINE.

**Statistic.** For a station, r(t) = (model - buoy) at the station minus the box baseline at t. R = the mean of r(t).
Interval: day-block bootstrap over the days of r(t), 2,000 draws, seed 20261128, 95%.

**Flag.** |R| >= 0.30 m, the interval excludes 0, at least 20 times over at least 7 distinct days.

**Null arm, per box.** Each `open` station of the box is judged the same way against the OTHER open stations of its box
(leave one out; needs at least 3 others, so a box needs at least 4 judged open stations). The box is USABLE only if at
most 10% of its open stations are flagged; with fewer than 10 open stations that means none. **[informed]** The null
is per box and not pooled, because boxes differ in how alike their open water is. This makes naming possible in one
box when another box's null fails, which favours the result I expect; so the pooled flag rate is printed beside it,
and if the pooled rate exceeds 10% the report says so in its first line.
A box that is judgeable but has fewer than 4 open stations is NULL NOT RUNNABLE: its stations are reported with their
numbers and none is a candidate.

**Positive control.** 46267 judged against the open stations of `us_pacific_northwest`. That box had two judged open
stations in the census, so for this control only the baseline may use 2. It must be flagged with R of at least
+1.0 m. No upper bound this time: the bound in the first rule was the error in that rule, not a property of the
buoy. If the control is not flagged the test is INVALID. The census replays the sampler without the #852 exclusion,
so the control still exercises the old read.

**Verdicts, per `none` or `partial` station.** CANDIDATE (flagged, in a USABLE box), NOT SHOWN, NO BASELINE, NULL NOT
RUNNABLE, TOO FEW PAIRS. Sign is reported: a positive R is a more exposed read, a negative R a more sheltered one.

**What a CANDIDATE is, and is not.** It is evidence that the station's value comes from other water. It is not a
served change. Naming a station in `unresolved_stations.py` is a served-number change at that point under D-065, needs
the owner's word, and first needs: (1) which sampler path the station takes in production (`interp`, from the scored
rows, for a `none` station; a `partial` station reads its own cell's wet corners and may need a different remedy than
"no data"); (2) whether any catalogue surf spot shares the station's four cells.

**Limits, stated now.** Ten days in one season. Analysis fields, not the served forecast. The global field stands in
for our regional tiles. About 45 `none` and `partial` stations will be tested at once with no multiplicity correction:
the 0.30 m floor and the box null are the guards, and the count of candidates is to be read against that. A box whose
open stations are few or clustered gives a weak baseline; the number of open stations behind each baseline is printed.
The Chesapeake stations share one baseline, so four flags there are one finding about one water body, not four.

**Data that expires.** NOMADS keeps about ten days of fields. The 11-16 fields must be fetched by 11-24 and the rest by
11-27 (the Hawaii shore-split commitment needs fields from 11-14 on, on the same clock, so its first fetch is due by
11-22). Scoring: no earlier than 2026-11-26, recorded in a log by 2026-11-28T12:00Z (ledger commitment).
