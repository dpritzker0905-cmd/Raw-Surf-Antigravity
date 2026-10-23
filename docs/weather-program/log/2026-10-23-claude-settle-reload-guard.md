# 2026-10-23 (claude, GPU-frames session): the scrub-settle check stops force-reloading a page it already holds

Written 2026-10-23. Branch `claude/settle-reload-guard` from dev `9bf8d065c`. Evidence: `evidence/settle-reload-guard-2026-10-23.json`.
Client only. No served number changes. ON, with a kill switch. Split out of the pan fix (#501) at the lead's ask: "Please ship the
reload guard as its OWN small PR first ... It's a pure bug fix with the biggest leverage and the fewest moving parts".

## The loop
- Where: `useMarineScrubSettle.runScrubSettleCheck`, the clamp branch. If the resident grid does not suit the view (`detectClamp`), it
  commits a covering regional series frame when that frame is meaningfully finer (`frameFinerEnough`); otherwise it force-loads the
  view's page, `ensureMarineSeries(..., currentPageOnly, force=true)`, "so the next tick can sharpen".
- When the resident reads `regional_too_coarse` and the covering series frame is the SAME coarse grid (a model whose grid is that
  coarse at this zoom), the reload asks the same product again: it can never come back finer. The landed page fires
  `marine_series_revalidated`, which runs the settle check again (marineSettleLiveMap), which reloads again: a loop at page cadence.
- The backstop's no-progress cap does not stop it: it keys on the ENGINE grid bounds, and the resident alternated between the /grid
  tile and series frames (13 x 13 and 17 x 13 in the samples), so the signature kept changing.
- Found in the pan-fix drain replay (offline, surf ON, ICON, 20 small pans at z8 off Florida, the 1-CPU box modelled):
  `__MARINE_SHARPEN_DIAG__` read `regional_too_coarse`, `frameFound` and `frameCovers` true, `willSharpen` false every second, and
  the final box was asked again each time its page landed: dev 18 to 60+ times depending on the run, 117 when less other work was
  queued. Live, real ICON at z7-9 can read too coarse the same way, and each reload is a 10-25 s surf page (the 19:44Z saturation).

## Change
- `marineSettleReloadGuard.settleSeriesReloadNeeded(coveringRegionalFrame, { model, layer, hour, vb })`: with no covering regional frame
  the branch reloads as before ("No covering frame warmed yet"). With a covering frame that is not finer, it reloads under a budget per
  {model, layer, hour, view rounded to 0.5 deg}: 2 at once, then one per 30 s, 5 in all. The capped fuller-tile /grid upgrade below it
  (`clamp_resharpen`, 2 per view and hour) is unchanged. Kill: `window.__RAW_DISABLE_SETTLE_RELOAD_GUARD__ = true`.
- NOT "never" (first version, measured and corrected): refusing the reload outright made the swell replay ask MORE (/grid 19 vs 11,
  pages 8 vs 6). A covering-but-not-finer frame can be a coarse INTERIM (the backend serves a coarse clip while its regional product
  builds), and the forced reload is how the fine product arrives. The budget keeps that path and still ends the loop (5 per view, not
  117).

## Cousins (the lead: "One loop found usually means there's a cousin")
Every re-drive that can ask the network again, and what bounds it:
- clamp branch force reload: unbounded -> this PR.
- `clamp_resharpen` /grid (useMarineScrubSettle): 2 per {model, layer, hour, view to 0.1 deg}.
- the `timeline_scrub` safety net on a wrong hour or no data: 3 per {hour, model, layer}.
- the render backstop's clamp probes (marineSettleWatchdogs.evaluateClampCapProbe): 3 no-progress passes, then one probe per 45 s,
  at most 4, then terminal. Weak spot: the no-progress signature is the engine grid's bounds, so two alternating residents never cap.
- the exact-tile upgrade (marineExactUpgrade): attempts per {model, layer, hour} with a forget window, plus a global gap.
- series page retries (marineGridSeries): coarse-preview revalidation and warming retries `COARSE_REVAL_MAX`, failures
  `SERIES_FAIL_RETRY_MAX`.
- `marine_series_revalidated` -> `useMarineDataFetcher.onSeriesRevalidated`: a commit from cache only, never the network.
No other unbounded network loop found. The alternating-resident signature is noted as a follow-up.

## Results
Offline, `scn_sibling_toggle.js` at z8 (-79.95, 26.5) on the owner window: 20 drifting pans 3 s apart, then until the client stops asking
(cap 400 s), then Home + 6 PageUp steps 4 s apart; the box modelled (surf at 1/5 of live cost: 3 s per 16-frame page, 0.2 s per mini and
/grid; swell 4 s per page, 0.3 s per mini, 0.4 s per /grid). Evidence rows `G2_*`.

| Run | /grid_series | pages | minis | modelled series CPU | /grid | drained at | first Waves frame |
|---|---|---|---|---|---|---|---|
| surf ICON, dev | 98 | 74 | 24 | 226.8 s | 14 | 400 s | 3.2 s |
| surf ICON, **guard** | **44** | 21 | 23 | **67.6 s** | 15 | **89 s** | 2.5 s |
| swell GFS, dev (A / B) | 25 / 27 | 8 / 10 | 17 / 17 | 37.1 / 45.1 s | 11 / 18 | 72.6 / 90.9 s | 0.9 / 2.2 s |
| swell GFS, **guard** (A / B) | 25 / 27 | 8 / 10 | 17 / 17 | 37.1 / 45.1 s | 12 / 11 | 72.6 / 90.5 s | 1.0 / 0.9 s |

- Surf: -70% of the modelled CPU a pan session asks, and it stops asking at 89 s instead of 400 s. dev's loop length varies run to run
  (earlier dev runs: 52, 57 and 89 pages).
- Swell (surf OFF, the lead's control): identical series asks in both pairs; /grid 12 vs 11 and 11 vs 18 (noise both ways). The first
  version ("never reload with a covering frame") asked more here (/grid 19 vs 11, pages 8 vs 6); the budget does not.
- PageUp steps at z8 after the pans (ms from the key to the selected hour on the GPU; - = not within 4 s), the same in both arms:
  surf guard 62, 2189, -, 2756, 2774, -; surf dev 36, 2603, -, 2263, -, 1441; swell guard 1696, 1706, -, -, 1497, - / 1628, 1705, 2643,
  2076, 1773, 2594; swell dev 2039, 1955, 2396, 2044, 1510, 1669 / 1891, 1356, 2027, 2994, -, -. Day steps at z8 after a pan session
  take 1.4-3 s or more in this harness in BOTH arms: not this PR's, recorded as a follow-up (before the pans, z8 steps to 24 and 48 h
  took 43-50 ms).

## Tests
- New: `useMarineScrubSettle.reloadGuard.test.js`: the replay's scene through the real `runScrubSettleCheck` (detectClamp reads
  `regional_too_coarse`; a covering frame that is the same grid): no sharpen; 2 reloads at once over 10 ticks, then one per 30 s, 5 in
  all; no covering frame still reloads every tick; killed, 5 reloads in 5 ticks; the helper (keys per view and hour, the budget, the kill);
  a wiring check.
- The settle / paused-churn / settle-live-map suites: 128 pass unchanged. The whole frontend suite: 6,825 pass; 12 fail only in
  `netlifyIconStoredTailScope.test.js` (spawnSync timeouts under load; alone 12 of 12). ESLint ratchet passes.

## Not done
- The live read after the merge (ONE short scenario, /api/health before and after): surf ON, ICON, a few pans at z8 off Florida, then
  still: no /grid_series for the same box twice in a row while the view is still; `__MARINE_SHARPEN_DIAG__` may read
  `regional_too_coarse` with `willSharpen` false, and that is now quiet.
