# Purchase Requests read-error recovery

## Status and priority

Local surgical repair on `codex/guardian-controls-load-recovery-20261030`, base `fb2d2e5def5ec8bcea1b2a39918f7740ba034a90`. Uncommitted and undeployed; PR643 remains a separate support release.

The next confirmed guardian read-trust finding was in PurchaseRequestsPanel: a failed queue read cleared its rows and displayed "No pending requests." A failed refresh could also leave a stale pending badge, and an older filter response could replace a newer filter's results. This slice repairs reads and recovery only. Existing approve/deny decision behavior is a separate concern.

## Linked-Groms entry verification

Before changing another component, freshly reran the 55 guardian tests: 55 passed across six suites. The existing linked-Groms forensic verifier passed its exact source hashes, prior Family Activity source reconstruction, ten-case red/green evidence and retained six-case browser receipts. GromHQ remains SHA256 `2b188a03405a5b69232a31704a910efd884bb0537d68001e5a6d585594be2d5c`, 794 lines. No new linked-Groms browser acceptance or hosted acceptance is inferred from the fresh test rerun.

## Repair

- Failed queue reads display a semantic alert with a native "Retry purchase requests" button; empty-state text appears only after a successful empty response.
- Pending/error reads hide stale rows and the pending count. Loading is announced, and Refresh is disabled while loading.
- Refresh and the native status selector now have meaningful accessible names.
- A request-generation guard accepts only the latest read. Effect cleanup invalidates abandoned reads when the parent/filter changes or the component unmounts. Late failures cannot clear newer successful results or dismiss a newer loading state.
- Retry uses the selected status and existing GET endpoint. No backend/API contract, approval policy, financial behavior or decision handler changed.

## Verification

- All eleven new regression cases failed against the original component, while the 55 retained tests passed. After repair, all 66 tests passed across seven suites.
- Cases cover failed initial read, positive queue retry, successful empty retry, announced pending retry and disabled Refresh, failed refresh hiding stale rows/count, retry retaining the chosen filter, obsolete success/failure responses, and repeated failure in light/dark/beach themes. They exercise actual component/shared UI behavior with fictional API data; no approve/deny calls were made.
- Actual Chrome tested the actual PurchaseRequestsPanel/shared theme/UI bundle in six combinations: light/dark/beach at 1280x720 and 390x844. Every case showed error/retry without false empty/count, Enter retry showed named loading and disabled Refresh, and a fictional successful read restored the row/count. Intended theme classes and no recovery-screen horizontal overflow were verified. Each case recorded two reads and zero writes.
- Additional mobile browser checks passed: Space retry; switch to Approved while Pending is unresolved; complete Approved, then complete the older Pending read and preserve the Approved result; fail Refresh without exposing stale rows/count; retry to a genuine empty Approved result. Five reads, zero writes.
- Exact reversal of only this read-recovery slice reconstructs the original component byte-for-byte (original SHA256 `5542bb85e19ac1cca10ac3420395c70e536e3e00da6b88e7e73949dd9964a5f2`). Approve/deny handler text is independently byte-equal before/after. All prior linked-Groms/Family Activity/GromManage/parental qualified hashes remain unchanged.
- Current PurchaseRequestsPanel SHA256: `e0d0009328009a475dfc216436d28698311c2109cc2842156d97ef8b85937282`, 314 lines. Scoped component/test lint: zero errors and zero warnings; whitespace check exit 0.
- Loopback server stopped, port 64527 has zero listeners, fixture tab closed and shared viewport reset. CSP blocked network connections; no live accounts or provider were used.

## Evidence and coordination

Private `guardian-controls-recovery` evidence: `linked-reverify.json/log`, `purchase-read-before.js`, `purchase-read-baseline.json/log`, `purchase-read-final.json/log`, `verify-purchase-read.py`, `purchase-read-preservation.json`, `purchase-read-browser-results.json`, `purchase-read-browser-extra.json`, `purchase-read-error-proof.png`, `verify-purchase-read-lint.cjs`, `purchase-read-lint-preservation.json` and the isolated loopback fixture source/build.

The portable guardian runner in `docs/audits/evidence/2026-10-30-guardian-load-recovery/run-tests.cjs` selects all seven suites. Set `RAW_SUPPORT_TEST_DEPS` to installed frontend dependencies and `RAW_GUARDIAN_TEST_OUTPUT` to disposable output. This avoids full backend/app startup.

An actual Claude Code Desktop coordination message was delivered before the repair. Its visible receipt acknowledged the read/retry slice and confirmed weather stays paused and unchanged, with no work started. The shared repair handoff, plan and memory contain the final results. A later user draft in Claude's composer was preserved; no final direct-message acknowledgment is claimed.

## Remaining boundaries

This proves local fictional read recovery, not real financial/role/provider acceptance. The original single processing-ID approve/deny concurrency issue and misleading decision-button names remain a separate surgical candidate; no decision was submitted here. Guardian integration still requires rebase, actual-target estate-floor requalification and hosted CI before a release decision. No commit, push, migration, restart, security probe, live write or weather change occurred.
