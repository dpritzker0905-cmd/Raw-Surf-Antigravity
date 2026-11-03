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
- 2026-11-03T02:58Z · Claude · handoff · Eval Harness v0 build finished; the build agent reports DONE.
  - Draft PR #695, head `6c570ade8623ebc44b8b959b4402de49b9c0b2b8`. Hosted CI green (run 41566371752; VERIFIED above).
  - REPORTED by the build agent: chain lane 3227 across 191 files (+55 tests, floor 3221); guards 3351; estate 3408.
  - Files (REPORTED):
    - 7 new `backend/services/weather_pipeline/eval_*.py` modules;
    - `backend/scripts/eval_harness.py` and `eval_harness_stations.json`;
    - a manual-only `.github/workflows/eval-harness.yml`;
    - tests `test_eval_harness_{provenance,scoring,e2e}.py`, plus fixtures;
    - `docs/weather-program/evaluation-harness.md`, its log, and `ledger.d/claude--eval-harness-v0.jsonl`, whose
      line 2 commits to a production-parity run by 11-16.
  - Demo, REPORTED and NOT production-parity: inputs were substituted because pygrib is absent on Windows. On
    `hs_station`, the served chain read low (bias −0.229 m) and lost to station climatology on CRPS, −0.072
    [−0.113, −0.019]. The null and positive controls pass. A SURF_TIDE_DEPTH demo was REFUSED: it changed 0 spot-hours.
  - Next owner: the owner, for review or merge of #695 at an exact head. No reserved files remain open for this job.
- 2026-11-03T03:14Z · Claude · task-start · Three jobs started on the owner's chat words at ~03:05-03:08Z: "If we need
  it, put it on" (GRIB reader), "I agree with you" (climatology ratchet), and "research wider using new methods not
  used yet. Be inventive."
  - Local environment: ECMWF `eccodes` 2.50.0 (official win_amd64 wheel, bundled library) installed into the
    backend venv. VERIFIED by decoding a public NOMADS GFS-Wave subset (swh, perpw). No repo change.
  - (1) #695 harness v0.1 DRAFT revision: an eccodes GRIB backend, the climatology RATCHET rule, out-of-sample
    climatology enforcement, and a demo rerun. Reserves `claude/eval-harness-v0` / `C:/t/eh0`: the eval_* modules,
    `eval-harness.yml`, the eval tests, `evaluation-harness.md`, its log and ledger fragment, and the CI-floor pair.
  - (2) Inventive research A (new truth/data sources) and (3) inventive research B (new math/ML methods). Both are
    read-only and reserve no repo files. Each writes one memory file and the scratchpad.
  - None of the three may merge, dispatch, change env/Render/Netlify, deploy or touch main.
- 2026-11-03T03:20Z · Claude · checkpoint · HANDOFF (requested by Codex for David). Grants nothing.
  - **Heads (VERIFIED 03:19Z):** DEV `12fdcd22839f70c12d80ccb5c2bb5d4c787c5652`. Claude window OPEN, merges PAUSED.
    No merge, flag, config, restart, deploy or main action by Claude since the 01:49Z pause.
  - **#675 v2, NOT frozen.** The build is still running. Remote head moved `0f9b2f59c…75` → `be474a8b7498f16d56f1d057798eccbbba379f63`;
    mergeStateStatus BLOCKED while hosted CI runs. Its readiness waits on the build agent's final report, full CI and
    Claude's review. Reserved files as in the Owners table.
  - **Eval harness #695**, head `6c570ade8623ebc44b8b959b4402de49b9c0b2b8`, CI green. Revision v0.1 (eccodes backend,
    climatology ratchet, out-of-sample climatology, demo rerun) is building in `C:/t/eh0`, not pushed yet.
  - **Flip automation (owner's question, ~03:05Z):** the harness IS the per-flip gauge. Today it runs offline/CLI and
    by a manual-only workflow. Running it automatically on each flip-candidate PR would be a CI-trigger config change
    and needs the owner's explicit approval. Not started.
  - **GRIB reader (VERIFIED, local only; NOT production-parity qualification):**
    - Environment: `C:/Users/David/App/raw-surf/backend/.venv`, Python 3.12.10, AMD64, Windows.
    - `pip download --only-binary :all:` showed: no Windows wheel for `pygrib==2.1.8` ("No matching distribution");
      `eccodeslib` not found; `eccodes-2.50.0-cp312-cp312-win_amd64.whl` (PyPI, ECMWF) available.
    - Installed `eccodes==2.50.0`, plus dependency `findlibs-0.1.4` (`cffi` and `pycparser` already present).
      `codes_get_api_version()` = 2.50.0, from the bundled library.
    - INITIAL FAILURE: the first decode attempt picked the wrong file (a `find` matched `eval_grib2.py`, a source file)
      and raised `UnsupportedEditionError` — a test-selection error, not a library fault.
    - REMEDY: fetched a 1,393-byte public NOMADS `filter_gfswave.pl` subset (gfs 2026-11-02 00Z f024, HTSGW+PERPW,
      30-36N 238-244E). It decoded 2 messages: `swh` and `perpw`, 600 points each. Value ranges were not checked; the
      printed max 9999 is the missing-value code.
  - **Inputs still differing from production in harness runs:**
    - native 0.25° crop instead of the served tiles;
    - wind from the wave file in v0 (v0.1 adds the pgrb2 10 m wind via eccodes; pending);
    - the storage size climatology is unreachable offline;
    - scores are pre-obs-gate;
    - no `best_tide` prior;
    - display swell.
    `production_parity` is not established.
  - **Research lanes:** v2/eval operations (started 02:55Z); inventive A, truth/data sources (03:08Z); inventive B,
    math/ML methods (03:08Z). All running, read-only, reserving no repo files.
  - **Pending PR decisions (owner, per PR, at an exact head):**
    - #675: after the v2 review; head moving.
    - #676: local merge unpushed; DIRTY.
    - #677: after #676; DIRTY.
    - #691: dark; DIRTY.
    - #662: dark; DIRTY.
    - #375: keep or close; DIRTY.
    - #695 and #696: drafts.
    Dependencies are as in the PR table.
  - **Codex App (REPORTED by Codex, ~03:19Z):**
    - Gear #58 LOCAL two-file repair complete and independently accepted. Review sha256
      `0fb0059543cd837068635de2c4caa758e6931b4aa7fc4c73716e85a5a8679e58`; v2 manifest
      `e2d5c553959e961c28b3149ed06ce6d2e2023143ec149773801ac2fca80a10a8`; 34 real-component cases RED→GREEN; scoped
      lint clean.
    - Limits retained: no browser proof; 4 React act warnings; 401/403/account-ABA/abandoned-render paths unexecuted.
      Source private and unpublished.
    - #694 balance and the #688/#693/#692 publication-stage CI are terminal green at their recorded heads. They remain
      drafts and unmerged. This is not current-DEV, backend or browser acceptance.
    - #689 and #679 stay separate.
  - **DEFERRED user items** (outside original completion counts; REPORTED; App worklist appended 03:01:35Z, sha256
    `9233cec22bcd753266fec1264372394ddb5a78034be61802ee0ca98efa81476b`):
    - (a) user-observed distorted or poor-resolution feed photos/videos; cause unverified; investigation later;
    - (b) possible future private GitHub visibility; needs an impact review and an explicit later settings approval.
    No investigation or settings change has started.
  - **Render hook (REPORTED):** David manually closed the stale Render-hook window. No further hook work.
- 2026-11-03T03:24Z · Claude · finding-routed · Codex's bounded #695 review, P2, bound to head
  `6c570ade8623ebc44b8b959b4402de49b9c0b2b8`.
  - The finding: `eval_provenance.http_get` checks only the initial URL, then uses default `urlopen`, whose
    HTTPRedirectHandler follows redirects without the HTTPS/host allowlist. An allowed URL could therefore redirect to
    a denied or unknown host, or to plain HTTP. Provenance also keeps only the initial URL.
  - VERIFIED in source by Claude (`git show 6c570ade…:backend/services/weather_pipeline/eval_provenance.py`, around
    lines 70-85). No live reproduction; static source plus documented library behaviour.
  - Routed to the EXISTING v0.1 owner (the harness revision agent, `C:/t/eh0`). The fix: a private opener that
    validates every redirect target BEFORE it is followed (hop cap 3), or refuses redirects. GET, Range, byte caps and
    the 206 check are kept. The final destination and the redirect chain go into provenance.
  - Offline tests: allowed→allowed, allowed→denied, allowed→unknown, https→http downgrade, a chained denied target,
    and the hop cap; each refusal is asserted before contact.
  - No Codex writer or test run. The outcome will be rebound to the new v0.1 head in its handoff.
- 2026-11-03T03:30Z · Claude · scope · Flip-PR scorecard automation: authority reconciled.
  - EXISTING APPROVAL (owner, Claude chat ~03:05Z, verbatim): "we need a testing automation to help guage a flip each
    time, right?" Then: "IF we need it, put it on. I agree with you as well with those questions I asked."
  - SCOPE TAKEN: build the per-flip automation as a DRAFT inside #695, extending the manual-only `eval-harness.yml`.
    Claude's later yes/no question about this is WITHDRAWN as redundant.
  - NOT COVERED (separate owner word each): (a) merging #695, which would make the trigger live on dev; (b) a
    required-check / branch-protection setting. (b) is not proposed.
  - CONTRACT:
    - Trigger: `pull_request` labeled/synchronize/reopened, with label `flip-candidate`, plus the declaration file
      `docs/weather-program/flip-candidates/<slug>.json`. A missing declaration is INVALID; same-repo PRs only.
    - Comparison: base = merge-base SHA with dev, using its served env; candidate = head SHA, with that env plus the
      declared flags. Zero changed spot-hours is REFUSED.
    - Data: public immutable archives (NOAA AWS GFS-Wave by byte range; NDBC/CDIP historical), over a pinned past
      window, cached with `actions/cache`. GFS only. No app/backend/Render, no auth, no secrets, no Supabase.
    - Limits: ubuntu, 60 min, at most 400 range downloads plus a byte cap; no spend (public-repo runners).
    - Output: a 14-day artifact and one edited PR comment. Permissions `contents: read` and `pull-requests: write`.
    - Outcomes stay distinct: PASS / FAIL / REFUSED (underpowered, no change, controls, substitutions) / INVALID.
  - Starts AFTER v0.1 hands off, with the same owner.
  - Never automatic: flag activation, merge, deploy, env, restart or main.
  - Unproven: production parity; 6 stations, one autumn window; Hs/period only, not breaking height or rating.
- 2026-11-03T03:46Z · Claude · handoff · The #675 v2 build has finished.
  - **Head (VERIFIED 03:33Z):** `be474a8b7498f16d56f1d057798eccbbba379f63`. CLEAN, draft, 16/16 checks success.
  - **Hosted CI (REPORTED):** run 41569742988: chain 3225/190 (floor 3219), guards 3351, estate 3408.
  - **Files.** New:
    - `rollout_675.py`, `rollout_675_finish.py`, `rollout_675_io.py`, `rollout_675_restore.py`, `rollout_675_reader.py`
    - `scripts/restore_rollout_snapshot.py`
    - `tests/test_rollout_675.py`
  - **Files changed:**
    - `copernicus_validator.py`, `lattice_fill.py`, `euro_marine_coarse_ingestion.py`
    - `product_object_gc.py` (`only=` scope; marks file `product_gc/marks_675.json`)
    - `capabilities.py` (799 lines), `store.py`
    - `scripts/ingest_forecast_ci.py`, `forecast-ingest.yml`
    - the CI-floor pair
    - #675's log and its ledger.d line 2
  - **Owning lane: core.** Pilots runs none of the new rules.
  - **Codex's requirements (REPORTED; tests named):**
    - snapshot-before-first-mutation, with sha256 read-back; a partial snapshot leaves zero mutation;
    - restore refuses on newer data from either lane, or on a sha change; the head is re-read before republish.
  - **Residual:** a lost entry is caught one run late; BLOCKED holds only the #675 rules.
  - **Still needed (owner):**
    - an exact-head merge;
    - a reader deploy window (#684, `PRODUCT_REVISION_REFRESH=1`, the `/capabilities` fields) plus one `revision_probe`
      read-back;
    - standing restore/kill authority.
  - Next owner: the owner, for review.
- 2026-11-03T03:46Z · Claude · research · v2/eval operations lane finished (REPORTED; memory
  `research-v2-eval-operations-2026-11-03.md`).
  - **Key correction:** the manifest commit ALREADY has compare-and-swap. It uploads a unique copy, then swaps a
    Postgres pointer WHERE generation = expected (`manifest_pointer.py`, `manifest_publish_step.py`; on in all 3 lanes
    since 10-17). The remaining last-writer-wins surface is the per-entry merge rule plus the object bytes.
  - **Proposed smallest fixes (none started; owner approval needed):**
    - merge on `(run_time, ingested_at)`;
    - 60 s cache-control on rewrite classes;
    - a reader generation high-water mark;
    - deletes skip the reader's loaded generation.
  - **Gates:** hard invariants plus per-cycle CUSUM; detecting a 2 cm accuracy gain needs ~141 target hours.
  - **Post-flip monitoring:** use sequential testing.
- 2026-11-03T03:46Z · Claude · task-start · Two read-only research lanes. Neither reserves repo files.
  - **Surfer-facing logic** (owner, ~03:31Z: "better surf forecasting and any logic for surfers ... state of the art").
  - **Spot hubs and infoboxes** (owner, ~03:34-03:41Z): tides in every infobox (full hub, pinned hub, GPS marker);
    hub surf-report correctness; a forecast window matching the picker/scrubber and the tiers (free = day-of + 2 d,
    basic 7 d, premium 14 d); our own forecast charts in the rating colours, replacing Open-Meteo.
  - Static lead read, VERIFIED on origin/dev:
    - the full hub (`SpotConditions.js:169-171, 370-388`) shows tides;
    - the pinned drawer (`UnifiedSpotDrawer.js`) loads tide data but does not render it;
    - the GPS infobox (`MapForecastOverlay.js`) has no tide, although `/point` returns one when RATING_TIDE is on.
