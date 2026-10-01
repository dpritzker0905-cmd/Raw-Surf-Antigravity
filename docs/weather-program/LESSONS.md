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
- **L-P10 · Read times from the clock; never write an estimate as a timestamp.** Twice in one hour a time
  was written ahead of the clock (a log header and STATE's `Updated`, then a ledger `acted_at`). The
  ledger's own check (`acted_at` not after `at`) refused the second; the first went through unchecked.
  Take `date -u` or `datetime.now(timezone.utc)` at the moment of writing. (2026-09-29)
- **L-P11 · Test code the way production runs it.** #171's 21 tests imported the fetchers as a package;
  production spawns them BY PATH, where `services` is not importable. A bare `from services._fetch_native_cell`
  inside `fetch_global_coarse` would have failed every GFS, ICON and EURO fetch, flag on or off. The real-GRIB
  parity job (run by path) caught it 4 minutes after the merge, before any ingest ran. The rule is now a test
  (`test_fetcher_script_imports.py`), and a new fetcher import follows the file's own try/except idiom. (2026-09-29)
  > Recurred 2026-09-30, and for 52 days: the calibration loop's buoy-wind residual (`11fcebdf`, 2026-08-09, "the
  > wind residual is finally scored") read `wind_n` 0 in production from the day it shipped, because
  > `fetch_ndbc_latest` parsed waves only. Its test REPLACED that fetch with a fake that merged the wave and wind
  > parses, i.e. the fake did what production did not. Now only the network is faked (the real fetch and parser
  > run), and reverting the fetch fails the test. Sharper rule: never monkeypatch the function whose behaviour the
  > test claims; fake the transport beneath it.
- **L-S15 · Price a flip on real data before offering it, and gate on what must not change.** The native-cell
  regrid passed 21 stub tests and 22 mutations, then its first real-GRIB run showed it would blank 20 of 425 coastal
  nodes (their own cell is land). A flip may move values; it may never remove one the old path served. The
  real-GRIB job now fails on that. (2026-09-29)
- **L-P12 · A tolerance in the oracle hides what bit-identity catches.** The land fallback's batch pass matched its
  scalar form under `allclose` everywhere and differed on real GRIB in 1 of 115,600 values after 4-decimal rounding:
  quantized inputs make ties common. When two paths must be identical, compare exactly, and prefer one shared
  function over two that agree. When a numeric test cannot reach the failure, pin the structure instead. (2026-09-29)
- **L-P13 · A pipe hides the exit code it feeds.** `memory_audit ... | tail -1 && git commit && git push` pushed a
  head whose audit FAILED: `&&` gated on `tail`, which always succeeds. Run a gate on its own (or `set -o
  pipefail`) and read its verdict before the next step. Sibling of L-P9. (2026-09-29)
- **L-A5 · A follow-up that lives in context dies at compaction.** This session held four promised checks (the
  hotfix's first production run, the post-flip probe, the shadow's first scored rows, the next fix's sizing) only in
  its own context. They are now `commitment` ledger lines with a due time and a check; the audit lists them at every
  session start and WARNs when one is overdue. (2026-09-29)
- **L-A6 · Integrity is not completeness.** A hash chain proves nothing was changed; it cannot see what was never
  written. The audit now reads git for every PR merge since the ledger began and FAILs a missing `pr_merge` line.
  On the day it was added it found none missing (14 of 14), and the selftest proves it fires. (2026-09-29)
- **L-P14 · A worktree is not yours because you started in it.** Another session checked out its own branch in
  raw-surf-wt mid-afternoon, and my next `git rebase` rewrote ITS branch; a script then wrote my ledger lines into its
  tree, twice (the second time because a failed step was joined with `;`, not `&&`). Before any git write, assert
  the branch (`test "$(git branch --show-current)" = <expected>`); scripts that write refuse on the wrong branch;
  with two sessions, one worktree each (`git worktree add`). (2026-09-29)
- **L-P15 · A shell between the runner and the tool turns a regex into a pipe.** A mutation script called
  `npx.cmd` from Python; on Windows that goes through cmd.exe, which read the `|` in
  `--testPathPattern=a|b` as a pipe. Jest never ran, every mutant exited 255, and the script counted 255 as
  "RED (caught)": 13 void verdicts across two PRs, one of them already cited in a merged PR. Caught because a
  mutant predicted to survive came out red. Invoke the tool without a shell (`node .../react-scripts.js test`),
  and take the verdict from the tool's own summary line ("N failed"), never from an exit code. Siblings: L-P9,
  L-P13. (2026-09-30, #183 correction)
- **L-P16 · A harness that restores a file in text mode rewrites every line ending.** The #197 mutation script read
  the source with `Path.read_text` and restored it with `write_text`; on Windows the restore wrote CRLF, so the
  "restored" file differed from HEAD on every line with no content change (`git diff` empty, `git status` modified,
  `file`: "with CRLF line terminators"). Committed, it would have been a whole-file churn under a one-line fix.
  Caught by `git status` after the run; restored from the committed WIP. A harness that saves and restores a file
  uses `read_bytes`/`write_bytes`, and checks `git status` is clean after. Siblings: L-P15, L-P6.
  (2026-09-30, #197)
- **L-P17 · A test that builds its input by hand cannot see a field the real producer drops.** W-30 (#199) passed
  15 tests and 13/14 mutations while inert on every real spot: the tests rated a synthetic spot carrying
  `best_tide`, and `sim_forecast.fetch_catalog` (the producer of every real spot) mapped rows to five keys without
  it. Found only by reading the producer while scoping the evidence lane. A fix that consumes a field needs one
  test through the path that PRODUCES that field in the product (here: the catalogue response -> the resolver ->
  the rating), and a positive control that reddens it with the producer line reverted. Sibling: L-S17 (an
  instrument that runs a configuration nobody serves). (2026-09-30, #199)
- **L-P18 · A frontend PR runs the lint gate BEFORE it is pushed, not after CI says so.** #205 failed
  `frontend-lint`: its test file imported four unused hooks and an unneeded `eslint-disable`, +5 on the
  shrink-only debt baseline (`frontend/scripts/eslint_baseline.json`). 195 suites had passed; Jest does not lint.
  `node frontend/scripts/check_eslint.js` (the CI gate itself) caught it in one local run. In a worktree without
  `node_modules`, a junction to an installed copy works (`mklink /J`; gitignored). (2026-09-30, #205)
- **L-S16 · A scalar interpolated as a vector can only shrink.** `/point` averaged the corners' (u, v) and served
  sqrt(u^2+v^2) as the wave height; |sum w_i h_i e_i| <= sum w_i h_i, so every served height was biased low wherever
  the corners' directions diverge, which is where spots are (NDBC 51202: served 0.98 m, corners 1.39-1.57, buoy 2.0).
  In the code since Stage 1.5 and invisible to every guard, because each compared the sampler with itself. Interpolate
  a quantity in the space it is defined in: heights as scalars, directions as vectors. (2026-09-30, audit-sota §3.1)
- **L-S17 · An instrument that runs the default configuration measures a system nobody serves.** Twice in one day:
  the 2026-09-29 Jacobian swept with `RATING_LOCAL_SIZE` off and ranked height last (served flags: first, 37%); the
  ledger's cap test counted the code-default lanes and stayed green while the live queue sat at 29,477 of 30,000.
  Set every armed or armable switch the way production (or the next flip) runs it, and say which you used.
  (2026-09-30, audit-sota §3.3, §3.4)
- **L-S18 · A replay sees only what it persisted.** The science shadow A/B replays each spot-hour's stored rating
  INPUTS, which already hold the sampled height, so a sampler candidate would read "0 changes": L-S4's blindness in a
  new shape. Price a change upstream of the persisted inputs by re-sampling the products (and grade it with a ledger
  lane). (2026-09-30)
- **L-F7 · The serve path has the failed-vs-absent trap too.** A Supabase 429 on a regional tile made `/grid` answer
  from the 2-degree tier with `coverage_scope: regional`, `fallbackReason: null`, and the log called it
  "regional-quality at zoom-out" at INFO: 9 of 57 requests in one burst. A refused read must retry, then name its
  fallback in the payload. Sibling of L-F1, L-F2. (2026-09-30, W-23)
- **L-O4 · A measurement's fan-out is load on what it measures.** 0.5 s-spaced `/grid` fetches during a core ingest
  drew 9 Supabase 429s; 1.5 s spacing drew none in 60 requests. Space audit fetches, and ledger the load you added
  when it touches production. (2026-09-30)
- **L-A7 · We learn what we mechanize.** The ledger's 17 corrections to 2026-09-30, sorted by the lesson each broke:
  every lesson enforced by a check (the file-size CI, the by-path import test, `acted_at` <= `at`, the completeness
  audit, the SCOREBOARD order check) had ZERO recurrences after it was written; the prose-only ones recurred:
  estimated timestamps (L-P10) 3 times after the lesson (seq 109, 135, 145), and claims that outran what was checked
  (L-F6, L-P11, L-S12, L-S17's family) in 8 of the 17. So: when a correction repeats a written lesson, the fix is a
  check in the same session. L-P10 became two (2026-09-30): `action_ledger.py append` refuses an estimated time in
  `verified`, and `memory_audit.py` reads HANDOFF headers; building the second exposed that the clock check's 5-minute
  slack had been wider than the real mistake (4 min 42 s), so it is 1 minute now. Over-scoped claims resist a check;
  their countermeasure stays the controls (L-S4) and stating the configuration (L-S17).
- **L-O5 · Judge Render memory on the 7-day chart, never one post-restart reading.** The F-08 Stage A "baseline" of
  820 MB was a fresh-restart outlier (38-45% of 2 GB); the normal level then was 70-80%. Every deploy restarts the box,
  so a single `/api/health` RSS after a merge measures the restart, not the load. (2026-09-26, moved from local memory
  2026-09-30)
- **L-P19 · Probe with the consumer's request, not a convenient one.** The far-zoom monitor asked grid_series for 6
  hours and read 6/6 through a restart; the client asks for 48 offsets on a 3-hour grid at GLOBAL_REQUEST_BBOX, and
  that page came back 30/48 alone, 16/48 beside its sibling. Build the probe from the client's own request builder
  (`backend/scripts/series_page_probe.py` mirrors `marineGridSeries.buildPageHours`), then simplify. (2026-10-01,
  commitment 228)
- **L-A8 · A size word in a comment outlives the cap it was sized for.** mid_res_tier deep-copied every clip into
  its cache because clips were "tiny, ~dozens of cells"; MAX_SPAN 40 -> 400 (2026-07-23) made the world clip the
  whole ~15k-cell grid, and that deep copy became 10.3 of 12.9 s of a far-zoom page. When a cap or span is raised,
  grep downstream for the size words (tiny, small, cheap, resident) and re-measure each. A profile found it in one
  run, after two sessions of reasoning about load. (2026-10-01, commitment 228)
- **L-F8 · One symptom can be two defects that take turns.** Whether the live Open-Meteo lane won its 2.5 s race
  decided which far-zoom defect a page showed: every hour from a 15-deg 25x12 grid (won) or the stored 2-deg field
  cut at the deadline (lost). A probe counting returned hours called the first 100% healthy. Measure what was
  served (origin, resolution), not only how much; S11 counts hours from the stored field. (2026-10-01)
