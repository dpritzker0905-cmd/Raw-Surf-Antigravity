# PR339 real encrypted payment recovery

Verified October16 UTC (October15 evening in the owner's timezone). Owner authorized
encrypted backup/local restore, private archive/key checks and remaining CI; no paid
project or deployment. Application code, tests and workflows remain unchanged from
qualified source55f091aa91c5f8505be3fbfa03c4eb6a4d82e156. Claude's wind work is untouched.

| Gate | Confirmed result |
|---|---|
| Current payment backup | PASS: PostgreSQL17.6 read-only repeatable-read snapshot at01:53:05Z; 13tables/3enums and required security metadata; snapshot transaction1.923seconds, rolled back/closed |
| Compatible tools | PASS: explicitly selected runtime pg_dump17.11, matching local pg_restore/server17.11; default runtime pg_dump18.6 was not used |
| Archive privacy/transport | PASS: AES-256-GCM with RSA3072/OAEP-SHA256-wrapped data key; only ciphertext persisted on source; 8223489bytes transferred with exact SHA-256 match; sender/receiver exits0; owned remote directory removed/read back absent |
| Retained private copies | PASS: two archive copies on separate healthy NTFS physical disks; all34retained files restricted to current Windows user and SYSTEM; root ACL inheritance disabled; media identity manifests and checksummed recovery kits retained outside Git/scratch |
| Recovery key custody | PASS: encrypted PKCS8 private key; primary random passphrase protected by Windows DPAPI. Independent recovery uses two random XOR shares on separate external media plus encrypted key. Both routes decrypted the real archive in fresh processes; portable retained unsealer also passed both routes |
| Intermittent external drives | Primary recovery requires only the internal disk. Retained unsealer has an explicit media-swap pause; real archive verification passed with first-share input removed before second-key input became available. Actual physical disconnection was not exercised. Private media identities account for changed drive letters |
| Corruption/wrong key | PASS: modified ciphertext, modified authenticated header and wrong key rejected before restore input was consumed |
| Real recovery | PASS: empty isolated loopback cluster, one error-stopping restore transaction; all13table row counts/hashes, columns/defaults, owners, normalized table/column/schema/type ACLs, RLS/policies, constraints, indexes, enums and effective role attributes/memberships match |
| Migration on recovered data | PASS: separate copy of restored baseline upgraded to payment_budget_merge_001, then repeated unchanged; actual Alembic connections current_user=postgres, lock1s/statement5s/idle10s; existing rows, initialized budget relation/schema identity and security preserved |
| Cleanup | PASS: EFS-protected temporary restore data, both disposable databases/cluster and its generated local credential removed; server stopped and loopback port closed. Encrypted archives, keys and private recovery kits retained |
| Remaining hosted CI | PASS: prior documentation head90d83bb7d30f79fe5abb68496a814482af3df0ca all18checks; six workflows successful. New documentation closeout does not retroactively inherit exact-head CI |

The baseline covers the full eleven-table public foreign-key closure of seven commerce
tables, plus Alembic history and the private budget. Both new payment tables were absent
on the real source. Their populated backup/restore, atomic-failure and contention checks
remain separately qualified by the earlier synthetic/CI receipts; do not claim this
baseline contained real checkout-intent or reconciliation-case rows.

Two post-visibility CHECK definitions are rendered differently by PostgreSQL17.11's
parser: array casts become element casts. Each original expression was added under a
temporary constraint name, validated against restored rows and read back through
pg_get_constraintdef; the result exactly matched the restored definition. Those
transactions rolled back. No regex deletion, dropped predicate or unvalidated bypass
was used. Original definitions remain in the encrypted snapshot metadata.

Role grantor identity also matters. An initial local bootstrap name caused membership
grantor differences. Read-only source verification confirmed its actual bootstrap
role; a fresh local cluster reproduced that identity before restore. All copied provider
roles were then explicitly NOLOGIN/PASSWORD NULL; a separate local-only administrator
was used. Exact attributes and memberships passed, without exporting provider passwords.
The exact migration used SET ROLE postgres through actual connection options, avoiding
a superuser-only migration proof.

One read-only export attempt failed on a local query-parameter helper bug and rolled
back before a dump. One local Windows control runner hung on inherited output pipes;
only its verified process chain and cluster were stopped, disposable data cleared, and
the corrected runner rerun. An expected pg_ctl status3 initially survived successful
cleanup into the caller's exit status; direct file/port checks established cleanup and
the helper now returns success explicitly. These were local harness faults, not app
code fixes or source writes. Every failed comparison remained a failed gate until fixed
and rerun. Final successful proof is in the sanitized receipts.

The private recovery kit contains the portable verifier/unsealer, dependency/reference
helpers, hashes, media identities and operator instructions. The unsealer is independent
of this checkout; the full reference runner is workspace-bound and needs deliberate new
owned paths/tool configuration before reuse. Never blindly rerun its saved session paths.
No private key, share, transfer code, database credential, raw dump, customer row, device
identifier or private path is in this public record.

The backup/recovery hold is closed **for this selected payment dataset at the captured
snapshot**. It is a point-in-time local recovery proof, not continuous/offsite backup or
whole Supabase recovery. Auth, Vault roots, storage object bytes and unrelated application
data remain separate. Snapshot again immediately before a future shared migration and
compare baseline drift. Never rewind financial writes or reinitialize the budget.

Remaining holds: explicit authorized shared migration and immutable artifact execution;
the unexplained Settings/previous stamp mismatch; operator recovery/scan/case coverage;
and deployed payment callback/return/refund/UI acceptance. PR339 remains draft and
unmerged. No application startup, Stripe/OpenAI calls, shared writes/migrations, paid
project, provider setting change or deployment occurred in this work.

Evidence: [real recovery receipt](evidence/2026-10-16-payment-release-holds/real-payment-recovery.json),
[completed exact-head CI](evidence/2026-10-16-payment-release-holds/hosted-checks-90d.json),
[release packet](2026-10-16-payment-release-holds.md).
