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

## 4. THE PROBE (2026-11-17, 20:52-21:06 EST): the cause is named. No gate number in this section.
**Instrument:** `scn_first_visit_probe.js` and `first_visit_probe_report.js` (this branch). A build of this branch (dev
`bd8e4c8cd`), offline backend, waves, GFS, dark, desktop; six views, a fresh page each, four isolated +3 h steps with 6 s
between them: 24 first-visit steps. In the page every `setTimeout` (delay, where it was set, when it fired), every
`/api/weather/grid` request (when it left, its stack) and the engine's grid every 40 ms were recorded; stacks resolved through
the build's source maps. 0 errors. Machine note: one core was held by a runaway process of another lane during this run
(reported to the director); the timings below are set by a timer, not by load, and repeat to within 35 ms.
**What the timeline shows, the same in every view:**
- The thinned world frame of the new hour (46 x 21) is the engine's grid 23 to 89 ms after the keydown.
- **The fine grid's request leaves 1,529 to 1,565 ms after the keydown in 21 of 24 steps** (median 1,535 ms). In the other
  three it left at 132, 338 and 1,048 ms, behind an earlier step's fall-back timer that happened to fire then. The fine grid is
  the engine's grid 1.5 to 5.1 s after the keydown (most often 1.9 to 2.8 s): the request then takes 0.3 to 1.3 s here.
- A 1,500 ms timer is set 24 to 35 ms after the keydown and fires at 1,527 to 1,551 ms, immediately before the request:
  **`marineExactUpgrade.js:286`**, `setTimeout(drive, EXACT_UPGRADE_DELAY_MS)`, in `useMarineExactUpgrade`. A second 1,500 ms
  timer fires beside it (`marineWorldWarmOnSettle.js:59`); it warms world frames and is not the one that asks for this grid.
  (The request is not attributed to the timer by the instrument itself: it leaves after an `await` inside the timer's
  callback. The match is by time, in 21 of 21, and by reading the code: the timer's callback is the settle check.)
**The cause, by file and line.** `EXACT_UPGRADE_DELAY_MS = 1500` (`marineExactUpgrade.js:50`). The hook arms when a THINNED
world frame becomes the engine's grid; 1,500 ms later, if the selected hour has not moved, it runs the settle check
(`checkRef.current()`), which at a regional viewport finds the coarse grid and asks for the fine one. Nothing asks sooner for a
keyboard or button step: the faster settle timers (60 to 250 ms, `useMarineScrubSettle.js:456-468`) belong to a wheel drag.
**The wait is deliberate, and its own comment says why:** "offline replay of a click burst: with 900 ms the first fetch went
out for an hour the next click replaced, and a second followed". Beside it `EXACT_UPGRADE_GLOBAL_GAP_MS = 1500`: "stepping
through hours one after another must not fire an exact world fetch per step". It is a dwell guard for the one 1-CPU backend
(a world `/grid` is 2.3 MB and 3 to 9 s there), added 2026-10-01 (`733c69f91`) and already raised from 900 ms by measurement.
**What that means for the gate written in section 2, said before any design.**
- F1 (the request leaves within 400 ms) and F3 (the backend is asked no more, in a scrub at 600 ms a step) pull against each
  other for any change that only shortens the wait: a wait shorter than the gap between two clicks sends a request for the
  first click that today is never sent. A shorter wait alone cannot pass both lines. That is the finding of this probe, and
  I do not move either line.
- So the question is not "how short can the wait be" but "when is the wait not needed". It protects the backend. Where the
  fine grid can be had WITHOUT the backend there is nothing to protect: an hour already in the client's cache, in the GPU
  frame store, or served as a crop of a static CDN frame (`staticFrames.js`, mid-zoom crops since 2026-10-22). In production
  static frames are on; in this harness the frame stand-in holds no wave frames, so every fine grid here went to `/grid`.
  NOT yet known, and the next thing to establish before a design: at these views and zooms, on production's configuration,
  is the fine grid served from the CDN crop path or from the backend? If from the CDN, the 1.5 s wait buys nothing there and
  the upgrade can run at once for those hours with F3 untouched. If from the backend, the honest options are a speculative
  prefetch of the next hour after a dwell (one request moved off the step, at most one wasted per dwell: F3 fails by one as
  written) or leaving it as it is.
- Asked of the Move 3 lane (owed): what its prefetch-after-dwell work covered at regional zooms.

## 5. Does production serve that fine grid from the CDN? By the client's own rule: YES for all five probe views (2026-11-17, 22:18 EST)
The owner's question ("find out if production serves it from the CDN"). Answered WITHOUT touching the live backend: by the
client's routing rule, run as code on the exact request boxes the probe recorded. Not observed on the deployed site.
- **What the "fine grid" at these zooms is.** The boxes the client asked for in section 4 are 24 to 34 degrees wide
  (`-170,13,-146,30`; `-22,31,3,46`; `138,-41,162,-26`; `-135,30,-111,45`; `-22,41,12,58`) and the grid that came back was
  24 x 21 to 30 x 21: a CLIP of the 2-degree world field (`global_mid`), not a finer product. The sixth view (z4) asks for
  the world box itself.
- **The rule** (`staticFrames.staticEligible` -> `staticFrameCrop.midCropRulesPass`): with static frames on, a box 12 to 40
  degrees wide is answered as a crop of the static CDN world frame when every regional tile it overlaps is narrower than the
  box (the server would answer such a box from `global_mid` too). `tryStaticWorldGrid` then serves it from the pinned frame,
  with no `/grid` request.
- **The check** (a temporary Jest file, not committed; the real `midCropRulesPass`, a manifest built from all 19 regional
  tiles in `backend/services/weather_pipeline/pilot_regions.py` read from that file, plus the world tier; the widest tile is
  22 degrees, the tallest 24): all five boxes -> **CDN crop**. The same with every tile padded 3 degrees a side: all five ->
  CDN crop. With no manifest read yet: backend `/grid` (as designed: "no manifest: /grid decides").
- **So, in production's configuration** (static frames on by default since 2026-10-21, the mid-zoom crop since 2026-10-22,
  GFS waves `global_mid` published 3-hourly on the CDN: 57 frames to f168 were read from it on 2026-11-15), the request that
  waits 1.5 s at these views is NOT a backend request. It is a crop of a static frame: from the CDN the first time, and with
  no network at all when the frame is already decoded (the client keeps 12) or held in the GPU frame store (Move 3 put every
  marine layer there for world steps).
- **What this does NOT establish.** (i) It was not watched on the deployed site. (ii) The live manifest may list GFS wave
  products this check does not know of (a dynamic viewport product of middling width would turn a box back to `/grid`); the
  repo's tile list is not the live manifest. (iii) The rule saying "eligible" is not the frame being there: an hour missing
  from the pinned index, or a session whose manifest has not been read, still goes to `/grid`. (iv) EURO and ICON carry
  estimated regional tails and are refused more often by the same rule; only GFS was checked. (v) Wind was not checked.
  (vi) This harness never exercised the crop path: its frame stand-in holds no wave frames, which is why section 4 saw
  `/grid` every time; so the harness UNDERSTATES how often production avoids the backend, and its 0.3 to 1.3 s "request
  time" is the offline backend's, not the CDN's.
- **What it means for the design, stated before any design is written.** For these views the 1.5 s dwell guards a backend
  that is not being asked. The wait can be skipped exactly when `staticEligible` says the box is a static crop, and kept
  whenever the answer would be `/grid`; then F3 (the backend is asked no more) holds by construction and F1 becomes reachable.
  Two things must be true first and are the next measurements, in this order: the harness must serve wave frames so the crop
  path is exercised offline (it has real GFS frames from 2026-11-15 to build that from), and the gate's request counts must
  then count `/grid` and CDN frame requests SEPARATELY (a CDN frame is not load on the 1-CPU box, but a burst of them is
  still traffic, and F3 as written says `/api/weather/grid` and `/grid_series`).
- A larger question this raises, for the director, not started: at a regional zoom a step draws the THINNED series frame
  (46 x 21) first and upgrades later, while the full 2-degree frame for that hour may already be in the GPU frame store.
  Drawing the crop of the stored frame at once would remove the stand-in altogether, not just shorten its life.

## 6. THE DESIGN (2026-11-17, 23:00 EST), at the owner's word ("Yes, write it"). Written before anything is built or measured.
**One sentence.** When the thinned stand-in lands and the fine grid for the settled view would be answered as a crop of a
static frame, ask for it at once; whenever the answer would be the backend, wait the 1,500 ms as today.

**Where.** One place: the hook `useMarineExactUpgrade` (`marineExactUpgrade.js:270-288`), which today arms
`setTimeout(drive, EXACT_UPGRADE_DELAY_MS)`. Nothing else moves: `drive` still runs the same settle check
(`checkRef.current()`), which still asks through the normal fetch path, so the arbiter, the dedupe ledger and the truth tags
see an ordinary commit, as the module's header requires.

**The decision, a pure function** (new, `marineFastFine.js`, so the 800-line files are not grown):
`fastFineOk({ model, layer, viewportBbox, surf, win })` is true only when ALL of these hold, and false on any doubt:
1. not killed: `window.__RAW_DISABLE_FIRST_VISIT_FAST_FINE__ !== true`;
2. the box the fetch path would send is a static crop BY THE SAME RULE THE FETCH PATH USES: the viewport box through
   `clampViewportBbox(box, layer, model)` (`backendWeatherServiceClientCoverage.js:196`), then
   `staticEligible({ model, layer, bbox, surf })` (`staticFrames.js:490`), the two calls
   `backendWeatherServiceClient.js:453` makes, not a copy of their logic;
3. the set's index is already pinned (`hasPinnedIndex(staticSetKeyForBox(...))`), so the ask cannot fall to `/grid` for
   want of an index;
4. the model is GFS and the surf (rating) mode is off. EURO and ICON, and the rated band, keep today's wait in this first
   version: their crop rules refuse more often and were not checked (section 5).
When it is true the hook arms `drive` after **`FAST_FINE_DELAY_MS = 120`** in place of 1,500 (not 0: the stand-in's own
frame must paint first, and a second keydown within 120 ms, a held arrow key, still supersedes it). The existing hour-held
test in `drive` is kept with the same shorter span: the hour must not have moved for 120 ms. The 4,500 ms fall-back drive
and every bound (`MAX_ATTEMPTS`, `MIN_GAP_MS`, `GLOBAL_GAP_MS`) are unchanged.

**Why this cannot ask the backend more, and where it still could.** If conditions 2 and 3 hold, the fetch the settle check
starts is answered by `tryStaticWorldGrid` from the pinned static frame and `/grid` is not called. It could still reach the
backend when the static path MISSES after having said eligible (the hour's frame absent from the index, a failed download,
a decode error): `tryStaticWorldGrid` then returns null and the same code falls through to `/grid`, 1.4 s earlier than
today. That is the one way this design can add backend load, and so:
5. a static miss on a fast-fine ask is COUNTED (`window.__RAW_FAST_FINE__.misses`) and trips a breaker: after **2** misses
   in a session, fast-fine is off for that session (the 1,500 ms wait returns). A miss costs at most the request today's
   code would have sent anyway, sooner; the breaker stops a burst of them.
Also counted: `armedFast`, `armedSlow` (with the reason: killed, not_static, no_index, model, surf), `fired`.

**What changes on screen.** At a regional zoom where the fine grid is a 2-degree crop: the coarse stand-in is replaced
after about 120 ms plus a frame fetch or a cache read, in place of 1.5 s plus that. In a click burst faster than 120 ms a
step, nothing changes. In a burst slower than that, each step now gets its crop (from the CDN or the client's 12-frame
cache) where today only the last did: more CDN frame requests, no backend requests. Where the fine grid is a real regional
product from the backend: nothing changes.

**The gate.** Section 2's lines stand, none moved. Three things are added before any number exists, because sections 4
and 5 showed the gate as written could not see this design:
- **The harness must exercise the crop path.** The frame stand-in is given real GFS wave frames (the 2026-11-15 12Z set
  already fetched, served as a static base) and the offline backend's manifest lists the regional tiles, so that
  `staticEligible` answers as in section 5. Proven first by a **path check P0**: with the change killed, at the five views,
  the fine grid arrives with `window.__RAW_STATIC_FRAMES__` showing a crop hit and NO `/grid` request; if P0 fails the
  harness is not production-like and nothing below is run.
- **F3 is counted three ways, per scenario:** `/api/weather/grid`, `/api/weather/grid_series`, and static frame downloads.
  The registered line (the two backend endpoints not higher in any repeat) decides. Frame downloads are REPORTED beside it
  with no pass line; a rise is expected in scenario (b) and is stated, not hidden.
- **F7, the miss path (new).** With the frame for the stepped hour removed from the stand-in (a forced static miss), the
  ask falls to `/grid`: the count of `/grid` requests in arm B must not exceed arm A's (it is the same request, sooner), the
  miss is counted, and after two misses the next step waits 1,500 ms again. Unit tests for the breaker.
- F6's unit tests: with the kill set, or any of conditions 2 to 4 false, the timer armed is exactly
  `EXACT_UPGRADE_DELAY_MS`; `fastFineOk` is false on a thrown error, a missing manifest and an unpinned index.
- The positive control of section 2 (a lab switch that removes the wait unconditionally must make F3 fail) is kept: it is
  what shows F3 can see a storm.

**What I am not doing, and why.** Not shortening the wait where the backend answers (the probe showed that trades requests
for speed, and the 1,500 ms was raised from 900 by measurement). Not prefetching the next hour. Not drawing the stored
frame's crop in place of the stand-in (the larger idea of section 5: it would touch the step path itself and is the
director's to assign). Not touching wind: the wind engine has no stand-in and its wait was not probed.

**Order of work.** (1) The harness change and P0. (2) `fastFineOk`, the hook change, the counters and breaker, unit tests.
(3) The gate, both arms, with the controls. (4) A draft PR with every line as it came out. Ships ON with its kill only if
the registered lines pass (D-065); it changes when a request is sent, never what is served, so no `SCOREBOARD.md` row.
The advisor is sent this section before step 2.

## 7. THE PATH CHECK (2026-11-18, 00:03-00:16 EST): the premise is gone. With wave frames on the CDN there is NO stand-in.
At the owner's word ("do the harness change and path check now").
**The harness change.** `wave_frames_fixture.js` (this branch): a local stand-in for the frame CDN holding REAL frames, built
from the GFS `waves` world set fetched from the public CDN on 2026-11-15 (run 12Z, 57 frames, 3-hourly to f168), each frame
at its original path, gzipped, with `latest.json` and the run's index. The probe takes `STATIC_BASE` and now records the
requests that go to it and the client's own static telemetry per step. Until now the stand-in held only pressure frames, so
the client had no wave set to read and asked the backend for everything.
**The run.** The build of section 4 (dev `bd8e4c8cd`, nothing changed in the client), the same five regional views, four
isolated +3 h steps each, a fresh page per view: 20 steps. First on two views (6 steps), then all five; the same both times.
**What happened, in 20 of 20 steps:**
- The engine's grid after the step is the FULL 2-degree world frame, **181 x 82**, of the new hour, **40 to 91 ms** after the
  keydown. The thinned 46 x 21 frame never appears.
- **No `/api/weather/grid` and no `/grid_series` request leaves**, in any step.
- No frame is downloaded during a step either: the frame is already in the client (static hit +1 and cache hit +1 per step,
  0 misses). The frames were fetched ahead by the client's own prefetch while the page settled: the stand-in served 424
  frames, 7 indexes and 7 `latest.json` over the 7 page loads of the two runs, about 60 frames (roughly 3 MB) a page.
- My own P0 line reads "0 of 20" because it was written to look for a CROP hit. There was no crop: the world frame itself is
  drawn. The check as written was looking for the wrong thing; what it shows is better than what it asked for.
**What this means.**
- In section 2 I wrote: "If arm A's median is itself under 600 ms on this build the premise is gone and the line is VOID (then
  there is nothing to fix here and that is the finding)." Arm A here is today's client, and the full-resolution frame is on
  screen in under 100 ms. **F1 is VOID by its own clause. There is nothing to fix for GFS waves where the static set is
  published, and the design of section 6 is not built.**
- The 1.5 s wait of section 4 is real code and was measured correctly, but it only runs when the step was served by the
  BACKEND's thinned series page. With the static set present the series frames are full resolution
  (`staticSeriesFrames`, `staticFrames.js:670`), so the thinned frame, the upgrade and its wait never start.
- **A correction to my own earlier reports.** "On a first pass every step shows the coarse world grid for 1.5 to 4 s" (the
  marine hour-blend log, sections 21-23 and 31, and the finding I passed to the director) was a property of MY HARNESS, whose
  frame stand-in held no wave frames, not of the product as configured in production. The hour blend's first-visit failure
  (H8f) was measured in that same artificial condition. That PR is closed for another reason (the owner's blinded look), so
  nothing ships on it, but the finding should not be repeated as a production defect. Section 5's reasoning ("the request
  that waits is a static crop in production") was a step toward this and is superseded: at these views production does not
  wait at all.
- **Where the thinned stand-in and its 1.5 s wait can still occur in production** (by reading the code, NOT measured): a set
  the CDN does not hold; a static miss (an hour missing from the index, a failed download); the first seconds of a session
  before `latest.json` and the index are read; static frames switched off (the kill, or a build without the bucket URL).
  How often any of these happens to real users is not known and is the only thing left worth measuring here.
- Limits: one model and layer (GFS waves); a 2.5-day-old run, which the client accepted; an offline backend for everything
  that is not a frame; not seen on the deployed site. Wind was not checked (it has its own static set and no stand-in).
**The advisor's read of sections 2, 5 and 6 (received 00:14 EST, recorded as it arrived, before any gate number):** go ahead
with the harness and P0; change the design before building. Its two main findings: (i) "a miss costs at most the request
today's code would have sent" is FALSE for the middle steps of a scrub, so a fast ask must be static-only and never fall to
`/grid`; (ii) once the harness serves the static path the control cannot make F3 fail, so F3 is void unless a view where the
BACKEND answers is added. Also: decide again inside the timer on the box actually sent; check the hour is in the index;
a line of at most one frame download per settled step; a negative path check with a mid-width product; time the call, not a
network request. All of it is right and all of it is now moot for this design, which is not built. Finding (ii) is the same
trap this section fell into from the other side, and it goes into the lessons: a harness that cannot reach the path the
product takes makes both the defect and its fix imaginary.
**Standing.** No code change is proposed. This branch holds the probe, the fixture and this log as the record; no PR is
opened for a fix. The ledger fragment on this branch (the close of #930) still needs to reach dev: a docs-and-lab PR for
that, with the fixture (which other lanes' offline tests need for the same reason), is the one thing I propose.

## 8. The advisor on section 7 (received 2026-11-18 00:53 EST), and what is left. Nothing measured in this section.
- **A caution on wording, taken:** section 7 shows that today's dev client takes the static path IN THIS HARNESS, with real
  frames, at five views. It is still not an observation of the deployed site. That sentence stands beside the retraction:
  the earlier finding was a harness artefact, and the new one is a harness result too, with a harness that now reaches the
  product's path. Neither has been seen in production.
- **Is there telemetry that already says how often users land on the thinned path? No** (the advisor read dev): the client
  keeps per-browser counters only (`window.__RAW_STATIC_FRAMES__`: hits, misses by reason, bytes; `staticFrames.js:84-90`),
  visible in the HUD with `?diag=1`; nothing is sent anywhere and there is no beacon or metrics route.
- **The order it recommends, cheapest and least intrusive first, and I agree:**
  1. THE BACKEND'S OWN REQUEST LOGS. A step served by the thinned path asks the backend for a `/grid_series` page or a `/grid`
     upgrade; a step served by a static frame asks it for nothing. So `/api/weather/grid_series` and `/grid` requests per
     day against map loads (`/capabilities` calls, which every map load makes) bound the share from above; split by model
     and layer from the query string and by hour. A read of logs that already exist: no client change, no new user data, no
     load.
  2. ONE OBSERVED SESSION on the dev site: a fresh browser, `?diag=1`, the five views, the counters read before and after,
     `/api/health` before and after. It says whether the deployed client takes the static path at all, and gives the
     REASONS for any miss (which the server's logs cannot).
  3. A CLIENT BEACON only if 1 and 2 leave it open: new collection from users' browsers, so the owner's word, a volume cap,
     counts by reason only (no coordinates or identifiers), and a kill.
- **To be written down BEFORE the logs are read** (not written yet, because neither step is authorized yet): which request
  patterns count as "the thinned path" and which are ordinary (a session's first series page is expected, not a miss), and
  what share would be worth acting on.
- Neither step 1 nor step 2 is started. Reading production logs and running a scenario on the dev site are actions outside
  this offline lane; they wait for the director's or the owner's word.

## 9. Sizing the thinned path from the backend's request logs: what counts, written BEFORE any log line is read
The owner's word, in this session, 2026-11-18 08:26 EST: "Yes, read the logs". A read of logs that already exist on the
host. No request is sent to the backend, no client change, nothing written anywhere but this file.

- **What is counted** (request logs of the backend service, successful GETs only, the longest window the host keeps up to
  7 days, per day and in total):
  - `L` = requests to `/api/weather/capabilities`. The client asks for it once per page load
    (`LayerAccessResolver.js:35`, a module-level fetch), so `L` stands for page loads of the app, which is MORE than map
    sessions with a marine layer on. That makes every ratio below lean LOW, and it is said beside every number.
  - `S` = requests to `/api/weather/grid_series`.
  - `G` = requests to `/api/weather/grid`.
- **What the counts can and cannot say.** A step served from a static frame asks the backend for nothing. A step on the
  thinned path asks for a series page or a `/grid` upgrade. So `S/L` and `G/L` bound the thinned path FROM ABOVE: other
  things also call these routes (close zooms that are meant to use `/grid`, a model or layer with no static set, any
  script). The logs cannot count steps, cannot say WHY a request was made, and cannot tell a first visit from a repeat.
- **If the log lines carry the query string:** split `S` and `G` by model and layer, and `G` by world or box. If they do
  not, only the totals are reported and that is said.
- **If the log lines carry a host or a referrer:** split production from dev (one box serves both). If not, said.
- **Verdicts, fixed now:**
  - RARE: `S/L < 0.2` AND `G/L < 0.2` over the window (fewer than one backend grid request per five page loads). Then the
    thinned path cannot be common; no fix is worth building; stop here.
  - ROUTINE: `S/L >= 1` OR `G/L >= 1` (at least one per page load). Then the backend is asked for grids as a matter of
    course. That is NOT yet "the slow path is common" (see what the counts cannot say); it sends the question to step 2,
    one observed session on the dev site, for the reasons. Step 2 is not authorized by today's word and would be asked for.
  - Anything between: UNRESOLVED, recorded as that; same next step.
- **Void, recorded as void:** fewer than 30 `L` in the window; the request logs do not carry paths; or the window the host
  keeps is under 24 hours.
- **Not done under this heading:** no request to the live backend or the dev site, no `/api/health` probe (nothing is being
  loaded), no reading of application logs beyond request lines, no user identifiers recorded here (counts only; no IPs, no
  coordinates).

## 10. The request-log count (read 2026-11-18, 08:45 to about 09:25 EST). Verdict by section 9's rule: ROUTINE, on almost no users
Source: the backend service's own access lines in the host's log store (there is no separate request log; the lines carry
the path and query string, a client address, no host and no referrer). Window 2026-11-11 13:30Z to 2026-11-18 13:30Z,
read with a text filter per route, paged 100 at a time. Nothing was sent to the backend. No address is recorded here.
- **Counts.** `L` (`/capabilities`) = 119 (one full page of 100 to 15 Nov 23:56Z, taken as 100 from the page being full,
  plus 19 counted by hand). `S` (`/grid_series`) = 456 (four pages parsed by script, the last 56 by hand). `G` (`/grid`) =
  266 (three pages tallied by hand; every breakdown sums to 266). All 200. The two larger counts were made by helper agents
  and are not re-counted by me.
- **Ratios.** `S/L` = 3.8, `G/L` = 2.2. Both are at or above 1, so by the rule written in section 9: **ROUTINE**. Not void
  (119 page loads, a 7-day window, paths present).
- **What ROUTINE does not mean here, and why the logs cannot size the slow path for real users:**
  - `S` came from 3 client addresses in 7 days; one sent 64% of it. `G` came from 10; one sent 61%, and seven others each
    sent one identical 12-request waves batch on one day each (84 lines: a daily automated job from rotating addresses, not
    identified). Most of 15 Nov's `G` is one address repeating an ICON wind pair about every 10 minutes for three hours.
  - `L` itself includes automated callers: data-centre addresses on a 4-hour beat in the first page.
  - So this is a handful of clients, mostly one, plus automation. There is not enough real-user traffic in a week for a
    share of real users to mean anything, whichever way the ratio fell.
- **What the lines do show about the client's behaviour** (the useful part):
  - Every `S` and `G` line carries a `bbox`. `S`: 410 regional boxes, 46 world; 354 GFS, 90 ICON, 12 EURO; waves 178,
    wind_waves 84, swell_1 83, swell_2 75, wind 36; 216 multi-hour pages and 240 single-hour asks. `G`: 202 regional, 64
    world; ICON 128, GFS 96, EURO 42; waves 150, wind 109, the other three 7.
  - So at regional views the deployed client asks the backend for series pages and single hours as a matter of course, on
    every marine layer, and ICON and EURO lean on `/grid`. Whether those are the views and layers the static sets are meant
    to cover (a miss) or ones they are not meant to cover (ordinary) the logs cannot say: that needs the client's own miss
    reasons.
- **Split by production and dev: not possible** (no host in the lines). Said, as section 9 required.
- **Limits.** Hand tallies for two of the three counts; the host's store is taken as complete for the window with no
  independent check; no line after 17 Nov 21:12Z on either grid route while `/capabilities` lines continue to 18 Nov 06:33Z.
- **Next, by the rule:** step 2, one observed session on the dev site (`?diag=1`, the client's static counters and miss
  reasons before and after, `/api/health` before and after). NOT started: today's word covered the logs only.
- The raw pages the helpers saved hold client addresses; they sit in this session's tool-results folder outside the
  repository and are not copied anywhere.
