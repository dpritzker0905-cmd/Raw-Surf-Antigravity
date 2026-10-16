# PR339 database, recovery and migration readiness

Verified October16 UTC on the isolated payment branch. No shared database writes,
migrations, deployments, provider configuration changes or paid requests were made.
Claude's wind source, decisions, scoreboard and pending observations remain outside this work.

| Release gate | Evidence and result | Remaining action |
|---|---|---|
| Actual runtime database identity and baseline | PASS at00:38:45Z: primary project, runtime postgres role, PostgreSQL17.6, read-only transaction; repaired three-head baseline and initialized budget verified | Repeat immediately before any authorized migration; stop on drift |
| Existing commerce schema and migration privileges | PASS: seven expected tables/columns, varchar(36) ids and id PKs; public CREATE/USAGE, referenced-table REFERENCES and Alembic version CRUD verified | Verify actual new-table constraints/indexes/ACL/RLS after approved application |
| Existing private budget | PASS: initialized,5100000 microdollars reserved; private schema/RLS/access intact; no unexpected creator default grants | Preserve row and security; never reset/reinitialize or replay budget DDL |
| Migration atomicity and populated recovery mechanics | PASS on synthetic PostgreSQL17.11: injected failure rolls back both payment tables and version changes; exact target, rerun and separate logical restore preserve data/security | This is not a real hosted backup/restore receipt or PostgreSQL17.6 execution |
| Fresh real backup and isolated restore | HELD: seven completed physical snapshots; newest October15 07:57:45Z predates the budget repair; PITR disabled | Verify a newer snapshot includes repaired state, then perform a separately authorized isolated restore |
| Deterministic shared execution | PARTIAL: immutable migration/source manifest and actual-connection timeout mechanics verified locally | Resolve/avoid the historical Settings/build discrepancy through a reviewed explicit artifact execution; no shared execution yet |
| Current combined revision | Reconciliation with DEVae13bade2 includes saved-board clues; frozen PR333 retained | New combined hosted qualification required; old d215 results cannot certify new source |
| Operator and deployed payment acceptance | HELD independently | Establish operator recovery/scan/case coverage and coordinated callback/return/refund/UI acceptance during an authorized release |

## Direct database evidence

The authorized Render shell used its existing DATABASE_URL privately, with read-only
defaults,5s statement timeout,1s lock timeout, explicit rollback and close. No customer
rows or credentials were displayed, exported or stored. Only the non-customer budget
setting row and catalog/schema metadata were queried. Actual runtime source was
a7c038919d7aca8637ea1e5e8981bb2e2331830a.

Live heads:6b8bb9b66da7, a107b7db4f12, avatar_url_text_001. Both new payment tables
are absent. The existing budget row is initialized with$5.10 reserved and$4.90 available
of$10; this is conservative reservation, not confirmed provider charges. Budget RLS is
enabled, FORCE is false, there are no policies, and postgres alone among the checked
postgres/service_role/anon/authenticated roles has private-schema access and table CRUD.
The bounds constraint remains0 through10000000 microdollars. Current role has the
required public and referenced-table privileges. The creator's global/public table
default-grant query returned no entries.

The seven checked tables are profiles, bookings, booking_participants,
payment_transactions, credit_transactions, live_sessions and live_session_participants.
No expected model column was missing; every id has the expected type and primary key.
Catalog relation bytes total4079616; this is neither a logical dump size nor a row count.
Runtime pg_dump is available. These observations are timestamped preflight evidence,
not authorization to migrate or assurance that subsequent live state cannot change.

## Recovery investigation

The provider holds seven daily physical backups, October9 through15. The latest
available restore point is October15 07:57:45Z, before the repaired budget was created
and initialized. PITR is not enabled. A backup existing in the dashboard does not
establish recovery of the latest financial state.

The separate Raw Surf App Dev project is an existing database with its own migration
history, recent requests and active connections. Its health changed from Unhealthy to
Healthy during inspection. A development label or a backup on that project's own page
does not establish that it mirrors the actual runtime primary. The owner subsequently
identified this project as a possible backup; schema verification is recorded separately.
No restore, reset or data mutation was performed there. A bounded read-only SQL Editor
probe at00:54:11Z found profiles/bookings/payment_transactions/credit_transactions,
but no public.alembic_version, private budget, checkout intents or reconciliation cases.
It is not a current recovery copy of the verified runtime primary. BEGIN READ ONLY and
ROLLBACK bounded the probe; no customer rows were read.

Targeted repository/workflow and known local project/backup-directory searches did not
identify an established current Raw Surf PostgreSQL logical-backup destination or
disposable hosted target. Historical website archives are not evidence of a current
database backup. This is a scoped search result, not a claim to have searched every file.

The primary's Restore to New Project confirmation offers an independent project in
the same organization/region, with additional monthly compute$9.68 and disk$0.50:
**$10.18/month displayed total**. Only the preview was opened, then canceled. Nothing
was created or purchased. Reconfirm the quote before any later approval/action.

Recommended route: obtain a completed newer provider snapshot, verify the restored
budget/history and commerce schema in a new unattached project, then rehearse the exact
payment target there. This keeps the data in the existing provider organization and
avoids overwriting either shared database or exporting credentials/customer records to
the computer. Before cloning, recheck external-execution risks and prohibit app startup,
provider SDK calls and external writes. At00:48:03Z pg_cron/pg_net/http/wrappers were
not installed and cron.job was absent; supabase_vault was installed. This is not a full
proof that every restored function is inert.

Alternative: a fresh logical archive in an explicitly secured private destination,
restored to a new loopback-only database with external execution disabled. This needs
a secure transfer route, role/extension/dependency coverage and an independently
recoverable encryption-key plan. None has been established; an ephemeral Render file
or a gitignored plaintext dump would not close the durable backup gate.

Supabase's [clone documentation](https://supabase.com/docs/guides/platform/clone-project)
distinguishes database copies from storage/functions/settings, and warns that copied
external-extension jobs can run immediately. Its [backup documentation](https://supabase.com/docs/guides/platform/backups)
excludes storage object bytes. A database-only drill must not be reported as whole-app
disaster recovery. Logical exports also need attention to roles and encryption keys;
see the [official restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).

## Qualified local recovery mechanics

Two unique owned loopback databases were created and removed; no shared target was
used. Synthetic populated records included2 checkout intents (one creation_unknown),
1 refund_pending case,2 payment transactions,1 credit transaction, profile balances,
booking/participant data and an initialized$5.10 budget reservation.

An injected exception in a temporary migration copy, after the second new table's DDL,
rolled back both payment tables and all version changes. The actual Alembic-created
connection read lock_timeout1s, statement_timeout5s and idle-in-transaction timeout10s.
The unmodified exact migration then succeeded without changing the budget relation/schema
identity, its row or existing commerce. A repeat preserved populated data and security.
Custom pg_dump plus pg_restore --single-transaction --exit-on-error into a separate owned
database preserved logical rows, owners, constraints, indexes, RLS and normalized ACLs,
including PUBLIC, grantors and grant options.

Initial raw ACL comparison differed: explicit owner-only ACL versus an implicit default
after restore. Complete aclexplode/acldefault normalization proved equivalent permissions;
the check was not weakened to ignore grants. The tracked read-only preflight script also
completed and rolled back in this fixture. An initial fixture-only failure named a missing
postgres role; the script now enumerates existing checked roles plus current_user.
Production postgres/service_role/anon/authenticated roles were verified separately.

This drill used PostgreSQL17.11 and preexisting local roles. It does not prove restoration
of the real PostgreSQL17.6 database, global role definitions, Vault encryption roots,
Supabase-managed services or storage objects. Receipts contain hashes and synthetic
counts only; no archive/customer records or credentials are tracked.

## Reviewed future execution procedure — not run on shared DB

The manifest records the qualified d215 backend tree, Git blob identities and archive
checksum. New DEV integration does not alter these migrations. Reconcile the final
release artifact and exact source qualification before execution; never replace the
running source checkout merely to invoke migrations.

1. Obtain an approved fresh-backup/isolated-real-restore receipt and release/operator
   coverage. Repeat bounded read-only identity, heads, table, budget and access checks.
   Stop on any drift. Do not stamp, reset the budget or infer DDL from a version marker.
2. Use a separately staged reviewed artifact and the existing runtime environment
   privately. Do not start/import server startup. Existing Alembic env creates its own
   connection and does not consume config.attributes['connection']; an outer transaction
   or connection-local timeout would not establish protection for it.
3. From that artifact's backend directory, the locally qualified command mechanics are:

   ```sh
   PYTHON_DOTENV_DISABLED=1 \
   PGOPTIONS='-c lock_timeout=1000 -c statement_timeout=5000 -c idle_in_transaction_session_timeout=10000' \
   python -m alembic -c alembic.ini upgrade payment_budget_merge_001
   ```

   Exact pending steps from the verified baseline are payment_reconciliation_001,
   checkout_intent_001 and the empty payment_budget_merge_001. Already-applied budget DDL
   must not run again. A timeout is a stop/reinspection condition, not an automatic retry.
4. After approved commit, read back the single merge head, both new table definitions,
   foreign/unique keys, indexes, owner, RLS and effective grants (including PUBLIC/defaults),
   alongside unchanged existing commerce schema and preserved private budget security.
   Concurrent legitimate budget usage can increase the counter; it must never decrease
   or be reinitialized. Record concurrent activity before interpreting comparisons.
5. If migration fails before commit, verify the original baseline and absence of new
   tables before retry. If additive schema succeeds but app rollout remains held, retain
   it; do not drop populated intent/case tables as automatic rollback. Preserve financial
   histories and prefer a reviewed fix forward. Whole-database rewind can erase later
   writes/reservations and cannot reverse Stripe charges or refunds.

Current Render Settings say upgrade heads, while the actual live build at21:43:11Z on
October15 executed stamp heads (stamp log21:43:54Z; deployment began21:42:47Z).
The discrepancy's cause remains unexplained. No settings or deploy hooks were changed.
The explicit reviewed path above avoids relying on that observation as execution proof;
shared execution itself remains unperformed and held.

Evidence: [sanitized receipts](evidence/2026-10-16-payment-release-holds/),
[previous qualification](2026-10-15-payment-budget-integration.md).
