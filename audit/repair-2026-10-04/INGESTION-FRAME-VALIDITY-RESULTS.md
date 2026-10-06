# WI-05 invalid replacement frame write protection

Local acceptance 2026-10-06 00:43Z; source not yet published/hosted-qualified. Commitment679.
Current Gulf/prune sourceff5cfc98's hosted check does not cover this backend delta.

## Evidence and repair

Real `ProductStore.save_product` and `save_products_batch` overwrite a good frame at the same
storage key with an empty or all-invalid normalized frame. Offline GFS/NOAA, EURO/ECMWF and
ICON/DWD fixtures reproduce L1 and simulated L2 loss:12fail/6valid-zero controls pass twice.
This is a real store-boundary reproduction, not a fetched GRIB failure or live cloud experiment.

The38 tracked regressions add finite/nonnegative marine cells, partially valid grids, legitimate
negative weather values, unset/off/noncanonical flag controls, actual current upload collection
and mixed-batch isolation. First harness used a nonexistent drain method; corrected to actual
`wait`, then the sourceff5cfc98 before fixture reran:22fail/16pass twice. The early bad harness
results are retained locally and are not the accepted before proof.

`INGEST_REJECT_INVALID_FRAMES` defaults0/unset, read at call time and registered in the flag board.
When explicitly1, the writer requires at least one is_valid=True cell with finite primary speed
and finite value if present; marine primary speed must be nonnegative. Valid zero is usable;
other weather values may be negative. Missing/all-invalid/empty frames skip before atomic L1
write, L2 product submission or registration. Single-save returnsNone; batch counts only saved
items and reports rejected ones. No rejected product enters current-invocation acknowledgment,
so a wholly rejected lane cannot make WI02 succeed from its invalid uploads. Partial grids retain
existing masks; the guard does not repair cells, synthesize data or change the forecast chain.

No workflow/provider enables the flag. Owner activation must coordinate ingestion/precompute/
monitor/Render under D001. It can preserve an older usable forecast instead of a missing/bad
new object, so availability/cycle serving acceptance is needed before activation. This does not
fix disk revalidation, cycle selection retry, full cross-process publication or every malformed
upstream record. Known valid-zero acceptance is not a physical forecast-skill gain.

## Qualification

-153focused passed twice;283expanded passed twice, including prior pruning/retention,
  publication/pointer/restore/concurrency, vector cache, ingestion/health and CI floor controls.
- Changed backend fatal lint clean; repo-root LOC12grandfathered/no growth. An initial backend-cwd
  zero-scope LOC output was rejected and rerun at the root. Broad existing lint findings remain.
- Staged selector:185guards154chain296estate.38new chain cases; paired floor2130/ref2136/files154.
  Projected5642backend=2393/2136/1113, hosted confirmation pending679; local interpreter lacks two
  declared packages. No discovery/skip changes. Frontend source unchanged from ff5cfc98.
- No merge/deployment, flag activation, cloud/provider write or live map load. Productionfreeze
  remains; actual Gulf cells/native pixels, Dev publication, PG/card/concurrency, cache/WI01,
  retry/WI06, latency/mobile/performance and held-out science remain open.
