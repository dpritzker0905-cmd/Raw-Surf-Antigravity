# T1 crowd truth: retention of the append-only logs after erasure (design, 2026-11-18)

**Status: PROPOSED.** This is an engineering design. Counsel has reviewed nothing; it rests on research, not legal
advice. The retention periods are David's or counsel's to set. They are named constants with no value in
`backend/services/surf_truth_log_retention.py`, and `awaiting()` lists them. Decision entry: `DECISIONS.md` D-083 (first drafted as D-082; #1059 holds D-082).

The legal research of 2026-11-18 was done with the legal-sources MCP. It retrieved the GDPR text, CJEU C-129/21,
CNIL Délibération 2021-122 and Cal. Civ. Code 1798.100/.105/.121/.140. It is held in the director's notes,
`T1-LEGAL-RESEARCH-2026-11-18.md`. Pinpoints still to verify against the English PDF: EDPB 05/2020 ¶64, ¶107 and
¶113-116. EDPB pseudonymisation Guidelines 01/2025 were not retrieved.

## 1. The problem

Three tables are append-only. Postgres triggers refuse UPDATE, DELETE and TRUNCATE for every role, and the
service role holds only SELECT and INSERT:

| Table | Columns (today) | Written by |
|---|---|---|
| `surf_truth_consent_events` | profile_id, granted, version, source, at | `services/surf_truth_consent.record` |
| `surf_truth_anchor_events` | profile_id, from/to status, actor_id, reason, at | `services/surf_truth_anchors.set_status` |
| `surf_truth_admin_actions` | admin_id, action, target_type, target_id, reason, detail JSON, at | `services/surf_truth_admin.log_action` |

Account erasure (`services/surf_truth_erasure.py`, #1022) anonymizes the profile but never touches these tables, so
the raw `profile_id` stays in them forever. The research's findings:

- Art. 17(3) lets a log be kept only where keeping it is *necessary*: (b) for an EU or Member State legal obligation,
  or (e) for legal claims.
- Art. 7(1), 5(2) and Recital 42 require us to be able to show that consent was given. EDPB 05/2020 ¶107 (to verify)
  says such a record is kept only as long as strictly necessary.
- Art. 11 does not help, because we hold the pseudonym key.
- California: 1798.105(c)(2) allows a confidential record of deletion requests. 1798.105(d)(2), (7) and (8) cover
  security, internal uses and legal obligations.
- CNIL 2021-122 on logs: keep them 6-12 months (up to 3 years with a documented internal-control reason), record a
  reference to the data rather than the data, store logs apart and write-only, and pseudonymize or purge
  automatically where the main data is short-lived.

So "keep forever" fails, and "delete at erasure" would break both the immutability guarantee and the consent proof.
The design keeps each log row immutable, and makes the person behind a row unrecoverable on a schedule.

## 2. Per table

| Table | Keep after erasure? | What it may hold | Ends by | Period (constant) |
|---|---|---|---|---|
| consent events | **Yes**: proof of consent (Art. 7(1), 17(3)(e); 1798.105(c)(2)) | subject ref, granted, version, source, at; nothing else | subject-key destruction at erasure + claims period; partition drop at the maximum | `CONSENT_EVENTS_AFTER_ERASURE_DAYS`, `CONSENT_EVENTS_MAX_DAYS`: **counsel names them** |
| anchor events | Weakest case | subject ref, from/to status, actor, **reason code**, at | key destruction at erasure (if David says so); partition drop at 6-12 months | `ANCHOR_EVENTS_DAYS` (research: 183-365), `ANCHOR_EVENTS_SHRED_AT_ERASURE` |
| admin actions | Yes, as a security log (Art. 32; 1798.105(d)(2)) | admin id, action, **pseudonymous target**, **reason code**, allow-listed detail | partition drop at 6-12 months | `ADMIN_ACTIONS_DAYS` (research: 183-365; up to 1095 with a documented reason) |

## 3. Mechanism (proposed; build once the periods are set)

Two parts. Neither one ever UPDATEs or DELETEs a log row, so the append-only triggers stay exactly as they are.

**A. Per-subject keys (crypto-shredding).**

- A new MUTABLE table, `surf_truth_subject_keys(subject_ref PK, wrapped_key, created_at, shred_after, shredded_at)`:
  - one row per person, created on their first log write;
  - `subject_ref` is a random UUID, not derived from the profile id;
  - `wrapped_key` is a 256-bit data key wrapped by a key-encryption key held in an environment variable (proposed
    name `SURF_TRUTH_LOG_KEK`; the value lives only in Render env and is never in a tracked file).
- Log rows stop storing the raw `profile_id`. They store:
  - `subject_ref`, which can be joined without decrypting anything;
  - `subject_box`, the profile id encrypted with AES-GCM under that subject's key.
  The admin actions' `target_id` gets the same treatment whenever the target is a person.
- Erasure fixes `shred_after` from the per-table constant: the claims period for consent, at once or never for anchor
  events.
- A daily job (it would sit next to `surf_truth_retention.enforce`) overwrites `wrapped_key` with NULL once
  `shred_after` has passed, and sets `shredded_at`. From then on, every row for that person in every log is a
  tombstone: status changes and times with no recoverable person.
- Lookups (export anchor status, consent in force, the admin views) find a person through the mapping
  `profile_id → subject_ref`. That mapping is in the keys table, so it is destroyed together with the key.

**B. Monthly time partitions (bounded retention).**

- Each log becomes a range-partitioned table on `at`, with one partition per month.
  - PG 13+ clones row-level triggers on a partitioned parent to every partition.
  - The TRUNCATE trigger is statement-level, so it is added to each partition at creation.
  - The grants stay SELECT and INSERT.
- Retention detaches and drops whole partitions older than the period:
  - `DROP TABLE` on a detached partition fires no row trigger;
  - it is the ONE sanctioned removal path, run by the migration role only, never by the backend's role;
  - each drop writes a tombstone line to the admin log (`partition_dropped`, with the month and the row count) and
    a ledger line.
- An event trigger (or a revoked DROP privilege for every other role) keeps any other path from dropping a partition.

**Why both parts.** Keys handle the individual (an erasure ends one person's identity in every log on that
person's own schedule). Partitions handle time (the period ends everyone's rows in bulk). Neither part rewrites
history.

**Migration.** The rows that exist today cannot be re-encrypted in place, because the triggers refuse UPDATE.

1. Create the partitioned v2 tables.
2. Copy the old rows, encrypting as they are copied.
3. Point the code at v2.
4. Drop the v1 tables in one ledgered migration.

Before that runs, read the row counts on prod and dev (one read-only query each); the stack is unmerged, so they
are probably empty.

**Not solved here, to be stated in the privacy notice:**

- Database backups and PITR keep shredded keys and dropped partitions until the backup window ends. That window adds
  to every period.
- Whether a row is "anonymous" after shredding is unsettled in the sources retrieved. Treat a shredded row as
  pseudonymous data whose key is destroyed, not as anonymous data.

## 4. Built now (no period needed)

- **Reason codes, not free text** (anchor events, admin actions):
  - Codes are `services/surf_truth_admin.ANCHOR_REASONS` and `AUDIT_FAIL_REASONS`.
  - The API bodies accept only those codes. `set_status` and `log_action` refuse anything else.
  - The admin screen offers a labelled native `<select>`, whose labels mirror the codes (parity test
    `tests/test_surf_truth_log_minimal.py`).
- **No user content in `detail`**: `log_action` refuses any key outside `DETAIL_KEYS` (statuses, verdicts, counts,
  run and object names, system-written text).
- **Named periods with no value**: `services/surf_truth_log_retention.py`. A test pins that every period is still
  None, so nothing invents a number.

## 5. Open questions, and who answers them

| # | Question | Owner |
|---|---|---|
| 1 | Claims period for consent records after erasure (and the overall maximum) | counsel |
| 2 | Anchor events: 6 or 12 months? Shredded at erasure? | David (counsel may advise) |
| 3 | Admin actions: 6 or 12 months, or a documented reason for longer? | David / counsel |
| 4 | Is a log row whose key is shredded acceptable as the end state, or must the partition be dropped first? | counsel |
| 5 | Backup/PITR window to disclose | David (Supabase plan) |
| 6 | Build the mechanism (A+B) now with the periods as config, or wait for 1-3? | David |
