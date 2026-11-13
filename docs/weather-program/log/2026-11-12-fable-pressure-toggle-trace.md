# 2026-11-12 Fable (animation lane): pressure toggle on a throttled phone, traced; one fix tried and rejected

Third of the three gaps after #812 (the owner: "focus on the 3 issues that separate it from state of the art"; the
coordinator: "one offline trace on a 4x-throttled phone, then the smallest fix"). Offline only: built client over
serve_synthetic.py, the published GFS pressure set mirrored locally, phone = 390 x 844, dpr 3, CPU 4x, dark theme.
Tool: `frontend/scripts/offline-backend/scn_pressure_own.js` (gains FLAGS and TAG_SUFFIX for a same-build A/B of one switch).

## The gap is smaller than the #812 record says
#812's log has the phone toggle at about 3.0 s on own frames against 1.7-2.2 s on the .om path (one run per theme).
Five fresh runs per arm on the #812 build, alternating:

| arm | toggle -> drawn, ms | median |
|---|---|---|
| own frames | 4212 (first run, cold), 1939, 1811, 1078, 1362 | 1811 |
| .om (kill) | 1854, 1968, 1591, 1577, 1006 | 1591 |

About 0.2 s at the median, inside each arm's own scatter (about 1.0-2.0 s). The two arms use different "drawn" tests.

## CPU profile of the toggle (one run per arm, sampled at 0.5 ms, source-mapped)
Main-thread self time that exists only on the own-frames arm: the isobar worker's reply unpacked in
`isobarStore.js` onmessage (213 ms), MapLibre's actor / worker-transfer serialising the isobar GeoJSON for setData
(about 310 ms across four functions), `parseFrame` (74 ms), `toField` (40 ms). Everything else (MapLibre render,
React, getBoundingClientRect) is alike in both arms. Times are under the 4x throttle.

## Fix tried: ask for the window neighbours' isobars when the browser is idle. REJECTED
Hypothesis: the phone window loads three frames at toggle and asks for all three frames' isobars at once; deferring the two
neighbours (requestIdleCallback, 1.2 s timeout; kill switch) would free the main thread before the first frame draws.
Same build, the fix against its own kill switch, six alternating pairs:

| arm | toggle -> drawn, ms | median | toggle long-frame blocking, ms |
|---|---|---|---|
| fix on | 1023, 1020, 1881, 1554, 1555, 1735 | 1555 | 571, 551, 1875, 1079, 1485, 1151 |
| fix off (kill) | 903, 1094, 1803, 1583, 1483, 1413 | 1483 | 246, 554, 1689, 890, 1340, 991 |

No gain on either measure (if anything slightly worse), so the change is not shipped. The deferral only moves the same
main-thread work to a moment that, on a throttled phone just after a toggle, is still inside the toggle.

## What would actually remove the cost (not built)
The cost is the isobar GeoJSON crossing to the main thread and then back out to MapLibre's worker. Handing MapLibre a
URL (a Blob URL of the worker's JSON) instead of an object would keep both crossings off the main thread. Not built:
the measured gap (about 0.2 s, inside the noise) does not justify it ahead of radar and precipitation.

## Not measured
A real phone; Safari and Firefox; light and beach themes in this trace; more than one profile per arm.
