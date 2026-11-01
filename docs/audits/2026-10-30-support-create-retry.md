# Support creation retries after staff edits

Status: locally repaired and qualified; no shared migration or deployment.

## Failure and outcome

An original keyed creation request could lose its acknowledgement, then return409 when retried after staff changed the ticket's priority or tags. `existing_request` compared the original request with the mutable ticket row. The original five-case fixture on deployed source `fb2d2e5def5ec8bcea1b2a39918f7740ba034a90` passed3/5: ordinary and status-only retries worked; priority/tag edit retries failed. The same five behavioral cases now pass5/5 against the candidate.

The original support-only audit register (42,175-179,464,884-889,993) was reconciled with its completed repairs. This is a newly discovered recovery gap in the implemented176/464 workflow, not an unrepaired original register entry. David explicitly selected the isolated repair after that distinction was explained. The file owner released the support route, SupportTicket model portion, one additive migration and bounded creation-retry tests; other chats retain their files.

New keyed creates now store a version-one SHA256 fingerprint of normalized original owner/subject/description/category/priority/tags/booking intent in the ticket's own INSERT. A matching retry returns the original ID/number without changing the staff-edited ticket or creating another receipt. Changed intent still returns409, including a changed priority/tag value that happens to match current staff edits. Existing UUID/request-key normalization, creation notice, SLA, assignment and staff reply behavior are preserved. The fingerprint is excluded from public/admin ticket responses and all email payloads.

## Legacy behavior and migration order

`SupportTicket.creation_request_fingerprint` is nullable. Existing rows remain NULL; original priority/tags cannot be reconstructed reliably, so no historical fingerprint is invented. Legacy rows retain the existing conservative field comparison, including409 for ambiguous original retries after staff edits. Calls without a client request ID retain independent creation semantics.

Prepared migration `support_create_intent_001` follows `monthly_archive_replay_001`. It adds only the nullable64-character column, performs no backfill, and leaves other migration branches untouched. Downgrade refuses to remove stored creation-intent metadata; when no fingerprints exist it can drop the column without deleting ticket rows.

Apply this additive migration through the separately authorized release process **before** deploying the new ORM. Existing old code tolerates the nullable column; new ORM ticket reads require it. Render's existing stamp step is not a substitute for executing DDL. No shared schema/version rows, startup logic, provider configuration or restart were changed here. A source rollback should retain the column/metadata rather than discard request history.

## Fresh verification

- Original five-case reproduction:3/5 on frozenfb2, then5/5 on candidate with identical behavioral oracles. Actual create/update functions, real disposable SQLite; queue boundary substituted, no live authentication/provider claim.
- New mounted HTTP and DDL fixture:40/40 on disposable SQLite and40/40 on native PostgreSQL17.11. Covers staff priority/tags/status/assignment edits, unchanged ticket/receipt snapshots, metadata privacy, conflicts in all original creation fields, normalized defaults/UUID casing, conservative legacy rows, unkeyed compatibility, queue rollback, concurrent identical/conflicting requests, nullable upgrade and guarded downgrade.
- Retained mounted delivery fixture:43/43 on both engines, including original creation receipts, owner/public/internal boundaries, staff replies, fake-sender behavior, SLA and reopened lifecycle. Existing fixture source was not changed.
- Existing durable pytest item:1 passed. Its two sequential subprocesses execute retained43 and new40 cases in separate ORM registries. No new pytest test function was added, so no estate floor increase is projected. The two pytest config warnings come from deliberately disabled unrelated asyncio plugin autoload. No hosted CI run is claimed.
- Retained ticket-number allocator17/17 and uppercase-ID API21/21 also pass. Their source fixtures remain unchanged; output stays private.
- Focused fatal flake8, Python syntax, source sizes below800 lines and whitespace checks pass. PostgreSQL cluster stopped, pg_ctl status3 and no OS listener. No app server, normal database module, dotenv, scheduler or weather startup.

The first sandboxed async reproduction stalled and was stopped; the unchanged baseline script then completed normally in2.3seconds with scoped execution approval. This was an environment limitation, not a product result.

## Email forensic recheck and isolation

Independently re-read the earlier creation/staff outbox/provider receipts and Gmail authentication/return screenshots. They remain coherent: one send per flow, Inbox receipts18:13/18:58Eastern, SPF/DKIM/DMARC PASS, correct authenticated ticket return. These are earlier live acceptance evidence onfb2; no new emails were sent and this migration candidate is not deployed. Mailer templates/senders/support-delivery services remain unchanged; current retained fixtures qualify the changed creation handler locally.

Candidate is isolated in `codex/support-create-retry-20261030`, based onfb2. The existing synthetic-unread helper worktree and its two source hashes are unchanged. No GromManage, notification, Auth/router, financial policy, weather source/config/flags, provider, live data or release actions were taken. App-only report/evidence accompany this slice; no weather bookkeeping was edited.

## Reproduction

From repository root, use the existing Python3.12 backend environment and a private output directory:

```powershell
$env:RAW_SUPPORT_FIXTURE_OUTPUT_DIR='<private output directory>'
python -B docs/audits/evidence/2026-10-30-support-create-retry/verify-create-retry.py
```

The existing `backend/tests/test_support_delivery_fixture.py` also runs both fixtures. Local verification used `--noconftest` and disabled unrelated plugin autoload to avoid application initialization. Native PostgreSQL used only a new owned loopback `support_numbering_fixture` database, then stopped its cluster. No shared DSN is accepted by the PG fixture.

Compact baseline/final/SQLite/PostgreSQL results and tested-source fingerprints are alongside the new fixture. Raw logs/databases remain private. Other browsers, physical devices, real JWT checks, cross-account live mail and shared migration/deployed acceptance are not claimed by this slice.

## File-owner review

The file owner independently reviewed the frozen route/model/migration diff and found no blocking defect in original-intent binding, owner checks, NULL legacy behavior, privacy, transactional insertion or guarded downgrade. They explicitly retained the migration-before-runtime gate and performed no overlay, release or independent test rerun. The launcher minimum was subsequently tightened from20 to all40 checks and the durable item rerun successfully; runtime/fixture bytes did not change. A private preparation command initially used a wrong relative path and changed nothing; the corrected command and final test passed.
