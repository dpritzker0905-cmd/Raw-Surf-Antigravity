# Mask repaint event and verdict attribution

## 2026-10-07 02:38Z - candidate, not yet deployed

The paused live receipt825 measured22water-mask paints consuming4038.3ms while
18wave callbacks consumed95.6ms. It did not identify the event driving each
refresh or distinguish source-tile fallback from rendered-water damage. This
change adds those measurements before changing the healing policy.

The fixed phase collector grows from9to23scalar buckets. Refreshes are timed by
initial call, idle, moveend, zoomend, water-source event, other-source event,
unknown-source event or other event. Paints are timed by source fallback, rendered
damage, clean rendered water, empty result, failure or unknown result. These
phases are nested; durations overlap and must never be summed as frame time.
The source category follows the painter's water-source selection. It describes
which event called refresh, not which source caused frame latency or damage.
The rendered-damage category records the existing open-water verdict; it does
not prove that missing tiles, rather than legitimate geometry, caused it.

The existing250ms source throttle,700ms paint throttle, readiness, coastline,
island, inland-water and damage-healing gates are preserved. Events are not
filtered, no completed paint is cached, and no forecast value changes. The
phase timing kill switch bypasses metadata inspection and timing. No source ID,
event history, feature, coordinate, payload or map object enters the receipt.
The two-snapshot interval retains reset/error/clock invalidation behavior.

## Reproduction and validation

The real engine integration failed four new verdict assertions before the
change (11existing passed). Afterward171focused controls passed, including
actual overlay repaint on unrelated loaded-source events while degraded,
healing after clean rendered water arrives, and a following idle hysteresis
skip. This reproduces a possible repeated-paint mechanism offline; it does not
establish that unrelated sources caused the live receipt.

The full frontend passed377suites/4155tests, adding1suite/27controls. The CI
frontend floor moves to the actual local count; exact-source hosted confirmation
is still required. Final lint ratchet and LOC checks pass. The initial test
attempts with wrong Windows discovery are excluded; the valid before run used
the established explicit testMatch. A multiline-test lint regression and one
line of engine growth were corrected before publication. A build with CI=true
rejected existing repository warnings; the real Netlify configuration uses
CI=false with a separate blocking lint ratchet. The matching CI=false production build passed.

Native Chrome with the actual custom layer and synthetic map/engine recorded
six visible/focused callbacks per leg: idle0.2ms versus deliberate240.7ms,
with150.2ms inside engine draw. Three synthetic25ms paint controls attributed
exactly one expected event and verdict each, with matching return identity and
zero unrelated activity. These calibrate the clocks/labels, not MapLibre
rendering, GPU completion, pixels or live smoothness. Other browser activity was
not controlled. The owned tab was closed and loopback server stopped; backend
requests were zero. Portable calibration is renderer-probe/serve-phase-cost.cjs.

Hosted qualification, matching served frontend/API and one bounded paused live
receipt remain pending. No Play/scrub, exact time, Gulf amplitude, device or
isolated staging-publication acceptance is claimed. Production frontend frozen.
The other chat's canary is excluded. Ledger836/837; no served forecast number
or scientific-serving flag changes.

## 2026-10-07 02:44Z - publication and event-loop hypothesis

PR252 is attached, source13fbab10bb6f620e7708cf7d1884f4b048cd047b matches local,
remote and PR. Own CI37563127950/four supplementary checks pending.839 verified
by840;841 tracks hosted, served and one bounded paused receipt. Code frozen.

The installed MapLibre map.ts fires idle after a loaded nonmoving frame. This
layer requests another repaint after successful mask painting. If the paint
remains degraded, a later idle can paint again after700ms. The new idle and
paint-verdict buckets discriminate this possible feedback loop from source
events; it remains a hypothesis until the served receipt.
[MapLibre event documentation](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapEventType/)
also distinguishes source-loading events from map events. Current source event
objects include sourceId/isSourceLoaded in the installed events.ts. No filter
is justified by the event type alone because the existing readiness gate also
checks global tile readiness.

Chrome access check reached the public landing page, without an authenticated
app session. Edge is no longer in the browser inventory; owner reconnect request
pending. The landing tab was closed; no extra live forecast scene was opened.
No app credential read/extraction or repeated forecast dispatch.

## 2026-10-07 02:57Z - own-source qualification and merge

843 accepts13fbab10 ownCI37563127950 all11 and four supplementary successes.
Actual5946backend:2425guards/2317chain/1204estate; estate298selected296results
0silent. Frontend377suites4155tests, matching raised floor. Local source remains
frozen.844 PR252 merged02:57:31Z as1a89ed0a559f132d53401b0cfc40c1cf8a184592;
fetched dev matches.02:57:55Z frontend/API stillbf72healthy, productionfc140024.
841 remains open for matching rollout and one bounded paused scene.842 owner
Chrome account sign-in restored; user feed tab present, owned landing retained
for later map receipt. No credential reads; no second forecast scene. This
supersedes the earlier access limitation. No forecast number/science activation.

## 2026-10-07 03:08Z - clean repeated paints, not degraded retries

Ledger846 fulfills841. Frontend/API matched1a89ed0a before the single paused
Chrome GFS Waves hour0 observation. The actual receipt includes all23 fixed
phase categories, proving the map's lazy-loaded diagnostic code is served.
At03:05:29.020Z:15001.6ms interval,12low-FPS windows all1FPS;
15visible/focused callbacks99.3ms, engine draw84.9ms.19rendered-clean paints
2433.2ms (all>66.6ms), zero source-fallback or damaged paints.7idle refreshes
684.2ms and8other-source refreshes1118.8ms;0water-source refreshes.17longtasks
3029ms/max472ms. Phase durations overlap and include driver waits; no GPU
completion was measured. Other browser activity was not controlled.

This FALSIFIES the degraded/source-fallback retry hypothesis for this receipt.
Clean-cache eligibility is the next boundary. The source category alone does
not justify dropping events: readiness depends on global tiles as well.
We did not capture the live viewport span, so a minimum-span cache defect must
be established independently offline and cannot yet explain this scene alone.
Zero LoAF entries do not exclude stalls. No performance improvement comparison
is valid against the prior receipt's different browser/view.

Waves read back0, HUD layer none/raster OFF; owned map tab closed, user feed
preserved.03:08:29Z shared API healthy exact1a89ed0a/datawarn. Production frontend
fc140024 frozen. No second live scene, playback/scrub or forecast science flag
activation. No served forecast number changed; original Gulf, time, device and
isolated staging-publication gates remain open. Raw console/recorder URLs and
credentials are excluded. Sanitized local scalar receipt is gitignored.

Correction to the publication asset check: the landing main bundle does not
contain map-only labels because the map is lazy-loaded. Local Windows and
hosted Linux chunk IDs are not interchangeable. Those marker checks are
excluded; the live receipt establishes the diagnostic categories actually ran.
