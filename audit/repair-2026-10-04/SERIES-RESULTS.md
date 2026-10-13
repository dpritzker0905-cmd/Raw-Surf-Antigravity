# Second repair batch: series cancellation and estimate provenance

Baseline: db20de62, first batch including its documentation rerun accepted by hosted
CI37180513517. W-03 and W-05 are separate client contract repairs; the rest of the complete
audit register remains open. AS-01 rotation is deferred on the owner's explicit instruction.

## Mechanism and repair

W-03: a completed fetch removed the caller abort listener, then its timer created a fresh
AbortController. Adding a listener to an already-aborted caller did not replay the earlier
event, allowing HTTP-failure, warming and coarse revalidation retries to reach transport.
Adjacent idle prefetch had the same lifetime mismatch. A late decoder could also publish
superseded results, and the mini lane could fetch after cancellation during slot handoff.

Deferred work now retains caller ownership until firing or cancellation. Abort clears the
timer/idle callback and releases its listener; firing/reset also release ownership. Entry,
mini handoff and post-decode gates reject canceled work. Active retries and fresh callers
still work. Kill: `window.__RAW_DISABLE_SERIES_ABORT_GUARD__ = true` disables the added caller
guard/deferred cancellation; existing in-flight transport cancellation remains intact.

W-05: the backend series serializer already emits `estimate_basis`, but frameToMarineData
dropped it. The adapter now retains the entire frame basis on `grid.estimate_basis`, and
matches the per-hour wrapper's `isEstimated`/`estimateBasis` fields. Missing basis remains
null, explicit native classification remains native, and zero weights/confidence survive.
Vectors, product identity and forecast time are unchanged. Kill:
`window.__RAW_DISABLE_SERIES_ESTIMATE_PROVENANCE__ = true` restores the prior metadata shape.

## Paired controls and Jacobian lens

| Controlled perturbation | Required response |
|---|---|
| Same deferred request, caller changes active → aborted | No second transport; timer/listener released |
| Same failed request, caller remains active | Retry still succeeds |
| Old canceled caller replaced by fresh caller, same page | Fresh load succeeds; old retry cannot overwrite it |
| Same decoded payload, abort before decoder resolves | No page/mini cache publication |
| Same acquired mini lane, abort before its continuation | Return owned slot without fetching |
| Same estimated frame, only blend weights change | Metadata changes; vector/product/time identity does not |
| Native frame follows estimated frame | No previous basis or estimated classification carried over |
| Basis contains zero confidence and persistence weight | Preserve zeros; do not replace with guesses |

The expanded actual-loader/limiter/mapper controls produced **23 failures / 5 passes before,
twice**, then **28 passes after** in both neighboring runs. The initial 22-case subset
independently produced 18 failures / 4 passes twice and 22 passes after. The baseline replay
restores both repaired source files byte-for-byte in a finally block. No substitute loader
supplies the behavior under test.

Neighbor acceptance: **19 suites / 163 tests passed twice**, including existing abort slot
ownership, retry bounds, background priority, coverage, cadence, base-anchor, antimeridian,
14-day/heavy paging, mini lanes, source truth and prewarm controls. Full frontend acceptance:
**337 suites / 3468 tests passed**. Discovery floors now match that count, from accepted
db20de62's335/3440 plus two new suites/28 controls. Production compilation passed via the
PowerShell equivalent of the CRACO build; lint ran independently.

Published functional source **d67763d59d5e007e07f84b274b6693faf5134ad7**, PR243,
CI37207402431: hosted frontend Run tests/Build frontend steps and overall job111451360943
completed successfully, verified through the jobs API. This includes the 337/3468 minimum
discovery gate; explicit hosted test totals await log availability while the whole run is
still active. Frontend lint/composition, ledger, encoding, LOC, backend estate/authority/
floor/import/lint and Netlify preview gates also accepted. The two longer backend guard
lanes remain in progress; no full-run acceptance is claimed. This source changes no backend
application code. A following acceptance receipt changes only documentation/memory.

Lint ratchet passed: 86 existing errors / 917 warnings; no new baseline violation. Initial
sandbox transform-cache EPERM prevented collection and is excluded from causal evidence;
unsandboxed offline execution ran the paired controls successfully. No backend test files,
lane selectors or exclusions changed.

## Limits and guidance

Transport/body/idle timing are deterministic mocked controls in Jest, not a native device
performance measurement. No visual layout changes are made by this batch. No live load
scenario, merge, production deployment, served forecast-number change or scientific flag
flip occurred. Point model/cache identity (W-01/W-02), missing-versus-calm consumers, broader
work admission/cache bounds and scientific held-out coverage remain open.

Primary guidance: [MDN AbortSignal](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal)
documents already-aborted signals, one-use cancellation and abort-listener lifetime. The
backend `_frame_provenance` and existing per-hour mapper define the actual metadata contract.
