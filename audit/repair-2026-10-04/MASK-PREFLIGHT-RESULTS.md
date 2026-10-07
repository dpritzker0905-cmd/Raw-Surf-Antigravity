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
six uploads and zero slow instrumented render/upload CPU calls. Fifteen long
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
