# Guardian competition mode survives refresh

After the guardian form-label repair passed a fresh 28-test recheck and exact-source preservation check,
the next normal family workflow finding was reproduced: the linked-child response omitted `elite_tier`.
GromHQ uses that stored value for both the Competition Mode display and its next toggle intent. Saving
could succeed while a subsequent refresh displayed the child as not competing.

The runtime repair adds one field, `elite_tier`, to each existing linked-child response in
backend/routes/grom_hq/parental.py. It returns the existing stored value including null. No toggle,
guardian-link rule, permission, profile model, financial policy, migration or frontend code changes.

## Verification

- Selected actual read/toggle handlers, role enum, request declaration and confirmed-link predicate with
  disposable async SQLite: **3/8 before, 8/8 after**. Checks cover stored null/enabled/other values,
  enable/read/disable/read across fresh sessions, the next inverse toggle intent, unchanged other-child
  metadata/aggregate figures and a normal new guardian's empty list.
- The profile mapping, standing calculation and pending-invite metadata are explicit fixture seams.
  These are ordinary positive flows for fictional preconfirmed families. No app/env/scheduler startup,
  authentication probe, denial/bypass scenario, actual family data, provider or live request occurred.
- Durable subprocess regression plus paired test-floor checks: **37 passed**, with two expected config
  warnings because unrelated asyncio plugins were disabled. Its one pytest item executes the same eight
  fixture checks; these counts overlap and are not an additive total.
- The new test was staged only so the project's tracked-file CI selector could claim it. Estate selection
  includes the new file. Both paired floor values increase by exactly one, retaining margin two:
  projected 3406 / floor 3404. Hosted CI must confirm or rederive this after later DEV changes; no hosted
  acceptance is claimed. No guard/chain selection or floor changed.
- Scoped fatal Python lint and whitespace checks pass. Removing the one response-field line reconstructs
  the original parental route file exactly. The unchanged GromHQ consumer and prior guardian repair are
  bound in the private forensic receipt.

This is local source/persistence verification, not mounted authentication, native PostgreSQL, full-browser
GromHQ or deployed acceptance. Previous form-label Chrome receipts remain historical to that repair;
they are not claimed as browser verification of this API change.

Evidence: retained eight-case fixture in evidence/2026-10-30-guardian-competition-readback/verify-readback.py;
private baseline/final JSON, JUnit, preservation hashes and plan under the session's
guardian-competition-readback folder. The new durable test is test_guardian_competition_readback.py.

Source remains uncommitted on the existing isolated guardian branch. Shared handoff, memory and actual
Claude coordination are updated. No source overlay, commit, push, migration, backend restart, deployment,
security probe, weather-source change or served-weather-number change.

The separate support-retry owner has native authorization in its own chat to prepare ordered integration;
that lane owns its route/model/migration and must verify current deployment/database identity and apply
its approved additive migration before its new ORM is deployed. This guardian batch is excluded from that
integration until separately reviewed. No cross-chat relay is used as execution approval here.
