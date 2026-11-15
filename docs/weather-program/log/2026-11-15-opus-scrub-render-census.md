# 2026-11-15: phone scrub-step React re-render census, and taking non-critical re-renders off the step (Opus, Move 3 batch item b)

## 18:10Z: the census (measured before any fix)

Instrument: `frontend/scripts/offline-backend/scn_render_census.js` on a profiling build (`RAW_PROFILE_BUILD=1`, see the craco
note below), offline lab only (synthetic backend on 4298, the host audit "ok"). Phone view, 4x CPU throttle, z6, Waves, GFS,
10 ArrowRight steps on the timeline wheel. A fake `__REACT_DEVTOOLS_GLOBAL_HOOK__` counts a fiber as rendered in a commit only
when it is a NEW fiber object in that commit's tree (not in the previous commit's current tree) AND carries `PerformedWork`.
The first census counted stale `PerformedWork` flags in skipped subtrees and over-counted; it was withdrawn and corrected
to the director the same hour.

**Per scrub step (median over the 10 steps):** about 10 React commits, 67 components rendered, about 152 ms of own render
time on the throttled phone.

| component | renders / step | as commit root | own ms / step |
|---|---|---|---|
| `MapWebGL` | 5 | 3 | 34.8 |
| `MapForecastOverlay` | 3 | 2 | 20.9 |
| `MapWeatherControls` | 3 | - | - |
| `ForecastTimeStatus` | 5 | - | - |
| MapLibre `Source` / `Layer` wrappers | 36 + 36 | - | - |
| closed `Dialog`s | 11 | - | - |

The hour state lives in `MapPage` (`useWeatherState`), so every hour change re-renders `MapPageContent` and everything under
it that is not memoised; `MapWebGL` and `MapForecastOverlay` then commit again on their own state several times per step.

**Profiling build note.** CRA's `--profile` aliases `react-dom$` to `react-dom/profiling`; with React 19 that alias is circular
(the profiling bundle itself requires `react-dom`) and the app crashed at boot ("reading 'd'"). `craco.config.js` now, only
under `RAW_PROFILE_BUILD=1`, removes the `react-dom$` alias and maps `react-dom/client$` to `react-dom/profiling`. Production
builds are unchanged (the env var is unset on Netlify and in CI).

## 18:12Z: pre-registration of the fix gate (before any fix code)

**Change under test:** (1) collapse the per-step commits (batch the state updates one hour change causes into one or two
commits), and (2) memoise hour-independent children so an hour change does not re-render them. Ships ON with a
`window.__RAW_DISABLE_<NAME>__` kill switch per lever, registered in `killSwitch.inventory.test.js`, with off-path tests.

**Arms:** the fix build with the kills unset (ON) vs the SAME build with every new kill set (KILL = today's behaviour). Alternate
arms, 3 sessions per arm, 10 steps per session, fresh browser each session. Offline lab only.

**Gates (all must pass to ship ON):**
1. **Render cost.** React own-render ms per step (this census), median over all steps, ON <= 0.5x KILL.
2. **Input responsiveness.** The keydown's Event Timing duration (input to next paint), p95 over all steps, ON <= 0.75x KILL,
   and ON p50 not worse than KILL by more than 5 ms.
3. **No harm to the picture.** Key-to-exact-shown (the engine shows the target hour of the target model) p50 / p95 not worse
   than KILL by more than 5 ms / 15 ms; 0 blank frames and 0 mislabel frames in either arm; the hour labels (the
   `ForecastTimeStatus` text and the wheel's `aria-valuetext`) reach the target hour on every step in both arms.
4. **Unit.** Jest pins each memo boundary (an hour change does not re-render the memoised child; a prop it does read still
   does) and each kill's off path; the mutants that drop a boundary or ignore a kill fail.

**Secondary (recorded, not gating):** commits per step; components per step; the same census and the handover / same-frame
record on Pressure and Satellite (the director's ask).

**Not allowed:** changing a gate, an arm, the view or the step count after the first ON number exists without an amendment
here that says why, before the re-run; every run is logged, failures included.

## 18:20Z: why one step makes about 10 commits (trace, before any fix)

The census now records, for every component that re-renders on its own (a "root"), which state hooks hold a new value vs the
previous commit (by hook index) and whether the new value is shallow-equal to the old one (`[SAME]`). Same lab, same view.

- **`MapWebGL`, a wasted commit on every step (10 of 10):** `useOpenMeteoTileUrls`'s `setOmTileUrls(prev => ({...filtered,
  ...newUrls}))` always returns a NEW object, and on a Waves view its content is shallow-equal to the old one every time. React
  cannot bail out, so `MapWebGL` re-renders and its 36 raster `Source` + 36 `Layer` wrappers re-render with it. Fix lever 1:
  return `prev` when the merged map is shallow-equal (React's own bail-out; no behaviour change).
- **`MapWebGL`, also:** `debouncedTimeOffsetHours` (the debounced hour, intended) and store/context subscriptions (15 per 10 steps).
- **`MapForecastOverlay`, 2 commits per step:** `setIsScrubbing(true)` in a passive effect right after the hour change, then 200 ms
  later `setIsScrubbing(false)` + `setSettledOffset`. Lever 2 candidate: derive `isScrubbing` as `timeOffsetHours !==
  settledOffset` (one commit fewer per step); one semantic difference, a return to the settled hour within 200 ms reads not-scrubbing
  at once, to be pinned by a test.
- **`MapPageContent`:** a GeoJSON state (`{type, features, hourOffset, stale}`) and a counter, a few steps out of 10.
- Radix `Presence` / `DialogContent` (11 closed dialogs) and `MapMarkerLayers` re-render through context; lever 3 (memoise
  hour-independent children) to be sized after levers 1 and 2.

## 18:25Z: amendment, before any ON number exists (instrument definitions, and what dev runs are)

- **Development runs are diagnostic.** A single-session census of a fix build while building it is NOT a gate run and cannot pass
  or fail anything; each one is logged here anyway. The gate is judged only on the registered A/B: 3 sessions per arm,
  alternating ON / KILL, from ONE build.
- **The A/B probe** is `scn_render_census.js` with `ARMS` (the KILL arm sets every new kill before boot) and these in-page
  instruments, all in the page's clock, per step:
  - *render ms, commits:* as in the census;
  - *input responsiveness:* the keydown's Event Timing entry (`PerformanceObserver`, type `event`, `durationThreshold` 16), its
    `duration` (input to next paint, 8 ms granularity);
  - *key-to-shown:* from the keydown's `startTime` to the first animation frame where the marine engine's drawn grid has
    `hourOffset` equal to the step's target hour (the wheel's hour after the press);
  - *blank:* an animation frame while the layer is on where the engine holds no grid;
  - *mislabel:* at the end of the dwell, the engine's drawn hour differs from the wheel's `aria-valuenow`;
  - *labels reach the target:* at the end of the dwell, the wheel's `aria-valuenow` equals the target hour and the
    `ForecastTimeStatus` text differs from the previous step's.
- This narrows gate 3's "exact-shown" (the instant-contract's product check) to the drawn hour, because this change touches no
  data path; the full exact-product check stays with `scn_instant_contract.js`.

## 18:45Z: dev run 1 (diagnostic, ON build, one session), and a second amendment before the A/B

Dev run 1 (fix build, kills unset, one phone session): 71.1 ms own render per step (the census before the fix read 152-165 ms
on the old build), commits per step still about 10, keydown input-to-paint 40-216 ms. This is NOT a gate number.

It showed two of the 18:25Z definitions are wrong for this lab:
- **mislabel:** the lab's store holds 3-hourly frames, so on most steps the engine draws the nearest stored hour while the wheel
  is on the in-between hour, and the status line says so ("Showing Sun 4 PM: the nearest stored forecast", "Loading Sun 6 PM...
  still showing Sun 4 PM"). That is the honest, intended display; "drawn hour != wheel hour" flagged it as a mislabel on 8 of 10
  steps.
- **key-to-shown:** "the engine draws the wheel's hour" happened on only 1 of 10 steps, for the same reason.

Amended, before any A/B run:
- *key-to-shown:* on steps where the drawn hour changes during the dwell, keydown to the first frame drawing the dwell's final
  drawn hour. Steps where the drawn hour does not change are counted ("held") per arm and reported.
- *mislabel:* the drawn hour at the end of the dwell differs from the wheel's hour AND the status line carries no disclosure
  ("nearest stored" or "still showing").
- *labels reach the target:* the wheel's `aria-valuenow` advanced by one hour and its `aria-valuetext` changed on every step.
- Gate thresholds, arms, view and step count are unchanged.

## 18:47Z: the registered A/B, run 1 (levers 1 + 2 only): FAILS gates 1 and 3, passes gate 2

One profiling build, phone 4x, z6, Waves, GFS, 3 sessions per arm alternating ON / KILL, 10 steps each (30 steps per arm).
Raw files: `scratchpad/m3/ab1/` (one JSON per session + `ab-summary.json`).

| | ON | KILL | gate |
|---|---|---|---|
| own render ms / step, p50 | 98.0 | 140.7 | 1: ON <= 0.5x KILL. **0.70x, FAIL** |
| sessions | 98.0, 111.9, 97.8 | 176.6, 138.9, 161.2 | |
| keydown input-to-paint p95 / p50 | 256 / 176 ms | 648 / 216 ms | 2: p95 <= 0.75x, p50 not worse. **0.40x, PASS** |
| key-to-shown p50 / p95 (steps where the drawn hour changed) | 411 / 1077 ms (n 9) | 837 / 1030 ms (n 7) | 3: p95 +47 ms > +15. **FAIL** |
| held steps (drawn hour unchanged) | 21 | 23 | |
| blank frames | 0 | 0 | |
| mislabel (drawn != wheel hour, no disclosure at dwell end) | 3 | 2 | 3: 0 in both arms. **FAIL (both arms)** |
| labels reached the target | 30 / 30 | 30 / 30 | |
| commits / step, p50 | 9 | 8 | secondary |

Reading, not a re-judgement:
- Gate 1: the two levers cut own render time by about 30%, not 50%. Lever 3 (memoising hour-independent children) is not built.
- Gate 3: the key-to-shown p95 rests on 9 vs 7 steps; one ON step at 1077 ms vs KILL's worst at 1030 ms decides it.
- Gate 3's mislabels occur in BOTH arms (KILL 2, ON 3), always the same pattern: the engine still draws the previous hour at the
  end of the 900 ms dwell and the status line has not yet said "still showing". Pre-existing in today's code, not caused by
  the change; the gate as registered still fails on it.
- Gate 2 passes clearly: the slow end of keypress-to-paint drops from 648 ms to 256 ms.

Per the registration this does NOT ship ON as is. Next decisions go to the director: build lever 3 and re-run the same gate,
and whether the pre-existing status lag behind gate 3's mislabels is its own fix.

## 19:05Z: new item (the director, from the advisor + animation lane): first-visit coarse-then-fine delay at coastal zooms

**Why the fine request waits (code):** `marineExactUpgrade.js` `useMarineExactUpgrade`. When the resident grid is a thinned WORLD
frame (`__decimatedStride > 1`, span >= 340 deg), it re-runs the scrub-settle check (which sends the `/grid` request for the fine
grid) only after the hour has been stable for `EXACT_UPGRADE_DELAY_MS = 1500` ms, with a retry at `EXACT_UPGRADE_RETRY_MS = 4500` ms;
every hour change re-arms the 1500 ms wait. That is the reported 1.5 s first request and 1.5-4 s of coarse picture. Repeat visits
are instant because the fine grid is then in the client cache. The wait exists to keep a scrub from sending one `/grid` per hour
it passes through (the 1-CPU backend).

**Offline lab (`scn_first_visit_fine.js`, desktop, z8 at (-80.05, 28.45), GFS Waves, 8 steps, 6 s dwell):** the lab does NOT
reproduce the world-frame case. Its series page at z8 is a regional 5x3 frame (not thinned, not world), so the upgrade never arms,
and on steps 2-8 no fine `/grid` was requested at all within 6 s; the coarse series frame stayed. Step 1 (no series yet) fetched
`/grid` at once and drew it at 2.3 s (the synthetic server's own latency). So the lab shows a second, related gap: a regional
coarse series frame is never upgraded to the fine grid on a first visit.

**Not yet pre-registered:** the time-to-fine gate waits on the director's load decision (any earlier request is one more
`/grid` per hour the user dwells on between the new and the old wait).

## 19:10Z: the director's decisions after run 1 (recorded before any further build or run)

- Run 1 stays on record as FAIL (gates 1 and 3).
- Build lever 3 (memoise hour-independent children), then re-run the SAME gate, unchanged, as an unseen run 2.
- The status lag behind gate 3's mislabel count is its own fix with its own gate. By the director's word, gate 3 for the RENDER
  fix is scored WITHOUT the mislabel count (it is a property of today's code, present in the KILL arm). The mislabel count is still
  measured and reported in run 2. Every other part of gate 3 (key-to-shown p50/p95, blank frames, labels reach the target) stands.
- The 1.5 s first-visit coarse-to-fine wait stays queued in this lane.

## 19:25Z: lever 3 built; dev run 3 (diagnostic); run 2 started

Lever 3: `MapPageModals` is wrapped in `React.memo` with `modalsStayClosed`: no re-render while every modal flag is false before
AND after; opening or closing any modal renders with fresh props. Kill `__RAW_DISABLE_CLOSED_MODALS_SKIP__`. Jest: 14 pass.

Dev run 3 (one ON session, diagnostic): 53 components per step (67 before; the closed modals are gone), but every component's
own time roughly doubled vs dev run 2 (e.g. `MapWeatherControls` 28 ms vs 9 ms), 140.6 ms total. Read as machine load during
the run (other sessions share this machine), not the build; the alternating ON / KILL design of the gate is what absorbs it.

Run 2 (unseen, the same gate, KILL arm = all three kills) started 19:26Z.
