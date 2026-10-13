# PF03: response-cost diagnosis and guarded prototype

Offline only. No runtime source, serializer, middleware, dependency or flag changed.
The actual `/weather/grid_series` route, FastAPI ASGI path, GZipMiddleware and GridVector
model serializers were exercised with a synthetic builder. No provider/production load.

The current route returns a dictionary after its builder. Framework JSON conversion,
encoding and gzip follow outside that builder's20s deadline checks. Changing only the
compression level cannot remove that dictionary/model conversion cost.

`pf03_response_experiment.py` is a reviewable experiment runnable through the existing
offline backend harness. It uses48frames/76800 distinct per-hour GridVectors, finite
heights, masks, missing periods, zero confidence and optional-field omission. Each arm
ran five times, then five more in reverse arm order. HTTP times include in-process ASGI
and client decompression; builder time is synthetic and excluded. These are local
Windows/partial-interpreter measurements, not Render or network p95.

| Response arm | First median ms | Reverse-order median ms | Compressed bytes |
| --- | ---: | ---: | ---: |
| Existing framework dictionary, gzip9 |1358.00|1360.52|650042|
| Existing framework dictionary, gzip1 |1160.70|1144.61|898784|
| Guarded direct Pydantic, gzip9 |666.56|985.14|650042|
| Guarded direct Pydantic, gzip1 |511.72|430.93|898784|

All40distinct-vector responses exactly match decoded legacy content, including masks,
valid hours, quantities, missing/zero fields and provenance metadata. Wire bytes match
within each compression level. Lower compression trades a38.3% larger payload for local
CPU savings. The direct/gzip9 arm itself varies materially across rounds; do not infer
a production latency ratio or choose the gzip policy from these timings alone.

The first exploratory fixture shared one1600-vector list across48frames. It was useful
for isolating framework encoding, but not representative ownership. Its two20trial
rounds are historical diagnostics only; the table above uses distinct vectors and a
finite compatibility guard. They do not count as extra independent release evidence.

## Numerical refusal discovered

Unguarded direct Pydantic encoding converts NaN/infinity to null. Standard JSONResponse
refuses those values. A fast serializer without this boundary would change numerical
meaning. The guarded prototype recursively refuses nonfinite values in primitives and
GridVector fields; unsupported types remain on the legacy path (datetime formatting
is explicitly protected). This is a narrow compatibility predicate, not a production
serializer specification. Runtime replacement remains unimplemented.

## Concrete next implementation gates

1. Include response encode/compress/bytes in lifecycle timing and deadline accounting.
   A post-work clock check detects overruns; it does not preempt CPU work. Cancellation
   and admission permits must represent actual unfinished work.
2. Qualify a default-off direct serializer with real route/builder results, unsupported
   types, NaN/infinity refusal, datetime/enum/string escaping, error/status and every
   provenance field. Preserve schema, masks, units and omitted-versus-null distinctions.
3. Bound expensive series admission across clients and retain foreground first-frame
   priority, bounded queues, disconnect behavior and retry semantics. Browser caps alone
   cannot provide this service invariant.
4. Decide compression from CPU/wire tradeoffs under fixed replay and service memory
   headroom; measure held-out cold/warm latency and shared foreground/API pressure.

Primary sources: [FastAPI response conversion](https://fastapi.tiangolo.com/advanced/custom-response/),
[Starlette gzip middleware](https://www.starlette.io/middleware/#gzipmiddleware).
The actual installed framework behavior, rather than newer-documentation performance
claims, determines the measurements. PF03 remains open; PF04 follows it.

Final reviewable-script replay:2tests passed (another20timing trials plus actual-route
datetime/bytes/set fallback and NaN/infinity error controls). Medians were2708.88ms
legacy/gzip9,2304.41ms legacy/gzip1,539.62ms guarded/gzip9 and301.72ms guarded/gzip1;
wire sizes and decoded parity remained identical. This larger baseline variation is
retained explicitly; local timing is unsuitable for a production speedup claim.
