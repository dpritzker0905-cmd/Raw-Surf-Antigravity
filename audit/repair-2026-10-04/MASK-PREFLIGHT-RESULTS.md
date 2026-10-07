# Empty-water mask refresh preflight

The regional and viewport-overlay refresh paths painted a Natural Earth mask
before discovering that the basemap water query was empty or unavailable. These
false returns retain the resident mask and do not consume the layer's successful
paint throttle, so repeated idle/source events could repeat the wasted paint.

The repair moves the existing finest-rendered-water selection ahead of canvas
allocation, after readiness and hysteresis checks. The painter receives that
same attempt-local selection; it does not query water twice. Direct painter
callers retain the original selection path. No packet survives a tile arrival.
The successful-paint throttle, source readiness, source-parent degradation,
damage detection, island/sheltered/inland-water guards and texture state remain.
Nonempty feature paints and later upload failures can still cost work.

## Reproduction and verification

The public engine seam uses actual water selection and the existing
rectangular Canvas painter contract, mocking only base-canvas creation and GL.
After repairing Jest harness initialization, two runs on unchanged source each
had **9 failing / 9 passing** cases. The passing controls demonstrated finest
selection, not-ready cheap exits and source-fallback healing. Failures covered
repeated empty queries, failed queries and one wasted allocation before recovery,
across regional, viewport-overlay and wide-grid delegation paths.

The fixed source passes **18/18** new regressions and **133/133** tests across
eleven mask/coastal suites. Native Canvas measurement, run alone with local
tests/builds stopped, reads actual engine/painter code with synthetic geometry
and map readiness:

| Ten same-view attempts | Before | After |
|---|---:|---:|
| Not ready: canvas allocations | 0 | 0 |
| Not ready: total CPU call time | 0.5 ms | 0.4 ms |
| Ready, no water: canvas allocations | 10 | 0 |
| Ready, no water: total CPU call time | 62.5 ms | 0.5 ms |
| Ready, no water: maximum CPU call | 12.8 ms | 0.3 ms |

All attempts returned false without recording a patch. The native fixture has
no full map layer, GPU upload or live backend. Allocation counts are the robust
effect; timings are single controlled samples, not an app FPS benchmark.

## Residual live problem

The preceding cadence repair PR248 is served on dev b8cdb2bd. Its clean bounded
Chrome GFS Waves check at 2026-10-07 00:00:59Z still triggered fallback after
12 low-FPS windows (2–9 FPS; 12,878 ms). The receipt reports 68 native callbacks,
six counted texture-helper operations and zero slow instrumented engine draw calls.
Mask refresh and other uploads outside that timer remain untimed. Fifteen long
tasks occupied 3,068 ms; 48 long animation frames spanned 12,211 ms with 2,501 ms
blocking duration. These metrics overlap and are not additive. GPU completion is
unmeasured. This is evidence of residual main-thread work, not attribution to the
empty-water path. Waves was disabled and the owned tab closed; API stayed healthy.

Original fallback cause, smooth Play/scrub, exact served time, Gulf storm amplitude
and device acceptance remain open. No served forecast number changes.

## Local publication qualification

Project CRACO completed **374/374 suites, 4,097/4,097 tests**, zero failures or
pending tests. Full production build exited zero. ESLint ratchet: 1,237 files,
86 errors / 917 warnings, unchanged inherited debt; LOC: zero new or regressed
violations. Staged secret scan found no leaks. Initial sandbox-only full run
failed the unchanged shell subprocess fixture (Windows DLL status3221225794);
initial build could not write the dependency-junction ESLint cache. Permissioned
reruns completed with all checks enabled; neither failure is counted as passing.
Frontend CI floors rise to374/4097; backend source and floors are unchanged.
Exact-head hosted qualification and served readback remain under commitment796.

## 2026-10-07 00:16 Z — timing scope correction800

Correction to794 and earlier render/upload shorthand: the histogram covers
renderHeatmapAndParticles engine draw calls. Six texture helper operations are
counts only; direct mask-refresh uploads and outside encode/listener work are
not collectively timed. Their cost cannot be excluded by0slow engine draw calls.
No cause attribution. Next discriminant needs separate whole-map/custom-callback,
mask prepare/paint/upload and data-encoding CPU scalars in the same low-FPS
interval, retaining no URLs/payloads, and independent native controls. No GPU
completion claim or budget relaxation. Current PR249 runtime76ad stays frozen.

## 2026-10-07 00:48Z — merged, deployed, residual fallback read back807

Exact9ee source qualified on its ownCI37551277208: all11jobs and four
supplementary workflows successful; guards2425+chain2317+estate1201=5943backend,
374/374suites4097/4097frontend, estate297selected295produced0silent.805 merges
PR249 as de1bd561 at00:38:09Z.806 verifies frontend/sharedAPI matching at00:41:54Z;
production frontendfc140024 stays frozen. Current Chrome DOM loaded served bundle
main.266069b3.js. Paused GFS Waves, hour0, canvas3440x1822/CSS1720x911, still
falls back at1..2FPS over12windows/15307.1ms at00:43:17.650Z.16nativecallbacks,
0texture-helper operations,0slow engine drawcalls; engine CPU histogram14under8ms,
2under16.6ms.17longtasks total3221ms/max220;0delivered LoAF entries does not
exclude stalls. Timing APIs can overlap and delivery can lag. GPU completion,
whole-map callback, outside encoding and mask refresh work remain unmeasured.
The posthog-recorder.js wrapper is not attribution. No Play/scrub in this capture.

Waves disabled (aria-pressed false), owned tab closed. PostAPI readback at
00:48:15.8195595Z healthy exactde1bd,13310products restored complete/no errors.
Initial sandbox DNS failure excluded; permissioned lightweight read succeeded.
807 fulfills qualification/readback796, not original fallback acceptance.
Next investigation separates whole custom-callback and mask prepare/paint/upload
cost and verifies focus/visibility. PR245 combined temporary tree clean/26offline
tests802; no current hosted/visual acceptance. Larger native controls804 were
uneven and do not prove resolution/FPS/GPU effects. Smooth playback, exact-time,
Gulf amplitude, real devices and actual staging publication remain open.
No served forecast number, science flag or production frontend change.
