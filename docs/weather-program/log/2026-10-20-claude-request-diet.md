# The map client's request diet: fewer requests, landed frames drawn sooner (2026-10-20)

Session opened 2026-10-20T18:23Z, started by the lead session (`local_d6b521eb`, user memory `scrub-lag-diagnosis-2026-10-20`: the
browser is no longer the bottleneck, at most 152 ms of main-thread stall per step; the waits are the 1-CPU server and a client that
asks for more than it needs). Task: the CLIENT half, six named amplifiers, shipped ON with kill switches, one draft PR against `dev`,
not merged. Branch `claude/upbeat-matsumoto-52b4be` from `dev` da40c3c5b. **No served number changes** (no SCOREBOARD row): the same
products are requested and drawn, fewer times or sooner. Offline throughout: the real backend over synthetic data on :4195
(`serve_synthetic.py --thin-bounds 1 --dynamic 1 --models GFS,ICON,EURO --layers waves,swell_1,swell_2,wind_waves,wind --regions
flagship`), the bundle on :3196 (`REACT_APP_ICON_STORED_TAIL=true`, as the dev deploy builds it); never the live box. Evidence:
`docs/weather-program/evidence/request-diet-2026-10-20.json`. Draft PR #426; ledger seq 1558 (`pr_open`) and 1559 (the live
read-back commitment, due 2026-10-27); first written as 1557-1558, re-appended after `dev`'s 1557 (#424) with `--acted-at`. STATE.md is left to the next merge's receipts (a draft changes no served state).

## 1. Instruments added to the visual lab

`frontend/scripts/visual-lab/lab.js`: `LAT_PRODUCTS` (latency per `/products`; the synthetic manifest is 4.3 MB and lands in ms, live
is 10.75 MB in 1.3-2.1 s, so without it no lookup can start before the manifest lands); request counts by START (`started`,
`loadStarted`; the harness log keeps finished requests only) and by kind (`net`, `loadNet`, wind apart); `loadList`; per-step
`exactMs` (the selected instant at FULL detail: the engine's copy of a grid drops `__decimatedStride`, so a stride-4 series frame is
told by its 8-degree cells); `telemetry` (`window.__MARINE_REQUEST_DIET__`, `__MARINE_EXACT_UPGRADE__`); `LAB_FLAGS` (window flags
set in both arms, e.g. `__SURF_MODE__`); flows `open_waves`, `open_wind`, `hour_steps`, `euro_steps`, `regional_page_steps`.

## 2. Measured before fixing (item 4 was INFERRED in the brief)

`open_waves`, `/products` at 6 s (a cold box), `dev` bundle:
- **4b confirmed:** the first marine `/grid` starts 77-185 ms after `/products` LANDS (it awaits the manifest to snap its valid time).
- **4a confirmed:** the hour-0 "mini" series frame landed about 6 s before the first heat-map draw (mini at ~10.4 s, draw at 16.5 s,
  after the `/grid`). In-page trace (a getter on the kill-switch name): the settle check DID run at the mini's landing and returned
  "Fetch already in-flight for this hour. Bypassing redundant fetch." before its SERIES-FIRST branch, and the settle hook's own
  listener is not registered until the first commit.
- **Item 1** needs real valid-time callers before the manifest lands: the harness stubs spots, so with the rating overlay off there was
  1 `/products` per open. With `LAB_FLAGS=__SURF_MODE__` (spot-rating lookups), **3 per open on every run**: the forced refresh skipped
  the in-flight download.

## 3. What changed (`frontend/src/components/map/marineRequestDiet.js` documents all six; umbrella kill `__RAW_DISABLE_REQUEST_DIET__`)

| Part (kill `__RAW_DISABLE_<NAME>__`) | Where | What |
|---|---|---|
| `PRODUCTS_SHARE` | `backendWeatherServiceClient.fetchProductsManifest` | a forced refresh shares the in-flight download; background refreshes (getSharedValidTime, manifest not loaded or empty) at most once per 30 s; the `finally` no longer clears a newer download's slot |
| `GRID_INSTANT_KEY` | `marineControllerCache.aliasMarineHourByInstant`, called before the three hour-keyed lookups | a cached exact `/grid` whose REQUEST valid time equals the snapped valid time of another offset is stored again under that offset, relabelled as the mapper labels a fresh reply (`hourOffset` on data and grid only); direct `/grid` replies only (no series frames, no ICON swell_2 blend or the client-built ICON >168 h path); valid time resolved read-only and only once a candidate exists |
| `EXACT_UPGRADE_SKIP` | `marineExactUpgrade.planExactUpgrade` | no world `/grid` when the ENGINE already holds a strictly finer world grid of the same served instant, run and flavor |
| `SERIES_PAINT_WHILE_PENDING` | `marineSeriesWhilePending.js`, `useMarineScrubSettle.js` | the settle check's pending branch draws the landed series frame (same lookup, same thin-over-exact refusal, same stamped commit) and keeps the fetch; a `marine_series_revalidated` listener re-runs the check while a fetch is pending; the null `mapInstance` of the settle closure before the first commit falls back to the app's published map |
| `STEP_PAGE` (**ships OFF**, opt-in `window.__RAW_STEP_PAGE__ = true`) | `useMarineOrchestratorScrubCache.requestStepPage` | a step that misses every cache also asks for the page holding the hour (current page only, mini first; not while dragging). Off because it measured no gain (section 4) |
| `SWR_RETRY_CAP` | `useMarineDataFetcherCore.js` (one line) | the stale-grid revalidation keeps its count across its own re-drive: `resetRetryCounts()` at the top of every run had kept it at 0, so a backend that kept answering stale was re-polled every 1.5 s for as long as the view stayed |

Not changed, on purpose:
- **4b** (the first `/grid` waits for `/products`): removing the wait sends an unsnapped valid time, and the backend ranks candidates
  within 3 h by COVERAGE first, so at an edge it can serve another frame for the hour. That is the frame selection D-001 keeps dark.
  4a's paint covers the wait instead (section 4).
- **3, "full detail at the current zoom"**: at the map's minimum zoom (2) the world is 2048 CSS px wide, so a stride-4 lattice cell
  (8 deg) is 45 px and the exact cell (2 deg) 11 px: on a wide view the exact frame always adds detail, and a zoom rule would never
  fire. An unthinned series page is already skipped (`isThinnedWorldGrid`).
- `useMarineDataFetcherCore.js:840` (`series_upgrade` dropped while a fetch is in flight): that lane only commits regional upgrades;
  the landed-frame paint above covers the load case.

## 4. Offline A/B (one bundle; A = `__RAW_DISABLE_REQUEST_DIET__`, B = default; interleaved A1 B1 A2 B2 A3 B3)

Latency injected per reply: `/grid_series` 2.5 s, `/grid` 1.5 s, `/products` 1.5 s (6 s for the cold-box load). The machine was
shared with other sessions' labs and tests (469 node processes), so step times carry that noise; each arm's median marine `/grid`
duration is given as the load reference. Request counts do not depend on it.

**Map open** (`open_waves`):
- with the rating overlay on (`LAB_FLAGS=__SURF_MODE__`): `/products` **3, 3, 3 -> 1, 1, 1** per open (B: `products_shared` 2 per open).
- cold box (`/products` 6 s): first heat-map draw **13.3 / 13.6 / 14.2 s -> 7.6 / 9.5 / 8.1 s** after navigation (medians 13.6 -> 8.1 s);
  `series_painted_while_pending` once per open; the `/grid` still starts 72-99 ms after `/products` lands (4b unchanged).
- warm box (`/products` 1.5 s): no change (median 12.4 vs 12.4 s): the mini and the `/grid` land close together.

**Targeted step flows** (requests started per flow, mean of 3; per-step time to the exact frame):

| flow | world `/grid` A -> B | series A -> B | sum of per-step median `exactMs` A -> B | never exact A -> B |
|---|---|---|---|---|
| `hour_steps` (GFS, +1 h x 7, then back) | 7 -> 3 | 4 -> 4 | 25.0 s -> 9.9 s | 3 -> 0 |
| `euro_steps` (EURO 45-54 h, +1 h) | 13 -> 6.3 | 4 -> 4.7 | 38.9 s -> 11.1 s | 0 -> 0 |
| `regional_page_steps` (GFS z7.5, 141-150 h) | 13.3 -> 5.7 (regional) | 7.7 -> 6.3 | 29.1 s -> 11.6 s | 0 -> 0 |

`hour_steps`: steps +3, +4, +6, +7 reach the exact frame in 32-52 ms in every B run (3.1-6.0 s in A): the instant of +2 / +5 is reused.
`regional_page_steps`: 7 of 10 steps in 27-56 ms in every B run; the three that fetch (143, 146, 149 h) are the new instants.
Machine-load reference (median marine `/grid`): A 2.3 / 2.0 / 3.1 s, B 3.7 / 2.7 / 3.5 s (hour / euro / regional): B ran on the slower
box, so the gains are not a load artefact.

**Broad flows** (`icon_waves_scrub`, `layer_switch_future`, `model_switch_future`, `erratic`, `pan_zoom_future`): requests per flow within
+-2 of A (B: series +0.3 to +2.3 in scrub/erratic from step pages, `/grid` equal), step times within the machine noise (B's median
`/grid` 0.1-1.5 s slower than A's in every flow). These flows jump several hours per step, so they rarely ask for the same instant twice.

**STEP_PAGE alone** (C = every part but STEP_PAGE, B = all on; `regional_page_steps` + `euro_steps`, C1 B1 C2 B2 C3 B3): no gain.
Requests per flow C -> B: regional 14.3 -> 14.3 (series 7 -> 7, `/grid` 5.3 -> 5.3), EURO 12 -> 12.3 (series 4 -> 4.3, `/grid` 6 -> 6);
the steps that fetch reach the exact frame in 2.2-4.6 s in both arms, the others in 23-66 ms in both. The activation and moveend
warm (`useMarineSeriesWarm`: the current page plus an idle neighbour, and every page in the background for GFS/ICON) already queues
those pages. In the broad flows it added series requests (`erratic` 30.7 -> 33 per session, `icon_waves_scrub` 5 -> 5.3) for no
measured step-time change. **So STEP_PAGE ships OFF** (`REQUEST_DIET_OPT_IN`), contrary to the brief's "request the page as well":
code, tests and flows stay, for the case it targets (regional steps two or more EURO pages from where the layer was activated),
which none of these flows reach. C (what ships) equals B on both flows within noise, so the A -> B gains on `euro_steps` and
`regional_page_steps` hold for what ships (C was interleaved with B, not with A).

**Final bundle** (after merging `dev` 5fe62b5f2, STEP_PAGE off; one run per arm, a consistency check, not a fourth sample): world
`/grid` per flow A -> B `hour_steps` 8 -> 4, `euro_steps` 13 -> 9, `regional_page_steps` 15 -> 6, `erratic` 18 -> 18; series 4 -> 3,
4 -> 4, 10 -> 6, 32 -> 33; `/products` per map open with the rating overlay on 3 -> 1.

## 5. Checks

On the branch after merging `dev` 5fe62b5f2 (#421), in a dot-free mirror of `frontend/` (CRA's Jest finds no tests under
`.claude/worktrees/`): `CI=true npx react-scripts test --watchAll=false src/components/map src/tests src/__tests__` **421 of 421
suites** (418 in the first pass; the other 3 read repo-root files the mirror lacked, ENOENT, and pass once those files are beside
it). New suites: `marineRequestDiet.test.js`, `marineSeriesWhilePending.test.js`, `useMarineOrchestratorScrubCache.stepPage.test.js`
(each with its kill switch, or for STEP_PAGE its default, as the control arm). `node scripts/check_eslint.js`: exit 0, no rule over
its baseline. `craco build`: compiled with warnings, as `dev`. `python scripts/loc_ratchet.py`: no new violations
(`useMarineDataFetcherCore.js` 965 of its 966; `useMarineScrubSettle.js` 800).

One test changed shape on the way: `marineGlobalPrewarm.seriesReuse.test.js` pins the number of valid-time lookups (every extra must
be read-only). The first alias resolved one even with an empty cache; it now resolves only once a candidate entry exists, and that
test passes unchanged.

## 6. Limits and follow-ups

- Synthetic data and injected latency on a shared machine; a lead for the real app until read on it. `SWR_RETRY_CAP` is pinned by a
  unit test only (the synthetic backend never answers stale).
- Three themes x desktop/mobile: no UI, CSS, theme or layout code changed; every theme and layout reads the same data path. The lab's
  flows cannot drive the phone layout (a harness limit noted 2026-10-20 by the lead session), so phone was not replayed.
- Follow-up: `checkScrubSettle` is memoised on `marineData` alone (`useMarineScrubSettle.js`), so every settle branch sees a null map
  until the first commit; this PR works around it in one branch only.
- Live read-back owed after merge and deploy (one owner map load, never a scripted replay): `window.__MARINE_REQUEST_DIET__.counts` and
  the Render access log's `/products` per map open.

## 7. 2026-10-21 ~03:20Z: lead rulings (after the PR opened)

- STEP_PAGE: the lead session agreed it ships OFF and **stays off pending the static-frame path (#422) and GPU-resident frames**,
  which make per-step page requests moot; noted beside `REQUEST_DIET_OPT_IN` so nobody turns it on to "finish" #426.
- `?fields=compact` on `/products` (#423): left to whichever of #423 / #426 merges second (one line in `fetchProductsManifest`); the
  client reads exactly the 7 compact fields (`valid_time_end` is live in `getAvailableTilesFromManifest`).
- Ownership with #422: #426 owns the `/products` block and the cache / exact-upgrade / settle / scrub-cache modules; #422 owns the
  source switch inside `fetchBackendMarineGrid` and `marineGridSeries.js`. A test merge conflicts on two adjacent import lines only.
