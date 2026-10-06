# Manifest candidate scan: event-loop placement and ownership

2026-10-06. Follow-up to PR243, merged into dev at073de1e2 after exactf405
CI37501260553: all11 jobs/four supplementary success, actual5906backend and
369frontend suites/4008tests. New scan source is separate and not deployed.

## Reproduced defect

`resolve_grid` retrieves the manifest in a thread, then calls the synchronous
`find_candidates` on the event-loop thread. Every requested hour repeats this
scan. The new response deadline cannot run while synchronous loop work occupies
that thread. This is one proven part of WS-07, not its complete latency claim.

The actual resolver and selector scanned a controlled20,007-entry normalized
manifest. Thirty-six cases cover GFS/EURO/ICON, waves/swell_1, bounds off/unset/on,
and island serving off/on. Instrumenting only the manifest iterator records
its actual thread identity. Twelve bounded-mode controls fail and24legacy
controls pass in each of two runs. No provider, forecast or database is called.
The fixture stops after real selection, before provider resolution.

Candidate expectations are independent explicit filenames/time differences:
exact time, inclusive±3hours, rejection one second beyond the window, estimated
versus authoritative lists, unrelated model/domain/layer rejection, island gate,
original ordering and case normalization. These selection controls do not grade
wave heights, final pixels or scientific accuracy.

## Narrow repair

With existing default-off `GRID_RESPONSE_BOUNDS=1`, run the same selector via
`asyncio.to_thread`. Off/unset retains the original synchronous path. No new
index, cache, candidate ranking, time window or forecast composition is added.
The bounded HTTP grid child keeps its lease while the real scan thread finishes.
No new flag or provider configuration was activated.

A further real HTTP regression stalls the actual manifest iterator in its thread:
the route returns503/Retry-After1 while work remains blocked; its reserved slot
remains held. Releasing the controlled scan lets the actual resolver finish and
the slot returns to zero. Cleanup always releases/joins controlled work.

The permanent module adds37controls to existing54, for91response/scan controls.
Expanded actual-source neighbors pass214twice,15.81s/15.35s. The set includes
series response ownership, island gates, series load/stride signatures, revision
refresh and floor controls. Fatal lint and654-file backend800LOC cap pass;
repo LOC ratchet reports0new/0regressed and12grandfathered non-growing files.
An earlier neighbor command used a missing filename and collected nothing;
that failed command is excluded from acceptance. Local Python differs from
the declared hosted environment; these results do not replace hosted CI.

Chain remains157files; paired floor2311/reference2317 retains margin6.
Projected backend5943 = guards2425 + chain2317 + estate1201. Frontend unchanged
at369suites4008tests. Own ledger739 requires exact-source hosted readback before
claiming qualification; ledger740 records planned source publication.

## Limits and rollout

Offloading this scan is not CPU preemption. Python's GIL still limits CPU
parallelism; other synchronous candidate ranking, overlap scans, serialization
and detached provider/background work remain separate. Calls outside an owned
HTTP envelope do not gain its lease/cancellation guarantee. Live throughput,
latency, event-loop lag and shared-worker resources have not been measured here.

The original Gulf storm payload, requested/served/drawn clocks, native/raster
playback, devices/themes/FPS/heap, actual staging publication, PostgreSQL
financial/card/races and disjoint scientific holdouts remain open. No original
GFS wave product is available locally. No wave heights were inflated.

Rollback: keep `GRID_RESPONSE_BOUNDS=0` or unset; revert the owned follow-up
source via its dev PR if needed. Unowned local canary changes are preserved and
excluded. PR243 rollout is owner-authorized; main/frozen production frontend
and scientific flags are not promoted by this follow-up.

Design reference: [Python task/shield/thread semantics](https://docs.python.org/3.12/library/asyncio-task.html).

Rollout readback741: PR243 dev frontend and shared API now serve073de1e2;
production frontend stillfc140024. This follow-up scan source is separate.
Additional floor/selector guards pass72; discovery/skip budgets unchanged.

## 2026-10-06 17:56Z — exact-source qualification745

Source5b286f7a own CI37504889852 all11 successful. Actual stdout: guards2425passes/186files (2492JUnit/67skip), chain2317passes/157files, estate1201passes/297selected295produced0silent; total5943backend. Frontend369suites4008tests. LOC37504889840,ledger37504889870, Lighthouse37504889848 and manual same-source encoding37505186980 passed. 745fulfills739. PR246 body updated/read back746; source remains OPEN/dev, not merged/deployed, responseflag off.747prepares docs-only receipts and runtime equivalence/pinned publication readback. Local canary hash preserved/excluded. DEV-RENDERER-SMOKE.md records fresh paused1FPS recovery/retrip; no physical Gulf/native/device/live-resource/cloud/PG/science acceptance.
