# Truth-inspector callback workload repair

The inspector throttled `render` snapshots but inspected every `idle` event.
The installed MapLibre render loop can fire idle after an animated custom layer
requests its next repaint. This bypass made the inspector serialize style and
walk layers at animation cadence. Delayed move-end callbacks also survived
unmount/effect replacement and multiplied during event bursts.

The repair shares a 250 ms budget between render and idle, with one trailing idle
inspection so a final settled state is still checked without another frame.
Timeline scrubbing suppresses both paths. Move-end work coalesces, remains a 100 ms
settled check, and is cancelled on cleanup. Initial/update inspections and the
existing marine-empty grace are retained. Forecast math, masking, native drawing
and fallback thresholds are unchanged.

## Reproduction and controls

Mounted React hook tests failed twice against deployed1993cc39 source:
8 failed/5 passed out of 13. Sixty render/idle pairs over one simulated second
caused 64 style snapshots, rather than mount plus at most four inspections.
Twenty move-end events caused 21 snapshots, and queued callbacks read a disposed
map or the previous model's closure. After repair, the 13 new tests and 4 existing
empty-grace tests pass. Tests also cover final idle delivery, current-style
violation detection, scrubbing starting before a deadline, one owned idle timer,
uninitialized styles and immediate effect-update inspection.

One completed offline native Chrome comparison used the actual React hook and
installed MapLibre, 100 background layers, and an animated custom layer. Each
case targeted 120 frames; one already queued final frame yielded 121 observed.

| Case | Idle events | Style snapshots | Style CPU call duration | Median frame gap |
|---|---:|---:|---:|---:|
| Deployed baseline | 114 | 125 | 6.1 ms | 16.7 ms |
| Repaired hook | 103 | 9 | 0.6 ms | 16.7 ms |

Snapshots fell 92.8%. CPU duration measures only calls to getStyle, not all
validation work, full-map CPU cost or GPU completion. Initial capture hit its
frame deadline. Reverse-order capture also timed out: 23 frames/18 idle events/
37 reads during its deadline. Both incomplete runs are excluded from improvement
and FPS acceptance. The completed comparison proves workload reduction in that
case; it does not establish the cause of the original intermittent live slowdown.
CSP blocked network connections; no live backend or physical forecast requests.
The owned tab and localhost server were closed.

The portable probe is `renderer-probe/serve-truth-cadence.cjs`; it reads its
baseline from pinned dev 1993cc39 via git, writes that copy and its bundle only
into a gitignored directory, and serves localhost. Run with the pinned Node
runtime from the repository root, open its reported URL, and use the public run
button. Never treat a deadline failure as a completed measurement.

## Qualification and remaining work

Full frontend, build, lint/LOC, secret scan and exact-head hosted checks are
pending at this initial receipt. Expected frontend floor: 373 suites, 4,079 tests;
backend source is unchanged. No new exclusions or skipped tests are intended.
Unowned staging canary remains untouched and excluded.

Original live low-FPS recurrence, GPU completion, smooth Play/scrub, exact
served/drawn/run time, Gulf amplitude and broader device acceptance remain open.
Mask repaint failure paths are still candidates, not proven causes. Qualification
and one bounded served observation follow before claiming live improvement.

Primary API reference: [MapLibre Map](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/).
The repeated-idle conclusion comes from the installed render-loop source and
the completed native probe, not an assumption that idle always means animation
has stopped.

## 2026-10-06 23:35Z — concrete truth inspector cadence/lifecycle repair785–788

Repeated red8fail5pass verifies unbounded idle and stale moveend defects. Mounted green17/17, final project CRACO373/373suites4079/4079tests0fail0pending. Buildexit0, lint1236files86errors917warnings inherited ratchetpass, LOC0new0regressed. One completed actual MapLibre/React offline pair125to9style snapshots; median16.7ms both, no FPS improvement claim; initial/reverse deadlines incomplete/excluded. No localtest/build overlapped the native pair. No original root-cause/Gulf/device/served-time acceptance. Forecast math, mask policy and guard thresholds unchanged; no served number change. 787 qualifies locally;786 awaits new hosted/approved dev merge/live readback,788prepares publication. Unowned canary hash unchanged/excluded. See TRUTH-INSPECTOR-CADENCE-RESULTS.md.
