# 2026-11-03 · claude · Spot-hub phase 3: per-spot chart series rated in CI (DARK, `SPOT_SERIES_PUBLISH`)

Session: a delegated subagent of the lead. Branch `claude/spot-hub-phase3`, stacked on `claude/spot-hub-phase2`
(#710). Owner's words as in the phase-2 log ("our own logic to generate our own forecasting charts that work in the
rating color codes"; "lets keep moving forward toward state of the art weather simulation system features"). DRAFT
PR only: no workflow dispatched, no repo variable set, nothing uploaded, no live backend or app call.

## What was built

- `backend/services/weather_pipeline/spot_series.py`: the logic and the format.
  - Every frame is `spot_ratings.rate_one_spot` through the hub's recording resolver, on the hub's frame plan
    (`spot_hub_composition.frame_plan` + the hub's "now"): ONE plan and ONE composition for the hub and the chart.
  - The observation gate is the glyph precompute's own `rating_confirmation.apply_gate_to_frames` (cross-model
    agreement + fresh reports), applied in the assemble job once all three models are in, gated on `RATING_OBS_GATE`
    exactly as `run_spot_ratings_precompute` gates the glyph frames.
  - The +-1-level band = min / max level index across the models that rated the frame.
  - 64 md5 hash shards per model, gzipped, columnar per spot: `t` (h after `base_time`), `h` (breaking cm), `s` / `r`
    (gated / ungated score x10), `l`, `lo`, `hi` (level indices), `w` (wind kt), `wd` (offshore / cross-shore /
    onshore, the why-text's words), `sw` (primary swell cm), `td` (tide cm where the rating had one), plus `off`
    (solar UTC offset). `index.json` names the plan, the tier note and every shard's bytes.
- `backend/scripts/spot_series_ci.py`: `rate` (one matrix job; L2 restore + prefetch as precompute_ci.py does;
  `--hub-parity K` runs the PHASE-2 hub path on K spots and counts hub == glyph item and hub day max == series),
  `assemble`, `publish` (refuses unless `SPOT_SERIES_PUBLISH=1`), `synthetic` (offline dry run).
- `.github/workflows/spot-series.yml`: triggered on `workflow_run` after "Precompute Spot Ratings (decoupled)" (the
  series and the glyphs rate the same restored products) and `workflow_dispatch`. Matrix GFS/EURO/ICON x 4 jobs,
  then one assemble job.
  - DARK TWICE: automatic runs skip the whole lane unless the repo variable `SPOT_SERIES_PUBLISH` is `'1'`
    (no runner time while dark); publish runs only with that variable `'1'` AND a full run (limit 0) AND every rate
    job green.
  - The served science env is mirrored from precompute.yml's rating step, and `test_the_series_runs_in_the_glyphs_
    served_env` DERIVES the set from precompute.yml, so a flip there that forgets this lane fails CI.
  - `PREFETCH_WINDOW_DAYS: '15'` (precompute warms 1 day because it rates +0/+3 h).

## Local dry run (synthetic catalogue, network-free)

`python scripts/spot_series_ci.py synthetic --spots 1773 --base-time 2026-11-03T18:00:00Z`:

| | value |
|---|---|
| frames per spot | 58 (1 now + 24 three-hourly + 33 day-parts) |
| frames per model | 102,834 |
| shards | 192 (64 x 3) + index |
| bytes, gzipped | 2,239,768 total; mean 11,665; max 17,888 per shard |
| producer overhead | 15.1-17.6 s per model for 102,834 frames (~0.16 ms/frame; the resolves are synthetic) |
| build (gate + shards) | 5.3 s for all three models |
| projected CI time | 92.6 min per model at CI's measured ~54 ms/frame (run 41491110869) -> ~23 min per job at 4 jobs |

The synthetic sea is random per frame, so it compresses WORSE than a real one; real shards should be smaller. The
real resolve cost, memory with 15 prefetched days, and EURO's CMEMS pre-warm are what the dispatched dry run measures.

## Tests

`tests/test_spot_series.py` (14): the series uses the hub's plan plus "now"; every row is `rate_one_spot` at its hour
(deterministic synthetic sea); the hub and the series rate the same frame identically (current + every daily max);
gate off follows the ungated score; gate on equals `apply_gate_to_frames` on the same frames (with a control that it
capped something); the band; shards stable and partitioning 0..63; columnar, gzipped and byte-deterministic; the
synthetic CLI; publish refuses while dark; the workflow's served env equals precompute.yml's; nothing runs or
publishes while dark; `hub_parity` counts agreement; the horizon is the capability horizon.

Floors: guards via `rederive_floor.py --add 30 --add-files 2` (phase 2's 16 + 1 file, this PR's 14 + 1 file, since this
branch carries both): **must read 3479 passed** in the guards lane.

## Flip gate (owner's word; none done here)

1. Dispatch "Spot Forecast Series (dark)" once with the defaults (40 spots a job, 10 hub-parity spots). Its step
   summary must show: ms/frame and job minutes; shard bytes; `hub = glyph` = all compared; `hub day max = series` =
   all compared.
2. Then one full dispatch (`limit 0`) for the true time and bytes.
3. The owner sets `SPOT_SERIES_PUBLISH=1`. Rollback: set it back to `'0'` (nothing reads the objects until phase 4).

## Owner decisions

- **Tier exposure.** Shards hold 14 days; the client must show only `LayerAccessResolver.resolveForecastWindow`'s
  window. Anonymous CDN access to a shard would expose 14 days to a free user, as the map's static frames already
  do. Decide: accept (as the frames do), or serve tiered shards / signed URLs.
- **Storage policy.** The bucket is private; only `spot_ratings/latest.json` has an anonymous-read policy. Phase 4
  needs either a policy for `spot_series/v1/*` (a migration) or a tiny proxy route. Not created here.
- **Tide beyond +72 h.** `td` carries only the rating's own tide (`tide_norm_at` reads 3 days). An 8-day tide curve
  (the Open-Meteo cap) is a separate fetch; days 9-14 stay blank unless a harmonic fit is approved.
- **Runner minutes.** ~12 jobs x ~25 min per precompute cycle (~6 cycles a day) once flipped; the repo is public.

## Phase 4 design (the next PR; visual, ON with a kill switch, from the research)

- Data: the client reads `index.json`, then the one shard `shard_of(spot_id)` for the selected model, gunzips
  (`DecompressionStream('gzip')`), and clips to `resolveForecastWindow(user, model, 'waves')` BEFORE drawing.
- Chart, per spot hub (full hub and drawer):
  - bars, one per frame, height = `h` (breaking ft), fill = `RATING_COLOR[level]` (`surfRating.js:354`), with the
    level word as the bar's text equivalent (accessibility: never colour alone);
  - the `lo`..`hi` level band as a thin bracket above each bar (the cross-model +-1-level spread);
  - wind row: kt + an arrow + the `wd` word, offshore/onshore colour-independent;
  - tide curve (`td`) where present, with the spot's `best_tide` window shaded; blank, labelled "no tide
    forecast", beyond;
  - the selected bar = the map scrubber's hour (two-way: tapping a bar moves the scrubber);
  - day separators on the LOCAL (solar) day with the `off` offset shown; the dense 3-hourly part and the day-parts
    drawn at their true spacing.
- Keyboard: the chart is a `role="slider"` over frames (ForecastWheel's pattern: arrows, PgUp/PgDn, Home/End,
  visible focus), each bar announced as "Tue 13:00, 4.1 ft, fair-good, 8 kt offshore".
- Three themes (light, dark, beach) on desktop and mobile; the composited palette checked with
  `node scripts/wind-color/check.mjs`-style contrast for the rating colours on each theme's card background.
- Kill switch `window.__RAW_DISABLE_SPOT_CHART__ = true` falls back to today's daily rows.
- The hub's daily rows can then read from the series instead of rating on the box, retiring phase 2's on-demand cost.
