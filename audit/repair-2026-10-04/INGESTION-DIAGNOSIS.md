# Current-source ingestion diagnosis — WI02/WI03 remain open

Run the durable instrument through `run_backend.py` with
`../audit/repair-2026-10-04/ingestion_jacobian_probe.py`. External sockets are blocked;
temporary storage, a zero-output producer and storage HTTP responses are injected.
This is a diagnostic instrument asserting observed unrepaired behavior, not a repaired-source
CI test. It is deliberately outside backend test discovery and does not raise accepted counts.

All6 controls passed twice: first separate fixtures, then the preserved combined instrument.
No actual provider, product, bucket, pointer or deployed configuration was changed.

| Finding | Held fixed | Perturbation | Actual current-source result | Meaning |
| --- | --- | --- | --- | --- |
| WI02 | Real CI entrypoint/store/health, zero producer output and zero product uploads | health.json HTTP200 versus500 | Exit0 versus1 | Metadata success can hide a wholly empty product cycle. |
| WI02 positive | Same empty cycle | Disable the health upload | Exit1 | The success is driven by the metadata acknowledgment. |
| WI03 | Nine global lanes, ingest age1h, sufficient horizon and known model-cycle timestamps | Model cycle age7h to55h | ok to ok | Model-cycle age has zero influence on the health verdict. |
| WI03 positive | Same old model cycle55h | Ingest age1h to13h | ok to critical | Health responds to ingest clock, not provider cycle freshness. |

The actual upload acknowledgment comes from ProductStore._upload_to_supabase, not a fabricated
diagnostic return. Its class-level last_upload_time is updated by health.json; main then uses
that timestamp as its only successful-upload requirement. The producer is stubbed at its
boundary, so this does not independently qualify every job's internal failure handling.

The health probe drives compute_data_health with supplied manifest metadata; model-cycle age
is preserved and known. This proves the missing metadata dependency, not that today's live
provider cycles are old. The read-only live health result remains healthy and ingest-fresh.

Next repair: distinguish real acknowledged product progress for this invocation from metadata,
downloads/restores and prior invocations. Qualify actual native/estimated upload paths, success,
partial failure, no-op/empty and failed-product-plus-successful-health controls. Health must grade
cycle age separately from ingest liveness, with model cadence and missing/estimated provenance.
Neither change should select a different served cycle; prune/invalid-frame/cache decisions remain
separate dark repairs under D-001. No repair or scientific promotion is claimed by this receipt.
