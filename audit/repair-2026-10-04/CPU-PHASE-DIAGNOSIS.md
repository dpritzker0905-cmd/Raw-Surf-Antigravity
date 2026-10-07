# Marine CPU phase diagnosis

The dev de1bd561 paused GFS Waves capture still fell back at1–2FPS after the
cadence and mask-allocation repairs. Its engine draw histogram did not measure
the complete custom callback, data update, mask preparation, painting or direct
mask uploads. This candidate closes that measurement gap; it is not a claim to
have repaired the original low-FPS cause.

Nine fixed scalar buckets measure synchronous CPU call duration, including
possible driver wait: custom callback, engine.render, setWaveData, regional and
viewport mask refresh, water feature query, base canvas, water painting and mask
upload (including texture-state capture/restoration). Inner phases overlap with
outer phases and must not be added as total frame time. Callback context counts
record visible/focused, visible/unfocused, hidden or unknown at callback entry.
They do not certify visibility continuously between callbacks or measure the
whole MapLibre frame. Other map layers, layout, external scheduling and work
between callbacks remain outside these buckets.

The fallback receipt uses copied snapshots from the same low-FPS interval as its
existing counters. Missing, active, reset, replaced, reversed-time, malformed or
failed measurements remain null; they never become a zero-cost claim. Failed
diagnostic writes are remembered weakly so a readonly store cannot silently
claim zero work. No entries, paths, URLs, payloads, location, GL objects or
device identifiers are retained in the receipt. There are no new timers,
observers, GL queries, readbacks or per-call history. The existing diagnostic
GPU object gates collection; the diagnostic-only disable flag suppresses it.
Fallback thresholds, retry budget, scheduling, coast policy and forecast math
are unchanged. No served forecast number changes.

This follows [MDN WebGL performance guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices):
synchronous queries can introduce driver waiting, so these CPU durations do
not assert GPU completion and add no synchronous GPU completion probe. Existing
long-task/long-animation-frame evidence remains a separate overlapping metric;
[Chrome's LoAF documentation](https://developer.chrome.com/docs/web-platform/long-animation-frames)
explains its frame-duration scope and attribution limits. Zero delivered entries
is not proof that no work blocked a frame.

## Reproduction and controls

Before wiring production call sites, the valid integration run failed6cases
with18unit controls passing: complete callback/skip timing, three actual engine
mask refresh boundaries, and interval receipt delivery were absent. An initial
sandbox transform-cache failure ran0tests and is excluded. An initial floating
threshold fixture assertion is also excluded; interior durations avoid asserting
an exact decimal subtraction boundary. After integration77focused tests passed.

Expanded202controls in17suites pass, covering original fallback protections,
error/repaint lifecycle, stale-hour opacity, stamps, mask readiness/preflight,
texture-state isolation, SDF, interval resets and privacy. The source-level
tracker placement assertion now targets the layer construction before its timing
wrapper and explicitly rejects a missing construction marker. This retains the
per-layer tracker contract. Registry extraction keeps engine LOC at3207, with
zero new/regressed LOC violations.

One offline Edge calibration used the actual custom layer and collector with a
synthetic map/engine, builds/tests stopped and no backend requests. Six idle
callbacks measured0.100ms total callback CPU/0ms engine CPU. Six deliberate
15ms pre-draw plus25ms draw stalls measured240.200ms callback/150.100ms engine
CPU. The histograms separated all six roughly40ms callback samples from all six
roughly25ms draw samples. Both legs recorded6visibleFocused callbacks, zero
hidden/unfocused/unknown, with focus/visibility confirmed at start and finish.
Warm-up was excluded. Initial sandbox loopback timeout is excluded; the reachable
loopback run completed, tab closed and server stopped. This calibrates the
instrument, not live FPS, full basemap performance, physical forecasts or GPU
completion. The final failure-boundary additions require final-source reruns.

The first full suite passed376suites/4126tests while the registry was being moved;
it is not the final source qualification. Two additional fault controls bring
the projected final floor to376suites/4128tests. Final full/build/lint/native
qualification and own hosted gates are tracked by commitment813. No current
candidate merge, deployment or live readback is claimed here.

## Next discriminating readback

After exact-source qualification and approved dev deployment, collect one bounded
paused GFS Waves interval. Compare the complete custom callback with its engine
draw and outside data/mask phases. A short callback while cadence is low narrows
the remaining work to other frame/scheduler boundaries; it does not attribute
that work to a console-recorder filename or prove GPU speed. Unknown phase data
requires instrument diagnosis, not a zero-cost inference. Turn Waves off, close
the owned tab and read lightweight API health afterward. Smooth Play/scrub,
served-time, Gulf storm amplitude, real-device and staging publication gates
remain open.

## 2026-10-07 01:32Z — final-source local qualification and native controls

Final376/376suites4128/4128tests,0fail/0pending; production build exit0 and lint
1240files86errors917warnings unchanged ratchet pass. LOC0new0regressed. Final
native Edge cold bundle, builds/tests stopped: six idle callback0.200ms/draw0.100ms;
six deliberate15+25ms stalls callback240.600ms/draw150.200ms; all correct separate
histograms and6visibleFocused per leg. Start/end visiblefocused. No backend.
Separate plain RAF control completed30intervals in792.200ms,31visibleFocused,
median16.700ms/min16.200/max300.300ms;1interval over50ms. One descriptive sample,
no engine/map/GPU work: not live map/FPS/GPU/physical proof or cause attribution.
Probe tabclosed/serverstopped. Two final failure controls explain4126to4128.
Exact-source hosted gates and approved served readback still pending813.
No served forecast number/science/production frontend change. Canary preserved.
