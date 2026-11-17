# 2026-11-16 Fable (animation lane): the fine grid on a FIRST visit to an hour arrives late

Client only, display only. No served number changes. Assigned by the director (2026-11-16 22:18 EST): "the first-visit
fine-request delay. It's the measured weak point and it serves 'instant' for every step. Pre-register its gate (time-to-fine
on first visit, /grid count per scenario unchanged), and coordinate with Move 3's earlier prefetch-after-dwell work so you
don't redo it. Keep the browser jobs offline and mock-backed." Base: `origin/dev` bd8e4c8cd. Branch `fable/first-visit-fine`.

## 1. What is known, and from where (nothing new measured in this section)
- From the marine hour-blend gate (`2026-11-15-fable-crest-hour-blend.md` on `fable/crest-hour-blend`, sections 21-23, measured
  offline with `scn_grid_at_rest.js`): on a FIRST visit to an hour at a regional zoom the engine draws a coarse world grid
  (46 x 21) about 45 ms after the step, and replaces it with the finer grid when that grid's own request returns, 1.4 to 4.2 s
  after the step. The request is SENT about 1.5 s after the step (0.4 to 1.6 s) and takes 0.4 to 3.3 s on the offline backend.
  On a repeat visit the cached fine grid is drawn at once. The wind engine has no stand-in: it holds the previous hour until
  the request returns (3.1 to 3.5 s on the same harness).
- Not known: WHAT holds the request back for about 1.5 s (a debounce, a settle timer, a queue, or a chain of them), and
  whether that wait is deliberate protection for the one 1-CPU backend during a scrub. The scrub-settle code
  (`useMarineScrubSettle.js`) and the dispatch slot (`useMarineDataFetcherCore.js`) both hold timers of that order.
- Move 3 (#802, merged; #832) put every marine layer in the GPU frame store with adaptive prefetch, so a WORLD step is served
  from the store. What is late here is the REGIONAL fine grid on a first visit, which the store does not hold. Before any
  design I read Move 3's prefetch code and its notes, and ask that lane what it already tried after a dwell, so this does not
  redo it.

## 2. THE GATE, written before the cause is found and before anything is built. No threshold moves after data.
Instrument: the offline harness only (the built client over the synthetic backend); nothing is asked of the live backend.
Arms: A = the kill set (today's behaviour), B = the change; both in one page where the kill is read at run time, otherwise one
page each, interleaved A B A B. Waves and wind, GFS. Dark, desktop 1280 x 800 unless a line says otherwise.
**Views (six, regional zooms where a fine grid exists):** (-158, 21.6, z5), (-9.5, 39, z5), (150, -34, z5), (-123, 37.5, z5),
(-5, 50, z4.5), (115, -10, z4). Each run starts from a page that has never visited the hours used (a fresh page, or hours not
yet touched), so every step is a first visit; that is checked per step (a /grid request for that hour was seen) and a step
that was served from cache is left out and counted.
- **F1 the request leaves sooner (the deciding line).** For an isolated step (one +3 h step, then nothing for 6 s), the time
  from the keydown to the fine grid's request leaving the client. 8 steps a view, 48 steps an arm. Pass: arm B's median at
  most **400 ms** AND at most **40%** of arm A's median. If arm A's median is itself under 600 ms on this build the premise
  is gone and the line is VOID (then there is nothing to fix here and that is the finding).
- **F2 time to fine.** Same steps: keydown to the fine grid being the engine's grid. Pass: arm B's median lower than arm A's
  by at least **60%** of the F1 improvement (the rest of the time is the backend's and is not this change's to claim).
  Reported for wind as the time the new hour is on screen at all.
- **F3 the backend is asked no more (the director's line).** The number of `/api/weather/grid` and `/grid_series` requests,
  counted per scenario, three repeats each, in both arms: (a) the isolated steps above; (b) a scrub of 8 steps at 600 ms a
  step; (c) a drag of 8 steps at 100 ms a step; (d) a pan of half a screen, 2 s rest, then one step; (e) a model toggle then
  one step. Pass: in every scenario arm B's count is **not higher** than arm A's in any repeat (equal or lower), per endpoint.
  Aborted requests count: the backend still starts work on them.
- **F4 nothing drawn is different at rest.** 6 s after each isolated step the engine's grid (size, bounds, valid time) and its
  texture bytes are identical in both arms. 48 of 48.
- **F5 a fast scrub is not slower.** Scenario (b): the hour-step latency (keydown to the first frame of the new hour) median
  in arm B not more than **10%** above arm A's.
- **F6 the off path.** Unit tests: with the kill set the timing constants and the dispatch order are today's.
- **Controls.** Positive: a lab switch that removes the wait entirely must show F1 near zero and must make F3 FAIL in scenario
  (b) or (c) (more requests); if it does not, F3 cannot see a request storm and is VOID. Negative: arm A against arm A
  (two pages, same build) must show no F1 difference beyond 15% and equal F3 counts; otherwise the harness is too noisy to
  decide and the gate is VOID.
- Kill switch for the change: `window.__RAW_DISABLE_FIRST_VISIT_FAST_FINE__ = true`. It is a timing change to when a request
  is sent, not what is served; if it passes it ships ON with the kill (D-065). No `SCOREBOARD.md` row: no served number can move.
- NOT covered: the live backend's real latency (never load-tested), a real phone, Safari and Firefox, EURO and ICON.
- The advisor is sent this text before anything is measured.

## 3. Next, in order
1. A PROBE, no gate number: per isolated first-visit step, a timeline of the keydown, every timer of the settle and dispatch
   path that fires, and the request leaving, so the cause of the wait is named with its file and line.
2. Read Move 3's prefetch-after-dwell code and ask that lane what was tried.
3. Only then a design, written here before it is built.
