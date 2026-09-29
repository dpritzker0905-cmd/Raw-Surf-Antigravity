# Lessons (append; correct with a dated note, never delete)

Each lesson came from a concrete wrong turn. The date and PR say where. Read the section that matches your task
before starting it.

## Science and measurement

- **L-S1 · Measure before building, and expect the hypothesis to fail.** "Drop ICON from the consensus" looked right
  on one judge run and failed on the ledger (big swells) and nearshore: GFS reads low, ICON high, and they cancel in
  the equal mean. Build the instrument first (judge arm, ledger split), decide after. (2026-09-29, #155/#156)
- **L-S2 · Compare candidates on the same rows.** Member arms on their own rows are not comparable. Use paired
  (`SAME_ROWS`) grades, or the ledger's all-members-present pairs. (#155)
- **L-S3 · Overlapping windows are one sample.** Three judge runs with 24 h backfills dispatched within 1.5 h are
  about one day of evidence, not three. (2026-09-29)
- **L-S4 · A null candidate must be exactly null; every instrument needs a positive and a null control.** The shadow
  A/B compared candidates with the persisted (rounded) score and showed 3 level flips for a no-op; it now compares
  with the baseline recomputed from the same inputs. "0 of 0 rows" is blindness: refuse it, never call it "not
  ready". (#154)
- **L-S5 · Look at the ratio, not just the MAE.** A consensus that wins on absolute error can multiply calm-sea
  heights (Florida tile: ×1.31 median, ×3.6 p90). Grade by sea-state band and report the served-height ratio. (#160)
- **L-S6 · n = 1 is recorded, not fixed.** Write down the mechanism and the candidate fixes; fix the half with clear
  evidence. (the E2E Firefox false red, 2026-09-29; #159)
- **L-S7 · Verify causal claims with the platform's own metrics** (Render CPU/latency, read-only) before blaming
  load. (2026-09-29)
- **L-S8 · Re-verify handoff claims live.** Notes drift and wrong notes read true until checked: "precompute has no
  workflow_dispatch" was false; "restore_status is useless as a gate" was false. (2026-09-29)
- **L-S9 · Benchmark at the worst case, not the first case.** "0.16 ms per sample, no cache needed" was measured on
  the 725-cell Florida tile; the sampler is O(grid) per call, so Brazil (5,917 cells) cost 25 s per frame. Profile
  before optimizing: the second hot spot only showed up under cProfile. (#161)
- **L-S10 · A control that samples only the ends of a range cannot see an inversion inside it; sweep the interior.**
  The sim read 8 m → 30.6 ft and 12 m → 29.5 ft, which looked like saturation, while 10 m read 36.6 ft: the MC-01 cap
  seam. (#146, #151)
- **L-S11 · Two answers must share one definition.** The judge's consensus arm and the ingest builder use the same
  `equal_consensus`; a test pins the product's /point answer to it at every node. Never re-derive a quantity for a
  second surface. (#161; CLAUDE.md "ONE FORECAST COMPOSITION")

## Failure modes in the data path

- **L-F1 · A failed read is not an absent object.** Mapping every non-200 to `None` let a Supabase Storage 429 bake
  1,821 glyphs without their size references for ~9 h. Readers that bake served numbers must tell failed from
  absent, retry the failure, and refuse rather than fall back silently. (2026-09-29, #162; the write side learned the
  same lesson on 2026-07-30)
- **L-F2 · Supabase Storage returns 429 "too many connections" under the pipeline's own fan-out** (prefetch, L2
  uploads). Uploads retry with jitter (#77); every reader in a bake lane needs the same care. (#77, #162)
- **L-F3 · GitHub drops and delays scheduled runs here**, by hours and by lane (core ingest 44% of slots missed,
  MOP 75%). More crons do not help; the backend dispatches a missed data-lane slot (#153, armed 2026-09-29).
- **L-F4 · A monitor that reads only the latest pass pages on cadence, not on failure.** Ledger passes 34-37 min
  apart score 0 legitimately (the observations are not in yet), and the accuracy monitor called that "instrument
  dead" after a merge burst. Judge liveness over a time window. (2026-09-29)
- **L-F5 · A physics merge without a rebake serves two compositions.** Glyph frames stay on the old chain until the
  next precompute; #150 re-runs precompute on a `dev` push that touches the composition chain. (2026-09-28)

- **L-F6 · A safety claim covers every branch, or it names the one it covers.** "A CONSENSUS point never reaches
  an upstream" (#164) was pinned for marine only; the wind fallback had no model gate, and the provider maps an
  unknown model to gfs_seamless, so the armed shadow lane would have scored real GFS wind under its own name.
  Found by checking the real consumer (the ledger resolves wind too) before arming. (ledger seq 27-28)

## Operations

- **L-O1 · The one-CPU box saturates easily.** A fresh instance sat at CPU 1.0 for ~12 min under E2E's map specs on
  cold caches. Never dispatch the nearshore judge (especially `consensus=1`, 3× the point calls) within ~20 min of a
  `dev` merge.
- **L-O2 · `restore_status` is a valid first-boot readiness gate** (`pending` until the first L2 restore finishes).
  (#159)
- **L-O3 · CDIP THREDDS can return 403 to GitHub runners for a whole run** (2026-09-28 23:30Z) and recover by itself.
  Confirm the next scheduled run before acting.

## CI and pull requests

- **L-P1 · CI floors.** Three backend lanes (`backend/scripts/ci_test_lanes.py --lane guards|chain|estate`; `git add`
  a new test file first, or no lane claims it). New floor = the hosted reading + your new tests − the margin (6 for
  guards and chain, 2 for estate). Edit `.github/workflows/ci.yml` and `_FLOOR_SET_FROM` in
  `backend/tests/test_ci_floor_staleness.py` in the same commit, then confirm the hosted
  `collected N tests across M files` equals the projection.
- **L-P2 · Two open PRs that both move `_FLOOR_SET_FROM` always conflict.** After the first merges, merge `dev` into
  the second and re-derive from the hosted readings.
- **L-P3 · Mutation checks: commit first, run pytest with `cwd=backend`.** Restoring with `git checkout HEAD -- file`
  once wiped an uncommitted edit; from the repo root, collection fails and every mutation fakes red. Report
  equivalent mutants as equivalent, not as caught.
- **L-P4 · Never switch branches while a local test run reads the worktree.** Hosted CI is the authority; the full
  local guards lane takes 15-25 min without xdist.
- **L-P5 · Squash WIP with `git reset --soft <merge-base>`**, never onto a newer `origin/dev`, or the commit reverts
  everything merged since.
- **L-P7 · Commit before switching branches.** `git checkout` carries uncommitted edits to the new branch: arming
  edits made on one branch followed me onto another (2026-09-29, caught by `git status` before any commit).
- **L-P6 · Windows shells.** Multi-line edits go through Python with exact-string asserts (heredocs mangle `\`
  continuations). In Git Bash, `git show origin/dev:path` needs `MSYS_NO_PATHCONV=1`. `grep -E "\t"` does not match
  a tab.

## Accountability and memory (2026-09-29)

- **L-A1 · A local clock is not UTC.** This machine runs EDT (UTC-4), and git prints local offsets; the session log
  put #161 at "~09:00Z" when GitHub says 13:06:13Z. Take times from `date -u` or the platform's timestamps.
  (correction: ledger line 16)
- **L-A2 · "Armed" is not "working".** The dispatch fallback reported `armed: true` while every dispatch it attempted
  failed with HTTP 403 (the token could read Actions but not write them). Verify an action by its first real
  effect, not by its own status flag. (Render log, 2026-09-29 13:46Z)
- **L-A3 · A memory without a verified date is a rumour.** The first memory audit found 12 of 12 local memories
  with no record of when their facts were last checked. Facts now carry `metadata.verified`, and the audit flags
  stale ones.
- **L-A4 · A rule that names tools a session does not have is a rule nobody can follow.** BRAIN_RULES §21 requires
  Mind/Memstate/Trevec checkpoints; none were configured in this session. §23 records that and names the git record
  as the memory every session actually shares.
- **L-S12 · A new instrument inherits the old instrument's rules, by calling it.** The same-model parity probe's
  first draft fetched Open-Meteo itself and treated its coastal 0.0 as a forecast: it reported ours +0.128 m high,
  every large row a land cell at Waimea, La Jolla or Juan de Fuca, the trap the ledger documented on 2026-08-10.
  Calling the ledger's own `fetch_om_forecast_rows` gave +0.008. The result contradicted the ledger, which is what
  stopped it being reported. (2026-09-29)
- **L-S13 · Vary one thing at a time until the residual has a mechanism.** Same cycle, same hour, same node still
  left 5 cm; scanning 9 offsets ruled out a shift, and scanning block means found the 2x2 NW mean at 72% exact.
  The code then confirmed it in one line. (2026-09-29)
- **L-P8 · `git fetch` before branching from `origin/dev`.** A merge made with `gh pr merge` does not move the
  local `origin/dev`: a branch cut right after it started from the previous dev, and its three new ledger lines took
  seq 33-35 over dev's own 33-40. The ledger's append-only rule would have failed it in CI; `action_ledger.py head`
  caught it first (seq 35 where 43 was expected). (2026-09-29)
- **L-S14 · To change what a function sees, change its input, not the function.** The native-cell fix needed five
  block reductions (height, scalar, direction, partition confidence, multi-tier total sea) to return their
  single-cell answer. Rewriting them would have been a second composition; half=0 would have zeroed the partition
  confidence the frontend fades crests by. A doubled VIEW of the grid made the unchanged functions return exactly
  the single-cell answer, and their own scalar forms on a 1x1 slice are the oracle. (2026-09-29)
- **L-P9 · An exit code with no count is not a result.** `ci_test_lanes.py` prints CRLF on Windows, so
  `pytest $(... --lane chain)` looked for `tests/x.py\r`; wrapped in `|| fallback | tail`, the run exited 0 and
  printed nothing. Strip `\r` (`| tr -d '\r'`) and read the "N passed" line before calling a lane green. (2026-09-29)
