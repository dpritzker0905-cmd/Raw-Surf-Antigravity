# Renderer projection boundary repair

2026-10-06 19:54Z. The owner attributes the earlier access problem to their
browser and asks to resume WebGL fallback repairs. No access fix is claimed.

## Proven boundary and repair

The actual marine engine returns before any GL access when its projection
matrix is absent or empty. The custom layer nevertheless stamped these calls
as non-skipped, so the mounted guardrail could interpret their one-second
cadence as sustained slow GPU drawing and switch to fallback.

Six new controls exercise the actual custom layer, actual engine early return,
and mounted guardrail. Both native-context and MapLibre-object callback formats
are covered with absent and empty matrices. A GL proxy fails on any attempted
access. The before runs both read six failed / twelve existing passed; the
second run directly asserts the unwanted fallback calls. Interrupted low-FPS
evidence also fails before the repair. The valid-next-projection control tests
argument forwarding with a stubbed draw, not native GPU performance.

The layer now stamps `engine_no_matrix` before calling the engine. The existing
guard excludes the non-draw marker. Its repaint in `finally` remains, and the
next valid projection clears the marker without remounting. Thresholds, hard
error fallback, recovery budget and scientific numbers are unchanged. The
diagnostic legacy-evidence override retains its existing behavior.

## Verification

| Check | Result |
|---|---|
| Before, twice | 6 failed / 12 passed; expected false-trip and missing-marker failures |
| Guard/layer neighborhood | 8 suites / 83 tests passed |
| Full frontend, corrected environment | 369 suites / 4014 tests passed |
| ESLint governance | Passed; 1230 files, existing 86 errors / 917 warnings within ratchet |
| Production build | Compiled with existing warnings; isolated output, no deployment |
| Repo LOC ratchet and diff whitespace | Passed; no new/growing oversized file |

Unqualified attempts are retained in ignored scratch logs: Windows CRA default
globs found no tests; the unrestricted `testMatch` argument initially ran the
whole estate and hit sandbox transform-cache renames. Explicit `testPathPattern`
and a worktree cache produced the actual focused red runs. The first full run
passed4002/4014 but twelve existing Netlify shell-scope checks failed to load Git
Bash's DLLs (status3221225794). The corrected full run passed all4014. The first
build could not write the installed ESLint cache; the authorized retry compiled.
None of these environment failures is credited as a symptom reproduction.

## Live performance remains open

A separate bounded public `?diag=1` dev smoke on the existing073de1e2 build
enabled GFS/Waves once, hour0 paused, without Play, scrubbing or a selected point.
At19:50:18Z it switched to the disclosed simplified third-party wave-height
layer after twelve low-FPS windows (captured windows3–16FPS). HUD showed7FPS,
32.67MB estimated GPU memory,19 uploads,4 dropped-frame counts,289 marine cells
and FRAMEBUFFER_COMPLETE. A startup layer callback logged a16-entry projection;
the captured engine early return lacked wave data while its matrix was present.
These samples do not establish missing projections at the trip, nor attribute
the broader live performance problem to the repaired boundary. Local tests and
build overlapped this observation, so it is not a clean device benchmark.
Waves was switched off and its inactive control read back. No flags/configuration
or guard override changed. This smoke does not qualify the new source.

Next: measure clean native draw cadence, per-frame CPU duration and uploads,
then GPU completion and playback/scrubbing separately. Preserve context-state
isolation. [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
supports investigating synchronous GL queries; it does not prove their cost here.
Original Gulf storm/hour98, device/native/raster smoothness, real staging
publisher, PG/card/races and science acceptance remain open. No wave heights
were inflated. Unowned manifest canary remains byte-identical and excluded.

PR246 retains the separate default-off backend manifest scan repair. New renderer
source needs its own hosted qualification; prior5b receipts do not qualify it.
Rollback: revert only the projection-boundary commit, retaining the prior guard.
