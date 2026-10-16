# Real payment recovery — isolated PR339

Owner authorized encrypted payment backup/local restore, private archive/key storage and
remaining CI, memory/lessons updates; no paid project/deployment, leave Claude wind work
untouched. Owner clarified external media may be disconnected, though usually mounted.

Actual primary read-only repeatable-read snapshot01:53:05Z,1.923seconds:13tables,3enums,
complete reviewed dependencies/security and row fingerprints. Both new payment tables
absent. Selected explicit pg_dump17.11 rather than runtime default18.6. Snapshot rolled
back/closed. AES256-GCM/RSA3072-OAEP-SHA256 envelope sealed before any remote persistence.
Only8223489ciphertext bytes transferred by tested outbound/no-listen route; sender/receiver
exits0, checksum exact. Remote owned ciphertext directory removed and read back absent.

Private retained copies on two separate healthy NTFS disks; three owned session folders
have protected ACLs restricted to Windows user/SYSTEM. BitLocker status unavailable, not
claimed. EFS directory inheritance and explicit dump/metadata/control-file encryption were tested.
Encrypted PKCS8 key uses a random passphrase, primary DPAPI protection and independent
two-share XOR escrow across external media. Both real decryption routes passed in fresh
processes; saved portable unsealer passed again from each retained kit. Primary recovery
needs only internal disk; independent shares read sequentially, physical unplug not tested.
Media identity manifests address reconnect letter changes. No new paid resource.

Real dump restored into empty EFS-backed loopback PG17.11 in one transaction. All13table
row counts/hashes and complete schema/security/index/constraint/type/role semantics match.
Two visibility CHECK cast representations were proven by local server reparse/validation,
rolled back; no predicate weakening. Original bootstrap grantor identity confirmed read-only
and reproduced locally; copied provider roles NOLOGIN/password NULL, no provider passwords
exported. Separate restored copy migrated as actual current_user postgres with1s/5s/10s
connection timeouts; initialized budget identity/row, old data/security preserved, rerun stable.

Harness faults stayed failed until rerun: empty-parameter percent query; Windows child
output-pipe hang; CHECK representation and bootstrap grantor mismatch; expected stopped
status leaking through cleanup exit. Owned process/cluster cleanup bounded and verified.
Final34retained files private ACLs passed; decrypted dumps, metadata, databases/cluster and
its temporary credential removed; loopback port closed. Archives, escrow and recovery kits
retained privately outside Git/scratch, not certified offsite/continuous/full Supabase DR.

PR339 head90d83bb7 all18CI checks/six workflows passed, including remaining simulation.
No backend/frontend/test/workflow changes since qualified55f091aa9. Remote DEV remained
ae13bade2 and branch90d83bb7 before memory publication. This closeout changes docs only;
later exact-head CI must be read separately. Shared migration/execution, historical
Settings/stamp discrepancy, operator and deployed payment acceptance remain held.

No served forecast number or Claude wind source/flag/polling timer/verdict changed.
SCOREBOARD/DECISIONS untouched. Report: `docs/audits/2026-10-16-real-payment-recovery.md`.

Local closeout: ledger/tamper tests and memory audit selftests passed; canonical audit0FAIL/14inheritedWARN/24NOTE. Ledger anchor advanced to1277. Entire prior90d ledger retained as exact prefix and protected application/workflow/wind/DECISIONS/SCOREBOARD blobs unchanged. Publication prepared with provider skip markers; new documentation head CI is a separate pending readback, not inherited from90d.

External-media usability verified: retained unsealer now pauses after first share. Actual archive authenticated after first-share input was removed and second-key input appeared; both were never available together in that staged-input test. Hardware unplug remains untested. Temporary share copies removed; final34private file ACLs and cleanup rechecked.

Final staged-media memory anchor1278. No code/test/workflow/wind edits; exact source and earlier CI qualifications preserved.
