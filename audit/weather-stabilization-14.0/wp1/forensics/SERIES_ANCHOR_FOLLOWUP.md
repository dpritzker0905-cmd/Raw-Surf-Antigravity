# Read-only follow-up: series and single-time clocks diverge

The final browser warning exposed a real selected-frame mismatch after the WP-1 diagnostic repair.
It did not establish a reset/state-owner defect. No application source was changed for this follow-up.

Root's candidate browser observations on2026-09-20:

| Observation | Owner | Requested | Selected/accepted |
|---|---:|---|---|
| Jump-to-now at20:52:07Z |0|Sep20 21Z|Sep20 21Z, regional17x17|
| ArrowRight at20:52:35Z |1|Sep20 21Z|Sep20 20Z, series hour0,4x7|
| Earlier +18 |18|Sep21 15Z|Sep21 14Z,7x9|

Those are root's browser observations, not fabricated results of this isolated probe. The following
independent source execution reproduces the same time pairs without network access.

## Verified causal path

1. `backendWeatherServiceClient.js:194` rounds browser time to the nearest whole hour, adds the
   offset, then chooses the closest matching manifest time within3hours. At20:52 the rounded anchor
   is21Z. With matching manifest frames, +1 can snap to21Z and +18 selects next-day15Z.
2. `marineGridSeries.js:278-282` sends `/grid_series` only model/domain/layer/bbox/hour offsets/flavor.
   No absolute anchor accompanies the offsets. `routes/weather.py:79-86` has no anchor parameter.
3. `grid_series_helper.py:472` independently floors server time to the current whole hour. At20:52
   this is20Z. All three assembly paths use this base: EURO fast path at282, Open-Meteo fast path
   at371, and generic per-hour resolver at569. Therefore series18 starts at next-day14Z.
4. `marineGridSeries.js:348` caches by `hour_offset`. The page key at208 contains model/layer/flavor/
   viewport/page but no base time. The response `base_time` is not retained in the cache entry at368.
   `nearestFrameInEntry` at546 and `getMarineSeriesFrame` at561 select nearest numeric offsets within
   1.5hours. Consequently a +1 request may select series hour0, whose absolute time is20Z.

The clocks predate this audit: blame attributes frontend rounding to`9b55e7ae5` (June2) and backend
flooring to`48b97defb` (June20). WP-1's read-only option leaves that mapping intact. The actual code
was inspected after graph discovery; graph trace had unrelated name collisions and a qualified-name
lookup failure, so its edges were not treated as causal proof.

## Executed sensitivity controls

`series_anchor_probe.py` executes the actual generic backend assembler under a fixed clock with an
in-memory resolver. `series_anchor_probe.cjs` extracts and executes the actual shared-time function,
nearest-frame selector, and mapper from source with controlled dependencies. It does not reimplement
their clock arithmetic. The trace-tag builder is stubbed; no GPU, external provider, or full-browser
result is claimed.

| Fixed time | Single-time +18, no manifest | Series +18 | Difference |
|---|---|---|---:|
|20:29:59Z|Sep21 14Z|Sep21 14Z|0h|
|20:30:00Z|Sep21 15Z|Sep21 14Z|1h|
|20:52:35Z|Sep21 15Z|Sep21 14Z|1h|
|21:00:01Z|Sep21 15Z|Sep21 15Z|0h|

With a controlled manifest containing21Z and next-day15Z, the20:52:35 case reproduces +1→requested21Z/
selected20Z and +18→requested15Z/selected14Z. This isolates a phase-sensitive discrete mapping:
a one-second perturbation across xx:30 creates a one-hour disagreement. It is not a physical Jacobian
or proof that every model/manifest sees the same error. Across xx:00, a still-warm previous page can
add another anchor-age concern because the page key omits base time; that is a source-backed risk,
not a separately reproduced live cache rollover here.

Receipts: [backend execution](series-anchor-backend.json), [frontend execution](series-anchor-frontend.json).

```text
python -B audit/weather-stabilization-14.0/wp1/forensics/series_anchor_probe.py
node audit/weather-stabilization-14.0/wp1/forensics/series_anchor_probe.cjs
```

Python execution used the existing local3.14 environment rather than declared production3.12.

## Metadata findings, separately scoped

`marineSeriesFrame.js:76-77` carries actual valid/served time onto the grid. At81 it creates a synthetic
`series_<model>_<layer>_hN` identity, placed on the wrapper and truth tag, but not `grid.productId`.
Thus a null bare-grid productId does not mean the mapper lost all lineage. The backend frame
serializer also omits the resolver product's original `product_id`; neither this synthetic identity
nor null bare-grid identity proves which persisted source product was used.

`normalizer.py:143-145` defaults legacy `run_time` to ingestion wall-clock when no run is supplied.
The Open-Meteo series fast path calls normalization without run_time at377-380; generic dynamic
normalization can produce similar metadata. `_frame_provenance` carries that legacy time separately
from explicit model-cycle provenance. A20:51 ingestion time with null model_run_time therefore does
not establish a fresh model cycle. Grid dimensions and timestamps alone cannot discriminate the
live fast path from the generic dynamic path.

## Smallest next investigation

Capture the browser's actual matching series response and request together, including `base_time`,
requested hour list, per-frame hour_offset/valid_time/served_valid_time/frame_offset_hours, provider/
upstream/source_dataset, model_run_time/status, ingested_at, and the committed wrapper/truthTag ID.
Compare the accepted engine grid against that response, rather than a global overwritten by prewarm.
This pins the live producer/clock attribution and distinguishes manifest, dynamic and normalization
provenance without promoting ingest time to a model cycle.

Then design a separately reviewed shared absolute-time contract, with red cases at xx:29:59,
xx:30:00, xx:59:59/xx:00 rollover, cached pages surviving the boundary, model cadence snapping, and
clock skew. Cache identity and frame eligibility must include the same anchor/absolute validity;
simply changing floor to round independently would leave midnight/queue/cache-age divergence.
Do not relabel the stale physical frame to match the requested time or disable the warning.

WP-1 remains open for full acceptance; WP-4 granularity work remains deferred until this shared-time
contract is resolved. No serving fix, feature flip, deployed change, or production write is claimed.
