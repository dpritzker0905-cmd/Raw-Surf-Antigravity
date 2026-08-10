# SOURCE AND HISTORY LEDGER — Weather Simulation 11.0

What was read, by whom, and what was **not** read. Companion ledgers:
`CHAT_AND_HANDOFF_LEDGER.md` (documents), `COMMIT_REVIEW_LEDGER.csv` (100 commits),
`evidence/console/A1-contradiction-ledger.md` (disagreements).

---

## 1. Provenance

| | |
|---|---|
| Repo | `C:\Users\dprit\Raw-Surf` → `github.com/dpritzker0905-cmd/Raw-Surf-Antigravity` |
| Branch | `dev` (backend deploy branch — every push is a production backend deploy) |
| Baseline commit | `3d3ccdc26c120dfb79be2ee5c8e83c25fae1b187`, tree **clean** |
| Commit at close | `9f4f85708e765741d51ac2812de5a36373ac514b` |
| Delta | **1 docs file, +24/−4** (`docs/research/HANDOFF-2026-08-09-D-…md`), fast-forward, no rewrite |
| Cause of delta | A **concurrent session**, same git identity, 18:07:30. **Not this audit** — no mutating git command was run |
| Verification | `git merge-base --is-ancestor 3d3ccdc2 HEAD` → true |
| Impact on findings | **None.** No production source changed |
| Files created by this audit | untracked, **`audit/weather-simulation-11.0/` only** |

---

## 2. Instruction and memory sources read

| Source | Read by | Note |
|---|---|---|
| `CLAUDE.md` (root) | lead + A1 | Binding rules: ONE FORECAST COMPOSITION; three themes; accessibility; release status |
| `AGENTS.md`, `.antigravityrules` | A1 | |
| `BRAIN_RULES.md` (37 KB) | A1 | **"The brain" of this repo.** ⚠️ Contains a committed live credential — **rotate** |
| Project auto-memory `MEMORY.md` + domain indexes | lead | Router file; landmines on height/quality/geometry, deploy topology, instrument reliability |
| `docs/architecture/*.md` (5 files) | A1 | `weather-backend-migration-roadmap.md` = the intended architecture |

## 3. Prior reports and audits read

| Document | Note |
|---|---|
| `MASTER_WEATHER_SIMULATION_REPORT_11.0.md` (repo root, 130 KB) | The running queue R11-01..R11-18 + shipped receipts. **NOT overwritten** — this audit writes to a new path |
| `docs/research/MASTER-AUDIT-{1..11}.0-*.md` | The 1.0→11.0 arc |
| `docs/research/AUDIT-OF-THE-AUDIT-2026-08-03-codex-weather-sim-review.md` | **The Codex audit input.** Read in full by the lead; dispositioned in §13 of the master report |
| `OPUS5_WEATHER_SIM_DEEP_AUDIT_HANDOFF_2026-08-03.md` | The document the Codex review audits — **located via its citation only**; see §6 |
| ~20 most recent handoffs in `docs/runbooks/` and `docs/research/` | A1 → `CHAT_AND_HANDOFF_LEDGER.md` |

## 4. Commit history

- **100 commits** reviewed → `COMMIT_REVIEW_LEDGER.csv` (91.5 KB), window `9f4f8570` … `6b34fef7`.
- Forensic leads answered with git evidence → `evidence/baseline-comparisons/A2-history-leads.md`.

**Baseline-commit finding (the audit brief's explicit question):**

| commit | exists | what it is | baseline? |
|---|---|---|---|
| `b5bbaa7d` | ✅ | 2026-05-27, *world-wrap seam fix — 3-copy rendering*, **1 file +17/−5** | ❌ **CONTRADICTED** — untagged, single-concern |
| `f5f6a3d` | ✅ (unambiguous prefix) | 2026-05-26, *wind/wave zoom advection containment cache bug*, 2 files, **empty body** | ❌ **CONTRADICTED** — no recorded verification |

Both predate `surf_point`, `surf_rating.py`, `science_registry.py` and the shore-normal asset.
**Use them only for the specific behaviour each touched.**

---

## 5. Live runtime evidence (lead auditor, first-party)

18 instrumented probes → `evidence/console/LIVE-RUNTIME-EVIDENCE-PACK.md`. Techniques:
`gl.readPixels` from the MapLibre drawing buffer after a render pass; `requestAnimationFrame` census
by callback identity; webpack module-cache walk; `gl.*` create/delete wrapping across toggle cycles;
`fetch` wrapping for abort/race observation; capture-phase click calibration.

**Every wrapper installed was restored inside the same call.** No production file modified.

---

## 6. What was NOT read or obtained — stated plainly

| Item | Status |
|---|---|
| **Exported chat transcripts ("the previous ten chats")** | ⚠️ **CORRECTION — they exist.** An earlier draft of this ledger said "NOT LOCATED"; that was **wrong**. Verified: **116 `.jsonl` session transcripts, 482.9 MB**, at `C:\Users\dprit\.claude\projects\C--Users-dprit-Raw-Surf\`. Subagent A1 **enumerated the ten preceding sessions and read each one's opening instruction**, but did **not** read ~0.5 GB of message bodies. ⇒ The requirement is **partially met**: sessions identified and framed; bodies unread. Any decision living only in a chat body and never reaching a commit or document is **outside this audit's evidence base**. No chat content is invented anywhere |
| `OPUS5_WEATHER_SIM_DEEP_AUDIT_HANDOFF_2026-08-03.md` (the Codex audit itself) | Referenced through the review that audits it; **the original was not independently opened by the lead** |
| Video recordings | **None captured** — no recording tool in this pane |
| Screenshots | 5 reviewed **inline**; the browser tool returns them in-conversation and does **not** persist them to disk. **No screenshot files exist in `evidence/screenshots/`** |
| Playwright traces, DevTools traces, React Profiler exports, Lighthouse | **None** — not available in this pane |

---

## 7. Division of labour and its confidence consequence

| Agent | Scope | Independently re-verified by lead? |
|---|---|---|
| **Lead (this session)** | All live browser work, the Jacobian, the ladder, capacity, the reports | n/a — first-party |
| A1 | Memory/brain/docs, contradiction ledger, stale-blocker sweep | ❌ |
| A2 | 100-commit ledger, history leads | ⚠️ Partially — **its open question on concurrent renderers was closed by the lead at runtime (REFUTED)** |
| B1 | Frontend architecture + render authority | ⚠️ Partially — RAF/module/renderer claims independently measured live |
| B2 | Backend pipeline, caches, flags | ❌ |
| D1 | React/MapLibre/WebGL static forensics | ⚠️ Partially — GPU lifecycle measured live |
| E1 | Scientific correctness (with executable probes) | ❌ — **its Critical E1-01 is reported on its authority, not the lead's**, though the lead's independent F-04 corroborates it from the runtime side |
| F1 / F2 | Upgrade status, state-of-the-art | ⚠️ **Had not returned at report time.** §15 and §16 state only what measured evidence licenses and say so explicitly |

**Rule applied throughout:** where a finding rests on a subagent rather than first-party measurement,
the report says so. No subagent conclusion is presented as the lead's own measurement.
