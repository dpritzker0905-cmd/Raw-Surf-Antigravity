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
RESULTS_TABLE

## Not done here, for the lead
- "Bound any retry to one": the SWR ladder's shape is the 2026-10-21 ruling (#441: never stops; 10 asks at 1.5 s first, a typical
  live sharpen being ~25 s; #426's hard cap at 3 left z5-7 previews coarse). With the per-ask count the existing live knob
  `window.__RAW_MARINE_SWR_MAX_RETRIES__` is a per-ask cap; the `cap1` arm above measures it at 1. Changing the default is your call.

## Harness (this PR)
- `scn_model_toggle.js`: `CONLOG=1` (console lines, every /grid and /grid_series answer, click and wheel marks on the reqlog clock),
  `SURF=1`, `FLAGS=<window flags>` (a control arm on the same build).
- `scn_sibling_toggle.js` STEPS: per step the stale-frame class (admitted by the status line, or silent), #501's counters, the
  fetcher's console lines and pipeline events, each /grid's valid_time.
