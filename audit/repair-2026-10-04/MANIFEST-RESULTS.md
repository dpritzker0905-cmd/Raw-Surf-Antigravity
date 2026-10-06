# Immutable manifest publication — AS-06

Recorded 2026-10-04 22:09Z. Baseline `649cb14e73bfbba539b7c5f555f62256759a6a8e`.
Prior receipt source CI37231405906 completed/success. Candidate hosted qualification pending.

## Repaired contract

The prior publisher used one object name per generation with overwriting uploads. A losing
writer could overwrite the winner's already-pointed bytes; an upload returning no acknowledgment
could still advance the pointer. Both actual-source failure paths reproduced twice.

`MANIFEST_IMMUTABLE_PUBLICATION=0` is the new dark switch. Enabled publication uses a unique
generation/UUID key, the real store's strict=True/overwrite=False upload, and requires the exact
True acknowledgment before insert/CAS. The existing pointer schema, reader bytes and fallback
are retained. No migration or remote configuration change. Direct publication also enforces
the existing designated-writer gate. UUID collision or HTTP400/409/429/500 refuses publication.

A failed or ambiguous CAS never immediately deletes its uploaded candidate: the server might
have committed before the acknowledgment was lost. Successful writers perform at most one
100-row listing and one20-object batch deletion, each with5s HTTP timeout. Cleanup keeps five
generations AND3600s since the later created/updated timestamp. Unknown paths, invalid/naive
timestamps, fresh copies, current/future generations and non-designated writers are preserved.
Old legacy keys can age out during transition. No unbounded listing or per-object delete loop.
Cleanup errors cannot revoke an acknowledged publication. This bounds work per publication;
it does not prove a global object-count cap or an absolute network wall-clock deadline.

## Forensic and local qualification

- Final exact prior publisher substitution, restored byte-for-byte:16cases,9fail/7pass twice,
  zero collection errors/skips. Initial pre-strengthening replay13cases,8fail/5pass twice retained.
- Final expanded actual publisher/store upload/REST CAS/reader, manifest neighbors and paired floors148pass twice.
  Thirty-nine new controls cover initial/ordinary races, exact upload acknowledgment, UUID
  collision, failed/ambiguous uploads/CAS, legacy success despite copy failure, writer gate,
  retention safety/bounds/failures, reader/CDN parity and dark rollback.
- Publication central differences epsilon0.05: winner/loser derivatives[0,1] legacy→[1,0]
  enabled. Both controls execute the real publisher, uploader, REST CAS and reader with
  deterministic concurrent synthetic storage. This measures ownership, not forecast skill.
- Paired floor controls36pass; selector619tracked/182guards/150chain/284estate, two existing
  fastmcp exclusions and one existing quarantine. No new skip/exclusion. Guards projected2327,
  floor2321; chain1982/estate898 unchanged; backend total projected5207. Frontend347/3610 unchanged.
- Fatal Python lint and backend643-file/800LOC guard accepted. Repository LOC ratchet accepted.
  Local interpreter remains partial (two declared packages absent/not a venv); full hosted
  Linux CI must qualify candidate. No acceptance inferred from a root-directory selector
  attempt reporting zero files; corrected backend-directory selector proves actual ownership.
- One live health/data read remains healthy/ok at deployed6b062e97. No live load test or write.

## Remaining acceptance

Hosted candidate full gates pending. Source is default off, no merge/deploy/activation. Actual
Supabase staging concurrency/acknowledgment/read-back and bounded-cleanup timings remain open.
Stored forecast values, reader schema and scientific composition are unchanged by the dark path.
Next source phase is PF01–04 queues, caches, duplicate raster work and encoding deadlines.

Primary guidance: [Supabase uploads and concurrency](https://supabase.com/docs/guides/storage/uploads/standard-uploads),
[file listing](https://supabase.com/docs/reference/python/storage-from-list),
[batch deletion](https://supabase.com/docs/reference/python/storage-from-remove).
Current changelog was retrieved and checked; installed storage3 REST routes/payloads inspected.
Backend-only environment credentials and existing writer authorization are retained; no client
credential, RLS/schema change or package upgrade introduced.

Final strengthening: writer-check exceptions refuse publication; cleanup-check exceptions
preserve acknowledged success. Core and independent pilot writer plus precompute/monitor
all declare the switch0. Final39publication controls plus73manifest/parity and36floor
controls are148pass twice. Earlier109/36 counts remain historical partial qualification.

### 2026-10-04 22:25Z: explicit chronology correction

The final AS06 expansion row was appended with date-only precision after timestamped rows.
It was written with ledger610 at22:14:13Z, not midnight. CI37239259594 rejected it because
the checker invented midnight. The historical row is retained. Date-only rows now constrain
the whole UTC day; prior explicit time constraints carry across them. Earlier days and
reversed explicit times still fail. Actual audit_docs before1fail/1pass; after12controls
and108publication/parity/floor/chronology controls pass; audit selftest accepted and
docs-only0FAIL/7WARN/6NOTE. Existing overdue commitments remain open.
Selector620tracked/182guards/150chain/285estate;12new estate controls, reference910/floor908.
Expected full backend5219, frontend3610; hosted follow-up pending. No served-number change.

### 2026-10-04 22:49Z: exact-source hosted acceptance

Source e4353c062c093b453ce7f4e9445a4a793ce7feba CI37240056010 completed/success, all11jobs.
Frontend347/3610; backend5219passed: guards182files/2327passed/66skipped/1xfailed,
chain150/1982passed/0skips; estate285selected/283results/910passed/0silent.
Ledger37240056059, encoding, LOC, Lighthouse and Netlify preview accepted. The dated
scoreboard correction passed hosted validation. Flags0; actual Supabase canary remains open.
