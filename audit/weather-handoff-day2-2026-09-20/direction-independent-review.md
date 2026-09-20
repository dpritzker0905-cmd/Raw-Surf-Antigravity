# Independent direction-patch review

2026-09-20; read-only review of the working diff against d82032f5. Graph discovery found the
estimator symbols but its source index is stale; findings below use the actual working files.

The refusal logic is coherent for its ordinary numerical domain: active positive-height
contributors require finite direction, zero weight/height does not govern direction, and the
dimensionless resultant guard prevents a nearly cancelled direction from being amplified back
to full scalar wave height. Grid resampling is checked before the trend's direction is consumed.
Unresolved noncalm cells become invalid placeholders and are excluded from nonzero counts;
all-invalid estimates are refused. Calm remains a valid zero vector. The point tests exercise
the actual resolver, surf transform and rating refusal/healthy controls; the changed coarse
fallback test retains honest fallback labeling for absent target direction.

Two limitations were independently reproduced without changing backend source:

- **Mixed-cell provenance remains last-cell dependent.** In `estimator.py:361,449,490,501`,
  ICON's per-cell share can transfer to GFS, while product `estimate_basis.weights` and grid
  diagnostics use the final processed cell's weights. For an otherwise uniform fixture, one
  unresolved ICON cell at index 0 produces heights `[2.6,2.8,2.8,2.8]` and reports weights
  `.6/.3/.1`; moving it to index 3 produces `[2.8,2.8,2.8,2.6]` and reports `.6/.4/0`.
  The type remains `euro_persistence_gfs_icon_blend` in both. This representation predates the
  patch; the new optional-direction refusal creates another route into it. The numerical cells
  are consistent with their local support, but the whole-product weights are not a spatial
  provenance audit. The new uniform-ICON test explicitly acknowledges this scope.
- **Extreme finite inputs can overflow `math.fsum`.** Actual
  `blend_direction([1e308,1e308],[90,90],[1.,1.])` raises `OverflowError` at estimator line 120
  despite finite individual amplitudes. These are unphysical heights with non-normalized
  weights; ordinary app weights are normalized and forecast heights are many orders smaller.
  No ordinary-domain runtime consequence is established. This is a defensive numerical-boundary
  limitation, not evidence against the normal cancellation fix.

Outputs: `backend-direction-review-probes.json`. The probe imported actual estimator functions
and reused the new test file's product fixture through `runpy`, using
`C:\Users\dprit\AppData\Local\Python\bin\python3.exe -B`. No provider fetch or backend mutation
was performed. Final whole-chain checks are owned by the coordinating task.
