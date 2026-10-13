# 2026-10-10 · A small pan re-requested the whole 14-day wind timeline; the box read /api/health at 10-13 s

Owner, panning the live dev wind map over the Gulf at about z6-7, 00:04-00:13Z: `/api/health` read 10-13 s (0.4-0.9 s
before and after). The Render request log for that window shows one client re-requesting `GET /api/weather/grid_series`
(`model=GFS&domain=wind&layer=wind`) for a slightly shifted, unsnapped Gulf box every 20-60 s, with many
`[grid_series] hour +NNh timed out after 10.0s` lines. Read-only log pulls only; no request of mine reached the box.

## What the client does (answers to the four questions)

- **Is the series box snapped to a lattice?** No. `windGridSeries.loadSeriesPage` sends the raw, unpadded viewport
  to 4 decimals. Only the CACHE KEY is rounded (0.5°, `viewportKey`; any span > 15° collapses to `global`). Marine pads
  (`padRegionalBbox`) and reuses a covering entry (`finestCoveringSeriesFrame`); wind has neither, and
  `getWindSeriesFrame` matches the exact key. So a pan that crosses any of four 0.5° edges is a new series.
- **Is there a reuse rule?** No (above).
- **Is the far-hour prefetch cancelled when the view moves?** No. `WeatherEngine`'s warm effect made ONE
  `AbortController` per effect, aborted only when the model, the map or the wind layer changes. `ensureWindSeries`
  also schedules the adjacent page on idle with that signal, and `loadSeriesPage` did not refuse an already-aborted
  signal (a listener attached to an aborted signal never fires).
- **Does it run while the timeline is not playing?** Yes: every `moveend`, whatever the playback state.

Per settled pan: a 1-frame mini, the 48-frame page 0 (hours 0..141) and the 48-frame page 1 (144..285) = 97 frames.

## What the server does with it (Render app log, 00:03:55-00:16Z)

| time (Z) | request | note |
|---|---|---|
| 00:04:30 / 00:04:35 | `hours=0`, boxes A / B (5 s apart) | |
| 00:04:50 / 00:04:55 | page 0 for A / B | each ~20 s, the `OVERALL_DEADLINE`; tails time out |
| 00:05:12 / 00:05:17 | page 1 for A / B | the idle adjacent-page prefetch |
| 00:05:52 → 00:06:13 and 00:06:43 → 00:07:04 | the same triple for boxes C and D | |

- **Timeouts.** Hours ~51-108 of page 0 and ~204-285 of page 1 time out at exactly 10.0 s. For wind GFS,
  `viewport_service` always fetches 16 days (`forecast_days = 16`) and `bg_process_remaining_hours_helper` then normalizes
  the remaining hours ONE AT A TIME (`normalize_async`, JSON write, `gc.collect()` each). A request's hours wait on
  per-hour futures that this single task resolves, so a cold 48-frame page needs about 24 s against a 20 s deadline: its
  tail is lost by construction, not by one bad hour. A timed-out hour costs its wait (10 s of a 4-wide semaphore) and
  leaves a hole: the client caches the partial page for 5 min and falls back to per-hour fetches for those hours.
- **One background build per model/domain.** `ACTIVE_BG_TASKS["gfs_wind"]` is a single slot and a new box cancels it
  (`Canceling stale background task for gfs_wind` at 00:04:05, 00:04:19, 00:05:59, 00:06:51, 00:10:52, each beside an
  `SWR background revalidation succeeded` naming a NEW box: a whole-degree `/grid` box such as `-93,26,-82,32`, and
  `…2026-10-16T00:00:00Z_-91.8141,…`, the page-1 warm frame of the previous series box). I did NOT trace which request
  started each cancel; the pattern is that every new box, from `/grid` or from a stale series prefetch, ends the build
  in progress. The Open-Meteo breaker was open (429s) in the 00:15Z marine lines of the same log.

Conclusion: the trigger is the client (97 frames of speculative work per pan, never cancelled); the amplifier is the
server (a 16-day fetch and a serial, cancel-on-next-box build per fresh box).

## Offline replay (no network; the real `windGridSeries.js` and `windSeriesWarm.js`, a mock `fetch`)

`windSeriesPan.replay.test.js` replays the six views of the log above and two steady-state sessions. "Frames built" is
a model (a 48-frame page takes 20 s, observed; the server stops at a disconnect via `request.is_disconnected()`);
requests and frames requested are hard counts. BEFORE is the previous wiring with the kill switch on, pinned row for row
to the numbers measured on untouched `origin/dev` 0f73e2fb.

| session | requests | frames requested | far-hour frames (144-285) | frames the box built | aborted |
|---|---|---|---|---|---|
| the live log, 6 views: before | 18 | 582 | 288 | 582 | 0 |
| the live log, 6 views: after | 16 | 486 | 192 | 390 | 2 |
| exploring, a pan every 25 s, 8 views: before | 24 | 776 | 384 | 776 | 0 |
| exploring, 25 s: after | 17 | 440 | 48 | 440 | 0 |
| fast, a pan every 8 s, 8 views: before | 24 | 776 | 384 | 661 | 6 |
| fast, 8 s: after | 17 | 440 | 48 | 237 | 7 |

The 48 far-hour frames left after are the one view the user finally rests on. Every view still gets its own mini and
page 0; the fix removes the blind far page and the abandoned work, NOT the per-view build.

## Fix (client only; no served number moves)

1. **Supersede.** `windSeriesWarm.js` (lifted out of `WeatherEngine`, so the replay drives the shipped wiring) gives
   each regional view the signal of `createSeriesViewportIntent` (the body of marine's `createMarineViewportIntent`,
   extracted so both lanes share one expression; marine's own test still pins it). A pan to another series key aborts
   the previous view's queued and in-flight requests; wide views share one signal and keep their reusable world series.
   Every entry point refuses an aborted signal.
2. **Dwell.** The adjacent page is prefetched 30 s after page 0 lands and only if the view is still the same; it dies
   with the view. `timeline_scrub_start` still prewarms every page, so the 14-day scrubber is never capped (tested:
   pages 0, 144, 288 all requested at scrub start). The 30 s is chosen from one trace (pans 5, 77, 51 s apart; a cold
   page takes ~20 s); tune with `window.__WIND_SERIES_ADJ_DWELL_MS__`.
3. **The request box is unchanged**, pinned by a test. `choose_adaptive_resolution` is a STEP function of the snapped
   area (`sqrt(area/400)`: ≤ 100 deg² → 0.5°, ≤ 400 → 1°), and the Gulf view sits on that step: the snapped boxes in
   the log are 15x7 = 105 deg² (1°) and 14x7 = 98 deg² (0.5°). Padding or a coarser lattice would change which grid a
   pan is served, which is a served-number change (D-001), so it was not done here.

Kill: `window.__RAW_DISABLE_WIND_SERIES_SUPERSEDE__ = true` restores the previous behaviour exactly (tested equal to the
pinned before, row for row). No `SCOREBOARD.md` row: no surf height, rating, glyph, hub or wind value moves.

## Checks run

Focused: 34 tests in the wind series, replay and marine work-bounds suites. Wide: `src/components/map src/tests
src/__tests__` = 367 suites, 4238 tests, all passed. `node scripts/check_eslint.js` exit 0 (my first run caught +2 unused
`eslint-disable` directives and `jest`/`global` in a helper that is not `*.test.js`; both fixed before the push).

## Not done, and why (follow-ups, in order of value)

1. **Server: bound the background build.** `bg_process_remaining_hours_helper` normalizes every hour of the 16-day
   response for every fresh box, one at a time, and the single `gfs_wind` slot is cancelled by the next box. Building
   only the hours that are asked for (plus a window), or one slot per box, would remove the amplifier for every client.
   It changes build behaviour for all wind users, so it needs its own design and a dark flag.
2. **Two boxes per pan.** `/grid` sends a whole-degree box, the series lane a raw one, so each pan starts two 16-day
   fetches that cancel each other's build. Sending the series the same snapped box would share one fetch through
   `IN_FLIGHT_REQUESTS`, but it can flip the resolution tier above, so it ships dark and flips on the owner's word.
3. **Wind arms its 45 s fetch timeout before it holds a slot** (marine fixed this on 2026-07-14): a page that queued
   for 30 s is aborted 15 s into its flight and wasted. Consistent with the 6 "aborted" in the BEFORE fast row: those
   were issued 25-50 s after the pans that made them and cut 7-20 s into flight (not isolated further). Supersede makes
   deep queues rare, so it was left alone.
4. `startWindSeriesWarm` passes the `timeOffsetHours` the effect closed over, as before: after a scrub to day 6 a pan
   still asks for page 0. Marine reads a ref. Not changed here.

## Read-back owed after deploy

On a Render log window with a pan session: `grid_series?…domain=wind` requests per rested view should be 2 (mini + page
0), not 3-6; page-1 requests (`hours=144,…`) should appear only after a rest of ~50 s; `Canceling stale background task
for gfs_wind` should be rarer; `/api/health` during the session should stay under ~2 s. Do not replay this live
(CLAUDE.md): read the owner's own session.
