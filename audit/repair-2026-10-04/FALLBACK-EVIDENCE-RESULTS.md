# Native fallback receipt and diagnostic failure repair

2026-10-06, PR246/dev candidate. No forecast math or served-number change.

The previous projection-boundary repair is separately qualified at a5a29ae9.
Its receipt head e56f10af now has all15 checks successful. That does not qualify
this new delta. PR246 remains OPEN/dev, with no merge or deployment.

## Clean live observation

Fresh Chrome dev map with the public `?diag=1` HUD; GFS/Waves/hour0, paused.
No Play, scrub, point selection, force-fallback flag or guard override. Local
tests/builds were stopped throughout the observation. Native startup callback
reported matrix16 at21:12:19Z; resident data was initially absent. One7FPS
warning at21:12:29Z did not become a sustained trip. Subsequent HUD readbacks
showed20 and27FPS, FRAMEBUFFER_COMPLETE,289marine cells, simulation frame1108
then1563. Texture uploads stayed19; slow CPU-call counter stayed1. Waves was
switched off and visibly unchecked before closing the research tab (frame1853).

This bounded interval did not reproduce the prior fallback. It does not grade
the original Gulf/hour98 storm, uninterrupted playback, all devices or GPU
completion. HUD FPS is a sampled counter, not a full cadence distribution.

## Proven source defect and change

Two new mounted-hook tests failed before source edits: a throwing diagnostic
sink interrupted slow-frame accounting and suppressed a genuine fallback;
there was no structured native trip receipt. The same tests pass after repair.
Diagnostic failure is a reproduced fault-injection boundary, not an explanation
of the live incident. Existing telemetry listeners already catch their own
exceptions; the direct guard emit had no containment.

The hook now catches that direct telemetry failure. Once per completed slow
window, a small helper copies existing native counters and five CPU-duration
buckets. After12 consecutive admitted windows it emits one allowlisted receipt
before unmount. It retains only first/latest snapshots; excluded/grace/healthy
windows, trip and retry clear the retained evidence. No GL queries, pixels,
payloads, location or device identity are collected.

The receipt's interval begins at the END of the first low-FPS window, so it
normally covers11 intervals. Null counters mean unmeasured/unusable; measured
zero is retained. Object replacement, disappearance or decreasing counters
invalidate interval deltas. A counter that rebounds cannot repair an earlier
discontinuity. CPU-call duration includes possible driver wait and is explicitly
not GPU completion. Native callback deltas are not a count of successful draws.
The existing20FPS threshold,12-window trip, exclusion gates and bounded retries
are unchanged. Diagnostics cannot stop fallback when the helper/sink fails.

These choices follow [MDN WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices),
which warns that synchronous GL queries can stall the calling thread. Existing
counter reads avoid adding such queries; no live performance gain is claimed.

## Validation status

Mounted-hook red:2failed/18passed. Expanded neighborhood:113passed before the
final sparse-histogram case. Final full370suites/4045tests passed (0failed),
including27 helper and4 mounted-hook additions. Node24 production build exited0
with inherited warnings. Lint1232files stayed within86errors/917warnings and LOC
had0regressions. Own source0bdc458d CI37533475555 all11 and four supplementary passed;
actual5943backend/370suites4045frontend, estate0silent.763fulfills760.
Sequential hosted logs and strict exact-head count parser accepted.764publishes
operator/probe/receipt work only, app/tests/workflows identical to0bd; no merge
or deployment. Launcher six manual controls are independently recorded in
STAGING-LAUNCHER-RESULTS.md and not borrowed from the hosted app qualification. The helper cases cover immutable snapshots, absent
versus zero, malformed/sparse/unsafe counters, reset/rebound, engine replacement,
clock regression, fixed receipt schema and throwing diagnostic reads. Hook
cases cover pre-unmount emission, a loading-gap reset and failure containment.

The first expanded attempt from the repository root failed module resolution;
the same runner from frontend passed. That failed invocation is not validation.
A separate JSON readback initially used Windows default cp1252 and failed to
decode Jest output; explicit UTF-8 then verified actual370/4045/0failure counts.
Unowned manifest canary work remains untouched and excluded.
