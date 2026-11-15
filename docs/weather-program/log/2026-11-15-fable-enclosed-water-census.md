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
