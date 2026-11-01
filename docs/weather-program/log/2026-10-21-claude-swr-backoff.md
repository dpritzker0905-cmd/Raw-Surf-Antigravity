# SWR_BACKOFF: the stale-grid re-ask backs off instead of polling for ever (2026-10-21)

Session opened 2026-10-21 ~15:10Z, started by the request-diet session (`local_8fb65c27`, PR #426), at the lead's request
(`local_d6b521eb`); #426's log (`log/2026-10-20-claude-request-diet.md` section 8) names this follow-up. Task: replace the stale /
empty grid re-ask's fixed delay and cap (`useMarineRevalidation.scheduleSWRRevalidation`) with a never-stopping ladder (1.5, 3, 6, 12,
24, 48 s, then hold), prove it offline (never the live backend), decide ON (kill switch) or opt-in with evidence, one draft PR against
`dev`. Branch `claude/swr-backoff-ladder`, cut from #426's head `6ff5a2d3d` while #426 was open; #426 merged at `8392f25b8` during the
session and `dev` (`f17508ba0`: #426, #432, #429, #422, #419) was merged in. **No served number changes** (no SCOREBOARD row): the same
products are requested and drawn; only WHEN the client re-asks a grid the backend labelled stale changes. Evidence:
`docs/weather-program/evidence/swr-backoff-2026-10-21.json` (every run, medians, server time per ask). Offline throughout.

## 1. What changed

- `marineRequestDiet.js`: part `SWR_BACKOFF` (ON; kill `window.__RAW_DISABLE_SWR_BACKOFF__`, or the umbrella
  `__RAW_DISABLE_REQUEST_DIET__`), pure `planSwrRevalidation({ attempt, empty, staleDelays, maxRetries })`. Shipped shape: the first
  `SWR_BACKOFF_FAST_ASKS = 10` re-asks keep the old cadence (1.5 s stale, 2.5 s empty), then the specified ladder (3, 6, 12, 24, 48 s;
  empty 5, 10, 20, 40, 48 s), 48 s held, never stopping. Why the fast phase: section 4. `SWR_BACKOFF_FAST_ASKS = 1` is the ladder
  exactly as specified; so is the live tunable `window.__RAW_MARINE_SWR_STALE_DELAYS__ = [1500, 3000, 6000, 12000, 24000, 48000]`.
- **#426's opt-in `SWR_RETRY_CAP` is superseded** (removed from `REQUEST_DIET_PARTS`; `__RAW_SWR_RETRY_CAP__` is no longer read). Its
  hard stop is `window.__RAW_MARINE_SWR_MAX_RETRIES__ = 3`, which now caps the ladder. `keepSwrRetryCount` (the one-line call site #426
  put in `useMarineDataFetcherCore.js`, still 966 of its 966 lines) now keys on `SWR_BACKOFF`: the re-drive keeps its attempt count so
  the ladder climbs; every other source, a viewport change, a model / layer / hour change and a fresh non-stale commit restart it.
- Live tunables kept: `__RAW_MARINE_SWR_STALE_DELAYS__` replaces the stale rungs (last entry held, as before);
  `__RAW_MARINE_SWR_MAX_RETRIES__` is now a hard stop only when set (unset = never stop; it used to default to 3, a cap the run-top
  reset kept from ever applying). Under the kill both behave exactly as before (fixed 1.5 s / 2.5 s, cap 3 at hook level).
- Telemetry: `window.__MARINE_REQUEST_DIET__.counts.swr_redrive_scheduled` (+ `last` with attempt, delay, empty).
- Tests: `useMarineRevalidation.test.js` (rungs, never stops, fresh-commit restart, empty rungs, both tunables, the kill and the
  umbrella byte-identical), `marineRequestDiet.test.js` (the fetcher-shaped loop: 14 re-asks in the first minute and 25 in ten vs 40 and
  400 under the kill; the pure planner), `useMarineDataFetcherCore.swrBackoff.test.js` (renamed from #426's `swrCap`: the REAL
  updateMarineGrid keeps the count on its re-drive, resets it for other sources and under the kill), `marineEmptyGridRetry.test.js`.

## 2. Instruments (offline)

- `serve_synthetic.py` stale window: `GET /__lab/stale?seconds=N&scope=world|regional|any&model&layer&stride` arms it from now; every
  matching marine `/grid` (never `/grid_series`) is the production resolver's own product made stale (`swr_revalidation_pending`) on
  every `stride`-th latitude and longitude until the window ends, then fresh; `/__lab/stale/status` logs every matching `/grid` (wall
  clock in/out, stale or fresh, cols). `--stale-seconds` arms one at the first matching request. Off unless armed.
- `lab.js`: flows `stale_world` (z3.5) and `stale_regional` (z6): 30 s settle at the view, arm the window, +6 h step, then the idle map
  dwells until the fresh grid has been drawn 5 s (or `LAB_STALE_TAIL_MS`); a per-frame draw log of the marine engine's resident grid;
  `LAB_WINDOW_JSON` for non-`true` window values. `stale_summary.js` prints each run and the medians.
- Lab: LAT_GRID 500, LAT_SERIES 2500, LAT_PRODUCTS 1500 ms; one bundle per round; arms interleaved A1 B1 C1 A2 ...; the 25 s and 120 s
  windows ran as two parallel streams on two backends (:4198, :4199) over one SPA (:3198). Shared, loaded machine (other sessions'
  labs, a parallel Jest run once): the re-ask cycle here is ~2.4 s (stale world `/grid` resolve 361 ms median on this machine, + the
  injected 500 ms, + client), so today's arm reads ~22-24 re-asks a minute, not the ~30-40 a faster box would give.

## 3. Pilots (what they changed)

- A move onto the world view asks no `/grid` (the activation prewarmed the exact world grid), so the world flow is an hour step.
- At zoom 6, hour 0: the view's series page landed INSIDE the window, a frame labelled hour -1 that the settle watchdog re-drove every
  ~2 s (each re-drive restarted the ladder at `retry #1`), and after ~19 s every re-drive was dropped, in both arms. Moved to the same
  shape as the world flow (settle 30 s at z6, then +6 h). Still at z6: the engine holds the same-instant series frame (labelled hour 5
  for hour 6), the watchdog drives the re-asks, and they END in every arm (section 6).
- The first bundle predates `dev`'s #429 (settle check sees the live map), which touches exactly that watchdog: round 2 reran on the
  merged bundle.

## 4. Round 1: first bundle (`6417e2fff`, before merging dev), world view, 3 interleaved runs per arm

A = today (kill), B = the ladder from the first ask, C = 10 fast asks then the ladder (the tunable, what now ships). Medians:

| stall | arm | re-asks / min while stale | backend fresh -> fresh grid drawn |
|---|---|---|---|
| 25 s | A | 23.9 | 2.2 s |
| 25 s | B | 8.0 | 5.7 s |
| 25 s | C | 24.0 | 3.2 s |
| 120 s | A | 24.5 | 2.7 s |
| 120 s | B | 3.1 | 32.9 s |
| 120 s | C | 7.2 | 17.1 s |

Every world run: the stale grid was drawn, the fresh one was drawn, and no ask followed the first fresh answer. B's asks as the
backend saw them: 0, 2.7, 6.6, 13.9, 27.0, 51.9, 100.8 s (the rungs plus a ~1-2 s round trip). One B run per window lost its step to a
harness `fetch failed` (B2 world 25 s: rerun once afterwards, not interleaved: 8.1 / min, 5.7 s, the same as B1 and B3; B1 z6 120 s).

**Decision: ON, with the fast phase.** The ladder from the first ask makes the fresh frame wait for the next rung: +30 s after a 120 s
stall here, and, computed for the one live sharpen on record (mid preview -> fine in 25 s, HANDOFF-2026-07-20; 0.5 s round trip), the
fresh grid is asked at 49 s instead of ~26 s. Computed mean extra wait for a stall anywhere in 0-30 s: 7.6 s (ladder) vs 1.0 s (today)
vs 1.6 s (fast phase). That is the zoom sharpen latency the owner has reported before ("slow expansion", HANDOFF-2026-07-15 section 1),
so the ladder alone would trade a visible regression for cheap requests. Ten fast asks keep today's behaviour through ~25 s and still
cut a long stall: computed per ten minutes 24 asks vs 16 (ladder) vs 300 (today, 0.5 s round trip). Cost per ask on this machine
(the production resolver alone, before JSON encoding): stale world `/grid` 361 ms median, p90 615 ms (n 513); z6 224 ms. So an idle
stale world view at today's cadence is roughly 10-20 % of the 1-CPU box. The shipped default is arm C's rungs exactly.

## 5. Round 2: merged bundle (dev `f17508ba0` + `4017c6167`), world view, A vs D (= the shipped default), 3 interleaved runs per arm

| stall | arm | re-asks / min while stale | backend fresh -> fresh grid drawn |
|---|---|---|---|
| 25 s | A | 22.6 | 1.7 s |
| 25 s | D | 21.2 | 2.6 s |
| 120 s | A | 21.2 | 3.2 s |
| 120 s | D | 7.1 (-66 %) | 6.8 s (4.9 / 6.8 / 9.1) |

Same pattern: equal through a typical sharpen, a third of the asks over a long stall, the fresh frame a few seconds later (where the
120 s stall ends against the rungs decides how many: round 1's C waited 17 s, round 2's D 5-9 s; up to one 48 s rung in the worst case).

## 6. Zoom 6 (both rounds): arm-independent, and a pre-existing gap

At z6 the re-asks are driven by the scrub-settle watchdog (the engine holds the same-instant series frame labelled hour 5 for hour 6),
each one restarts the ladder, and the re-asking ENDS mid-stall in every arm. Reached fresh, per window and arm: round 1 25 s A 0/3, B
2/3, C 1/3; 120 s 0/3 in all arms. Round 2 (with #429) 25 s A 2/3, D 2/3; 120 s A 0/3, D 0/3. So the review's worry (a z5-7 stale
preview left coarse on an idle map) is real, but not caused or cured by this change: something ends the re-ask after ~15-35 s at z6
in every arm. Not chased here (scope); a follow-up should find what drops the re-drive (a duplicate-commit skip or same-target dedup
returning before `scheduleSWRRevalidation`, or the series frame's non-stale commit clearing the timer) and whether the live app does
the same.

## 7. Checks

In a dot-free mirror of `frontend/` (`C:/Users/David/rsx/swrladder`, `node_modules` junction, the repo-root files three suites read):
Jest `src/components/map src/tests src/__tests__ src/hooks` on the merged branch **440 of 440 suites, 5,881 tests** (the first full run
failed 2 tests in #426's `swrCap` test, which the dev merge had re-added beside its renamed copy; removed in `a9e86240f`).
`node scripts/check_eslint.js` exit 0 (no rule over its baseline); `craco build` compiled with warnings, as `dev`;
`python scripts/loc_ratchet.py` no new violations (fetcher core 966 / 966, `useMarineRevalidation.js` 145, `marineRequestDiet.js` 148).
Three themes x desktop / mobile, ARIA: no UI, CSS, theme or layout code changed (data path only); the phone layout was not replayed.

## 8. Limits and follow-ups

- Offline and synthetic: the stale window is an injected label on the production resolver's product, not a real revalidation; the
  machine was shared. Request counts and the ladder's timing are robust; the latencies carry the machine's noise.
- The empty / cold-ingest transient (a run still ingesting) was not replayed offline (the window answers stale, not empty); its rungs
  are the same shape from 2.5 s and are pinned by unit tests only.
- Live read-back owed after merge and deploy: one owner map load, never a scripted replay: `window.__MARINE_REQUEST_DIET__.counts.
  swr_redrive_scheduled` and, in the Render access log for an idle stale view (a zoom-in sharpen), `/grid` asks at ~1.5-2 s spacing for
  ~25 s and then spreading out (ledger commitment below).
- Zoom 6 re-ask ends early in every arm (section 6): proposed as its own session.
- Ledger: lines 1595 (`pr_open`) and 1596 (commitment) follow `dev`'s 1594; if `dev` appends first, whoever merges second re-chains.

## 9. 2026-10-21 ~22:00Z: PR and ledger

Draft PR #441 (`claude/swr-backoff-ladder` -> `dev`); ledger seq 1595 (`pr_open`) and 1596 (the live read-back commitment, due
2026-10-28), after `dev`'s 1594. Not merged; the lead merges.

## 10. 2026-10-21 ~22:11Z: ledger re-chained once (corrects section 9's seq numbers)

`dev` took #438 (`42833a52d`) and its lines at 1595-1596 while #441 was open, so #441 conflicted on `ACTIONS.jsonl`. Merged `dev`, took
its ledger byte-for-byte, and re-appended this PR's two lines unchanged (same fields, `acted_at` = their first writing): **1597**
(`pr_open` #441) and **1598** (the live read-back commitment, due 2026-10-28). Section 9's "1595 and 1596" were those lines' first
numbers; on `dev` 1595-1596 are #438's.
