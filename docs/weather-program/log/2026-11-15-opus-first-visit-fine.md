# 2026-11-15: first-visit coarse-then-fine at coastal zooms (Opus, Move 3; the director, from the advisor + animation lane)

## 19:40Z: the cause, cited to code (no fix code written)

- **What waits:** `frontend/src/components/map/marineExactUpgrade.js`, `useMarineExactUpgrade`. When the resident grid is a thinned
  WORLD frame (`isThinnedWorldGrid`: `__decimatedStride > 1` and span >= 340 deg), the hook re-runs the scrub-settle check, the path
  that sends the fine `/grid` request, only after the selected hour has held still for `EXACT_UPGRADE_DELAY_MS = 1500` ms (every
  hour change re-arms the wait), with one fallback at `EXACT_UPGRADE_RETRY_MS = 4500` ms. Bounds: at most 3 attempts per
  {model, layer, hour}, 2500 ms apart, and `EXACT_UPGRADE_GLOBAL_GAP_MS = 1500` across hours.
- **Why it was put there** (`733c69f91`, 2026-10-01, the code's own comment): "offline replay of a click burst: with 900 ms the first
  fetch went out for an hour the next click replaced, and a second followed". The wait keeps a click burst or a scrub from sending
  one exact world `/grid` per hour passed, on the one 1-CPU box. It is not the one-slot dispatch queue and not the fetcher's
  debounce (`timeline_scrub` dispatches with a 20 ms stable delay).
- **A second gap** (offline lab, `scn_first_visit_fine.js`, desktop, z8 at (-80.05, 28.45), GFS Waves, 8 steps, 6 s dwell; log
  `2026-11-15-opus-scrub-render-census.md` 19:05Z): at z8 the lab's series page is a REGIONAL 5x3 frame, not thinned and not world,
  so the upgrade never arms; on steps 2-8 no fine `/grid` was requested within 6 s and the coarse frame stayed up.

## 19:45Z: pre-registration (before any fix code and any gate run)

**Change under test (the director's option 2, plus the regional gap):**
- **P, prefetch next:** keep the 1500 ms wait. Once the user has dwelt on an hour for >= 1.5 s (the same stability test), also request
  the fine grid of the NEXT hour in the scrub direction, through the normal fetch path, at most one per dwell, so the next step finds
  it in the client cache. Kill `__RAW_DISABLE_FINE_PREFETCH_NEXT__`.
- **R, regional upgrade:** arm the same settled upgrade (same 1500 ms wait, same attempt bounds) when the resident grid is a coarse
  SERIES frame (regional or world) coarser than the fine grid the viewport would get. Kill `__RAW_DISABLE_FINE_UPGRADE_REGIONAL__`.

**Lab:** offline synthetic backend only (port 4298), never the live box. Its `/grid` response time is measured and reported with
every run (the 0.4-3.3 s seen so far is the mock's, single-process, not production's). One build; ON vs KILL (both kills set),
alternating, 3 sessions per arm per scenario; desktop (no throttle) and phone (4x CPU).

**Scenarios** (Waves, GFS; a coastal view where the KILL arm shows the coarse-then-fine pattern; z8 at (-80.05, 28.45) unless
the 20:00Z note below names another before any ON number):
- **slow:** 6 single ArrowRight steps to hours not yet visited, 3 s dwell each;
- **drag:** ArrowRight held through 12 hours (a press every 150 ms), then a 3 s stop;
- **back:** after slow, 3 ArrowLeft steps (direction change).

**Instruments (in the page's clock):** time-to-fine = keydown to the first animation frame drawing a non-series, non-decimated grid
at the step's target hour; every `/api/weather/grid` request (count, bytes received); every draw.

**Gates (all must pass, scored as written):**
- **F1, latency:** slow scenario, steps 2-6 (step 1 has nothing prefetched): time-to-fine p50 ON <= 0.5x KILL, and ON p95 not worse
  than KILL. Both views.
- **F2, load:** `/grid` requests and bytes per session: drag ON <= KILL (no request per hour passed); slow and back ON <= KILL + 1
  (at most the last dwell's unused prefetch). Both views.
- **F3, no harm:** scrub step key-to-shown (the census probe) not worse than KILL by more than 5 ms p50 / 15 ms p95; 0 frames where
  a fine grid of an hour other than the current target is drawn after the target changed (no stale fine over a newer hour);
  0 blank frames.
- **F4, unit:** Jest pins: the prefetch fires once per >= 1.5 s dwell and never during a drag; R arms on a coarse series frame and
  not on a fine one; both kills' off paths; the mutants that drop the dwell test or ignore a kill fail.
- Default ON only if F1-F4 pass as written; otherwise it stays off by default or is not shipped, and the result is logged as it falls.
