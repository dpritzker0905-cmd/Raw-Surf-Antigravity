# Raw Surf coordination record (Claude ↔ Codex)

**Canonical index for cross-agent coordination on Raw Surf.** Authorized by the owner (David), relayed by Codex
2026-11-03 ~02:04Z: "a shared project record between Codex and Claude". `docs/audits/2026-10-28-codex-repair-coordination.md`
is historical and is NOT continued here.

## Protocol (read before editing)
- **One named editor: Claude (lead session `local_d6b521eb`).** Codex supplies updates and receipts in chat. Codex does
  not edit this file while Claude is the editor. The editor role changes only by an entry in the Log, made by the
  current editor.
- **Exact-string updates.** Changes replace an exact existing string, never rewrite the whole file. The
  "Current snapshot" section is replaced as a block. Every replacement also appends a Log line.
- **Append-only Log, with attribution.** Each Log line gives UTC time, author, kind and text. Corrections are new
  lines saying `CORRECTS <time>`. No line is ever deleted or edited.
- **Freshness.** Every snapshot field carries the UTC time it was observed. A field older than 6 h is STALE until it
  is re-read.
- **Evidence labels.**
  - VERIFIED: the editor read it from a primary source, cited here.
  - REPORTED: a party's own claim, not yet read by the editor.
  - REQUEST: someone asked for something.
  - APPROVAL: the owner's own words, quoted, with time.
  A request is never an approval.
- **History is kept.** Failures, skips, cancelled runs, the draft-vs-deployed status and the frontend/backend versions
  each keep their own timestamp.
- **Precedence.** For weather-program state, `docs/weather-program/` (README, STATE, DECISIONS, SCOREBOARD, LESSONS,
  log/, ACTIONS ledger) remains the record. This file only coordinates, and points to it.
- **Raw Surf only.** No secrets, credential values, private chat or session transcripts.
- **This record grants nothing.** It authorizes no implementation, test, merge, deploy, env change, restart or
  qualification.
- **Handoffs (owner instruction, relayed by Codex 2026-11-03 ~02:10Z).** Whenever either side works separately, it
  leaves a timestamped HANDOFF in the Log. The handoff gives:
  - what changed;
  - exact refs (full SHAs, PR numbers) and check/run receipts;
  - reserved files;
  - open risks and decisions;
  - the next owner.
  On resuming collaboration, read the latest handoff and VERIFY current Git, PR and served state from primary sources
  BEFORE editing anything. This record is not approval, and it is not automatically current truth, even when a field
  is under the 6 h stale threshold.

## Current snapshot (as of 2026-11-03T02:07Z unless a field says otherwise)

### Branch heads and deployed versions
| Item | Value | Observed (UTC) | Label | Source |
|---|---|---|---|---|
| DEV head | `12fdcd22839f70c12d80ccb5c2bb5d4c787c5652` (Weather batch 2, #690) | 02:05Z | VERIFIED | `git rev-parse origin/dev` |
| Backend (Render) serving, CURRENT | not read for this record | — | UNKNOWN | needs a fresh verified read |
| Backend (Render) serving, HISTORICAL | `a8e6d0c7` (#644, commit 2026-10-30) | 2026-11-03T00:17Z only | VERIFIED (historical) | E2E run 41549383730: "backend serving a8e6d0c7, not 12fdcd22". Not a claim about 02:07Z or later |
| Frontend (Netlify dev), CURRENT | builds from DEV pushes; deployed SHA not read | — | UNKNOWN | needs a fresh verified read |
| DEV CI at 12fdcd228 | success | 2026-11-03 | VERIFIED | CI run 41549383722 |
| DEV E2E at 12fdcd228 | failure, before the browsers started (backend not on this SHA) | 2026-11-03T00:17Z | VERIFIED | run 41549383730; the same cause at 29f4c3591 (41543535742) and f0721ddff (41537830165), cd09e4e3e (41517795216), 558a1a54f |

### Windows
| Window | Executor | Status | Since (UTC) | Scope |
|---|---|---|---|---|
| Claude merge window | Claude | OPEN, merges PAUSED | opened about 2026-11-02T20:16Z; paused about 2026-11-03T01:49Z | DEV merges only, all `[skip render]`; no restart, env change, deploy or main |
| Codex restart/qualification window | Codex | NOT STARTED | — | Planned after "Claude window closed": one Render deploy of the final SHA, the approved env flips, read-backs, one four-browser E2E. Needs the owner's approval per action |

Merged in the Claude window (VERIFIED, `git log origin/dev`):
- #681 `b175b5283` (carries #680)
- #674 `cd09e4e3e`, a merge commit carrying #669, #671, #670, #668 and #564
- #687 `558a1a54f`, at Codex-qualified head `d8295796`
- #672 `6a00e7f6e`
- #682 `f0721ddff`
- #673 `29f4c3591`
- #690 `12fdcd228`, a merge commit carrying #678, #683, #684, #685 and #686

### Owners and reserved files
| Owner | Job | Branch / worktree | Reserved files | Label |
|---|---|---|---|---|
| Claude | #675 rollout v2 draft (owner chose "Build v2 as a draft", 2026-11-03 ~01:47Z) | `claude/euro-estimate-continuity`, detached `C:/t/r675v2` | `backend/services/weather_pipeline/rollout_675.py` (new); `copernicus_validator.py`; `lattice_fill.py`; the EURO tail path in `euro_marine_coarse_ingestion.py`; `capabilities.py`; `prune_object_protection.py`; the `product_object_gc` module; `backend/scripts/restore_rollout_snapshot.py` (new); new tests; possibly `forecast-ingest*.yml` and `routes/admin/surf_forecast.py`; #675's log and its ledger.d file | REPORTED (building; exact list follows when pushed) |
| Claude | Evaluation Harness v0 draft (owner's evaluation-first decision, 2026-11-03 ~00:32Z) | `claude/eval-harness-v0`, `C:/t/eh0` | a new harness module and CLI under `backend/` (names pending); an optional manual-only workflow; `docs/weather-program/evaluation-harness.md`; `log/2026-11-02-claude-eval-harness-v0.md`; its ledger.d file | REPORTED (building) |
| Claude | this record | `claude/raw-surf-coordination`, `C:/t/coord` | `docs/audits/RAW-SURF-COORDINATION.md`; `ledger.d/claude--raw-surf-coordination.jsonl` | VERIFIED |
| Shared hot pair | — | — | `.github/workflows/ci.yml` and `backend/tests/test_ci_floor_staleness.py` (CI floors). Whichever PR merges second re-derives its floors | — |
| Codex | App/Grom/harness work frozen | — | Codex avoids Claude's weather files and the shared floor pair | REPORTED by Codex, 2026-11-03 ~01:54Z |
| Codex App | GearHub retailer repair (local) | — | `GearHub.js`, `GearHub.retailer.test.js` (Codex App alone). No overlap with weather or the CI-floor pair | REPORTED by Codex, 2026-11-03 ~02:49Z |
| Claude | Evaluation Harness v0: now draft PR #695 | `claude/eval-harness-v0` | as above | VERIFIED 02:53Z: head `6c570ade8623ebc44b8b959b4402de49b9c0b2b8`; CI run 41566371752 completed **success**. The build agent's final report is pending |
| Claude | #675 v2 draft | `claude/euro-estimate-continuity` | as above | VERIFIED 02:53Z: remote head still `0f9b2f59c969122eb43eaa1188304516fdadad75` (v2 not pushed yet); the build is still running |
| Claude (research subagent) | Weather-sim research: #675 v2 and evaluation operations (accuracy/freshness metrics, writer/reader revision proof, cross-writer publication/recovery, automated operator gates). Reconciles existing research first | none (read-only on repos) | reserves NO repo files. Writes only the scratchpad and one memory file (`research-v2-eval-operations-2026-11-03.md`). Must not touch `C:/t/r675v2`, `C:/t/eh0`, the GearHub files or the CI-floor pair | VERIFIED: started 2026-11-03T02:55Z. Research only: no source/config/tests/CI/merge/deploy/restart/main/live qualification, no new spend/top-ups/credentials/installs/exports |

### Pending PRs (each needs the owner's own go-ahead, per PR, at an exact head)
| PR | Title | Head (full) | State | Depends on | Decision needed | Label |
|---|---|---|---|---|---|---|
| #675 | replace-before-prune estimates + lattice ghost refresh (D-060..062, ON + kill) | `0f9b2f59c969122eb43eaa1188304516fdadad75` (moves when v2 lands) | CLEAN at that head; draft | the v2 patch, its review and green CI | review v2, then an exact-head merge; the deploy window is separate | VERIFIED 02:05Z |
| #676 | GFS pilot boxes at the full 14 d horizon (D-061) | `32189ea8df1a2a6846c050c8b0d0b31eea5ea47c` (local merge `6309ee877`, unpushed) | DIRTY | after #675, or rebased; conflicts with #677 in the pilots env | exact-head merge | VERIFIED 02:05Z |
| #677 | EURO swell partitions at 2 deg + frame sets (D-062) | `09255eb7c4041d5c160ac47576e44732c5821b34` | DIRTY | after #676 | exact-head merge | VERIFIED 02:05Z |
| #691 | GFS swell partition tracking (dark `SURF_PARTITION_TRACKING`) | `1bab3ecae283bf4cd4616815e0d696099d298250` | DIRTY | none | merge dark; do not flip | VERIFIED 02:05Z |
| #662 | EURO/ICON scalar-height shadow lanes (serve nothing) | `588c6c0ce75409e2276dd886b182e1ee98926822` | DIRTY | none | merge dark | VERIFIED 02:05Z |
| #375 | consensus direction + period buoy grading (measurement only) | `7190ae5de8fad18719390ce68af2bd5f219f1d07` | DIRTY | none; its period half is superseded by #686 | keep as a measurement, or close | VERIFIED 02:05Z |
| #688, #693, #692 (+#689), #679 | Codex app candidates (Messages, photographer, Zoomlab, cancellation) | as Codex reports | drafts or ready | #692 builds on #689 | owner, separately | REPORTED by Codex |
| #694 | fix(bookings): bind balance reads to the committed session (App balance repair) | head `4fd7f5695ed49fb650e3d49faed710a7fa9f03a7`, base `12fdcd22839f70c12d80ccb5c2bb5d4c787c5652` | VERIFIED 02:19Z: OPEN, draft, MERGEABLE, no auto-merge; CI run 41562727512, attempt 1, 12/12 jobs success at that head. REPORTED (App terminal reviewer / owner, ~02:18Z): temp merge `beaf13f3ce3da594a08306f1b02c6bce08b51ef6`, tree `ea446db68f249cbe7a920ae8b8590b6a729d0929`; LH, Encoding and LOC success; terminal review PASS, receipt sha256 `21f3c14a4230a33cba6055803477ff80823784de02be48328571d41ffa3ed771`; frozen 45-input manifest sha256 `89e82fa42bac152ffa247d1c3b88e3582cc48b25d976cc336e0d1d393ca78b98`; frontend 627 suites / 8188 tests (balance included, build warnings); chain 3172; estate 3408 pass / 2866 skip; sim 3351 pass / 66 skip / 1 xfail (XML 67 skip); Postgres 33 pass; nonadditive; clean checkout; no active watcher or queued action | none stated | owner, separately. NOT accepted: E2E, Safari, latest DEV, backend, deployment | VERIFIED where marked; the rest REPORTED. Supersedes the 02:13Z row ("main CI and backend lanes PENDING") |

### Approvals on record (owner's own words; a relay is marked as such)
- 2026-11-02 ~20:04Z: "Merge and push what needs to be". Then at ~20:16Z: "if you're doing the merge yourself, then do
  the merges" (in Claude chat). Covers the PRs listed at that time: #681, #674, #672, #682, #673, weather batch 2. Plus
  ~20:56Z: "Merge #687 too".
- 2026-11-03 ~00:32Z (relayed by Codex). The owner's own words were "Sounds good. I approve of that. Move forward. Thank
  you.", in reply to the evaluation-first plan. The #675 merge was expressly separate.
  - The phrase "TRUTH / REFERENCE DATA AND EVALUATION INFRASTRUCTURE FIRST" was Codex's planning context, NOT a
    verbatim quote of David. Corrected 2026-11-03T02:13Z; the original wording is kept in the Log.
  - Explicitly not granted: #675 merge, deploy, env, restart, main, browser rerun, gate waivers, all builds, flipping
    scientific defaults.
- 2026-11-03 ~01:47Z: "Build v2 as a draft" (owner selected it in Claude chat; Codex confirmed). Draft authority only.

### Next actions
1. Claude: finish #675 v2 draft and Evaluation Harness v0 draft. Report their exact heads, files and CI receipts here.
2. Owner: per-PR, exact-head merge decisions for #675 (after v2 review), #676, #677, #691, #662, #375.
3. Claude: when the train finishes, post "Claude window closed" with the full final SHA.
4. Codex, with the owner's approval per action: the restart/qualification window.

## Log (append-only; UTC; author; kind; text)
- 2026-11-03T02:07Z · Claude · created · Record created on the owner's authorization relayed by Codex at ~02:04Z.
  Snapshot built from `git`/`gh` reads at 02:05Z, plus the E2E receipt 41549383730.
- 2026-11-03T02:13Z · Claude · protocol · Added the HANDOFF requirement (owner instruction relayed by Codex ~02:10Z):
  leave a timestamped handoff when working separately; verify Git/PR/served state before editing on resume; the record
  is not approval or automatically current truth. ACKNOWLEDGED by the editor.
- 2026-11-03T02:13Z · Claude · correction · CORRECTS 2026-11-03T02:07Z. The backend row said "`a8e6d0c7` …
  2026-11-03T00:17Z … VERIFIED" under a snapshot dated 02:07Z. It is now a HISTORICAL observation at 00:17Z only, and
  the current backend and frontend are UNKNOWN until fresh verified reads.
- 2026-11-03T02:13Z · Claude · correction · CORRECTS 2026-11-03T02:07Z. The approval line quoted "TRUTH / REFERENCE DATA
  AND EVALUATION INFRASTRUCTURE FIRST ... Move forward." as the owner's words. The owner's actual relayed words were
  "Sounds good. I approve of that. Move forward. Thank you." The capitalised phrase was planning context.
- 2026-11-03T02:13Z · Claude · update · Added #694 (App balance repair draft) as REPORTED by Codex. It supersedes the
  earlier private-balance snapshot. No merge or browser approval.
- 2026-11-03T02:19Z · Claude · update · #694 publication closeout, from Codex's report at ~02:18Z. The editor
  independently read: head `4fd7f569…a7`, base `12fdcd22…5a`, OPEN/draft/MERGEABLE, no auto-merge, CI 41562727512 attempt
  1 12/12 success. The terminal-review and manifest receipts, lane counts, clean checkout and "no queued action" are
  REPORTED. This supersedes the 02:13Z PENDING row. No E2E, Safari, latest-DEV, backend or deployment acceptance. Codex
  verified record 091ec5f7 and acknowledged the handoff protocol.
- 2026-11-03T02:55Z · Claude · task-start · Research subagent launched on the owner's request (relayed ~02:49Z). Scope
  and boundaries are in the Owners table. No repo files reserved. It will report which tools it used and which were
  unavailable, with provenance.
- 2026-11-03T02:55Z · Claude · update · Codex App's GearHub reservation recorded. Eval Harness v0 is draft PR #695 at
  `6c570ade…b8`, CI 41566371752 success (VERIFIED). The #675 v2 remote head is unchanged at `0f9b2f59c…75`
  (VERIFIED); the build is still running.
- 2026-11-03T02:55Z · Claude · diagnosis · Codex's hung render-hook question. Read-only `Win32_Process` listing at
  ~02:52Z; nothing was executed, edited or killed.
  - VERIFIED: PIDs 78792 and 13772 (created 02:30:37-38Z) run `bash.exe --login -i
    C:\Users\David\.codex\plugins\cache\claude-plugins-official\render\0.3.0\scripts\validate-render-ya…`, i.e. the
    **.codex** copy of the hook. Their parent 71272 is not running. A sibling `cat.exe` (PID 47992, 02:30:38Z) has a
    parent, 13456, that is not running either.
  - VERIFIED: none of them descends from this Claude session's process (claude.exe PID 16136). This session's own
    children are: subagent shells; one subagent's `gh run view 41566371752` wait loop (that run has completed, so the
    loop should exit on its next poll); and the remember plugin's post-tool hook (.claude path).
  - Assessment (INFERENCE): the stuck process is Codex-side, started from the .codex hook path. `--login -i` with `cat`
    on stdin plausibly waits on an open interactive stdin. Claude neither owns nor awaits it. It blocks no current
    Claude task: Eval CI completed, and the v2 build is progressing.
