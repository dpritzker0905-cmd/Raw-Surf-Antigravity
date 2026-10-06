# WI06 GFS-wave cycle retry: partial dark repair

Locally accepted 2026-10-06 01:12Z; new source unpublished/unqualified, commitment686.
Predecessor WI05 sourcea3b321f0 is independently qualified: CI37396359484 all11success,
5642backend=2393/2136/1113 and360suites3746frontend; estate296selected294produced0silent;
ledger/LOC/encoding/Lighthouse success. That does not qualify this new retry delta.

## Reproduction and behavior

Actual picker20controls:17fail/3legacy controls pass twice before; final32 regressions.
Transient f000 or final-hour HEAD could select6h older instead of the recoverable newest cycle.
Default0/unset NOAA_WAVE_CYCLE_RETRY enables a separate sibling helper only on explicit1;
script-by-path/package imports both tested. The legacy path stays byte-identical when off.

On: two attempts per endpoint, newest-first across seven cycles, one12s elapsed selection budget,
socket timeout at most3s/remaining budget, bounded jitter and numeric Retry-After. Terminal
statuses are not retried. Excessive/unparsed Retry-After or exhausted429 stops probing rather
than immediately probing other URLs; complete cycles require both endpoints. Responses close;
late success is rejected. Socket timeouts can overrun the elapsed budget: this is late-output
refusal and bounded attempts, not forcible network cancellation or a proven live latency gain.

Original corrected offline probe2fail/1genuine404control twice; first URL fixture omitted gfs.
and was rejected. Final67focused twice and347expanded twice pass, including current storage/
publication/provenance/selection, coverage/deadline, multi-region/block-mean/range and by-path
imports. Changed fatal lint/size/LOC pass; staged selector186guards/154chain/296estate,
32new guard cases; paired floor2419/ref2425. Projection5674backend, hosted686 pending.
Frontend source unchanged; no skips/discovery weakening or provider flag enabled.

## Remaining ranking and activation acceptance

Independent actual store duplicate sweep2fail twice, both manifest orders: an older verified
cycle ingested later deletes the newer verified cycle. This retry repair does not migrate
legacy run_time ranking; WI06 remains partial. Actual normalization already carries explicit
known cycle separately from legacy ingest/pruning time. A ranking repair needs its own dark
guard, before/after regression and cross-provider/tail/unknown-cycle acceptance.

Owner activation review must cover Render/ingestion/precompute/monitor together, actual AWS response/
budget behavior and availability. No workflow enables the flag; no live request, cloud/provider
write, merge/deployment or served-number/physical-skill improvement. WI01 cache freshness,
actual Gulf/native pixels, cloud publication, PG/card/concurrency and science remain open.
Primary design sources are linked in CACHE-CYCLE-NEXT-REPAIR.md.
