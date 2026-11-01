# Linked-Groms load-error recovery

## Result and scope

Local repair on `codex/guardian-controls-load-recovery-20261030`, base `fb2d2e5def5ec8bcea1b2a39918f7740ba034a90`. The guardian batch remains uncommitted and undeployed; PR643 is a separate completed support release.

A failed linked-Groms read previously cleared children and pending requests, then displayed the regular dashboard. This falsely implied an empty family and could expose default or stale totals and inappropriate empty-family actions. The same fetch is used after link/unlink readback.

`GromHQ.js` now records a failed read and gates the derived dashboard behind an explicit recovery screen. `grom/LinkedGromsLoadError.js` provides a semantic alert, native "Retry linked Groms" and "Back to Settings" buttons using shared theme tokens and Button. Pending reads have an announced loading status; Retry is absent while a request is pending. A successful response restores existing children, pending requests, totals and Competition Mode readback; a successful empty result retains the normal empty-family flow.

The existing GET path, response mapping, linking/unlinking handlers, competition writes, backend policy, financial logic and weather code are unchanged by this slice. GromHQ remains 794 lines, below the 800-line cap.

## Family Activity re-verification before editing

- Freshly reran all 45 guardian tests: 45 passed across five suites.
- Re-ran the prior preservation verifier: Family Activity source SHA256 `c4a82fa1028afb82c8e05d624257076d5fa887e8cafb1b8bba220bc713f581dd` matched; reversal reconstructed the preceding toggle repair; GromManage and parental source hashes matched their qualified values.
- This confirms local source/test evidence. The previous Family Activity browser evidence was retained; no hosted acceptance or live family-data claim was added.

## Linked-Groms verification

- Ten focused new tests failed against the unchanged runtime component while all 45 retained tests passed. Failures were missing error/retry/loading behavior, not setup errors.
- After repair, all 55 tests passed across six suites. Cases cover initial failure without false empty/totals/actions, positive retry with linked child/pending request/actual totals/competition state, successful empty retry, pending initial/retry reads, repeated failure in three themes, Back to Settings, and a failed post-link readback hiding stale totals before successful recovery.
- New tests use the actual GromHQ and shared UI with fictional API data. The post-link refresh test invokes the real parent callback through a mocked child panel, without performing a link mutation. API writes remained unused.
- Actual Chrome tested the actual GromHQ/theme/shared UI bundle at 1280x720 and 390x844 in light, dark and beach themes. Each of six cases showed the failed-read alert without empty-family or totals claims; Enter retry displayed an announced pending state with no Retry control; completing the fictional read restored the child, $37 and checked Competition Mode. Each recorded two reads and zero writes. DOM checks confirmed the intended theme and no horizontal overflow in the recovery screen.
- Additional mobile browser checks passed: Space retry, repeated failure, successful empty retry, and keyboard Back to Settings. The fixture used loopback only with CSP `connect-src 'none'`; no live accounts or backend were used.
- Exact reversal of only this slice reconstructs the pre-slice Family Activity component byte-for-byte. GromManage and parental readback source hashes remain unchanged. Current GromHQ SHA256: `2b188a03405a5b69232a31704a910efd884bb0537d68001e5a6d585594be2d5c`.
- Scoped lint: zero errors, two existing GromHQ warnings and no new diagnostics. New component/test have zero diagnostics. Git whitespace check returned 0.
- Fixture server stopped; port 61894 has zero listeners. Browser tab closed and shared viewport reset.

## Evidence and coordination

Private `guardian-controls-recovery` artifacts: `activity-reverify.json/log`, `linked-baseline.json/log`, `linked-final.json/log`, `verify-linked.py`, `linked-preservation.json`, `linked-browser-results.json`, `linked-browser-extra.json`, `linked-error-proof.png`, `verify-linked-lint.cjs`, `linked-lint-preservation.json` and the fictional loopback fixture sources/build.

The portable standalone runner in `docs/audits/evidence/2026-10-30-guardian-load-recovery/run-tests.cjs` now selects the new regression suite. Set `RAW_SUPPORT_TEST_DEPS` to installed frontend dependencies and `RAW_GUARDIAN_TEST_OUTPUT` to a disposable output directory. No full backend/application startup is needed.

Claude's actual desktop chat showed the previous PR643/Family Activity closeout acknowledgment at 00:24Z (8:24 PM Eastern October 30), with weather paused and no checks open. This slice is recorded in the shared repair handoff; an existing user draft in Claude's composer was preserved, so no direct new message or new acknowledgment is claimed. Memory and the local plan are updated separately from weather records.

## Release boundary

Complete locally only. Integration must rebase/requalify the combined guardian batch, regenerate its projected backend estate-floor evidence against the actual target and pass hosted CI before a release decision. No new commit, push, migration, restart, mail send, security probe or weather change occurred. Unrelated age-verification/spending-alert error handling and cross-account request-ordering behavior were not changed or qualified by this slice.

Continuation: linked-Groms was freshly reverified at 55/55 tests and passed its exact-source preservation verifier before the next repair. The subsequent Purchase Requests read-error/filter-order slice is documented in `2026-10-30-purchase-request-read-recovery.md`; combined tests are now 66/66 and all qualified sources from this slice remain unchanged. Neither local repair has been deployed.
