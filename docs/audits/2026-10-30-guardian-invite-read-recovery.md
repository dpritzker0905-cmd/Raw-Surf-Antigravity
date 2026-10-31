# Guardian invitation read recovery

## Status and scope

Local repair on `codex/guardian-invite-read-recovery-20261030`, base `a8e6d0c7f071578a4200f7881f35f41b9adeb7e8`, in a new isolated checkout. Uncommitted and undeployed. PR644 deployment verification was completed before source edits; its coordinator explicitly released this file and browser ownership. The original frozen guardian worktree remains intact.

The original audit identified that AskMyParentPanel only logged invitation-read failures and silently hid the invitation section when no prior invitations existed. A child could not distinguish a failed check or retry it through that panel.

## Repair

The invitation list now has independent announced loading, read-error and Retry states. Pending/error reads hide invitation actions until a successful current response arrives. Successful empty reads retain the existing hidden-empty invitation presentation. The independent code-generation control remains available. Native Retry and existing theme tokens work across the three themes.

A generation guard and effect cleanup invalidate abandoned reads, including React StrictMode effect replay. An old completion cannot replace current invitations or dismiss a newer loading state. Code generation, clipboard copy, confirm/decline handlers, API paths, linking callbacks and policy remain unchanged.

## Verification

- Nine new focused cases: eight failed against the original component and one existing-behavior characterization passed; all 80 retained merged guardian cases passed. After repair, all 89 cases passed across nine suites.
- Cases cover failed initial read with code control still available, GET-only retry restoring an invitation without linking, successful empty retry, initial/retry loading, repeated failure, obsolete effect success/failure and obsolete completion while a newer read remains pending.
- The 80 retained cases include the existing positive synthetic code/link/decision behavior. New invitation recovery cases made no mutation calls. StrictMode cases use actual effect cleanup rather than bypassing the component lifecycle.
- Actual Chrome tested the actual AskMyParentPanel/shared UI/theme bundle in light, dark and beach themes at 1280x720 and 390x844. Six cases passed: read-error visible, code control enabled, Enter retry announced pending with Retry absent, fictional invitation restored with Confirm/Decline available, two reads and zero writes. Intended theme class and no recovery-screen horizontal overflow were verified.
- Additional mobile checks passed Space retry, repeated read failure and retry to a successful empty result; no alert or invitation section remained, code control stayed enabled, three reads and zero writes. No code was generated or invitation answered in browser checks. Fixture CSP blocked network connections.
- Exact reversal reconstructs the original component byte-for-byte; its initial SHA256 was `a1ad6ca0018a92bb87a531efc6e0b1497ebedbcb8affdc54ec7efc9d4e4125dc`. Code/copy/answer handler text is independently byte-equal before/after. All 25 original frozen worktree file hashes remain unchanged.
- Current component SHA256 `916027d4643b411e05bd5c43da001a34a72361a7b918330fffcc22d369c6c8bd`, 156 lines. Scoped component/test lint: zero errors and warnings; git whitespace check exit 0.
- Fixture process stopped, port 63835 has zero listeners, tab closed and shared viewport reset. No full backend/app startup or hosted API was used.

## Evidence and coordination

Private `guardian-invite-recovery` evidence includes `PLAN.md`, `before.js`, `baseline.json/log`, `final.json/log`, `verify-preservation.py`, `preservation.json`, `verify-lint.cjs`, `lint-preservation.json`, `browser-results.json`, `browser-extra.json`, `error-proof.png` and the loopback fixture sources/build. The portable guardian runner now selects the new test suite. Set `RAW_SUPPORT_TEST_DEPS` to installed frontend dependencies and `RAW_GUARDIAN_TEST_OUTPUT` to disposable output before running `docs/audits/evidence/2026-10-30-guardian-load-recovery/run-tests.cjs`.

The actual Claude weather-chat composer was inspected empty before delivering PR644's verified release results and this local repair closeout. No user draft was overwritten. Shared handoff, memory and plan contain the final evidence; a new acknowledgment is not inferred merely from delivery. Weather stays paused and unchanged.

## Boundaries

This proves local fictional invitation-read recovery, not live child/guardian or identity-provider acceptance. No backend/policy/provider change, real code generation, invitation answer, security probe, deployment or weather work occurred. PR644 is the deployed batch; this subsequent slice requires its own integration and release qualification. GromHQ age-verification/spending-alert failure feedback and identity-polling lifecycle remain separate unqualified candidates.
