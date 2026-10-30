# Shared additive migration proposal — prepared, not executed

Published source: `a8bcc34212aceb0dde287dc4857209db891f66fd`, draft PR #640. The exact generated SQL is preserved byte-for-byte as the `sql` value in tracked `evidence/2026-10-30-dev-release/prepared-additive-migrations.json`, with a local plaintext companion `prepared-additive-migrations.sql`; SHA-256 `24fe03580da0bc4212302c675a9cfc4d3c2b77f8b913076ff3fba37718d55477`. Source migration SHA-256 values are in `migration-plan-binding.json`.

## Confirmed destination and catalog
The running shared Render service maps to Supabase project `jnfbxcvcbtndtsvscppt` through pooler host `aws-1-us-east-2.pooler.supabase.com`, confirmed with SQLAlchemy's actual parser and the project suffix of the database username. No credentials were printed. The runtime backend/.env file was confirmed absent (existence only), so its override=True loader does not supersede this environment. The earlier stdlib URL-parser host interpretation is superseded. SUPABASE_URL independently names the same project; it alone would not prove database mapping.

Catalog-only review found exactly three Alembic rows: `6b8bb9b66da7`, `avatar_url_text_001`, `e1a0c5f2b7d4`. The five additions and monthly table are absent. Existing email tables, outbox idempotency unique index, suppression hash unique index, notification preference unique-user index and support ticket-number unique index are present. The Dev-named project is a different schema and is not this destination.

Read-only transaction confirmed `transaction_read_only=on`; relation metadata (total bytes/estimated rows, not exact customer counts): profiles 1,253,376/259; credit_transactions 663,552/866; live_session_participants 679,936/17; global_pricing_config 73,728/4. Estimates may be stale. No business rows were read.

## Exact proposed additions
Apply existing prepared migrations in order `e1a0c5f2b7d4 → bonus_spend_only_001 → monthly_archive_replay_001`. Preserve the other two version rows.

| Table | Addition | Contract |
| --- | --- | --- |
| profiles | spend_only_credits | FLOAT NOT NULL DEFAULT 0 |
| credit_transactions | spend_only_amount | FLOAT NOT NULL DEFAULT 0 |
| credit_transactions | refund_of_transaction_id | VARCHAR(36), nullable; index ix_credit_transactions_refund_of_transaction_id |
| live_session_participants | payment_credit_transaction_id | VARCHAR(36), nullable |
| global_pricing_config | credit_package_bonuses | JSON, nullable |
| monthly_leaderboard_archives | year, month, archived_count, completed_at | all NOT NULL; completed_at timezone-aware timestamp; composite primary key(year, month); initially empty |

Existing balances remain cash-classified with zero new promo classification. No balances are reconciled, records cleaned up, snapshot history adopted or provider calls made. Existing legacy monthly snapshots continue to fail closed for review.

## Execution and failure boundaries
The proposed SQL is one explicit transaction with lock timeout 1s, statement timeout 10s and idle-in-transaction timeout 15s. A client wall-clock watchdog of 120s must cancel and roll back if the operation has not completed. It locks the four affected tables plus version table in SHARE ROW EXCLUSIVE mode, blocking concurrent writers; ALTER TABLE requires stronger locks and the regular index build blocks writes. Even these small catalog sizes do not prove zero contention. Any timeout/error, unexpected heads, partial column/table/index state or changed migration hashes aborts the transaction. No automatic retry or metadata stamping workaround.

Immediately before execution recheck project identity, exact source hashes, those three heads, table/column existence, exact new-column absence and index/table absence. The prepared transaction itself guards lineage and partial/already-applied additions after acquiring locks. It uses only generated existing upgrade DDL followed by a compare-and-swap update of the one version row.

After commit use a separate read-only transaction to verify exactly the three resulting heads, all five types/defaults/nullability, the refund index columns and archive composite PK. Never claim successful execution from a timeout or missing acknowledgement: inspect schema and version metadata first. Then only after exact-head CI/review gates pass may DEV merge trigger the approved shared deployment. The existing build's `stamp heads` must not run first because startup would omit the refund index while marking the migration complete.

Before commit, failure rolls back all DDL and version changes. After a successful commit, prefer leaving additive schema in place while reverting application code if needed. Never drop promotional classification or completion records to force a rollback; the migration downgrade explicitly refuses where promo balances/offer history or archive completion records exist. Do not blindly rerun on partial or committed state.

## Rehearsal and limits
Fresh disposable loopback PostgreSQL rehearsal passed 12/12: actual ordered upgrade functions, legacy fixture cash/zero-default/index/PK preservation, transaction rollback returning the original three heads and removing additions, successful committed fixture lineage, rerun preflight refusal and stopped server. It used minimal synthetic affected tables, not a complete hosted schema clone. The exact generated SQL also passed commit, cash/default/index/PK, repeat-refusal and hash-binding checks in a second disposable database. No hosted DDL has been executed.

## Once-only approval question for the parent to relay
May I execute these two existing prepared additive migrations on shared Supabase project `jnfbxcvcbtndtsvscppt`, using the reviewed transaction above, before the approved DEV deployment? This adds five columns, the refund provenance index and an empty monthly archive table, and advances only the email/bonus/monthly version row while preserving the other two heads. It briefly blocks affected-table writes and may fail if locks exceed one second. It makes no historical corrections, cleanup or provider transactions. Your earlier approval covered deployment/stamp/existing startup; manual live upgrade requires this separate approval. Execution will still wait for exact-script rehearsal, unchanged catalog preconditions and required CI gates.

## Execution status
Parent relayed direct human approval, but the execution tool automatic approval review did not accept the assistant relay as trusted direct user authorization. The action was rejected before execution. Schema/version readback remains unchanged. No retry or alternate execution path is authorized by this rejection; obtain direct action approval in the execution chat or hand execution to the user. Independent source review found no blocking gap in the exact SQL; stricter timeouts remain as reviewed.
