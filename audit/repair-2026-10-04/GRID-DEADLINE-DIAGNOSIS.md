# Single-grid deadline and worker ownership: next repair

This is a diagnosis and implementation boundary, not a completed repair or live latency measurement.
The existing LIVE-04 finding remains open. No forecast provider was contacted.

The real FastAPI `/api/weather/grid` route was driven through HTTPX ASGI transport,
with its resolver replaced by controlled work. Two independent offline runs each
passed three diagnostic assertions:

- With `GRID_SERIES_RESPONSE_BOUNDS=0` and with it set to `1`, a single-grid request
  still waited beyond the configured one-second series deadline. Releasing the
  resolver then produced the expected HTTP200 fixture. The series envelope does
  not protect this separate route; its setting is not a general weather deadline.
- Cancelling the HTTP request awaiting a controlled `asyncio.to_thread` resolver
  cancelled the waiter while the actual thread remained running. The fixture
  explicitly released and joined that thread; it left no worker behind.

Evidence: ignored `visual/grid-deadline-probe-1.xml` and `-2.xml`, three assertions
per run, 3.18s and3.10s respectively. `visual/test_grid_deadline_probe.py` grades
the currently missing boundary, so it is deliberately not a permanent acceptance
test. A passing diagnostic assertion describes an open defect, not a passing fix.
The controlled resolver does not reproduce the reported405-second production
request or establish current production latency. The thread result is an inference
about the real store/encode thread boundaries, not a claim that every live request
leaks work. Python's [task, timeout and thread semantics](https://docs.python.org/3.12/library/asyncio-task.html)
were checked alongside the actual local behavior.

The current grid route waits on `resolve_grid`, then coarse-fill processing, before
FastAPI response validation/serialization. The resolver dispatches store operations
through `asyncio.to_thread`; the viewport layer also shares shielded futures among
callers. The existing series response envelope correctly documents that its deadline
cannot preempt Python/C work and retains its permit until its operation finishes.
Simply adding `wait_for` around the grid resolver would leave response encoding
outside the budget and could admit replacements while earlier thread work continues.

The next repair needs these independent acceptance controls before it can qualify:

1. Start the elapsed budget at request ingress and include bounded admission,
   resolution, coarse/surf processing, schema serialization and compression. Handler
   duration alone must not be reported as complete request latency.
2. Preserve an owned operation and its resource permit until actual work completes,
   including after waiter timeout, disconnect or cancellation. Keep strong task
   references and consume late failures. Do not cancel a shared provider future merely
   because one HTTP waiter leaves.
3. Bound active work and queued requests jointly with existing series work on the
   shared worker. Test full queues, expiration before admission, visible-frame versus
   page starvation and repeated retries. Separate envelopes must not multiply the
   intended server concurrency budget.
4. Preserve the public response schema and all numeric/provenance/coverage fields.
   Grade real `NormalizedProduct` serialization, alias/custom serializer behavior,
   partial coverage and large grids; a direct `Response` must not bypass the existing
   response-model filtering by accident. Preserve L1 cached-product immutability.
5. Return a deliberate retryable status for expired responses. Do not present a calm
   or wrongly clocked fallback as fresh. Compare already-fast cached responses against
   the existing behavior and test the frontend's frame-retention/retry contract.
6. Qualify cancellation and noncooperative work separately. A bounded HTTP wait is
   not a hard CPU execution limit. Use a default-off rollout boundary; actual shared
   Render latency/resource acceptance and owner activation remain separate.

No deadline source change, provider configuration or flag activation is included
in the coordinate repair. The original Gulf physical/pixel/playback case remains
open; local weather-product inventories held no GFS wave product payload with which
to certify the owner's captured storm frame. Existing Gulf encoder/ramp evidence is
explicitly synthetic.

The shell inventory also exposed no Docker/Postgres CLI and no standard PostgreSQL
installation directory. This does not prove the machine has no other installation,
but it supplies no isolated PostgreSQL test target. SQLite authority controls are
not substituted for the remaining PG/card/concurrency acceptance. The Dev Supabase
connector still fails OAuth refresh before its read-only query; actual publisher
acceptance remains unexecuted.


2026-10-06 04:27Z: a separate actual mounted point-hook diagnosis (three ordinary/wrapped controls and three zero-coordinate cases, twice) confirms the existing `useExactPointFetch` truthiness guards suppress valid latitude/longitude zero. This UI gate needs a separate repair; the API and outer-cache coordinate checks do not fix it. Repeated actual-module world-copy selections reach exact_success. No runtime change is included in this diagnosis.

2026-10-06 16:41Z: first default-off response envelope source0849 qualified on own
hosted gates; actual-helper replacement-work gap was then reproduced twice and
a child-slot follow-up passed229expanded twice locally. See RESPONSE-OWNERSHIP-RESULTS.md
for qualification scopes and remaining resource/producer/pixel acceptance. Dev
connector access is restored; fresh read-only staging metadata is accepted, but
actual publisher authentication/execution and PG financial/race acceptance are separate.
