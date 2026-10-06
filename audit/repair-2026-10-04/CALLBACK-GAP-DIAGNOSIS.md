# Marine callback-gap diagnosis

Recorded 2026-10-06. Follow-up to PR246's clean dev observation, not a claim that
the original 1–5 FPS slowdown is repaired. WF-02 and CX34-07 remain partial/open.

## Evidence and hypothesis

The deployed native receipt counted 27 marine callbacks over 15.724 seconds;
17/7/1/2/0 calls fell into the CPU-duration histogram buckets. Most engine calls
were short. These durations include driver waits, but exclude other MapLibre
passes, render listeners and browser scheduling. GPU completion was unmeasured.
See `DEV-FALLBACK-ROLLOUT-RESULTS.md` for the exact observed limits.

The actual custom layer already requests its next repaint in `finally`.
Installed MapLibre fires `render` after `painter.render`. Thus an engine CPU
histogram cannot explain the entire interval between completed map frames.
`useLayerTruthDiff` calls `getStyle` during render events at most every 250 ms
and checks layer visibility. It is a candidate for measurement, not an established
cause. Normal simulation composition is throttled; sandbox evolution and the
GPU dispatcher are gated. No supported evidence yet identifies one of these
paths as the source of the live gaps.

## Diagnostic change

`marineMainThreadTiming` observes supported `longtask` and `long-animation-frame`
entries only during a consecutive low-FPS streak. It begins at the END of the
first low-FPS window, matching the native receipt interval. Fully contained,
delivered entries contribute count, total duration, maximum duration and, when
available, long-frame blocking duration. Unsupported metrics are null. Failed
delivery is explicitly incomplete; unreadable blocking duration is unknown.
Zero means no eligible delivered entries, never proof that no stall occurred.

Only these timing scalars are read; entries, script attribution, URLs, origins,
window objects and hardware identifiers are never retained in the receipt.
Long tasks and long frames overlap and must not be summed. Observer delivery
can lag the fallback trip. Neither metric measures GPU completion or attributes
a stall to a particular render listener.

The guard disconnects and discards the observer on every existing exclusion,
healthy window, fallback, retry and unmount. A 30-second safety expiry also
disconnects it if map callbacks stop entirely. The diagnostic kill switch is
`window.__RAW_DISABLE_MAIN_THREAD_TIMING__ = true`. Protection thresholds,
recovery policy, repaint scheduling, forecast values and science flags are
unchanged. Production receives no additional animation-frame loop or GL query.

API semantics and feature detection were checked against primary documentation:
[long tasks](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongTaskTiming),
[long animation frames](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Long_animation_frame_timing),
[blocking duration](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceLongAnimationFrameTiming/blockingDuration),
[supported entry types](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver/supportedEntryTypes_static).

## Controls and native calibration

Before guard integration, mounted diagnostic controls failed twice identically:
5 failures (no observer/receipt/cleanup) and 3 passing fallback controls. The
initial Windows test-selection errors were harness errors and are excluded.
This red result establishes a diagnostic blind spot, not the cause of the live
slowdown. The integrated neighborhood initially passed 7 suites / 107 tests.
Final review added an inaccessible-blocking-duration control.

Chrome ran the actual timing collector in the local, network-isolated probe;
30 animation frames per case, with six deliberate 100 ms CPU stalls in the
blocked case. Case order was reversed for the second run. No live forecast,
backend request, full app or GPU-completion measurement was involved.

| Case order / case | Inserted CPU work | RAF gaps >50 ms | Delivered long tasks | Delivered long frames | Long-frame blocking duration |
|---|---:|---:|---:|---:|---:|
| idle then blocked / idle | 0 ms | 0 | 0 | 0 | 0 ms |
| idle then blocked / blocked | 600 ms | 6 | 6 / 600 ms | 5 / 500.4 ms | 250.6 ms |
| blocked then idle / blocked | 600.1 ms | 6 | 6 / 600 ms | 5 / 516.6 ms | 251.2 ms |
| blocked then idle / idle | 0 ms | 0 | 0 | 0 | 0 ms |

Idle RAF median was 16.7 ms in both runs; maximum 16.8 and 17.5 ms.
Blocked maximum gaps were 100.2 and 100.1 ms. All cases completed with no
incomplete-delivery indication. This validates detection of deliberate CPU
stalls. The differing long-task/long-frame counts demonstrate why the metrics
are separate; the test does not demand numerical equivalence.

## Remaining acceptance

Exact new source still needs hosted qualification, owner-named PR247 dev merge,
served build readback, and one bounded live observation with no overlapping
local tests/builds. Examine delivered main-thread timings alongside the native
histogram and map cadence. If timing APIs are unsupported or delivery incomplete,
retain that uncertainty. Large delivered main-thread stalls justify a focused
listener/task trace; short or absent delivered records do not prove GPU fault.

The original fallback recurrence, smooth Play/scrub behavior, exact served/drawn
time, Gulf storm amplitude, broader devices and independent audit gates remain
open. The unrelated canary work is preserved and excluded from this change.

## 2026-10-06 22:45Z — final local callback qualification

Final project CRACO suite:372/372suites4066/4066tests0fail (callback-full-final.json).
Build exit0, lint1235files with inherited86errors917warnings and no ratchet
regression, LOC0regressed. Full frontend floors raised to measured372/4066.
Backend source unchanged, hosted backend projection remains5943 (2425/2317/1201).
Exact new source hosted checks pending, not borrowed from PR246 or docs head d1.
No original root-cause, GPU completion, Gulf/play/scrub/device acceptance claimed.
No dev merge, main promotion, serving/science flag flip or served math change.

## 2026-10-06 23:19Z — qualified PR247 merged and served; bounded capture780


PR247 exact source ec34dfa22e6498b2fa0613550f45d89de78e6c5d qualified on
CI37543004057: all11 jobs and four supplementary workflows successful. Actual
backend5943 = guards2425 + chain2317 + estate1201; estate297 selected295 produced,
zero silent. Frontend372/372 suites4066/4066 tests. Source diagnostics remain
unchanged from that qualification. Owner776 approves the dev merge and beneficial
dev repairs;778 reads MERGED1993cc39294a75436218d426b13a359cdb57a356 at23:10:28Z.
779 reads dev frontend1993cc39 at23:13:44Z and shared API healthy/full1993cc39 at
23:14:02Z; production frontendfc140024 remains frozen. Automatic squash CI still
running at the later readback; source qualification is not borrowed from it.

One clean native Chrome map, no concurrent local build/test: GFS Waves paused0
loaded authoritative NOAA ncep_gfswave025; public GPU HUD FRAMEBUFFER_COMPLETE,
169 marine cells,11 textures/33.51MB,19 uploads before short playback. Startup
warnings at23:16:32..35Z were2/4/4FPS; later warnings12..19FPS interleaved with
healthy windows. HUD27FPS before Play,26 at Play,23 at Pause12,24 at ArrowRight13,
21 near cleanup. Uploads31 after playback. No sustained guardrail trip and no
mainThreadTiming receipt. This is a non-reproduction of the sustained slowdown,
not evidence of zero long tasks or a repaired cause. Timeline says nearest model
time where appropriate; requested/drawn/served/run equality remains unproven.

Waves off verified by public aria-pressed false; owned tab1101120701 closed.
Post-map API at23:18:08Z healthy/full1993cc39; data-health warn unchanged from
premerge.780 fulfills777 bounded follow-up only. Original intermittent fallback,
smooth Play/scrub, exact served/run time, Gulf amplitude and broader devices stay
open. Unowned canary SHA256 unchanged and excluded. No served forecast number,
production promotion, science/serving switch or cloud publication changed.

Next discriminating experiment: offline full-layer idle/settle fixture measuring
mask refresh and truth listener costs separately from engine draw. Source shows
idle/moveend/zoomend may invoke refreshMaskWithBasemapWater outside the engine CPU
histogram. Successful paints consume the700ms throttle; false returns do not.
Some false exits occur after canvas painting or upload failure, so the claim
that all skipped attempts cost only bounds math is not universally true. Whether
that path occurred during the original live slowdown is UNKNOWN. Hysteresis and
tile-ready exits must remain cheap; a test must distinguish those from failed
expensive attempts and verify prompt tile-readiness recovery before any throttle
change. useLayerTruthDiff getStyle work is another unmeasured candidate. Neither
candidate is a proven cause. No speculative mask/listener behavior repair applied.
