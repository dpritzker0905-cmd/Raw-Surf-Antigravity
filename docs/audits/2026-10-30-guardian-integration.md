# Guardian recovery and purchase-decision integration

Status: locally qualified candidate on current DEV; hosted CI and deployment acceptance are separate gates.

## Ownership and integration base

The file owner froze and released the guardian batch from `codex/guardian-controls-load-recovery-20261030` at base `fb2d2e5def5ec8bcea1b2a39918f7740ba034a90`. The frozen manifest has SHA256 `bdf2e80e9ebb2e1ce0e4c499290e999527b2f8288de21c69bd3cce9add822ca8`; all 25 listed source hashes were checked before transfer. The separate PR643 deployment report was excluded. The two CI files were rederived semantically rather than copied wholesale.

Integration uses `codex/guardian-purchase-integration-20261030`, based on DEV `e36c019b1edc2aa59d3814ea189236a487aeb945`, which already contains the completed support retry repair. The original owner worktree remains intact. Three bounded agents handled purchase decisions, independent review, and integration/CI gates; the coordinator independently ran combined checks and browser scenarios.

## Resulting behavior

- Guardian settings show explicit loading/error/retry states and expose editing only after both reads succeed. Abandoned child/parent responses cannot replace the selected settings; stored zero spending values remain visible. Form controls have meaningful names and associations.
- Linked-Groms and Family Activity read failures show recovery controls instead of falsely reporting an empty family or activity history. Competition switches expose their checked state and prevent duplicate saves for the same child.
- Linked-child responses include the already stored `elite_tier`, so Competition Mode reads back the saved state after refresh. The backend runtime change is one DTO field; no schema, migration, authorization or spending-policy change is needed.
- Purchase queue reads distinguish failure from a successful empty result, hide stale rows/counts while unavailable, and reject obsolete filter responses.
- Purchase decisions use a synchronous per-request guard shared by approve and deny. A second request may proceed independently; completing or failing one cannot unlock the other. A failed action can retry without losing its request or another request's denial draft. Decision controls have contextual names containing their visible action text.

The new action repair preserves the frozen queue-read/generation guard and status-badge function byte-for-byte. Existing approve/deny endpoint, parent identifier and encoded-reason contracts are exercised with fictional data; no real decision was submitted.

## Fresh verification

- The independent reviewer freshly passed the original 66 tests across seven suites. The final 14 action cases were run unchanged against both sources: the frozen component passed four characterization cases and failed ten targeted regressions; the repaired component passed all 14.
- The coordinator's final combined run passed **80/80 tests across eight suites**, with zero failed or pending cases. Action tests cover same-batch duplicates, independent request locks, both completion orders, failure/retry, row/count preservation, encoded reasons and cross-row draft/editor preservation.
- The controlled backend/floor run passed **37/37 pytest items**, with backend startup, conftest and unrelated plugins disabled. Its durable wrapper executes eight positive checks using selected actual handlers and disposable SQLite. Two configuration warnings arise from deliberately disabling the asyncio plugin. An earlier worker's sandboxed fixture attempt produced no result and was stopped; it is not counted as a pass.
- Actual Chrome ran the final component/shared theme and UI bundle in light, dark and beach themes at 1280x720 and 390x844: **six scenarios passed**. Each covered simultaneous approvals, completion isolation, rejection/retry, simultaneous denial drafts, draft preservation and encoded reasons. Space and Enter worked. No horizontal overflow occurred. All 36 decisions were in-memory promises, with CSP `connect-src 'none'`; no live account, API or financial transaction was connected. The fixture tab closed, viewport reset and owned listeners stopped.
- Scoped ESLint over 12 changed source/test files reported zero errors and two retained GromHQ warnings. The full repository lint-debt gate passed without baseline modification. Fatal Python lint and whitespace checks passed.
- Independent review found no blocking action/draft/contract defect. The contextual button and reason-input names were aligned with visible labels before the final combined run and browser build.

## Hosted CI and release gates

Successful DEV run `41148501823` at the integration base reported 3,405 estate tests. The one new backend pytest item projects 3,406; the paired reference and estate floor are 3,406 and 3,404, preserving margin two. Lane partitioning selects the wrapper exactly once. Hosted CI must confirm the projection.

The existing frontend CI command continues to run the full suite. Its existing JSON-results gate now also requires each of the eight guardian suites exactly once, passing, nonempty and unskipped. No job, duplicate test execution or weaker aggregate floor was added. The inline validator passed 21 synthetic-report checks. Local Windows CRA discovery returned an empty list under the repository's documented glob limitation; that is not treated as hosted execution evidence.

Local Node was 24.21.0; hosted CI uses the repository's 24.22.1 pin and remains the build authority. Installed dependencies were reused through an ignored worktree junction; no dependency or lockfile changed.

Before release: bind the committed tree to this source, pass exact-head hosted CI, obtain the current scope-specific Claude restart window, verify the actual existing DEV deployment targets, then merge normally and monitor the resulting automatic deployments. Preserve the applied support migration; this batch requires no DDL. Main promotion is separate. No weather code, flags, jobs, policy, provider settings or mail behavior is included.

This is local synthetic and source evidence, not real-account, child-access, financial/provider, physical-device or production-main acceptance. Deployment results belong in the separate release closeout.
