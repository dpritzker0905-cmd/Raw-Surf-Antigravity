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

## 20:05Z: amendment before any ON number (found while building, not from a measurement)

`fetchMarineData` (the cache-only path the prefetch uses) also starts sibling-layer series warms and a world warm after every
network `/grid`. A prefetch therefore passes `noSideWarm` (its own `/grid` only). F2 is widened to count EVERY
`/api/weather/*` request and its bytes (`/grid` and `/grid_series` separately), not `/grid` alone; the bounds are unchanged
(drag ON <= KILL; slow and back ON <= KILL + 1 `/grid`, and `/grid_series` ON <= KILL).

## 20:15Z: the A/B driver, how each gate is computed (before any run)

`scn_first_visit_fine_ab.js` (one build; desktop and phone; slow, drag, back; 3 sessions per arm, alternating):
- F1 over the slow scenario's steps 2-6: time-to-fine p50 ON <= 0.5x KILL and p95 ON <= KILL; and ON has no more steps where no fine
  grid was drawn within the dwell than KILL (a never-shown fine grid is a miss, not a fast step).
- F2 per scenario, summed over the sessions: `/grid` ON <= KILL (drag) or <= KILL + 3 (slow, back: one unused prefetch per session),
  and `/grid_series` ON <= KILL. Bytes reported.
- F3 step time: the keydown to the first change of what the engine draws (this probe's own clock; the census probe is not run in this
  A/B), p50 / p95 not worse than KILL by more than 5 / 15 ms; 0 stale fine frames (a fine grid of another hour drawn after the
  target hour was drawn) and 0 blank frames in ON.

## 20:22Z: amendments from the advisor's review (before any run; P and R built, no gate number yet)

1. **Arms, so P and R are scored separately:** `none` (both kills), `R` (`__RAW_DISABLE_FINE_PREFETCH_NEXT__` only), `PR` (neither).
   R is scored R vs none; P is scored PR vs R. Each default rests on its own result.
2. **R's own load line** (it adds requests by design where KILL never upgrades): at most one fine `/grid` per hour settled
   >= 1.5 s, none during a drag, and `/grid_series` R <= none. F1 for R: the share of slow-scenario steps 2-6 with a fine grid
   drawn within the dwell, R > none, and time-to-fine reported.
3. **P's view:** P is scored on top of R (PR vs R), so on the z8 view its "KILL upgrades" baseline is the R arm. F1 for P: slow
   steps 2-6 time-to-fine p50 PR <= 0.5x R, p95 PR <= R. F2 for P: `/grid` PR <= R + 1 per session (slow, back), <= R (drag).
4. **New scenario BROWSE** (the biggest load risk): 6 pans and 2 zooms, no hour change, 3 s apart. Line: every weather request
   count PR = R = none (P is armed only after the session's first hour step; built that way before any run).
5. **Pace:** the slow scenario is also run with a 1 s dwell and reported: there P must show no gain AND no extra request
   (PR = R `/grid`).
6. **Cache:** prefetched grids go into the existing per-hour marine cache (`marineControllerCache`: capacity-bounded LRU with
   eviction tombstones, cleared on the hourly roll); no new cache, no new size.
7. **Is the regional series frame production's shape?** From code: `grid_series_helper._series_build_stride` strides every series
   frame by `stride_for(cols, rows, hours)` (the series vector budget), so a production regional series page is coarser than the
   `/grid` frame at the same view by design; the mock's 5x3 has the same cause. Production frames carry the stride
   (`__decimatedStride`), so R now counts a strided regional series frame too (it only excludes WORLD frames, which the existing
   upgrade owns); R still asks only when the series cells are > 1.5x the last fine grid's.

## 21:42Z: Brief 4 (#929, approved 16:14 EST): z7 misses + the coarse-to-fine wait; added to the 19:45Z gate, before any run

On top of F1-F4 (unchanged), the change also has to pass:
- **Census slow steps -50%:** in the slow scenario at z7 (the brief's zoom; same place), steps whose time-to-fine exceeds 1,500 ms,
  PR arm <= 0.5x the none arm.
- **Never-shown <= 10% of before:** steps where no fine grid is drawn within the dwell, PR <= 0.1x none.
- **A/A:** two none-arm runs agree within 10% on the slow-step count, else INCOMPLETE.
- **A planted miss registers:** one extra session in the PR arm with the slow scenario's 4th hour removed from the mock's store
  (the backend answers 404 for it); the probe must count that step as never-shown. If it does not, the instrument is broken and
  the run is void.
- The load-void rule (census log 20:20Z) applies.

## 2026-11-16 05:45Z: the A/B (none / R / PR), as registered: P passes F1 and FAILS F2 and F3; R fails F1, F2, F3

Raw `scratchpad/m3/fineq/` (90 sessions + summary). No void rule was registered for this gate; the machine was 55-96% busy.
Mock `/grid` latency p50 735-1101 ms, p95 5.7-12.2 s (the mock's, single process, under load; not production).

| view | arm | time-to-fine p50 / p95 (slow steps 2-6) | fine shown | `/grid` slow / back / drag / slow1 / browse |
|---|---|---|---|---|
| desktop | none | 1014 / 1014 | 2 / 15 | 9 / 11 / 3 / 3 / 42 |
| desktop | R | 1381 / 1381 | 2 / 15 | 9 / 9 / 3 / 4 / 42 |
| desktop | PR | 41 / 1265 | 13 / 15 | 37 / 51 / 6 / 9 / 41 |
| phone | none | 2229 / 2860 | 8 / 15 | 18 / 7 / 3 / 2 / 41 |
| phone | R | 1687 / 1687 | 1 / 15 | 10 / 10 / 8 / 3 / 43 |
| phone | PR | 295 / 432 | 13 / 15 | 22 / 29 / 9 / 4 / 40 |

- **P (PR vs R): F1 PASS** (fine shown 13/15 vs 2/15 desktop and 1/15 phone; p50 41 vs 1381 and 295 vs 1687 ms). **F2 FAIL:** `/grid`
  far above R + 1 per session (desktop slow 37 vs 9, back 51 vs 9; drag 6 vs 3; slow1 9 vs 4). **F3 FAIL:** first-draw p95 305 vs 98 ms
  desktop; blank 24 in EVERY arm (equal across arms; an instrument artifact to check, but the gate counts it).
- **R (R vs none): F1 FAIL** (fine shown not higher: 2 vs 2 desktop, 1 vs 8 phone), F2 FAIL (phone drag 8 vs 3), F3 FAIL (blank 24).
  The regional upgrade did not deliver the fine grid in this lab.
- Reading, not a re-judgement: the KILL baseline here almost never fetches a fine grid after step 1 (the regional gap), so every fine
  grid PR delivers is an added request; the registered F2 bound assumed a baseline that fetches one per settled hour. As written,
  P costs about 3-5x the `/grid` requests of R in step scenarios: on the 1-CPU box that is the load the director ruled out.
  **Neither P nor R ships ON.** Both stay behind their kills; the PR is not opened until the director decides.

## 2026-11-16 05:52Z: the director's ruling; a fresh gate for a ZERO-box-load prefetch (pre-registered, before any code)

P via `/grid` is NOT shipped. New change under test (**C**): when the user has dwelt >= 1.5 s after a step, prefetch the NEXT hour's
fine data from the static CDN regional frame bundles the client already reads (pilot-box bundles), never `/grid`; where no bundle
covers the view, today's behaviour. Kill `__RAW_DISABLE_FINE_PREFETCH_CDN__`. R is not part of C.
**Gate (all as written; desktop and phone; offline lab with the mock CDN; the census void rule applies):**
- **C1:** fine shown on slow first-visit steps 2-6 >= 13 of 15 (the P arm's count), in a view a bundle covers.
- **C2:** `/grid` and `/grid_series` count per scenario (slow, slow1, back, drag, browse) <= the baseline (C killed).
- **C3:** first-draw p95 <= baseline p95; 0 stale fine frames; blank frames <= baseline (after the blank-frame check below).
- **C4:** Jest: C never calls `/grid`; fires once per dwell; armed only after a step; the kill's off path; mutants fail.
- **Blank-frame check first:** the 24 blank frames in every arm of the 05:45Z run are investigated before C runs; either shown to be
  an instrument artifact (with the probe corrected and re-checked on the unchanged build) or fixed.

## 2026-11-16 06:00Z: the 24 blank frames are an instrument artifact (proved); probe corrected and re-checked

All 24 blank frames per arm sit in the BROWSE scenario (desktop 9 x 8 steps, phone 8 x 8, across 3 sessions), at 342-582 ms from
page start. The browse scenario presses no key, so the probe never reset its event list or its key time: the single "none" draw
recorded while the page booted (before the layer was switched on) was counted again in every one of the 8 browse steps, with
"time" measured from page start. No scenario that presses a key had any. Fix: a browse action now resets the list and stamps its own
time, as a key does. Re-check on the unchanged fine build (browse, one session per arm, ON and both kills): 0 blank draws in 8
steps in each. The 05:45Z F3 verdicts stand as recorded (scored as written); the artifact only means "blank" was not a real failure.

## 2026-11-16 06:20Z: measured first: inside a pilot box the first visit is ALREADY exact; C is DROPPED as redundant

Lab: `serve_synthetic.py --models GFS --layers waves --regions florida_east_coast --land-mask 1 --dynamic 1` (port 4299, store6),
published with `publish_frame_images.py --only frames` (the Florida bundle: 38 KB in this lab; 324 KB live), today's `dev` build,
`scn_zoom_scrub.js` desktop, z8 at (-80.6, 28.1) inside florida_east_coast, 10 one-hour steps to hours not yet visited
(`scratchpad/m3/boxfine-desktop.json`):
- **cur (bundles on, today):** ms to the exact frame on the GPU per step: 0, 10, 0, 0, 0, 5, 17, 8, 0, 6. Every first visit exact, <= 17 ms.
- **noregional (bundles off):** 0 (the opening hour), then 9 of 10 steps never exact inside the window (one at 37 ms).
- Phone not measured: the scenario's phone run failed to find the Waves chip in the mobile layout (a harness gap, not a result).

So a next-hour CDN prefetch has nothing to add inside the boxes: the bundle already holds the whole run and each hour is a slice
decode. **C is dropped; no code written.** The coarse-then-fine wait lives outside the boxes and on partial covers; sizing of the
zero-box-load routes for those is sent to the director and the frame-carry lane (publisher budget).

## 2026-11-16 06:40Z: limits of the 06:20Z result (the advisor's red-team), written beside it before it is quoted

"First visits are already exact inside pilot areas" holds ONLY for what was measured:
1. **Scope:** one view (florida_east_coast, z8, (-80.6, 28.1)), one layer (waves), one model (**GFS**), desktop, one session per arm,
   offline lab. The 10 steps are the scenario's fixed list: hours 1, 2, 3, 4, 28, 52, a burst to 172, 148, 147, then Home (0): 9
   first visits plus the return to 0, not ten one-hour steps (06:20Z said "one-hour steps"; corrected here). NOT measured: another
   pilot area, EURO or ICON, a view straddling a pilot edge (partial covers still go to `/grid`, by the contract).
2. **The bundles-off arm** runs against the mock backend; "9 of 10 never exact in the window" shows the bundle is what delivers the
   frame, and says nothing about the size of the LIVE wait.
3. **Phone:** still unmeasured. The scenario now falls back to the app's own layer toggle when the mobile layout hides the Waves chip
   (committed), but on the phone profile at this view the engine received no wave grid within 60 s in the first try; unexplained, not
   a result.
4. **Freshness:** in the lab the bundle is always the current run. Live, a regional set skipped for budget keeps its old bundle, so
   "exact" means exact to the bundle, possibly a cycle behind the glyphs; a live claim needs the bundle's run recorded per step.
5. **Options A and B are estimates.** For B: if the 0.5-deg layer REPLACES the fine grid outside the pilot areas at close zoom, the
   map's values change (coarser than the 0.25 `/grid` serves there today) and that needs David's word and a parity line; if the client
   still fetches `/grid` afterwards, B removes the wait but none of the box load. Storage and egress per run x layers x three models are
   owed before the director decides.
Owed before the claim is general: a second pilot area, ICON (and EURO where bundled), an edge view, and phone at 4x.

## 2026-11-16 06:50Z: the frame-carry lane's budget figures for options A and B (theirs, quoted; sent to the director)

- GFS-Wave global 0.25 is already fetched (one pass over 129 hours, about 19 min), so a 0.5-deg tier is a stride-2 sample of it:
  no new download.
- 0.5-deg frame about 0.88 MB (scaled from today's 55 KB 2-deg frame); about 113 MB per run per layer (129 frames).
- Egress is the catch: whole-globe frames cost about 113 MB per full single-layer scrub, so B needs 30-deg tiles (about 3-6 MB per view).
- Today's encoder at 0.5 deg is about 33 min per run for 4 layers: B needs a vectorized encoder.
- A (more pilot boxes) adds about 40 min to GFS Marine Pilot alone: it does not fit the budget.
So B is viable only as 30-deg tiles with a vectorized encoder; A is out on budget. The director decides; the advisor's open questions
(replace vs fetch-after; David's word and a parity line; storage and egress x 3 models) still apply.
