# Fresh-context repair prompt

Copy the prompt below into a fresh context. The [published handoff](FORENSIC-REPAIR-HANDOFF-2026-10-13.md) is in this same directory.

```text
Continue the remaining forensic-audit repairs for Raw Surf.

Published handoff:
https://github.com/dpritzker0905-cmd/Raw-Surf-Antigravity/blob/codex/audit-handoff-docs-2026-10-15/docs/weather-program/FORENSIC-REPAIR-HANDOFF-2026-10-13.md

Branch: codex/audit-handoff-docs-2026-10-15
Verified publication commit: ddb67b60704a9f84bb0a148eaab237285dded91b

Read the handoff and both linked audit reports. Treat them as historical findings: reconcile each against current source, repair logs, and evidence before assuming it remains open. Read AGENTS.md, CLAUDE.md, BRAIN_RULES.md, and docs/weather-program/README.md, STATE.md, and relevant decisions.

Before editing:
- Inspect current branches, worktrees, staged/unstaged changes, and active task ownership.
- Identify completed, partially repaired, and unowned findings.
- Use an isolated worktree for implementation. Do not switch, reset, stage, commit, or alter another task’s checkout or files.
- The last known weather owner handled F2 rendering, G04/G05 storm displacement during zoom/pan, and timeline latency; the master task owned release reconciliation and the combined ledger. Verify current ownership before touching those areas.
- If ownership is unclear or overlaps, leave that slice pending and proceed with the highest-priority independent repair.
- Use the documentation branch as a reference; do not merge its historical STATE or ledger wholesale into current work.

Follow the handoff’s priority order:
1. Remaining P1 authentication and forecast-identity defects.
2. False recovery coverage and actual-time scientific matching.
3. Cancellation, same-cycle HRRR reload, and truthful model provenance.
4. Measurement-tool correctness before visual tuning.
5. Zoom continuity, directional cancellation, and visual/animation qualification.
6. Remaining marine/scientific gaps and source-matched acceptance evidence.

For each remaining, unowned finding:
- Reproduce the defect on the current source.
- Make a bounded repair with a meaningful regression test.
- Run the handoff’s acceptance tests and positive controls.
- Record the exact tested commit, results, limitations, and evidence.
- Keep engineering correctness, scientific acceptance, visual quality, and device qualification distinct. REFUSE or missing evidence is not PASS.
- Follow the weather-program append-only log/ledger protocol and coordinate shared-record writes. Add required SCOREBOARD entries.

Never include credentials or another task’s changes. Keep scientific flags off. Do not deploy, merge, alter production, or run heavy tests against shared live services.

Finish with a finding-by-finding report: verified repairs, remaining work, ownership/dependencies, and the exact tests still needed.
```
