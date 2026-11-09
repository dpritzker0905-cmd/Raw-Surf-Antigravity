# 2026-11-08 Claude: point-tide contract fixes

Branch `claude/tide-contract-fixes` (local only, no push/PR). Base: dev `aceb68b4c` plus the two reviewed handoff files
(`weather_point_tide.py` 9411b95c71b49c81..., `test_point_tide.py` acb6a6c43ad69791...) from the Codex worktree.
Served numbers: `/api/weather/point-tide` is new and `tide_extrema` only stops reporting false turns; no flag.

## Fixes
1. MEDIUM `services/weather_pipeline/tide.py` `tide_extrema`: a run of equal samples is ONE point; it is a High/Low only if the
   change flips sign across it, placed at the plateau midpoint (level = plateau value). Rise-plateau-rise and
   fall-plateau-fall no longer yield a false extremum. Shared with the hub `/tides/{spot_id}`; its tests still pass.
2. LOW `routes/weather_point_tide.py`: `coverage` start/end are `...Z` (were `+00:00`); every parsed instant is converted
   to UTC first, so a non-UTC offset feed no longer yields events labelled Z at the wrong instant.
3. LOW same file: one duplicate / out-of-order / unparsable timestamp is skipped and treated as a gap
   (previously the whole cell returned unavailable).

## Tests (+17 in `backend/tests/test_point_tide.py`: dev 4 -> 21; 3 came with the handoff, 14 are new)
plateau (rise, fall, true peak, parabola unchanged), duplicate and unparsable timestamps, non-hourly step, two-sample
segment, single-sample island, request at last sample before a gap, just before first sample, non-UTC offset, Z coverage,
cache headers on success-with-gap. Guards floor: base 3567 + 17 = 3584; MIN_PASSED 3561 -> 3578; MIN_FILES 224 unchanged.

## For Codex (UI), not done here
`usePointTide.js:30-31` caches a miss for 10 min while the server answers a miss with `max-age=30`. Align them.
