# Family Activity failure recovery

## Status and scope

Local repair on `codex/guardian-controls-load-recovery-20261030`, base `fb2d2e5def5ec8bcea1b2a39918f7740ba034a90`. Uncommitted and undeployed. This follows the guardian Competition Mode repairs; PR643's separate deployment is documented in `2026-10-30-pr643-deployment-verification.md`.

The audit found that a failed family-activity read was converted into an empty list and displayed as "No recent activity from your Groms." A failed refresh also discarded the previous result without explaining the failure.

## Repair

`GromHQ.js` now distinguishes loading, failed and successful-empty reads. A semantic alert and native, keyboard-operable "Retry family activity" button recover through the same GET endpoint. Pending or failed reads hide stale rows/counts and the old Refresh control. Successful empty results retain the existing empty state. `grom/FamilyActivityError.js` uses the shared Button and theme tokens. GromHQ remains 792 lines, below the 800-line cap.

The endpoint, permissions, activity interpretation, other guardian handlers and competition toggle behavior are preserved. No backend, scheduler or weather code changed in this slice.

## Verification

- Eight new regression cases failed against the pre-repair component; the 37 retained guardian tests passed. After repair: all 45 tests passed across five suites.
- Coverage includes initial failure, nonempty recovery, successful empty retry, refresh failure hiding stale rows/counts, pending status, repeat failures across three themes, and zero write requests.
- Actual Chrome ran the actual GromHQ/shared UI bundle with fictional API responses and network connections blocked by fixture CSP. Six combinations passed: light/dark/beach at 1280x720 and 390x844. Each failure displayed its recovery state, keyboard Enter restored a fictional post, and all checks retained zero writes. Desktop additionally verified failed refresh, Space retry, and a successful empty result. Theme classes and lack of horizontal overflow were read from the DOM.
- Exact reversal of this slice reconstructs the prior GromHQ SHA256 `3240b078c4a74794bf8b678523532b304e7d91ed2b39f111beb1d7232208be17`. GromManage and parental readback source hashes remain unchanged. Current GromHQ SHA256: `c4a82fa1028afb82c8e05d624257076d5fa887e8cafb1b8bba220bc713f581dd`.
- Scoped lint: zero errors, two existing GromHQ warnings, no new diagnostics; new component/test have zero diagnostics. Existing HEAD had three warnings. Git whitespace validation passed.
- Browser viewport reset, fixture tab closed, loopback server stopped and port 63565 confirmed absent.

## Reproduction and evidence

Run `docs/audits/evidence/2026-10-30-guardian-load-recovery/run-tests.cjs` with `RAW_SUPPORT_TEST_DEPS` pointing to installed frontend dependencies and `RAW_GUARDIAN_TEST_OUTPUT` to a disposable output directory. This standalone runner avoids full application/backend startup.

Private evidence under `guardian-controls-recovery`: `activity-baseline.json`, `activity-final.json`, `activity-browser-results.json`, `activity-error-proof.png`, `verify-activity.py`, `activity-preservation.json`, `verify-activity-lint.cjs`, `activity-lint-preservation.json`, and the loopback fixture source/build. The portable regression tests remain beside GromHQ.

These are local fictional component/browser results, not hosted acceptance or real family history verification. No security probes, live writes, provider sends, deployment, restart or weather work occurred.

## Next boundary

This surgical slice is complete locally. Guardian integration must rebase/requalify the combined batch, regenerate projected estate-floor evidence against its actual target and pass hosted CI before a release decision. Do not mix this batch into PR643 or replay its migration. The remaining linked-groms load-error masking is a separate candidate requiring its own focused recovery design and verification.

Continuation: Family Activity was freshly reverified at 45/45 tests with its exact preservation check before the next edit. Linked-Groms load-error recovery is now repaired and qualified locally in `2026-10-30-linked-groms-recovery.md`; the combined suite is 55/55. Reversing only that subsequent slice reconstructs this report's qualified Family Activity component SHA256. Neither local slice has been deployed.
