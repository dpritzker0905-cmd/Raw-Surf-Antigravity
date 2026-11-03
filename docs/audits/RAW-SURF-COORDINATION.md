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

## Current snapshot (as of 2026-11-03T02:07Z unless a field says otherwise)

### Branch heads and deployed versions
| Item | Value | Observed (UTC) | Label | Source |
|---|---|---|---|---|
| DEV head | `12fdcd22839f70c12d80ccb5c2bb5d4c787c5652` (Weather batch 2, #690) | 02:05Z | VERIFIED | `git rev-parse origin/dev` |
| Backend (Render) serving | `a8e6d0c7` (#644, commit 2026-10-30) | 2026-11-03T00:17Z | VERIFIED | E2E run 41549383730: "backend serving a8e6d0c7, not 12fdcd22" |
| Frontend (Netlify dev) | builds from DEV pushes; deployed SHA not read for this record | — | UNKNOWN | to be read and stamped separately |
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

### Approvals on record (owner's own words; a relay is marked as such)
- 2026-11-02 ~20:04Z: "Merge and push what needs to be". Then at ~20:16Z: "if you're doing the merge yourself, then do
  the merges" (in Claude chat). Covers the PRs listed at that time: #681, #674, #672, #682, #673, weather batch 2. Plus
  ~20:56Z: "Merge #687 too".
- 2026-11-03 ~00:32Z (relayed by Codex): "TRUTH / REFERENCE DATA AND EVALUATION INFRASTRUCTURE FIRST ... Move forward."
  Explicitly not granted: #675 merge, deploy, env, restart, main, browser rerun, gate waivers, all builds, flipping
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
