# Payment / existing budget integration candidate

The isolated branch codex/payment-budget-integration combines the frozen PR333 payment
repair with current DEV5ec87562d (including PR335/336/337). It changes no wind source,
provider settings, credentials or live state. PR333 remains bd7920fbd and is not rewritten.

Thirty-four imported payment paths are byte-identical Git blobs. The four adaptations are
CI floor/workflow qualification, floor reference and migration readiness checks. A new
payment_budget_merge_001 joins checkout_intent_001 and6b8bb9b66da7 without DDL. Existing
migration parents and the released budget migration remain unchanged. From the reported
baseline6b/a107/avatar, only payment_reconciliation_001, checkout_intent_001 and the merge
run. No stamp is proposed for a live database.

Regression before: combined graph had two heads. After: real disposable PostgreSQL123
passed/0skip, including real upgrade, initialized private budget reservation/RLS/ACL/identity
preservation, retained commerce rows and repeat-upgrade safety. Floor controls36 passed;
production build passed. Full frontend rerun and all exact-source hosted checks pending.
Local interpreter lacks9 declared packages; estate collection hit missing PyYAML. Counts
437suites/5587frontend and1809estate are projections until fresh hosted confirmation.

[Source manifest](evidence/2026-10-15-payment-budget-integration/source-manifest.json).
[Verification](evidence/2026-10-15-payment-budget-integration/verification.json).
[Append-only session receipt](../weather-program/log/2026-10-15-payment-budget-integration.md).

## Live release holds

- Fresh actual DB identity, heads, schema, constraints/indexes/RLS and effective privileges,
  including the owner's repaired budget baseline; configuration alone is insufficient.
- Verified backup and recovery for populated checkout/case/commerce/budget records; no automatic
  downgrade/drop or whole-DB restoration over concurrent writes.
- Deterministic reviewed migration execution and startup behavior. The retained cap rollout
  reports Settings said upgrade but build executed stamp; cause remains unexplained. Current
  Alembic env opens its own connection; config.attributes connection is not consumed. Startup
  metadata creation can hide drift and cannot qualify Alembic history.
- Operator scan/case/refund coverage, historical orphans, deployed webhook/return and whole-app
  acceptance; coordinated shared backend and authorized frontend rollout. No extra cap test.

This candidate is for review/CI. Do not merge DEV, migrate the shared DB or deploy from this
report. Claude's wind work and all existing weather commitments retain their owners.
