# Repair PR delivery

The implementation inventory is PACKAGE_FILES.json. REPAIR_PACKAGE_HANDOFF.md records the local verification verdict before this branch was committed. All package-*.log/json/xml files it references are preserved verbatim in verification-evidence.zip; weather-repair-review.zip is the original source snapshot. Archives avoid rendering thousands of test-log lines as code-review changes.

This PR targets dev; do not merge until exact-commit CI is reviewed. It does not deploy or close scientific objectives. Broader local Brain/evidence reconciliation and unrelated skills are deliberately not included. New implementation and regression test files are included.

## PR CI follow-up

The first PR run exposed a frontend LOC regression: marineGridSeries.js reached 810 lines. The earlier backend-only size check did not cover this frontend ratchet. Extracted frame conversion unchanged into marineSeriesFrame.js; full local frontend tests pass (247 suites / 2,372 tests), the full LOC ratchet passes, and ESLint baseline passes. PR_FOLLOWUP_FILES.json inventories the two revised files; pr-loc-evidence.zip preserves rerun evidence. The original inventory/ZIP remains the initial snapshot, not the latest head. Linux CI is rerun on the follow-up commit.
