# Audit repair batch — 2026-10-03 UTC

Owner instruction: "Ok start fixing the fixes mentioned in the audit report, but test each item
twice before and after fixing to ensure we're on the right path, using forensics and jacobian lens".

Work is isolated on `codex/audit-repairs`, based on `origin/dev` `e0f93466`. This session does not
change another checkout, deploy, push, perform a real payment, rotate a provider credential or
flip served weather flags. Trevec/Mind tools are not exposed here; the canonical Git record,
local source, history and repeatable experiments provide the evidence. No Tree Ring store exists
in this worktree; no new memory runtime was installed or claimed active.

## Repairs and evidence

Seven repair items have two valid baseline and two post-fix test runs. Full scope, root causes,
Jacobian checks, run references and open boundaries are in
`audit/repairs-2026-10-03/REPORT.md` and `results.json`.

- APP-01/02 account authority: 11 failures twice -> 17 passes twice.
- APP-05 profile projection only: 6 failures / 3 passes twice -> full account file 26 passes twice.
- APP-03 wallet/webhook effect: 12 failures twice -> 13 passes twice; real local ORM transactions,
  provider substitute, duplicate/order and rollback controls. Postgres concurrency unverified.
- APP-04 credential fallback: 2 failures twice -> 3 passes twice. Rotation/state remain open.
- WEA-07 optional preview: 13 failures twice -> 14 passes twice. Current conditions invariant
  under outage, 429, async timeout and malformed preview; primary failure still 502.
- WEA-03 spectral cap: 6 failures twice -> 21 passes twice including existing tide guards.
  Shared cap uses tide; binding-cap Jacobian becomes 0.81 m/m on either side of zero;
  scalar/one-partition parity and flag-off null control pass. Default flag remains off.
- WEA-02 provenance only: 3 failures twice -> 26 passes / 2 skips twice including existing cache
  and lane guards. Both domains retain served hour/model cycle; baseline inputs unchanged.
  Downstream parity/observation hour consumers are still open.

Combined new regression set: 69 passes twice. Final set including paired CI-floor controls:
91 passes twice. These repeats test repeatability; they are not independent scientific observations.
Local environment matches interpreter 3.12 and 44/46 declared pins; pygrib/uvloop absent,
bundled interpreter outside virtualenv. No CI/prod parity claim.

CI partition: 603 tracked files = 180 guards + 144 chain + 276 estate + 2 existing FastMCP
exclusions + 1 existing quarantine. LOC check passes. Hosted dev run 37048650086 at e0f93466
read 2248/1777/582 passes. New chain +13, estate +56: projected 2248/1790/638; floors
2242/1784/636 and paired reference updated together, margins 6/6/2 unchanged. Hosted
confirmation remains pending. No threshold lowered or quarantine added.

Fresh capped whole-tree probe: 624 passed, 574 skipped, 5 failed, stopped by maxfail=5.
Five DCL failures report a missing Event Bus DB, in the existing quarantine, with source/test
unchanged from base. Full later estate is unmeasured by that probe. Initial exploratory whole
run was interrupted while slow unrelated service tests were running and is not final evidence.
Complete required lane receipts will be appended before closeout.

## Memory and release boundary

Start memory audit: 0 FAIL, 2 WARN, 12 NOTE; overdue commitments 172 and 309 remain open.
Every local change is recorded through the official action-ledger append command. The end
memory audit and ledger verification are recorded below after updating the anchor.
This local batch closes only the tested paths; it does not close the whole audit. No provider
rotation, production financial race proof, served forecast skill gain or deployment is claimed.

## Final local measurements

- Required guards: 2246 passed, 68 skipped, 1 existing expected failure, zero failures; 21:28.
- Required forecast chain: 1790 passed, zero failures/skips; 11:41.
- Initial estate: 636 passed, 2866 skipped, one native Windows crypt availability control failed.
  Python's official 3.12 documentation describes crypt as Unix-only. The test incorrectly demanded
  its presence on Windows. That platform expectation failed twice in the full password file
  (1 failed / 9 passed), then passed twice (10 / 10) after correction. No hashing implementation,
  frozen hash or wrong-password test changed; no skip or exclusion added.
- Final complete estate: 637 passed, 2866 skipped, zero failures; 1:41.
- Final combined set including the password controls: 101 passed twice in fresh processes.
  Total distinct passes across the three required lanes: 4673; skips/expected failure remain separate.

The local guard count is two below the hosted baseline and estate one below its projection;
both are above the existing-margin floors. Hosted confirmation is still required. Raw XML and
the one-off credential-removal helper are ignored; sanitized evidence and its verifier are tracked.
The verifier asserts all four DCL/test/selector files byte-equivalent to base (line endings normalized),
and checks empty Strava defaults without printing their values.

Memory audit after updating the record: 0 FAIL, 2 WARN, 12 NOTE. Ledger: 355 entries, OK at that
reading; later append-only repair verification/checkpoint lines are checked again at closeout.
The warning commitments remain open. Legacy query-only clients intentionally receive 401 and
need authenticated staging journey verification before integration. No served-number skill gain,
live UI outcome or production financial/credential remediation is inferred from these local tests.

Closeout gates after ledger appends: ledger selftest detects every tamper; 358 entries verify
against STATE's published head. Canonical plus local memory again: 0 FAIL, 2 WARN, 12 NOTE.
Final CI partition and staged LOC policy both exit 0. Local repair checkpoints are ledgered
at seq 358; their Git read-back is recorded in the subsequent closeout finding.

Local repair checkpoint `32a10a9a` read back on `codex/audit-repairs`; working tree clean after
that commit. Pre-commit scanned 85.77 KB of staged material with no leaks found; this is not a
history-wide clearance or a credential-rotation receipt. Ledger seq 359 records that read-back.
The accompanying closeout checkpoint contains only the verification record. No remote action.

After the first checkpoint, the memory audit exposed one additional completeness warning:
0 FAIL, 3 WARN, 12 NOTE (the missing receipt for the pre-existing base PR #220). GitHub read-back
confirms MERGED at 2026-10-02T18:37:06Z, merge commit e0f93466 (Git timestamp 18:37:05Z).
Ledger seq 360 backfills that historical receipt with acted_at/reconstructed; seq 361 records
the changed audit reading. This session did not merge that PR or change repair source.

Final read-back after the backfill (c9d0ef): memory audit 0 FAIL, 2 WARN, 12 NOTE; ledger
361 entries, OK. Only the two pre-existing overdue commitments remain warned.
