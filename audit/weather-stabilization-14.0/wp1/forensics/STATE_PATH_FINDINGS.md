# WP-1 independent source and executable-state check

This records the bounded diagnostic before application-source modification; see [REPORT.md](REPORT.md)
for the subsequent repair and superseding render-evidence conclusion. Root reproduced wheel18,
mouse pan/zoom, Jump-to-now0, then timeline metadata18 and renderedHour18 after25seconds. Browser
evidence belongs to the owning task; this document distinguishes what the source and isolated
execution actually establish.

## The reset already reaches the single owner

- `useWeatherState.js:43-44` owns `timeOffsetHours` once via React state.
- `MapWeatherControls.js:571-573` computes0, calls `setSliderVal(0)` **and** `onTimeChange(0)`.
  The audit's claim that reset changes only the visual control is not supported by this code.
- `useMarineOrchestratorScrubCache.js:32-33` updates both previous/current time refs before lookup.
- `WebGLMarineLayer.js:168-190` independently reports requested vs rendered hour. Root's observed
  `hour:0, renderedHour:18` therefore already demonstrates that committed0 reached the renderer.

Do not introduce another clock owner to repair a downstream fetch/diagnostic mismatch.

## Timeline diagnostics are not committed-render identity

`backendWeatherServiceClientDiag.updateProjectionDiag` rewrites
`__FORECAST_TIMELINE_COVERAGE_DIAG__` at lines256-283. Missing fields inherit the previous record;
`coverage_status` depends on geographic coverage rather than requested/rendered time agreement.

Cache hits also write this record through `marineControllerCache._updateDiagnosticsOnCacheHit`.
`getModelSafeMarine` calls that writer using `returnedHour` (marineController.js:457). Thus it would
be incorrect to describe the timeline record as network-only. A cache miss does not write it.

The scrub hook commits a series frame directly at line190 then returns at213 without invoking that
writer. A healthy series transition tohour0 can therefore leave diagnostic hour18/full_coverage.
The WebGL layer reports retained-hour status separately; these are not one invariant today.

## Executed probe

Run from the repository root:

```text
node audit/weather-stabilization-14.0/wp1/forensics/scrub_cache_probe.cjs
```

The default baseline mode transpiles the actual hook from revision `91b90ae9` plus the unchanged
actual `marineWarmCommitCovers` implementation; `current` executes the candidate hook and helper.
React's effect and external cache/network dependencies are controlled; no browser, network, or
renderer performance result is implied. All assertions pass:

| Scenario | Owner ref | Commit | Fetch enqueue | Timeline diagnostic |
|---|---:|---|---|---|
| Cache miss, not scrubbing |0|none|timeline_scrub_deferred|18/full_coverage retained|
| Cache miss, scrubbing remains true |0|none|none|18/full_coverage retained|
| Exact series frame available |0|hour0|none|18/full_coverage retained|

Receipt: [scrub-cache-probe.json](scrub-cache-probe.json).
The first harness version mocked null coverage incorrectly as false and triggered a null dereference
in rejection telemetry. The real helper fails open on null, so that was a harness defect. The final
probe executes the real helper; no production null defect is claimed.

## Fetch discriminator and existing-test gap

On a backend cache miss the hook calls `enqueueMarineUpdate('timeline_scrub_deferred')` only when
`window.isScrubbingTimeline` is false. The dispatcher schedules `updateMarineGrid('timeline_scrub')`
after150ms (useMarineDataFetcherCore.js:820-825). That source bypasses ordinary dedupe, failure-count,
rate-limit and movement guards. `getViewportHash` includes current hour; stale viewport-only identity
is therefore not established as the cause.

The existing debounceHeal suite checks a pure predicate. It does not drive reset through cache,
dispatch, and commit. It cannot establish recovery of this observed failure.

To distinguish hypotheses on the actual stuck page, collect:
`__MARINE_PIPELINE_TRUTH__`, `__MARINE_FETCH_DIAG__`, `__MARINE_SCRUB_DIAG__`,
`__MARINE_RENDER_HOUR_PARITY__`, `__MARINE_FETCH_PENDING__`, `__MARINE_FETCH_DEBOUNCING__`,
`isScrubbingTimeline`, `__BACKEND_WEATHER_SERVICE_DIAG__`, and the hour0 network request/status.
No actual stuck-scrub or failed-fetch cause is claimed without those observations.

Later browser/source evidence refuted actual renderer retention: the parity effect runs before
the upload effect in the same React commit and reads a ref that changes without another render.
The legacy parity global can therefore report the previous hour while the accepted engine grid
is current. The repair prefers that accepted grid's actual valid time and does not change rendering.

The smallest supported diagnostic repair is to stamp requested identity when the owner changes,
and committed/retained identity at the actual commit/render boundary, then expose a time-mismatch
status instead of retaining a green geographic-coverage verdict. The root task should coordinate
that with its observed recovery defect before selecting a source patch.
