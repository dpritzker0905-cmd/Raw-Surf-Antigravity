# Grid response ownership and zero-coordinate UI repair

Local candidate; exact-source hosted qualification is still pending. No deployment,
provider change or flag activation. The separate staging-canary edit is excluded.

## Point UI

The mounted `useExactPointFetch` hook used coordinate truthiness in three gates.
Latitude zero, longitude zero and the origin never initiated an exact lookup; a
reselection at those coordinates also stayed idle. Truthy invalid coordinates
could enter the retry path even though the shared adapter refused their request.

The three gates now use finite numeric coordinates and geographic latitude bounds.
Finite world-copy longitudes remain supported by the shared adapter's wrapping.
Scientific calculations, model selection and playback/scrub suppression are unchanged.
This is one shared hook; it adds no theme, device layout or new visual component.

The actual mounted hook, sampler, caches and HTTP adapter are exercised with an
offline transport. Both request-identity modes cover zero selections, reselection,
world aliases, typed/nonfinite/impossible input and playback/scrub suppression.
The final 42 controls failed24/passed18 twice before the repair; all42 pass after.
The expanded three-suite run passes139 twice. Full frontend:369suites/4008tests,
61.437s. Build exits0 with inherited warnings. Lint ratchet passes with the same
86errors/917warnings; this is not lint-clean. No native pixel/device claim.

## Grid and series HTTP boundary

`GRID_RESPONSE_BOUNDS` defaults to0. When enabled, a custom FastAPI route wraps the
original handler, including dependencies, response-model validation and serialization.
It does not substitute a serializer or bypass the public `NormalizedProduct` schema.
An ASGI ingress timestamp includes application middleware/routing/admission time;
it excludes socket/proxy queues before ASGI and network transfer after send.

`GRID_RESPONSE_DEADLINE_S` defaults to20 and is clamped to1..20seconds. Series uses
the smaller of that budget and its clamped `GRID_SERIES_DEADLINE_S`. Compression
is negotiated and performed before output becomes eligible; outer gzip cannot
compress it again. Late output returns503/Retry-After1; a full waiting queue returns
429/Retry-After1; detected disconnects return499. No calm fallback is fabricated.

The grid and series paths share the existing admission object: one visible-frame
slot, one page slot, four waiting tickets total, FIFO within each lane. A free
reserved slot stays usable even when the other lane fills the waiting queue.
With the new switch on, the older series envelope is bypassed to avoid double
admission. Direct per-hour Python calls outside an envelope retain their behavior.

Strong references retain root operations. A context-owned grid child is shielded
from HTTP/per-hour waiter cancellation. A lease remains held until actual awaited
resolver/coarse-fill/compression work and owned children finish. Background response
revalidation also runs once under that lease, including after expired output, so a
scheduled revalidation marker cannot be abandoned with an undelivered response.
An available partial series may return while its canceled-hour work still owns
the lease. Late failures are consumed; unexpected failure types are logged without
request/provider payloads. Revalidation starts after response construction instead
of after socket send under this dark path; its work can keep subsequent requests queued.

This is a cooperative output budget, not a hard CPU limit. Noncooperative Python/C
work can delay timeout scheduling. Existing detached/shared provider producers and
other endpoint/background lanes do not become globally bounded by this response
envelope. Their separate concurrency/resource acceptance remains open.

The real single-grid HTTP route exceeded its budget before the repair with either
older series-switch setting: two permanent timeout assertions failed twice, with
controlled work released and joined. Final49 new controls cover that deadline,
24 JSON byte-parity comparisons (dict/model/subclass,1/1500vectors,four encodings),
response filtering/custom vector serialization, cached-product immutability,
serialization and compression budgets, resolver/coarse/compression threads after
timeout/cancel, series-hour cancellation, background revalidation, shared slots and
queue refusal/fairness/expiry/retries, disconnects/late errors, ingress elapsed time,
invalid response-model rejection and direct-call compatibility.

Final expanded backend runs5/6 pass154 twice (49new +17series +88point controls),
12.46s/12.56s. Separate floor/selector guards:57pass. Local interpreter has two
declared packages absent and is outside the declared virtualenv; hosted CI remains
the authoritative full-estate test. Tracked selector:643files, guards186,
chain157, estate297, two excluded and one quarantined; partition passes. Chain
floor2269 is projected from hosted2226 +49 =2275, preserving margin6; paired
reference updated in the same change. Frontend floor369/4008 has no margin.
Backend size check passes; repo LOC ratchet has zero new/regressed violations.

The Jacobian-style invariance check here is the paired envelope-toggle comparison:
decoded JSON bytes and cached input remain identical across all24 response fixtures.
It establishes no change to their scientific values/provenance. It is not a physical
Gulf calibration, production performance benchmark or hard execution-limit proof.

Initial expanded run1 had10 failures in an over-eager registry-cleanup assertion:
completed-task callbacks had not yet had an event-loop turn. The fixture now waits
for drained ownership; it does not clear registries or forgive leaked active leases.
Those failed results are retained and excluded from the final acceptance counts.

## Rollback and remaining acceptance

Leave `GRID_RESPONSE_BOUNDS=0` until separately reviewed shared-worker resource and
latency acceptance. Setting it back to0 restores the original HTTP grid path and
the previous series-switch choice. The small idle-slot fairness correction remains
in `SeriesAdmission`; an owned-source revert restores it too. No flag was set here.

The original Gulf storm/product/clock/pixel/playback case, desktop/mobile/themes,
FPS/heap duration, actual staging publication, PostgreSQL/card/race acceptance and
held-out scientific validation remain open. No real GFS storm product was available
locally. No live forecast/provider request or shared-worker load test was run.
Supabase OAuth refresh remains an external blocker; no credentials or cloud writes
are needed or embedded in these offline tests.

Design references checked: [FastAPI custom routes](https://fastapi.tiangolo.com/how-to/custom-request-and-route/)
and [Python task/shield/thread semantics](https://docs.python.org/3.12/library/asyncio-task.html).

## 2026-10-06 16:41Z — qualified parent and real-helper follow-up

Source0849b89e is qualified on ownCI37494572374: all11/four supplementary
success, actual5901backend (2425guards/2275chain/1201estate) and369/4008
frontend; estate297selected295produced0silent.729fulfills727/verifies728.
Guard pytest2425pass66skip1xfail (JUnit67skipped),872.09s; chain2275pass,529.89s.
Different CI durations are not a source-caused performance or live-latency result.
Static previewHTTP200/build0849 verified; no map/forecast executed.

The actual series helper then reproduced a narrower remaining admission defect:
four started grid builds for four hours after canceled waiters, both older
series-switch modes, two failures in each of two runs. Root lease retention
alone did not stop the helper replacing work inside that lease. This new
follow-up has one real grid-child slot per root operation. A started child
holds it through actual completion; a canceled queued child is canceled
before it can build; an expired root refuses any later queued start.
Thus the dark generic helper is serial within a root lease, instead of its
normal concurrency4. Default-off behavior keeps the old concurrency. Actual
cached/live throughput and shared producer limits still need acceptance.

Five follow-ups cover the real-helper stalled controls in both modes, real
healthy four-frame parity in both modes, and post-deadline queued work refusal.
Final source now has54new controls;229expanded pass twice,13.39s/13.25s
(54new+17series+13signature+88point+57floor). New paired chain floor2274/
reference2280 retains margin6;157files unchanged. Projected5906backend,
frontend369/4008 unchanged. Own732 qualification is pending for this delta;
the parent CI does not certify it. No flag/provider/math/promotion change.

The Dev connector now works. Fresh readonly metadata verifies private/empty
weather storage and pointer, RLS, singleton/primary constraints and service-role
CRUD privileges. Actual publisher Storage/REST authentication remains separate:
the staging process URL/service credential are absent. No SQL/storage mutation
or publisher execution.730records this restored access boundary; unowned
canary source is still excluded and unqualified.
