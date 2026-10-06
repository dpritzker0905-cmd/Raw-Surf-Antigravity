# Dev renderer smoke: fallback remains open

2026-10-06. PR243 is deployed to dev and the shared API as073de1e2.
Production frontend remains frozen atfc140024. This is a bounded paused-frame
observation, not playback, scrubbing, physical Gulf forecast or device acceptance.

## Observations

Fresh authenticated Chrome dev map controls mounted. Waves was enabled once
with GFS selected at hour0; Play was never started, and no point was selected.

| UTC | Captured evidence |
|---|---|
| 17:37:52 | Global181x82/span360 frame: requested18:00Z; served time null; model run missing; provider open-meteo; stored product gfs_marine_waves_global_mid_20261006T180000Z.json |
| 17:38:05 | Guard reports1FPS for12 consecutive windows and triggers marine fallback |
| 17:39:00 | WeatherTruth absence warning: series_GFS_waves_h0 chain silent39s after seriesFrameMint |
| 17:39:06 | Recovery attempt1/2 after backoff |
| 17:39:07 | Regional21x21/span5 frame: same requested clock; served time null; run missing; provider open-meteo; stored product gfs_marine_waves_florida_east_coast_20261006T180000Z.json |
| 17:39:30 | Guard trips again at1FPS after recovery |
| 17:44:58 | Browser entry URL main.7f5c89e4.js matches fresh cache-bypassed dev HTML, HTTP200 |

Waves was then switched off and inactive controls were read back earlier in
this session. A later attempt to reread the Waves attribute timed out in the
browser; that failed command provides no further acceptance. The test tab stays
available. No configuration, diagnostic override or guard threshold was changed.

The bounded console slice contains no captured shader throw/context-loss error;
absence in that slice does not prove absence across the session. PostHog's
console wrapper appears in the source URL; it does not establish the cause.
Entry-URL agreement is not a byte-level asset comparison. A later visible-tab
readback does not prove visibility/focus during either trip.

## Diagnosis boundaries and next checks

The guard already excludes hidden/unfocused windows, long scheduling gaps,
mount grace, transitions, scrubbing, movement and absent native residents. Its
fresh-call signal uses marineLayerStamp on each actual custom-layer render;
it is not a one-second-throttled diagnostic counter. The custom layer already
requests repaint in finally. Those inspected mechanisms do not explain this trip.

The marine render path performs synchronous GL state reads and a framebuffer
completeness check per particle pass. These are profiling candidates, not a
proven explanation for1FPS. Preserve context-state isolation and frame identity
while measuring native call cadence, render duration, texture/mask rebuilds,
frame-loading state and GPU completion separately. Do not remove the guard or
inflate wave heights to hide the symptom. Chrome's internal GPU page was blocked
by browser URL policy; hardware cause remains unverified.

Also reconcile requested, served and drawn clocks with actual payloads before
grading Gulf heights. These hour0 products do not reproduce the owner's
October5/hour98 Gulf storm. Null served/run metadata does not prove wrong
scientific values, but cannot certify exact-frame truth.

Primary reference: [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
describes synchronous GL queries that can stall the main thread. The reference
supports measuring these calls; it does not attribute this application's trip.

The manifest-scan backend repair in PR246 is separate and default-off. No
renderer source fix or native smoothness acceptance is claimed by that PR.

## 2026-10-06 21:21Z — subsequent clean observation and source boundaries

The preceding no-renderer-fix statement describes the earlier manifest-only
stage. Projection repair751/757 is now separately qualified. New759 diagnostics
contain a reproduced faulted-telemetry boundary and add a bounded native trip
receipt; final local370/4045/build/lint/LOC pass, own760 hosted pending.
The new clean paused GFS observation (no concurrent local test/build workload)
did not trip: one7FPS warning, later20/27FPS, uploads19 and slow CPU-call count1
stable, complete framebuffer/289cells. Waves off readback and research tab closed.
This does not grade full-app smoothness, Gulf/hour98, playback or GPU completion.
FALLBACK-EVIDENCE-RESULTS.md records the observation and exact limitations.
No dev merge/production promotion or served-number/flag activation.

## 2026-10-06 22:13Z — served rollout768 and clean native receipt769

PR246 dev72e6e5ad frontend/shared API served at22:07:46Z; production frontendfc140024 remains frozen. Clean single Chrome tab, no concurrent local build/test, GFS Waves paused0: native fallback reproduced22:08:39.622Z; new receipt12windows/15.724s continuous, FPS1..5, callbacks27/uploads6/slowCPU3/hist17,7,1,2,0. Histogram excludes scheduling/full-map passes and is not GPU completion. Play selected6 then pause12, keyboard13 stable; simplified notice/time-unverified and recovery1/2 at22:09:43.600Z observed. Served/run metadata null; no exact-frame/physical Gulf/device acceptance. Waves off read back and tab closed.769 fulfills766 observation, not broader science/latency/cloud gates. Source inspection confirms existing finally repaint and MapLibre render event after painter; callback-gap cause remains open. No new source/math/flag change. DEV-FALLBACK-ROLLOUT-RESULTS.md.
