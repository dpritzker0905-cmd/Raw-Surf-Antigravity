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
