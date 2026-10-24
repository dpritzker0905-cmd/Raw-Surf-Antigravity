# 2026-10-24 (claude, GPU-frames session): the same-key /grid repeats and the sibling re-asks at z8 (P1)

Branch `claude/same-key-grid-repeats` from dev. Evidence: `evidence/same-key-repeats-2026-10-24.json`. Client only, no served number
changes; three parts ship ON, each with its own kill switch.

## Ask (the lead, 2026-10-24)
- "P1: same-key /grid repeats at z8 (225 asks over 33 distinct keys; one key asked 31x at about 2 s) and swell sibling minis asked
  11-13x. Find the asker and dedupe on the key. Bound any retry to one."
- The finding it came from: the mid-zoom session's z8 Lake Michigan replay (GFS <-> EURO x3 plus one PageUp, 264 s, dev f6433615a),
  `side-session-notes/.../wave-lakes-z8-asks-2026-10-23/`.

## The askers (measured)
Replay: `scn_model_toggle.js` with `REQLOG=1 CONLOG=1` (new: the client's own console lines and every /grid and /grid_series answer
the page received: product, stale flag, size), z8 (-86.9, 44), PLAN `EURO,GFS,EURO,GFS,WHEEL:PageUp,EURO,GFS`, a synthetic store with
land mask and wave lakes, built viewport products removed before each run (cold), swell unless noted.

1. **The /grid loop is the SWR re-ask ladder restarting.** Before 25 of 30 repeats of the top key the client logged
   `[SWR] Committed stale/coarse grid. Scheduling SWR revalidation retry #N`, before the rest a render-backstop re-drive; the retry
   numbers restarted at #1 21-22 times per session. The ladder (#441) is ONE count for the whole fetcher, zeroed by every run that is
   not its own re-ask (each toggle, each wheel step, each backstop re-drive, each clamp re-ask), and those runs also cancelled its
   pending timer. The mid-zoom log shows it directly: the GFS 00Z key was asked in three bursts of 9, 10 and 12 at ~2 s, one per
   GFS-visible window, each burst the fast 1.5 s rung from #1 again.
   - It needs the box to answer stale for a while (a saturated box: the revalidation has not landed). With the store's viewport
     products already built (a warm backend), the same replay asks each key 1-3 times; the first cold run after a fresh store asked
     one key 30 times. Reproduced deterministically with the synthetic backend's stale window (`--stale-seconds 150`).
2. **The sibling minis and pages are re-asked on every visible /grid.** marineController runs the sibling warm after each network
   /grid; a sibling whose answer gave no frame to cache (no drawable cell for this model in the box, a coarse world frame, a frame
   evicted or for another hour) stayed "not ready", so each /grid asked its mini again and queued its page again. Mid-zoom log: the
   GFS swell_1 mini at the opening hour was asked at 15, 28, 35, 50, 83, 83, 97, 100, 101, 127, 163, 164, 166, 166 and 169 s.
3. **The settle check's page reloads were budgeted per HOUR.** #505 limits the force-reload of a page it holds a covering frame of
   (2 at once, then one per 30 s, 5 in all) per model, layer, hour and view; every wheel step inside the page (the replay steps +1 h
   and back after each click) opened a fresh budget for the same page request. Warm backend: one GFS 48-frame page asked 5-6 times
   and one EURO page 4-6 times in 260 s, every answer the same fresh page.

## What ships (client only, ON, kill switches)
- `SWR_KEY_LADDER` (marineRequestDiet.js, useMarineRevalidation.js, one call in useMarineDataFetcherCore.js): the ladder climbs PER
  ASK (the fetcher's viewport hash: box, model, layer, hour, flavour). Every stale answer to the ask moves it one rung, whoever
  asked; an ask not answered stale for 96 s starts at the bottom again. While the re-ask of an ask is scheduled, any other re-drive
  of that same ask waits for it; any other ask is never held, and leaving the view clears the timer, so a return asks at once and
  climbs on. Kill `window.__RAW_DISABLE_SWR_KEY_LADDER__`. Telemetry `__MARINE_REQUEST_DIET__.counts.swr_key_hold`, ring
  `swr_key_hold`.
  - First build tried and replaced: counting only the ladder's own timer (the other re-drives kept cancelling it: #1 every time)
    and holding only while the stale answer was the resident (the resident was a fresh series frame then). Both read in the trace.
- `SETTLE_RELOAD_PAGE_KEY` (marineSettleReloadGuard.js): #505's budget is kept per PAGE request (model, layer, flavour, page,
  snapped request box). Kill `window.__RAW_DISABLE_SETTLE_RELOAD_PAGE_KEY__`.
- `SIBLING_ASK_ONCE` (marineSiblingWarm.js): a sibling's mini (per hour) and page (per page) for one model, layer, flavour and
  snapped box are asked once per 5 min (the series TTL), answered or not; an aborted ask does not count; a held warm re-caches the
  mini's frame from the series cache (no request). Kill `window.__RAW_DISABLE_SIBLING_ASK_ONCE__`. Telemetry
  `__RAW_SIBLING_WARM__.askedOnce`.

## Measured (one build, the control arm sets the three kill switches = dev)
Build dev 111f0726c + this change. The stale window with `--stale-fast 1` (new, see Harness): production answers its SWR preview
from cache, so a stale re-ask returns in well under a second; without it every stale answer re-ran the resolver (p50 2.4 s on this
machine) and the ladder never left its fast rung in either arm.

| Scenario (stale 150 s, fast) | Arm | Asks | /grid | /grid_series | Repeat | Most asks of one key | SWR restarts at #1 |
|---|---|---|---|---|---|---|---|
| swell, GFS <-> EURO, run a | dev | 95 | 63 | 32 | 4.13 | 36 | 23 |
| | fix | **66** | 40 | 26 | 2.54 | **18** | 4 |
| swell, GFS <-> EURO, run b | dev | 107 | 73 | 34 | 4.65 | 42 | 34 |
| | fix | **70** | 38 | 32 | 2.59 | **17** | 4 |
| | fix + cap 1 (`__RAW_MARINE_SWR_MAX_RETRIES__` = 1) | 49 | 25 | 24 | 1.96 | 10 | 4 |
| surf, GFS <-> EURO | dev | 83 | 60 | 23 | 3.61 | 33 | 22 |
| | fix | **54** | 33 | 21 | 2.35 | **15** | 3 |
| swell, ICON <-> GFS | dev | 95 | 69 | 26 | 3.39 | 30 | 13 |
| | fix | **62** | 44 | 18 | 3.26 | **15** | 3 |

- Asks down 30-35% in every scenario; the worst key halved (36 / 42 / 33 / 30 -> 18 / 17 / 15 / 15). Its remaining asks are the
  ladder by design: 10 at the 1.5 s rung, then 3, 6, 12 s (the EURO key in run a: #2-#10 at ~2 s, #11 at 3 s, #12 at 6 s, #13 at
  12 s; back on the key later it asks once at once and climbs on).
- The most asks of one visible page: 7-8 (dev) -> 4 (fix). ICON pair: minis 12 -> 6.
- Slow stale answers (no `--stale-fast`): 75 / 76 (dev) vs 73 / 70 (fix), restarts 24 / 28 -> 6 / 5. No stale window: 46 vs 42 asks,
  /grid_series 33 -> 26.
- The siblings: this store does not reproduce the mid-zoom run's unusable sibling frames (the most asks of one sibling mini is 2 in
  every arm here), so SIBLING_ASK_ONCE's effect rests on that log's timeline above and on the unit tests.
- Every session, both arms: 1-6 frames where the drawn model is the previous one and no status line shows yet, 0-16 ms after a
  model click (one frame each: the chip moves a frame before the status line). Not this change; it goes to the verify matrix
  (cell 3, mislabel on every frame). 0 lit lakes.

## Not done here, for the lead
- "Bound any retry to one": the SWR ladder's shape is the 2026-10-21 ruling (#441: never stops; 10 asks at 1.5 s first, a typical
  live sharpen being ~25 s; #426's hard cap at 3 left z5-7 previews coarse). With the per-ask count the existing live knob
  `window.__RAW_MARINE_SWR_MAX_RETRIES__` is a per-ask cap; the `cap1` arm above measures it at 1. Changing the default is your call.

## Harness (this PR)
- `scn_model_toggle.js`: `CONLOG=1` (console lines, every /grid and /grid_series answer, click and wheel marks on the reqlog clock),
  `SURF=1`, `FLAGS=<window flags>` (a control arm on the same build).
- `scn_sibling_toggle.js` STEPS: per step the stale-frame class (admitted by the status line, or silent), #501's counters, the
  fetcher's console lines and pipeline events, each /grid's valid_time.
