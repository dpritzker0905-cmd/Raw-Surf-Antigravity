# 2026-11-18 Fable: the precompute point-source count says which KIND of stored answer (coastal band, step 1)

Session: Fable repair lead (`e372475c`). Branch `fable/tally-stored-split`, cut from `dev` at `db2107a75`.
Logging only. No served number moves, no frame byte changes. Nothing dispatched.

## 2026-11-18 22:47Z What was done, and why

**Asked for by David**, typed in this session: "Cover with agency data, start the coastal band", then "Yes, go ahead"
to "send the band design to the advisor and start slice 1, the count split". The director approved the sequence.

**Why this first.** The coastal band (the agency cover that replaces the Open-Meteo wave point fallback) is scored on
the #1015 count. That count called an answer `stored` whenever the response carried a product id. Read from
`point_resolution.py`: when the only cover is a world grid and its sample is land-masked, the resolver tries the live
branch, and if that returns nothing it serves the degraded world sample, which carries a product id. So the worst
answers were counted with the best.

**What changed** (`services/weather_pipeline/marine_source_tally.py`). A stored answer now gets one of four labels,
read only from labels the resolver already sets:

- `stored`: a regional tile or a viewport product.
- `stored:world_grid`: a 2 or 10 degree world product answered cleanly (`coverage_status == inside_global_coarse`).
- `stored:world_grid_degraded`: the degraded world sample served after the live branch returned nothing
  (`fallback_reason == coarse_sample_degraded_direct_point_failed`).
- `stored:no_value`: a stored product covers the point and has no value there (`interpolation_method == unavailable`).

All four still count as stored, so the "not stored" share that is already quoted reads exactly as before. The one-line
log adds ", N stored without a usable value" when N is not zero.

Kill: `SPOT_RATINGS_SOURCE_TALLY_SPLIT=0` gives one `stored` label again; `SPOT_RATINGS_SOURCE_TALLY=0` removes the
count altogether, as before.

## Checks

- `tests/test_marine_source_tally.py`: 58 passed locally (11 new). The local interpreter is not the declared
  environment; hosted CI is the authority. CI lint gate clean on both files.
- A test reads `point_resolution.py` and requires the two label strings to be there, so a rename in the resolver fails
  the test instead of quietly putting every degraded answer back under plain `stored`.
- NOT run locally: the full guards lane. Guards floor +11 tests, +0 files.

## Expected reading on the next precompute run (written before it runs)

Waves: `stored:world_grid` should be the larger part of the 728 spots with no regional tile, times two rated hours;
`stored:world_grid_degraded` plus `no_answer` is the population the band has to cover that today gets a poor answer
or none. Wind: 0.0% not stored today; the split shows how much of wind is world-grid.
If `stored:world_grid` is near zero, the label is not reaching the counter and this change is wrong.
