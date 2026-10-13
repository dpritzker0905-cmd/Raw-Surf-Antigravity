# PR246 dev rollout and clean native fallback readback

2026-10-06. Owner explicitly approved PR246 into dev after final checks.
Ledger765 records authority;767 merge;768 served rollout;769 bounded live
observation, fulfilling766. This is deployment and diagnostic acceptance,
not completed smoothness, exact-frame, Gulf physics or device acceptance.

## Qualified and deployed

Approved head144e889e5acee8dff0825fe919fa5aad9e2893c2 passed its own
[CI37536152276](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/actions/runs/37536152276):
all11 jobs plus Encoding, LOC, Weather Program Ledger and Lighthouse.
Actual stdout:5943backend =2425guards+2317chain+1201estate;
370frontend suites/4045tests; estate297selected295produced0silent.
Counts match the projection. No qualification borrowed from another head.

Pinned squash merge of [PR246](https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/pull/246)
read back MERGED/dev at22:04:37Z as72e6e5adf790d77dc4a73fc186799ea2a103960d;
fetched origin/dev agrees. Fresh22:07:46Z sequential cheap requests read
dev HTTP200/service-worker BUILD_VERSION72e6e5ad and healthy API version
ending in that full merge SHA. Production frontend HTTP200/buildfc140024
at22:06:26Z remains frozen. No main promotion, manual deployment, science
or serving flag activation, schema/Storage write or credential change.
GRID_RESPONSE_BOUNDS is still default-off; its source qualification is
not live resource/latency acceptance. Unowned canary preserved/excluded.

## Bounded clean observation

One fresh Chrome tab at dev map?diag=1; no concurrent local test/build
workload. GFS selected, Waves enabled once, paused at hour0, no point
selected. Public HUD reported complete framebuffer and441marine cells.
At22:08:39.622Z the guard tripped and its newly deployed native receipt
was captured before unmount:

| Counter | Measured value |
| --- | --- |
| Completed low-FPS windows | 12 |
| Receipt interval | 15724.2ms; starts at end of first window |
| Counters continuous | true |
| First/last/min/max FPS | 1/5/1/5 |
| Native callback delta | 27; callbacks do not prove successful draws |
| Texture-upload delta | 6 |
| Slow CPU-call delta | 3 |
| CPU-call histogram | 17 under8ms;7 under16.6ms;1 under33.3ms;2 under66.6ms;0 above |
| GPU completion measured | false |

These CPU durations include possible driver waiting. They are not GPU
elapsed time, and exclude other MapLibre passes, event listeners and
browser scheduling between callbacks. Most measured native calls were
short; low callback cadence is reproduced, its cause is not established.
Do not attribute the result to PostHog solely from its console source URL.

The simplified-wave notice appeared and omitted native resolution text.
Play advanced the public wheel to6, then was paused at12. One keyboard
ArrowRight scrub selected13; a subsequent read still showed13. This
grades basic selection/controls only, not continuous frame pixels.
The fallback displayed `Verifying displayed forecast time.` Automatic
recovery1/2 logged22:09:43.600Z. No second trip receipt was captured in
the bounded interval. Waves aria-pressed false was read back; tab closed.

Captured hour0 products were global181x82 and Florida21x21 at requested
2026-10-06T21:00Z. A recovery snapshot names NOAA's ncep_gfswave025 and
requested2026-10-07T12:00Z, but servedValidTime/modelRunTime remain null.
That cannot certify a selected/drawn clock. No October5/hour98 product,
Gulf exact-point comparison or nearshore-vs-offshore physical acceptance.

## Narrow next diagnosis

The custom layer already calls triggerRepaint in finally. Installed
MapLibre map.ts emits render after painter.render; the guard counts
completed map events, while the receipt times marine calls. Full-map
work, other handlers, scheduling and GPU completion remain distinct
candidates. No new renderer behavior change is justified by these
observations alone. Preserve GL state isolation and frame identity.

[MapLibre's custom-layer contract](https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/)
supports triggerRepaint for custom animations. [MDN's WebGL guidance](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices)
notes synchronous query stalls; this supports measuring before optimizing,
not assigning this incident to a particular GL call.

Next: obtain bounded full-map/scheduling evidence and a causal offline
counterexample, repair that boundary, then repeat native Play/scrub/coast
and device tests. Exact served/drawn provenance and a same-run Gulf point/grid
comparison remain required. Actual Dev publisher/PG/card/resource/SLO and
held-out science gates are separate. No served-height math changed.
