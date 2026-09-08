# Repair PR delivery

The implementation inventory is PACKAGE_FILES.json. REPAIR_PACKAGE_HANDOFF.md records the local verification verdict before this branch was committed. All package-*.log/json/xml files it references are preserved verbatim in verification-evidence.zip; weather-repair-review.zip is the original source snapshot. Archives avoid rendering thousands of test-log lines as code-review changes.

This PR targets dev; do not merge until exact-commit CI is reviewed. It does not deploy or close scientific objectives. Broader local Brain/evidence reconciliation and unrelated skills are deliberately not included. New implementation and regression test files are included.
