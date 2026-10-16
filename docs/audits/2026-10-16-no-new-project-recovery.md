# Payment recovery without a new paid project

Owner constraint: no new paid project (October16 UTC). The earlier$10.18/month Supabase
clone proposal is rejected. No project, subscription, PITR add-on or restore was created.

The preferred alternative is a **fresh encrypted logical payment backup and a disposable
restore on the existing local PostgreSQL installation**. It can avoid a new subscription
and does not require overwriting either existing Supabase database. Real export, private
storage/key custody and real restore remain unperformed; this is a concrete execution
plan supported by dependency inspection and synthetic mechanics, not a closed release gate.

## Confirmed feasibility

- Native PostgreSQL17.11 is already installed locally; its owned loopback fixture passed
  all123 payment gates with no skips and a separate populated dump/restore. It was stopped
  afterward. Docker is absent and WSL is not installed, so do not prescribe a working
  Supabase-container restore environment on this computer without setup.
- The runtime database is PostgreSQL17.6. Its total physical size at01:06:47Z was126897299
  bytes. A bounded read-only foreign-key dependency walk expands the seven commerce tables
  to **eleven**, about11MiB of relation bytes; this is not an estimated archive size.
- Required public tables: booking_participants, bookings, credit_transactions,
  dispatch_requests, gear_catalog, live_session_participants, live_sessions,
  payment_transactions, posts, profiles and surf_spots. Include public.alembic_version
  and ai_budget_private.openai_budget: thirteen existing tables in the baseline packet.
  Recompute the closure if schema changes; new payment tables must join future backups
  after they exist.
- Three referenced custom enum types were found: dispatchrequeststatusenum, gearcategory
  and roleenum. No custom trigger functions were found on the eleven tables. Each has RLS
  enabled with zero policies. Types, schema ownership/access, role attributes/memberships,
  ACLs, constraints, indexes, defaults and sequence dependencies still need exact capture
  and review; seven table dumps alone would be incomplete.
- The source role has CREATEDB/CREATEROLE, but no database/role was created. A second
  database on the running instance would share failure and resource exposure with live
  data, so it is not the selected independent recovery target.
- No primary storage bucket with backup/archive in its name was found. That limited name
  query does not prove there are no backups elsewhere. No durable private export route
  or recoverable key escrow is established yet.
- Existing cryptography library can seal the existing synthetic archive with AES-256-GCM
  and RSA-OAEP-SHA256. Exact authenticated recovery passed; modified ciphertext, modified
  authenticated header and wrong private key were rejected. Nothing was restored or
  uploaded by that prototype, and no key was persisted. This does not qualify real transport.

## Bounded implementation path

1. Establish the private encrypted archive destination outside public Git and routine
   scratch cleanup. Prefer existing private storage with verified remaining allowance,
   or an access-restricted local backup folder and a second retained encrypted copy.
   No new paid resource/add-on is permitted. Verify quota/retention instead of promising
   zero usage charges from an unmeasured storage account.
2. Generate a local public/private encryption pair without displaying keys. Persist key
   material only in an access-restricted, gitignored local .env or existing credential
   store. Keep the recovery key separate from the archive and establish an independently
   recoverable escrow; a key held only in RAM, only in scratch or only under this machine's
   profile does not establish durable recovery. Do not paste secrets into chat.
3. Use the existing runtime DATABASE_URL privately at its current authorized location.
   No database credential export/reset is necessary for the backup source. Send only the
   public encryption key to the export process. Take one consistent read-only snapshot
   covering all thirteen baseline tables plus schema/type/security dependencies and
   verification fingerprints. Freeze budget/history with the same snapshot, not a later
   read. Bound lock waits and total duration; abort cleanly on contention, size or drift.
4. Use Render's existing Magic-Wormhole sender as the first transport candidate. Its
   binary and cryptography library were confirmed in the native runtime. Render
   [documents this transfer option](https://render.com/docs/disks#transferring-files).
   An isolated local receiver0.24.0 is now installed; a262144byte random synthetic
   transfer passed with matching source/receiver SHA-256 and remote cleanup. No customer
   data was used; no account, bucket, SSH access or paid resource was created.
   This avoids creating a cloud bucket, paid project or persistent SSH access. Send only
   pre-encrypted ciphertext to this computer; never store the one-use transfer code in
   tracked output. The synthetic roundtrip/checksum prerequisite passed; real archive transfer remains unperformed.

   Export the reviewed logical archive, encrypt before persistence/transfer, validate the
   export exit status, manifest and checksum, then transfer only ciphertext through an
   authenticated private route. Do not print dump contents or put them in Actions artifacts
   on this public repository. An ephemeral Render file is not the retained backup.
5. On the existing local instance, create uniquely named empty owned databases with no
   app attached and loopback access only. Provision only reviewed non-login role/type
   dependencies; do not reuse provider credentials or enable outbound extensions/jobs.
   Fully authenticate the encrypted archive before giving any bytes to pg_restore.
6. Restore all reviewed schema/data/security in one error-stopping transaction. Compare
   snapshot fingerprints, row counts, foreign/unique keys, enums, owners, RLS, normalized
   ACLs (including PUBLIC, grantors/options), role semantics and the initialized budget.
   Keep raw customer rows out of tool output and tracked receipts.
7. Preserve the restored baseline, then apply the exact payment migration target in a
   separate owned copy and compare existing rows/security. Use synthetic new intent/case
   records for populated post-migration recovery; never call Stripe/OpenAI or start the app.
   Confirm budget/history preservation, repeat target and failure rollback before cleanup.

This would establish actual payment-dataset recovery on a different minor version of
PostgreSQL17. It is not a whole-Supabase disaster recovery drill: Auth service settings,
Vault encryption roots, global credentials, storage object bytes and the rest of the
application remain separate coverage. Retain provider daily backups as the broader layer.

The [PostgreSQL dump documentation](https://www.postgresql.org/docs/17/app-pgdump.html)
warns that selected tables do not automatically include all dependencies. Supabase permits
[logical exports with physical backups enabled](https://supabase.com/docs/guides/troubleshooting/download-logical-backups).
Thus a fresh logical backup need not wait for a scheduled physical snapshot, but its secure
destination, consistent dependency capture and real restore must still be verified.

Related: [release-readiness report](2026-10-16-payment-release-holds.md),
[sanitized evidence](evidence/2026-10-16-payment-release-holds/).
