# Grom Community Preview read and count recovery

## Ownership and status

Local repair on `codex/grom-preview-read-recovery-20261030`, base `a8e6d0c7f071578a4200f7881f35f41b9adeb7e8`, in a new isolated checkout. Source/test/lint/forensic and browser checks pass. This slice is uncommitted and undeployed.

David asked the two repair chats to work together. The coordinator owns invitation integration, CI/shared runner, publication/release and its browser checks. Root owns only GromLimitedFeed.js, its new focused test and this report. Root retains the native Claude relay. Frozen invitation and historical guardian worktrees stay untouched. This work runs in parallel with invitation qualification rather than overlapping its files or release operations.

## Confirmed problem and repair

The original audit found that a failed `/posts/grom-preview?limit=3` read became an empty list and displayed "No Grom Posts Yet." The header always said "3 POSTS," even for zero, one or two returned posts or a failed/pending request.

The preview now distinguishes pending, failed and successful reads. A semantic error and native Retry button recover through the same limited GET endpoint. Counts are hidden while pending/failed and use the successful returned length, with "1 POST" versus plural labels. A read-generation guard and effect cleanup reject abandoned successes/failures and prevent an old completion dismissing the current loading state.

The child-link panel, code/answer handlers, guardian level display, parent-link/locked-feature guidance, backend/access policy, media rendering and disabled post actions are unchanged. No capability is unlocked by retry. The media section is independently byte-equal before/after, and reversing the entire read/count slice reconstructs the original component exactly.

## Local verification

- Qualified pre-repair baseline: 12 new regression failures, one existing three-post count characterization pass, and all 80 retained guardian cases passed. Final: 93/93 cases across nine suites.
- Cases cover failure without false empty/count, positive retry, successful empty retry, announced pending initial/retry state, repeated failure, abandoned effect success/failure/completion during a newer pending request, and actual 0/1/2/3 counts with singular/plural text. New cases make no mutation calls.
- The unit fixture explicitly substitutes the unrelated child-link panel with a sentinel control. Its behavior is not inferred from that mock; the existing retained guardian tests cover it, and browser qualification uses the actual child panel.
- An initial unqualified run had a timing error: the old hardcoded three-post badge resolved before rows arrived, making the characterization assert too early. It also exposed unrelated child-panel effect noise. The fixture was corrected before runtime edits; the original component was rerun to establish the qualified baseline above. Initial artifacts are retained separately and excluded from product regression counts.
- Scoped component/test lint: zero errors and warnings. Whitespace check exit 0. GromLimitedFeed is 226 lines, below the 800-line cap.
- Current component SHA256 `8a30a45b08e4dc34841b5317efbec31c73a17546ef77f2155e0b29da0825b241`; original SHA256 `7b1e0cb590097d1541479d2b3fb238698c8a69ffb2d37f98d1db3e3528e329fd`.
- AskMyParentPanel, CI and the shared portable guardian runner are unchanged in this checkout. All five files in the frozen invitation manifest retain their hashes. A private runner selects the 13 new preview cases and the 80 merged guardian cases; these totals overlap other batch totals and must not be added together.

## Browser qualification

The integration coordinator explicitly granted a temporary browser/viewport window while PR645 entered hosted CI. Actual Chrome ran the actual GromLimitedFeed, child panel, shared UI and theme bundle with fictional GET responses and network connections blocked by fixture CSP.

All six cases passed: light/dark/beach at 1280x720 and 390x844. Failure displayed an error without a fabricated post count; the actual child code control remained available. Enter Retry announced loading and hid Retry until completion. Successful reads rendered the actual 1/2/3 post count, including singular "1 POST," and the fictional rows. Each case recorded two preview reads and zero writes. The intended theme and no recovery-screen horizontal overflow were verified from the DOM.

Additional mobile checks passed Space Retry, repeated failure, and a successful empty result showing "0 POSTS" and the real empty-state text. Three preview reads, zero writes. No code was generated, invitation answered or live account opened. The fixture server stopped, port 63154 has zero listeners, its tab closed, viewport reset and exclusive browser ownership explicitly returned to the coordinator before its release/provider work.

## Evidence and boundaries

Private `grom-preview-read-recovery` evidence includes `PLAN.md`, `before.js`, `baseline.json/log`, `final.json/log`, `initial-unqualified-baseline.json/log`, private `run-tests.cjs`, `verify-preservation.py`, `preservation.json`, `verify-lint.cjs`, `lint-preservation.json`, `browser-results.json`, `browser-extra.json`, `error-proof.png` and the loopback fixture source/build. The private runner points at this checkout and installed frontend dependencies; it does not alter integration-owned test discovery.

The shared repair handoff, plan and memory record the parallel work and coordinator's exact PR645 no-restart plan. A native Claude relay was attempted only after an empty composer readback, but unreliable input geometry/focus prevented sending; no paste or Return was executed. The relay is pending, not acknowledged. The coordinator was informed and retains the release/CI/provider checks; no new restart clearance was requested or inferred.

This slice has no commit/push/release delegation. No real accounts, code generation, link/invitation answers, financial actions, backend startup, provider change, security probe or weather work occurred. The original media-preview and placeholder comment-count findings remain outside this bounded read/count repair.

## Fresh forensic recheck and integration handoff

At David's subsequent request, freshly reran all 93 cases across nine suites: 93 passed, zero failures. Re-ran exact slice reversal, independent media equality, frozen invitation hashes and scoped component/test lint: all passed, with zero lint errors or warnings. The prior six-case browser evidence was checked by the verifier; browser scenarios were not unnecessarily repeated while the coordinator owned provider UI.

The qualified three-file slice is being frozen for integration coordination: this report, GromLimitedFeed.js and GromLimitedFeed.recovery.test.js. The private `frozen-manifest.json` binds their exact SHA256 values and base. Root stops source/test/report edits after creating that manifest; the original checkout stays intact. The coordinator must copy only those files into a fresh current-DEV-based integration branch and requalify the combined state. Its CI and shared-runner updates remain coordinator-owned.

Fresh receipts are `reverify.json/log`, `preservation.json` and `lint-preservation.json`. This handoff does not itself authorize publication, merge or deployment, and does not reuse PR644 restart clearance. The direct Claude relay remains pending a safe native UI window; shared coordination records the current plan without claiming delivery or acknowledgment.
