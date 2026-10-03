# Audit continuation: messaging and strict sim inputs

## 2026-10-03 13:33Z — measured local repairs, overall audit still open

Owner: "Ok continue fixing the fixes mentioned in the audit report, but test each item twice before and after fixing to ensure we're on the right path, using forensics and jacobian lens".

Branch asserted `codex/audit-repairs`; starting HEAD `0d516a90`, clean. The first repair batch's log and
report remain frozen. Start memory audit: 0 FAIL / 3 WARN / 12 NOTE; two overdue commitments and the
secrets-policy pointer now stale at eight days. No provider rotation claim is refreshed from that pointer.
Trevec/Mind unavailable; canonical Git memory and source/AST topology used. The Tree Ring hook is a
no-op without a project `.tree-ring`; no second memory database installed.

APP-05: fourteen messaging routes now require verified JWT actor binding, with persisted admin
check before cleanup SQL. Six conversation actions accept omitted legacy query identity, using
JWT subject, while preserving membership checks. Mounted production routers, signed JWTs and
real ORM fixture: BEFORE 47 failed / 25 passed twice; AFTER 72 passed twice. Legitimate owner/peer,
linked child directory and parent family-preview controls pass; rejected effects preserve state
and legitimate changes leave peer columns unchanged. Cleanup uses a SQL ordering spy, not an actual
Postgres duplicate merge. Broader family/blocked-user policy and sibling account paths stay open.

WEA-05: `_validated_baseline` refuses missing/nonfinite/boolean/out-of-domain scalar inputs without
invented zeros, retaining measured zero and numeric-string compatibility. Built default-off via
`SIM_STRICT_INPUTS`, declared in admin registry. BEFORE 41 failed / 18 passed twice (59 cases).
Five +0.25 input perturbations give a diagonal identity mapping with exact off-diagonal nulls;
complete valid payloads match under flag A/B. This proves boundary behavior, not forecast skill.

Verification found a new cache defect: legacy cached fabricated direction could bypass newly
enabled strict input validation; disabling could reuse a strict refusal. BEFORE 3 failed / 59 passed
twice (expanded 62 cases). Fetch and zero-I/O peek now separate strict and legacy keys, leaving the
disabled legacy key intact. FINAL AFTER: 62 new passes twice; with forecast/provenance/cache companions,
88 passes / 2 existing skips twice. Source-only baseline replay restored the exact `0d516a90` sim
module for the two 59-case readings, then restored the fixed bytes; no external state changed.

Harness corrections precede counted baselines: one test-writing command used an incorrect cwd-relative
path and ran no tests; the initial weather fixture named a nonexistent cache variable and produced
57 setup errors. Neither is a defect baseline. Corrected instruments have zero setup/collection errors.

Wider checks: affected integration 239 passed / 2 skipped; all CI-owned sim consumer suites 255 passed /
2 skipped; full estate 709 passed / 2866 skipped, zero failures. Fatal Python lint, LOC ratchet and
whitespace pass. No exclusions, skips or quarantines added. Full guards/chain not rerun this batch.
Selector-owned new cases: chain 62, estate 72; files +1 each. Same hosted pinned-base receipt
37048650086 (`e0f93466`, success) plus prior executed additions yields projected guards 2248, chain
1852, estate 710. Floors and provenance move together to chain files 145 / passes 1846, estate 708;
margins 6/6/2 unchanged. Local estate 709 is not substituted for its Linux hosted projection.

Evidence: `audit/repairs-2026-10-03-followup/REPORT.md` and `results.json` (case names/outcomes and XML hashes).
Raw traces and one-off scripts gitignored. SCOREBOARD S16/S17 hold the paired conditions. Online source:
OWASP Authorization Cheat Sheet, checked for every-request/object authority guidance.

No push, PR, deploy, provider write, real payment or notification; no serving flag enabled. Runtime
is local Python 3.12 plus existing packages, lacking pygrib/uvloop and its own virtualenv. Hosted CI,
staging UI and Postgres evidence remain pending. Strava authority/rotation, served-hour consumers,
tide/MOP and period contracts, scientific skill, payments concurrency, shared capacity, delivery and
UI/accessibility remain open. Roll back only product paths to `0d516a90` and ledger any rollback;
keep canonical history append-only.
