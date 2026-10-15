# Payment and budget migration integration

Owner: "ok move forward" after the isolated integration packet. This authorizes this candidate,
local verification and the previously requested repair publication. Shared database writes,
DEV merge, deployment, Render/config/credential changes and wind changes remain held.

## Candidate and reproduced gap

- New branch codex/payment-budget-integration starts from latest DEV5ec87562d (merged PR337),
  preserving frozen PR333 at bd7920fbd. No old PR333 ledger suffix was imported.
- Imported only the qualified source/test/CI patch. Thirty-four payment paths retain exactly
  their frozen Git blobs. Four qualification files adapt graph/floor/workflow checks; one new
  no-DDL merge revision joins checkout_intent_001 and6b8bb9b66da7. Manifest:
  docs/audits/evidence/2026-10-15-payment-budget-integration/source-manifest.json.
- Correct-directory regression RED: one graph control failed because there were two heads,
 6b8bb9b66da7 and checkout_intent_001, before the merge revision was added.
  Initial root-directory attempts failed collection and are not regression evidence.
- Migration fixture now applies real budget DDL once in an owned disposable database,
  seeds a synthetic initialized reservation, then upgrades the reported baseline heads
 6b8bb9b66da7/a107b7db4f12/avatar_url_text_001. It checks exact pending revisions,
  unchanged budget relation/schema identities, row, RLS/ACL, existing commerce rows and
  restricted payment access, then repeats the target to prove no replay/reset.
- Paired estate projection1650+159=1809, floor1807; frontend434+3=437 suites,
 5568+19=5587 tests. Hosted measurement must confirm both projections.
- Local floor controls36 passed. Local broad estate stopped during collection because this
  interpreter lacks PyYAML; it is not a qualified estate run. Local full frontend initially
 436 suites/5575 tests passed plus12 native-shell failures; elevated full rerun in progress.
- Starting canonical memory audit:0 FAIL/14 inherited WARN/24 NOTE. Existing weather
  commitments remain with their owners. No served forecast number changes; no scoreboard row.

## Release boundary

The retained cap rollout report says the executed build stamped history despite Settings
showing upgrade; the cause remains unexplained. The owner reports a later bounded real-DDL
repair and the three baseline heads above. These are retained owner receipts, not a fresh
hosted readback in this session. Budget behavior/spend must not be retested or reset here.

Before live approval: exact combined CI, fresh actual DB identity/history/schema/access,
verified backup and populated-record recovery, deterministic migration execution, operator
coverage and coordinated shared-backend/frontend acceptance remain required. Alembic env
opens its own connection; an outer connection attribute does not currently govern it.
Startup metadata creation can mask migration drift. Do not stamp or downgrade populated
payment tables. No shared service, provider or live database request was made in this work.

## Local verification checkpoint

Real disposable PostgreSQL gate123 passed/0 skipped in261.13s, including combined migration
and initialized budget preservation; optimized production build exit0. Existing Python
runtime still lacks9 declared packages: these are local behavior receipts, not parity proof.
The exact hosted candidate must independently pass strict parity and all release workflows.

## Publication and concurrent DEV sync

Published source aa7845039 as draft PR339; PR333 stillbd7920fbd. Full unrestricted frontend
437 suites/5587tests passed. Draft initially had no CI because DEV advanced to48284a5e3
with the vision beach-field fix, creating ledger/STATE conflicts. Synced that source unchanged;
kept DEV ledger as exact prefix and reconstructed only this lane's two actions via CLI.
The two additional board theme cases project437suites/5589tests now; hosted must confirm.
Budget reservation figures from earlier retained receipts are historical; no cap read/reset here.
Owned disposable PostgreSQL stopped and port no longer listening after123/0skip proof.
