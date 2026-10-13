# WP-8: parity flags are not evidence of field divergence

Reviewed checkout: `91b90ae9f642b9be015aa4c06a766cdfd557b74a`, 2026-09-20. This work changes no application diagnostics, data, or rendering behavior.

The two Audit14 `false` observations are explained by broken or unimplemented instrumentation. They do **not** establish that the point and rendered forecast differ. Nor does this finding certify actual point-to-pixel parity.

| Field | Actual writers and inputs | Verified interpretation |
|---|---|---|
| `__WebGLMarineLayer_DIAG__.infoboxHeatmapParity` | Default `false` in `frontend/src/components/map/WebGLMarineLayerDiag.js:40`; computed at 103–116, written at 142; called from `WebGLMarineLayer.js:201`. The sole production writer of `__MARINE_POINT_DIAG__` is `frontend/src/hooks/useExactPointFetch.js:316–344`. | The point writer includes model/layer/hour but **omits provider**. The comparator requires provider equality and reads missing provider as `none`, so an otherwise matching populated `open-meteo` heatmap returns false. The hook has the selected provider available at line 288 but never writes it into that object. The comparator is live; its provider input is unwritten. |
| `__FORECAST_TIMELINE_COVERAGE_DIAG__.pointVisualParity` | Default `false` at `backendWeatherServiceClientDiag.js:586`; next write at 277 is `prevTimelineDiag.pointVisualParity || false`. Point paths write product IDs/estimate fields, not this flag (`backendWeatherServiceClientDiag.js:394–400`, `backendCopernicusServiceClient.js:263–269`, `backendWindServiceClient.js:204–210`). | There is no comparison and no production write that can compute true. An externally injected true also survives later mismatching product/time updates. This is an orphaned verdict, not a failing comparison. |

Write discovery searched the whole frontend for all three diagnostic-object names and both property names, then checked the assignments and callers. Codebase-memory found the layer writer/caller, but returned stale locations for other current modules; actual checkout source was authoritative. Trevec retrieval could not initialize its embedding model due unavailable external model download. No inference relies on graph line numbers.

`parity-probe.cjs` runs the actual AST-extracted point assignment, the complete actual `updateWebGLMarineLayerDiag`, and actual `updateProjectionDiag`. It substitutes fixture inputs for external services and does not emulate React timing or GPU rendering. Exit 0; `parity-probe-results.json` records:

- Actual point writer with matching model/layer/hour + populated heatmap provider: false.
- Healthy control supplying the missing matching provider: true.
- Negative control changing the point hour: false.
- Timeline flag with matching grid and point product: remains false.
- Timeline flag manually seeded true, then differing product and time: remains true.

Recommended diagnostic-only follow-up: retire or explicitly label the timeline boolean as unmeasured. For the layer boolean, either deprecate the duplicate in favor of the existing four-state `__MARINE_SOURCE_PARITY__` (`forecastDiagnostics.js:275–356`), or wire provider and explicit unsampled/not-applicable status before exposing a verdict. Merely adding provider would leave other limitations: its hour is a requested offset, its heatmap inputs are props plus the last signature, and recomputation is tied to layer updates rather than point completion. Neither instrument compares sampled values, model run, served valid time, or the actual framebuffer.

The existing `__MARINE_SOURCE_PARITY__` distinguishes MATCH/MISMATCH/UNSAMPLED/NOT_APPLICABLE but is also a metadata check, not a pixel certificate. Do not wire the old flags to a guessed pass or treat their cleanup as a scientific/rendering repair.

Additional read-only tracing for the main task's timeline observation: `WebGLMarineLayer.js:106–198` writes `__MARINE_RENDER_HOUR_PARITY__` and `__MARINE_HEATMAP_STATUS__` from `lastUploadedGridRef`. That effect appears before the upload effect at line 918; `safeUploadWaveData` only changes the ref later at 370–387. A React commit can therefore publish requested h0 / old h18, then upload h0 without rerunning the earlier diagnostic effect (its dependencies are offset/revision/active/model, not a reactive upload revision). This is a concrete stale-instrument mechanism, not proof of the actual observed timeline or of a stuck GPU field.

For the live discriminator, collect the direct `__MARINE_ENGINE__._waveData.waveGrid` identity (hour, valid/served valid time, model/layer, dimensions and truthTag), the **separate** coarse base and pending seed identities, and recent `__RAW_FORENSIC__.events` commit/reject/clear records. In `WebGLMarineEngine.js`, the resident swap occurs at 297 and accepted-commit recording at 440–452. The layer's `__WEBGL_MARINE_UPLOAD_DIAG__` and `__MARINE_RENDER_SOURCE_DIAG__` are weaker: they use requested time and are written after `setWaveData` returns even when the engine returns early to preserve a resident field. Resident/accepted-commit evidence still needs render/RAF activity to support a claim about displayed frames. No app code was edited for this trace.

Reproduce from repository root:

```powershell
$env:AUDIT_HEAD = git rev-parse HEAD
node audit/weather-stabilization-14.0/wp8/parity-probe.cjs
```
