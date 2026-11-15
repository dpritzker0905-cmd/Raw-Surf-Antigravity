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
