# 2026-10-11 — Whole-app forensic and Jacobian audit

Actor: Codex. Owner request: audit the entire Raw Surf app without code changes, review features/improvements/upgrades/linkages, read memory and lessons, then update memory and brain after confirming data. Additional owner context: Claude is working on weather-sim wind and awaiting a polling event for approximately 2.5 hours before a verdict.

Source baseline: `e0af8885df558032437df7a53a0ad9ba683850e1`, initially clean detached HEAD. Documentation branch: `codex/app-forensic-audit-memory`. [Full report](../../audits/2026-10-11-app-forensic-jacobian-audit.md).

## Scope and evidence

- No application code, tests, configuration, flags, workflows, database rows, deployments or served numbers changed. No SCOREBOARD row: this is an audit and memory correction, not a numerical fix. No workflow dispatched, no live payment/authorization probe, no message sent to Claude or anyone else.
- Read project rules, canonical memory/state and lessons, historical feature/audit/architecture memory, frontend routing, backend router assembly and selected end-to-end dependency chains. Trevec/Mind/Memstate were not exposed in this session; no local Tree Ring CLI/store was available. Skill guidance is not a claim that memory tools ran.
- Read-only remote refresh, GitHub PR/workflow state and HTTP health/service-worker reads established the deployment evidence in the report. Observation at 01:56:15Z: backend healthy at `e0af8885`, 2,048 MB limit, 745.3 MB RSS, 902 MB peak. Data-health at about 01:57Z was `warn` on ICON marine, ICON weather and EURO marine. Dev frontend `e0af8885`; production frontend `fc140024` is distinct.
- Current-head E2E run 38084203665 failed with a 40-minute E2E timeout; prior successful marine nightly 38053781558 used older `541117de`. Error symptoms do not establish a root cause. Open #264 (`de490d11`) and #311 (`92fc8752`) were inspected, not merged or certified. Their reported controls were not rerun.
- At approximately 01:55Z the owner reported Claude's pending wind polling window. Exact event and deadline unknown. #311 is independently observed related work, not definitive identification of that event. No verdict is issued and no new polling commitment is created.

## Offline forensic controls

These used current source in isolated processes. SQL, provider/network calls and notifications were replaced with stubs; no live state was changed. The Python route bodies were extracted through AST with framework decorators/annotations removed so absent third-party dependencies would not be mistaken for functional failures. Thus results establish function behavior under stated controls, not a mounted ASGI integration test.

| Control | Observed result | Limit |
|---|---|---|
| Scheduled booking confirmation, fake price 100, no local transaction, failing simulated lookup | Success; Confirmed; escrow 80; one commit; zero provider calls | Local branch behavior only; no production booking touched |
| Same handler, unpaid provider-style control | HTTP 400; zero commits | Negative control, not real Stripe interaction |
| Post settings, caller-supplied matching owner ID | Settings changed; one commit | Router assembly separately checked for absence of auth dependency |
| Same settings, different owner ID | HTTP 403; zero commits | Demonstrates identifier comparison rather than identity verification |
| AI helper, blank vs action-word filename | Zero people vs surfing/person output | No image pixels read |
| AI helper, invalid base64; face suggestion with two candidates | Person output; two high-confidence suggestions | Metadata heuristics, not image inference |
| Grid 181 x 83, south -80/north 84, two-degree spacing, decimation stride four | Last retained latitude 80; declared north still 84; client interpolation puts retained equator at 2 north | Synthetic geometry proof, not a universal live displacement |
| Coarse key: change run/served valid time at same hour offset | Key unchanged; change offset control changed key | Engine reuse checked in source; no live stale-frame reproduction |

Additional source-confirmed gaps: admin settlement/retry simulation; stored alert filters not consumed; gear debit before partner receipt; export's missing model attribute and 500-message cap; conditional internal broadcast fallback; semantic embeddings without model/fallback provenance and no established application learning loop. Full causal chains, source links, severity and acceptance conditions are in the report.

## Verification and memory changes

Initial `memory_audit.py --docs-only`: 0 FAIL, 13 WARN, 13 NOTE. Overdue commitments remain 149, 217, 266, 282, 291, 298, 299, 309, 313, 318, 333, 860, 957. None was marked fulfilled based on this audit.

`action_ledger.py selftest`: every tamper detected. `memory_audit.py --selftest`: every check fires. Initial self-test attempts encountered sandbox temporary-directory permissions; the successful reruns used an ignored workspace scratch temporary directory. An initial async stub attempt hung at Windows event-loop socket setup under the sandbox and was stopped; successful no-suspension stub controls used direct coroutine completion. These environment failures were not interpreted as application defects.

Local Python was 3.14.8 with pytest/FastAPI/SQLAlchemy/NumPy absent, and frontend dependencies were absent. Full suites/build and authenticated role/device journeys were not run. Static BOLA ratchet: 269 heuristic candidates, baseline 269, exit zero; that is neither 269 proven exploits nor zero authorization defects.

Documentation changes: full report; this session log; a scoped STATE entry and timestamp; append-only lessons; dated historical pointers in `memory/FEATURE_REFERENCE.md` and `.codebase-memory/adr.md`; BRAIN corrections for credential/mock boundaries, the canonical surf formula, tool availability and tracing secrets. The BRAIN changes explicitly supersede conflicting older instructions and preserve their provenance in git. No actual credential values were written.

Local branch creation and these authorized document actions are recorded in ACTIONS through the ledger script. Final validation and local commit status are recorded below when observed. There is no claim of cross-machine synchronization until reviewed/merged; no push or PR is performed by this audit.

## Final documentation verification

Observed 2026-10-11 02:16Z: ledger verification passed with 1,042 entries; memory audit returned 0 FAIL, 13 WARN, 13 NOTE. Warnings are the same unresolved commitments above. The base ledger and LESSONS bytes remain exact prefixes of their updated files. All 24 local source links in the report resolve; the feature matrix has 38 rows. `git diff --check` passed. An allowlist check found only the eight intended documentation/memory files changed, and the repository credential-shape scan passed on added text.

The documentation is prepared for a local commit on `codex/app-forensic-audit-memory`, without push, PR, deployment or application-code changes. The commit identifier and clean-worktree result are reported to the owner after Git readback. This log/report action is covered by action records 1040-1042; no overdue commitment was closed.
