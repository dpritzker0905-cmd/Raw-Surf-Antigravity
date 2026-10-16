# Payment / existing budget integration candidate

The isolated branch codex/payment-budget-integration combines the frozen PR333 payment
repair with DEV48284a5e3 (including PR335/336/337 and the later beach-field contrast fix). It changes no wind source,
provider settings, credentials or live state. PR333 remains bd7920fbd and is not rewritten.

Thirty-four imported payment paths are byte-identical Git blobs. The four adaptations are
CI floor/workflow qualification, floor reference and migration readiness checks. A new
payment_budget_merge_001 joins checkout_intent_001 and6b8bb9b66da7 without DDL. Existing
migration parents and the released budget migration remain unchanged. From the reported
baseline6b/a107/avatar, only payment_reconciliation_001, checkout_intent_001 and the merge
run. No stamp is proposed for a live database.

Regression before: combined graph had two heads. After: source0597cedd2 passed all18
hosted checks across six workflows. Declared Python3.12 matched46/46pins; real PostgreSQL
123 passed/0skip including initialized budget row/schema/RLS/ACL/identity and commerce
preservation. Payment UI19tests and production-bundle browser42 local fixturecases passed.
Full frontend437suites/5589tests and build passed. Estate1809pass/2880expectedskips,
315selected/313producing/0silent; chain2444pass; simulation2658pass/66skip/1existingxfail;
budget PostgreSQL33pass. Both CI count projections are confirmed; floors1807 and437/5589.
Local floor controls36 passed. Windows missing PyYAML and restricted native-shell failures
remain documented local limits; full declared hosted checks passed. The final evidence
commit changes documentation only and preserves the qualified application/tests/workflows.

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
