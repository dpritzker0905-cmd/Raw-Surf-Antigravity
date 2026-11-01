# WebRTC setup cancellation — October 29, 2026

Status: completed and verified locally. Focused local packaging was subsequently authorised;
publication and integration remain pending. Historical testing receipts below describe the pre-commit
state. Current delivery is established by Git history/readback. Existing worktree `2866/raw-surf`, branch
`codex/audit-repair-20261029`, entry HEAD `1a3e51875a90553d97fc637b4640bf02b3be656e`.

## Scope and ownership

The fresh coordination continuation directed the existing repair chats to resume only already
authorized, unblocked local work. This is the pending setup-cancellation item in the combined
consistency/calling handoff. This lane owns `frontend/src/hooks/useWebRTCCall.js`; the booking and
admin lanes' current changed-file inventories contain no delta for it. The booking lane retains its
completed challenge/trophy/replay work; ce30 retains its admin-support work. No new shared integration,
schema, release or provider action is part of this repair. No new commits are authorized in this run.

One implementation agent owns the hook and new cancellation Jest suite. Separate read-only review
and a local browser fixture provide independent checks. The parent owns this report, its existing
session log and branch ledger fragment.

## Reproduction and intended acceptance

The real hook is exercised with held media, permission and SDP promises. Cancellation, replacement,
identity change or unmount must invalidate the previous attempt. A late successful media result must
stop its own tracks; a stale error must not clear a newer call. Delayed offers/answers must not signal
or create timers for cancelled calls. Same-tick duplicate starts/answers must not create competing
setup attempts. Terminal decline/accepted-elsewhere paths must invalidate pending answers. Retired
local SDP/ICE continuations must not consume or populate the next call's buffered candidates.

Fake API, media, RTC and signaling implementations avoid real users, devices or provider operations.
The browser fixture removes ICE configuration before bundle output, blocks external requests and
uses fictional identities. Raw hook source and provider credential values are not copied into evidence.

## Existing limits retained

The signaling protocol still lacks per-call identifiers; late network messages across attempts remain
a separate protocol issue. Real media, NAT/TURN, physical devices, provider delivery and hosted/full-app
acceptance remain unqualified. Async camera flip/toggle work lives in a separate media hook and is
outside this startup/answer repair. The existing permission-check behavior and provider configuration
are preserved; no security testing or credential rotation occurs. The signaling sub-hook's WebSocket
reconnect lifecycle is unchanged; this patch cancels only this orchestrator's setup wait. An active
remote-description failure can still leave the existing call in CONNECTING; recovery from current-call
negotiation failure is a separate issue, not a stale-completion cancellation claim.

The booking lane's finalized target-specific candidate PostgreSQL and ordered migration-function
receipts supersede the earlier outstanding local rehearsal notes. They remain disposable evidence;
shared schema/version reconciliation, hosted CI and actual Claude acknowledgement remain held.

## Results

Baseline before application edits: 35 failures and six passing controls across 41 actual-hook React
cases. Review added further tests, including five failures on the intermediate candidate and one
abandoned concurrent-render failure before their fixes. Initial CLI configuration errors are excluded
from product evidence. The expanded independent Chrome baseline reports 12 failures and two passing
positive controls across 14 cases against entry HEAD `1a3e51875`. Both browser controls complete a
normal outgoing/incoming setup. No browser page errors or external requests occurred, and the owned
browser/server closed.
The baseline hook hash is `c30722c811c63b2db765237d0174131fd59b7cf5c9d5b6e3e0896ba3526fc3da`.

The final implementation claims a unique session before setup begins, guards every held completion
and failure, keeps ICE buffers with their own session and stops newly returned obsolete streams.
Identity is updated at layout commit, so an abandoned render cannot invalidate the committed call.
Decline and accepted-elsewhere cleanup invalidate a pending answer. WebSocket readiness waits are
cancelled and settled on cleanup. End signaling occurs only after an outgoing offer was sent, or for
a received incoming call, so cancelling local setup does not send an unsolicited remote hangup.

Final verification on source SHA256
`808a5a1eec5c55ab8127e5b398222f28c8f4ce1e0f888f98f53bc0560fdc0186`:

- 55 new actual-hook cancellation cases and eight unchanged lifecycle cases pass; independently
  repeated in a separate Jest cache, **63/63**.
- Combined previous 103 cases plus 55 new cases: **158/158 across 12 suites**, using UTC. These totals
  overlap; 63 focused hook cases are a subset of 158, not additional product tests.
- Actual hook in Chrome: **14/14**, versus baseline 2/14. Every scenario finishes with zero owned
  intervals and answer timeouts. Zero page errors/external requests; browser and loopback server closed.
- Targeted lint passes. Full repository lint ratchet passes 1,590 files with the retained 86 errors
  and 907 warnings; no rule exceeds its baseline. Whitespace check passes.
- Hook length: 636 lines. The ICE configuration text and retained lifecycle test are unchanged.
  All 12 first-batch application fingerprints still match. One application source file changed here.

Evidence: [baseline browser results](evidence/2026-10-29-call-cancellation/browser-baseline-results.json),
[final browser results](evidence/2026-10-29-call-cancellation/browser-results.json),
`frontend/src/hooks/useWebRTCCall.cancellation.test.js`, and the structured verification summary in the
same evidence directory. Original test/build logs remain private, outside tracked evidence.

From `frontend/`, run CRACO Jest with `CI=true`, `TZ=UTC`, `--watchAll=false --runInBand --watch=false`
and `--testPathPattern=useWebRTCCall.(cancellation|lifecycle)`; use a writable worktree cache.
Browser replay from the repository root:
`node docs/audits/evidence/2026-10-29-call-cancellation/verify_browser.cjs <private-output-directory>`.
For historical baseline replay, add `--baseline --baseline-ref=1a3e51875a90553d97fc637b4640bf02b3be656e`.
The verifier holds historical source in memory and removes ICE configuration before bundle output.

Production frontend compilation passed (exit 0) by 23:18 UTC on the unchanged source fingerprint.
Source maps and the duplicate build-time ESLint plugin were disabled to keep output/cache local;
the separate full lint gate passed. No backend source changed and no backend/PostgreSQL tests were
repeated for this hook-only continuation. No files were staged, no commit was made, and no shared
source integration or release occurred.

Final governance readback: canonical ledger 2,074 entries intact; branch fragment check zero
problems; docs-only memory audit 0 failures, 64 existing warnings and 12 notes. Local report links,
source/test/fixture fingerprints, unchanged HEAD and empty staging were verified. The existing memory
extension note, combined handoff and own session log record completion and uncommitted status.

This selected queue item is complete. The integration/release coordinator and database owner retain
shared schema/version and release decisions; hosted CI and actual Claude acknowledgement are pending.
The separate protocol, reconnect, camera-control and active-negotiation recovery issues require their
own scope/ownership decision. No further repair was started to keep the lane active.


## Focused local packaging authority

The owner subsequently authorised focused local commits, superseding the earlier local no-commit
hold. The approved 12-path source/test/evidence/documentation allowlist is recorded in
`evidence/2026-10-29-call-cancellation/verification-summary.json`. The entry index was empty.
All five tested source/test/fixture fingerprints match the retained final receipt; existing test,
Chrome, build and lint results are reused rather than represented as new executions.

The mandatory hook is unchanged: a redacted staged-diff secret check and Python LOC guard remain
enabled. No network/active security probe, hook bypass, publication, integration or shared schema
operation is part of packaging. The seven earlier commits are preserved without rewrite. The exact
new commit and final index/worktree state are read back by the delivery action and reported separately.
