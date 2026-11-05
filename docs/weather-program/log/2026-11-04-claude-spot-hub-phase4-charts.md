# 2026-11-04 · claude · Spot-hub phase 4: Raw Surf's own forecast charts in the hubs (ON, kills `SPOT_HUB_CHARTS=0` / `__RAW_DISABLE_SPOT_HUB_CHARTS__`)

Session: a delegated subagent of the lead. Branch `claude/spot-hub-charts`, built stacked on #713 and moved onto
`origin/dev` `f2dda1f97` once #713 merged (the trees were identical, so nothing was re-resolved). Owner's words as in the phase 2/3 logs ("our own logic to generate our own forecasting charts that work in
the rating color codes"). DRAFT PR only: nothing merged, no env, secret, bucket policy or workflow change, no deploy,
no live backend or app call.

## Owner display decision (relayed by the lead, 2026-11-04)

The entitlement stays ROLLING 72 h for free. The map, scrubber and hourly chart show hours to +72 h. The hub's DAILY
view shows today + 2 full local days (always inside 72 h); the leftover hours appear in the hourly chart only. Day
columns beyond the tier are locked, with an upgrade prompt. Generalised: daily = today + (days - 1) local days for every
tier (basic 7, premium 14).

## What was built

- **Read route** `GET /api/weather/spot-series/{spot_id}?model=&subscription_tier=` (`routes/weather_spot_series.py`,
  logic in `services/weather_pipeline/spot_series_serve.py`). The PROXY for the private bucket: the service key stays
  on the box, no storage policy or signed URL is created.
  - Trim: `forecast_tier_window.tier_horizon_hours` (free 72 h rolling, basic 7 d, premium 14 d, clamped by the
    model's capability row); a model the tier may not use falls back to its first model. Frames from the latest one at
    or before now to now + window; days beyond are `locked_dates` (names only). The ungated score `r` never leaves CI.
  - Cost: `index.json` once per 300 s per process (absent: one read a minute); a shard once per (model, shard,
    generation), the generation (`base_time|generated_at`) is both the immutable cache key and the GET's cache-buster;
    concurrent misses share one read; parsed shards LRU 24 (`SPOT_SERIES_SHARD_CACHE`); a cached request is a dict
    lookup and a slice. Storage outage: the last good index is kept.
  - Kill: `SPOT_HUB_CHARTS` (env > runtime manifest > default '1', read through `runtime_flags.flag`), registered in
    `_RATING_FLAGS` as "Render env". It moves no served number (display of numbers `rate_one_spot` wrote in CI).
- **Frontend** `frontend/src/components/spot-hub/charts/`:
  - `spotSeriesModel.js` (pure): decode, a second clip to the SMALLER of the resolver's and the server's hours, daily
    columns (real max / min, best frame), map-hour link, text equivalents, contrast helpers.
  - `SpotForecastChart.js`: bars at true time spacing in `RATING_COLOR`, height labels, a bracket where the models'
    levels differ, shore-relative wind arrow + kt, tide line with "No tide forecast beyond here", day separators on the
    spot's SOLAR day (labelled with its UTC offset), a readout line, daily buttons (select the day's best frame), locked
    days + one upgrade button. ONE `role="slider"` (ForecastWheel's keys: arrows, PgUp/PgDn, Home/End, visible focus),
    `aria-valuetext` "Tue 13:00, 4.1 ft, Fair to Good, 8 kt offshore, tide 0.6 m". Compact variant for the infobox
    (72 h for every tier: it is ~200 px wide), on the palette of the glass it sits on.
  - `useSpotSeries.js`: one request per (spot, model, tier) per 5 min per page, shared by all surfaces.
  - `SpotChartPanel.js`: chart when `ok`, otherwise (loading, 404, error, kill) the surface's previous rows.
- **Surfaces**: full hub (`SpotHub.js`: a bar choice writes `?timeOffset=`), pinned drawer (`SpotConditions.js` via
  `SpotReportContent.js`: a bar choice calls MapPage's `window.setTimeOffsetHours`), map infobox
  (`MapForecastOverlay.js` for a selected catalogued spot; MapPage passes `user` and `setTimeOffsetHours`).
  A GPS / long-press point has no series (the shards are per catalogued spot), so the infobox shows no chart there.

## Evidence

- Backend `tests/test_spot_series_serve.py` 22 passed on real phase-3 shard bytes (`spot_series.build_shards`): tier
  windows for guest/free/basic/premium, every open day inside the window, leftover hours, locked dates, model fallback,
  columns byte-equal to the shard slice, first frame at/before now, tide_until, one read per generation + republish,
  12 concurrent viewers -> 1 index + 1 shard read, unpublished -> 1 read for 5 views, LRU bound, outage keeps the
  index, misses say why, flag default on / '0' kills with no storage read, registry entry, the route through FastAPI.
  Mutation: dropping the window clip turns 4 tests red. Plus 110 passed over flag-lane parity, runtime flags,
  spot_series, tier window and floor staleness; flake8 gate clean; file size OK (`routes/weather.py` 800 lines).
- Frontend: 53 new tests (5 suites) green; touched surfaces' existing suites (SpotHub*, SpotConditions*, spot-hub,
  drawer, kill-switch inventory) 224 passed. Full `src/components src/tests`: the only red file is
  `map/marineHeightEncoding.test.js` (8 hash tests), red IDENTICALLY on a clean `origin/dev` worktree here (local
  Node 22.23 vs CI's 24.22), so not this change. `check_eslint.js` passes; `npm run build` passes.
- Screenshots: `audit/spot-hub-phase4/screenshots/` (README has the grid): hub (free), drawer
  (premium), infobox (free) x light/dark/beach x desktop/iPhone 13, from the real components in a scratch harness build
  with every backend call answered by a Playwright mock (132 mock answers, 96 other requests aborted; nothing live).
  Two defects found by looking and fixed: the infobox drew beach text on its dark glass (now follows the glass), and
  the "no tide" label clipped at the chart edge (now drawn only where it fits).
- Floors: guards +22 tests / +1 file on dev's map after #713 (3521 -> 3543, floor 3537, files 222; by hand:
  `rederive_floor.py` needs `gh`, absent here; re-derive if another guards PR merges first). Frontend +5 suites / +53 tests
  (538/7040 -> 543/7093).

## Not done / owner decisions

- No SCOREBOARD row: no served number moves (the chart shows the series phase 3 rates; the hub's own numbers are
  untouched). If the owner reads "the hub now shows the series" as a served change, add the row at merge.
- Nothing reads the shards until phase 3 publishes (`spot-series.yml`); until then the route answers `unpublished` and
  every surface keeps its previous rows. The first live read after publish (one hub view, `/api/health` before and
  after) is the merge-gate commitment.
- The hub's daily rows still come from phase 2's on-box rating; retiring that cost by reading the series is next.
- Civil vs solar local time (unchanged from phase 2): the chart labels solar time with its offset.
- `memory_audit.py --docs-only`: 0 FAIL, 71 WARN (overdue LIVE-read commitments of other PRs; this delegated session
  may not touch the live box), 7 NOTE.

## Review: File Size Governance (hosted, first head)

`scripts/loc_ratchet.py` caps frontend files at 800 lines too: `MapForecastOverlay.js` read 806. The infobox's chart
block moved into `SpotChartPanel.InfoboxSpotChart` (one test added), the overlay now reads 800; ratchet "New: 0".
