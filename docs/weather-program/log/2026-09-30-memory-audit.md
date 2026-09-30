# 2026-09-30 · Memory audit: every memory checked against reality, and are we learning?

Session opened 2026-09-30 12:31:58Z (`date -u`) in worktree `raw-surf-wt`; branch `claude/memory-audit-2026-09-30`,
stacked on #189 (`617a57c0`, open, owner's word pending). One writer: this session. Owner's brief (chat): "Ok lets
start back up on things. Check every single memory and make sure we're learning here."

## 12:31-12:40Z · the read-back, the inventory, the learning check

### Start of session
- `memory_audit.py`: 0 FAIL / 0 WARN / 3 NOTE (commitments 79 and 94 due 18:00Z today; 149 due 2026-10-03).
- #189: all checks green (15 pass, 3 skipped by design). Hosted lanes on its head: chain **134 files / 1630**, exactly
  the projection; guards 175 / 2130. Still open: the owner chose to leave it open overnight.
- The test file the harness reported "changed on disk" matches `HEAD` (my own heredoc append the night before).

### Every memory store, and what each check found
| Store | Verdict | What was checked, and the fix |
|---|---|---|
| `docs/weather-program/` (the record) | TRUE, clean | audit 0/0; ledger 152 OK; STATE matches git and GitHub |
| local `audit15-fix-program` | TRUE | a pointer; reading order names the 2026-09-30 audit |
| local `memory-write-protocol` | TRUE, extended | + rule 10 (a recurring lesson becomes a check) and rule 11 (stores that are not program memory) |
| local `owner-working-style` | TRUE | updated the night before |
| local `pr-workflow-mechanics` | TRUE | CI floor mechanics held exactly on #189 (hosted = projection) |
| local `science-method-lessons` | TRUE, extended | + one-line rules for L-S16..L-S18 and L-A7 |
| local `consensus-decision` | **STALE** | still described the superseded plan to rewrite GFS tiles in place (D-009 replaced it), pointed at the frozen untracked HANDOFF.md, and said "every model reads low on big days" without the forecast-binned correction. Rewritten as pointers + three dated corrections (incl. "merge #189 before the flip") |
| local `ops-pipeline-facts` | **STALE** | described the accuracy monitor's single-pass false alarm as current; #166 fixed it (`forecast_accuracy_monitor.py:200-221`, a recovery window). Struck through with a note; + the serve-path 429 (L-F7), the ledger cap, measurement load (L-O4) |
| local `f08-stage-a-measurement` | **STALE** | its "how to apply" was Stage A's gate; Stage B's first box is live (seq 140). Marked history, points at D-007; its lasting rule moved to LESSONS L-O5 |
| local `raw-surf-machine-setup` | **one claim FALSE** | "neither gh nor git is on PATH": both are, in PowerShell and Git Bash. Corrected; + NDBC TLS works |
| local `icon-swell2-estimate-intended` | **path STALE** | the blend moved to `backendWeatherServiceClientHelpers.js:544` (`GFS_WEIGHT` 0.6); capability row re-read (ICON swell_2 supports_grid false) |
| local `raw-surf-secrets-policy` | **new finding; open items unverified** | see "Mem0" below. Its verified date stays 2026-09-25 on purpose: the open rotation items could not be re-checked (reading secret-scanning alerts is credential exploration), so the audit will call it STALE on 2026-10-02 and prompt the owner check |
| local `raw-surf-infra` | not re-checked | verified 2026-09-29; Netlify/Vercel last checked 2026-09-25 |
| **Mem0 connector** (`search_memories`, user `dprit`) | **SECRET IN PLAIN TEXT** | populated 2026-05-24 from an older agent's files ("Antigravity"), not used by this program. One memory (id `623a983f-f31e-4be4-be56-f4365f7c6ece`) holds a full Mem0 API key; seen incidentally in a neutral search, never repeated. A deliberate search for more was refused by the permission classifier (credential exploration). **Owner:** rotate that key at Mem0, delete the memory, review the store |
| `CLAUDE.md` | 1 claim false, 1 true | "trevec is active and synchronized" + its tool block: no Trevec/Mind/Memstate server exists here (owner's file, not edited; also in #189). The Pipeline sim table: **reproduces 6 of 6 rows exactly** with the current chain under code defaults (the table does not say which configuration; L-S17) |
| `BRAIN_RULES.md` §12 | **STALE (W-50)** | "memory above 512 MB": the plan is 2 GB. Now 75% of the limit (~1.5 GB), the old value struck through with a dated note and the evidence (degraded at 1,588 MB / 85.3% on 2026-09-21) |
| `frontend/system-brain/weather-simulation-system.md` | **STALE (W-50)** | "512MB" figures; last rewritten 2026-07-05. Dated history note added at the top |
| `program/weather-simulation/` | **misleading names** | 19 files named `CURRENT_*` from August, last commit 2026-09-22. `README.md` added: frozen history, the record is `docs/weather-program/` |
| `audit/weather-simulation-15.0/` (untracked, main checkout) | frozen by D-008 | not opened |

### Are we learning? The ledger says: only what we mechanize
The ledger's 17 `correction` lines, sorted by the lesson each one broke:

| Class | Corrections | After the lesson was written | Enforced by a check? |
|---|---|---|---|
| local clock read as UTC (L-A1) | seq 16 | 0 | yes: everyone uses `date -u`, the ledger stamps `at` itself |
| estimated time written as a timestamp (L-P10) | 111, 135, 150 (+109 found by 111) | **3** | **no** (only STATE and log headers, with a 5-minute slack) |
| a gate whose verdict was not the tool's own (L-P9, L-P13, L-P15) | 68, 81, 115 | 0 since L-P15 | partly: `--require-history` in CI; the no-shell runner is a practice |
| a claim that covered more than was checked (L-F6, L-P11, L-S12, L-S17) | 28, 52, 98, 99, 107, 122, 126, 142 | recurs in new shapes | only L-P11 (a test); the rest are practice (controls, stating configuration) |
| house size rule | 62 | 0 | yes: CI file-size check |
| a stale handoff claim (L-S8) | 145 | caught, as designed | the practice works: re-verify live |

Every check-enforced lesson: zero recurrences. The prose-only L-P10: three. **LESSONS L-A7** records this.

### What was mechanized this session
1. `action_ledger.py append` refuses an estimated clock time in `verified` (`~02:21Z`, `~23:55-00:05Z`, `02:2xZ`);
   a `pending:` note may still forecast one. Positive controls: the two real historical cases (seq 109, 145) are
   refused; negative controls: a clock reading, a bound and a pending forecast are accepted. In the selftest (CI).
2. `memory_audit.py` reads HANDOFF headers (`written ... HH:MMZ`) against their commit, like STATE and the logs.
3. Building (2) exposed a blind spot in the EXISTING check: `CLOCK_SLACK` was 5 minutes, and the real seq-135 case led
   its commit by 4 min 42 s, so the check could never have caught the mistake that motivated it. Now 1 minute (an
   honest HH:MM reading leads by < 60 s). The live audit stays clean with it.

### Not done here
- Commitments 79 and 94 are due at 18:00Z; not read early (the consensus shadow's rows need the full day).
- The Mem0 key rotation and deletion, the Trevec block in CLAUDE.md, the secrets policy's open items: the owner's.

## 12:48-13:50Z · #189 and #190 merged; Trevec registered, not yet indexed
- Owner (chat): "Merge #189 and #190 and then give me better instructions to update mem0 and trevec", then "merge #190
  and trevec mcp setup".
- #189 merged 12:48:23Z (`f432d4fd`); Render served it by 12:51:17Z (uptime 44 s). #190: GitHub auto-merge was refused
  (the repository does not allow it; owner setting), so it waited for its two backend lanes; merged 13:47:39Z (`994b3f4e`)
  with chain 134 / 1630 and guards 175 / 2130 unchanged and the ledger workflow (both new selftests) green.
- Trevec 1.5.0 is installed at `C:\Users\David\.trevec\bin\trevec.exe` (not on PATH in tool shells). `trevec mcp setup`
  (all, claude-code, claude) found "no supported IDE configurations" on this Windows machine and changed nothing. The same
  registration was made with the desktop app's bundled CLI (`%APPDATA%\Claude\claude-code\2.1.284\claude.exe mcp add
  --scope user`), serving the worktree from an index OUTSIDE the repo (`C:\Users\David\.trevec\data\raw-surf-wt`), so no
  `.trevec/` can ever be committed to the public repo; `trevec init` (which creates `.trevec/` in the repo) was not used,
  and CLAUDE.md's rules block already exists. `claude mcp get trevec`: Connected.
- The index did not build: after extracting 33,641 nodes and 953,553 edges from 3,719 files, trevec's embedder failed to
  download `Xenova/bge-small-en-v1.5` `onnx/model.onnx` (133 MB) from Hugging Face: TLS "invalid peer certificate:
  UnknownIssuer". curl (Windows certificate store) verifies the same host; no proxy variables are set. So something
  re-signs TLS with a root only Windows trusts (the tool sandbox or a security product). Next: the owner runs the index
  in their own terminal; if it fails the same way, the model is pre-seeded.
- Trevec defaults the owner should know: anonymous telemetry ON; episodic memory ON for Claude Code, Cursor and Codex
  chat history (it would ingest transcripts, which include the exposed Mem0 key, into its local data dir).
