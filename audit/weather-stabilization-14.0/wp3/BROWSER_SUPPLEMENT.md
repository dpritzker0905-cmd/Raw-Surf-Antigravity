# WP-3 browser supplement: cold world-request blocking

This is a transcription of the main task's browser-tool observations on 2026-09-20. The rendering reviewer did not independently operate the browser during these runs. Screenshots were viewed through the tool; no screenshot files or HAR were saved with this supplement. It records the evidence supplied by the main task, not a separately replayed browser result.

Both experiments used local development instrumentation to block world marine grid/grid-series requests in cold sessions. They ran **after the controlled cache-reuse change had been implemented**. This completes the bounded consumer investigation but does not meet Audit14's strict requirement to perform D3 before editing. The earlier code baseline was `91b90ae9`; these observations belong to the local candidate with the reuse change, not an unchanged baseline or a deployed build. No exact candidate build SHA was supplied with these observations.

| Observation | Cold coastal z9 | Cold wide z3 |
|---|---|---|
| Recorded time | 2026-09-20 20:43:34.192 UTC | 2026-09-20 20:49:22.308 UTC |
| Browser run marker | `wp3-block-z9` | Cold z3 blocking run; exact URL not supplied |
| Viewport `[west, south, east, north]` | `[-81.19157714843746, 27.312277038193628, -79.70842285156256, 28.404969258652628]` | `[-127.9109375, -10.4645415337, -32.9890625, 56.3783557508]` |
| Accepted resident | GFS / waves, h0, regional 17×17 | `null` |
| Accepted valid time | `2026-09-20T21:00:00Z` | None |
| Accepted product | `gfs_marine_waves_florida_east_coast_20260920T210000Z.json` | None |
| Coarse base | `null` | `null` |
| Blocked world requests | 7 | 20, including grid/grid-series requests and all three world series pages |
| Visual tool observation | Green coastal crests remained visible | Marine pass blank over the Americas; HUD reported `MARINE_EMPTY_RENDER` |
| Timing limitation | Roughly 1 FPS observed | 314 RAF callbacks over approximately 320 seconds; observation at 320,510 ms elapsed |

The coastal run shows that a valid regional forecast can be accepted and visible in this z9 viewport with no coarse base and all observed world requests blocked. This does not establish pixel equivalence with the ordinary composite: the global wash and crest-ring consumers identified in the source can still contribute in other coverage or transition states. No matched image comparison was saved.

The wide run shows failure to obtain an accepted marine field while world requests were blocked: the resident and coarse base remained absent after about 320 seconds, alongside a blank marine pass and `MARINE_EMPTY_RENDER`. Together with the world request paths in the source, this supports retaining world-data access for wide views. It does not prove a precise zoom cutoff. The z7 and z8 boundary cases, partial regional coverage, and zoom-out transition still need direct checks before suppressing world requests by zoom.

These observations support the narrow repair: reuse the correctly timed world frame already present in the series cache, while preserving the existing cold-world fetch and consumers. They do not justify suppressing every world request at coastal zooms, or reusing one old-hour frame across later forecast hours.

Measurement limits remain material:

- The slow RAF cadence does not establish healthy animation or compositor performance, nor identify the cause of the low rate.
- Cross-origin byte counters were zero without Timing-Allow-Origin (TAO). Zero is unavailable transfer-size evidence here, not a measured zero-byte transfer. No actual payload-byte reduction, <1 MB scrub result, or backend p90 improvement is claimed.
- Counts are requests blocked by the local instrument. They are not successful downloads, backend completed work, or a normal unblocked request-budget measurement.
- The supplied observations do not include a matched cold unblocked control, archived HAR, full request ledger, or captured image artifacts in this supplement. The deterministic code/cache tests remain the reproducible before/after evidence for the repair itself.

WP-3 remains partially complete. The consumer question is now informed by actual cold browser observations at z9 and z3, with the chronology deviation explicit. The stricter request, bandwidth, latency, boundary-zoom, and pixel-equivalence acceptance criteria remain open. No application code, production flags, or deployments were changed while writing this supplement.
