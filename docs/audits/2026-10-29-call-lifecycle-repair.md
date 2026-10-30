# Calling lifecycle repair — October 29, 2026

Local follow-up to the consistency repair, authorized by the owner to use the remaining time before
18:30 UTC (2:30 p.m. America/New_York). Source base: `3f3ebeed8` on
`codex/audit-repair-20261029`.

Saved repair commit: `1056b4f7b`. The [combined two-batch handoff](2026-10-29-consistency-call-handoff.md)
records completed work, exact ownership, evidence limits and the next unrepaired issues.

## Audit and ownership

The October 26 continuation audit, sections “Direct messages: outgoing-call timeout ownership”
and “Calls: connection timer and quality monitoring,” identifies stale outgoing-call timeouts and
duplicate duration/quality monitors. The pre-repair source retained both defects.

The other chat, “Audit each app feature,” was freshly inspected at 18:19 UTC: its current work is
Saved Crew request lifecycle. A read-only Git comparison lists 59 changed files in its checkout;
`frontend/src/hooks/useWebRTCCall.js` is absent. This follow-up owns only that application source
file plus new tests/evidence. No changes are made to the other checkout or weather source.

## Verification scope

Actual React hook tests and a separate Chrome fixture use synthetic peer connections, media,
signaling, API responses and clocks. They never obtain a microphone/camera, contact a call provider,
or send a message. The browser fixture removes the pre-existing ICE configuration at build time,
so provider configuration is not reproduced in fixture artifacts.

Reflection Beam provided an advisory second opinion on timer/peer ownership, duplicate events,
late asynchronous results and teardown. Local independent review covers the implementation.

Real device media, NAT traversal, hosted signaling and deployed end-to-end calls remain unverified.
The signaling protocol lacks per-call identifiers; delayed network messages across calls and
signaling reconnect behavior are separate from this bounded timer/peer lifecycle repair.

## Repair

Outgoing timeouts are retained and cleared on cleanup, answer and connection. Their callback checks
that the original peer is still active; end signals read the current recipient ref. Both connection
event paths start the same idempotent duration and quality monitors. Cleanup nulls timer refs,
detaches peer handlers before closing, and resets the corresponding ownership refs. Retired peer
callbacks and late quality results cannot overwrite the new call. Offline retries are coalesced and
bound to their original offer.

The asynchronous media acquisition and SDP setup paths are not generation-fenced by this change.
Cancellation while those setup promises are pending remains a separate known issue. No whole-call
reliability or security/provider acceptance is claimed.

## Results

- Focused actual-hook React tests: eight passed. The original five were independently repeated;
  three added cases cover late statistics, ICE-first ordering and offline retry coalescing.
- Final combined frontend regression run: 103 passed across 11 suites, including the previous 95 tests.
- Independent Chrome: four scenarios passed, no page errors or external requests; the owned browser
  and loopback server closed after verification.
- Repository-wide lint ratchet: 1,589 files, no increased rule bucket. Existing debt remains
  86 errors and 907 warnings; this is a ratchet pass, not a zero-warning result.
- Git whitespace check passed. Source SHA256:
  `c30722c811c63b2db765237d0174131fd59b7cf5c9d5b6e3e0896ba3526fc3da`.

The first Jest baseline attempt was invalid because CRA reset the media mock implementation.
It is not evidence of a product failure. The corrected fixture passed against the repair.
The independent Chrome fixture against the pre-repair Git source then reproduced the actual defect:
after A ended and B started, crossing A's original deadline left B idle instead of outgoing. The same
fixture passes all four checks on the repaired source. Sanitized evidence and replay scripts are in
`evidence/2026-10-29-call-lifecycle/`. The verifier's `--baseline` reads Git HEAD; it selected the
pre-repair source when this evidence was recorded, but current HEAD now includes the repair.

The docs-only memory audit reports 0 failures, 64 warnings and 12 notes (unchanged from the prior
closeout). Production frontend compilation completed successfully (exit 0) by 18:28 UTC on the
frozen source. As in the preceding repair, source maps and the duplicate build-time ESLint plugin
were disabled to keep outputs/cache inside this worktree; the separate repository lint gate passed.

Local verification commands (from `frontend/`): CRACO Jest with `--runInBand --watchAll=false
--testPathPattern=useWebRTCCall.lifecycle`; `node scripts/check_eslint.js`; CRACO production build.
Browser replay from the repository root:
`node docs/audits/evidence/2026-10-29-call-lifecycle/verify_browser.cjs <private-output-directory>`.
Add `--baseline` to reproduce against the Git HEAD version before the repair commit; after committing,
the baseline is historical and should be run in a checkout at the recorded source base `3f3ebeed8`.

No backend source changed, so the preceding PostgreSQL/backend checks were not repeated for this
hook-only change. No served weather number changed. Local branch only; no push, merge or deployment.
