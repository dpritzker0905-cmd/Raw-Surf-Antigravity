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
  ⬆ 2026-09-30, late: the log half of the clock check read only headers ending in ` ·`, which was 31 of the 41
  timed headers on `dev`. So #206's `## PR and ledger (23:14Z-23:17Z)`, committed at 23:15:52Z (`0b057d3d`),
  passed. The check now reads every `## ` header (`log/2026-09-30-clock-every-header.md`). For a check built from
  one case's shape, count how much of the population it can read.
  ⬆ Same night: each claim is now held to the commit that wrote THAT line (git blame). That found 7 headers, 1 to 7
  minutes ahead, which the file's last commit had hidden since 2026-09-29. Each is corrected by its own `correction`
  ledger line (#206's included), since a log cannot be edited. A silent fallback is a weaker check that nobody
  sees: until git's output was decoded as UTF-8, the blame fell back on 5 of 12 files on Windows. A fallback on a
  committed file now WARNs, and FAILs in CI.
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
  ⚠️ Note 2026-10-01 (coarse-fill session; it REPEATED this, caught by `git status`, restored from the committed
  WIP): "committed, it would have been a whole-file churn" overstates it here. `.gitattributes` is
  `* text=auto eol=lf`, so `git add` stores LF and a CRLF restore cannot reach a commit; the cost is a working tree
  that reads modified with an empty `git diff`, which can still mislead the next step. The rule stands.
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
- **L-S19 · A provider's model is not the model's field: read the source's own metadata before you trust the
  provider's.** Open-Meteo's `gfs_hrrr` is HRRR's values, but with two of HRRR's own properties lost on the way.
  - **The winds are grid-relative.** The GRIB's section-3 component flag says so, and the provider serves them as
    earth-relative: -alpha in direction, 11-17 deg at US coasts.
  - **Point-sampled at the node.** Its 3 km cell is taken at each 0.25-deg node: 5.2 kn p95 of aliasing.

  Neither is visible in its JSON. The check that found them was the GRIB itself (`grid_section`, `check_grid`) and a
  sign test against a third model (GFS) where the error must flip with longitude. Then truth confirmed it: 101 NDBC
  buoys, +0.47-0.69 kn vector RMSE unrotated. When a provider repackages a model, test its grid convention, units and
  sampling against the model's own metadata. (2026-10-09, log 2026-10-09-hrrr-wind-lane §2)
- **L-S20 · Sharper is not more accurate: grade detail and skill separately, and claim only what was measured.** The
  HRRR lane draws 1.37x the coastal gradient of GFS (19/19 valid times). At 101 NDBC buoys over 5 days it ties GFS
  (vector RMSE 5.97 vs 5.99 kn at 3 h, 6.61 vs 6.47 at 24 h; 45/88 buoys better). "HRRR's sharper coast" was true;
  "more accurate" would have been an assumption. (2026-10-09, same log §5)
- **L-S21 · An equivalence check that never ran the new path proves nothing; assert the path was taken.** The first
  real-file proof of the strided world read said "old == new" on 207,872 cells, and the new path was not taken once:
  the live files declare no `resolution`, the guard required one, and every hour fell back to the old path, so it
  compared the old path with itself. The CPU column caught it (no faster, and 7 full L1 entries in "new" mode). The
  test now asserts the lane's own trace (its `#s{stride}` L1 key) beside each equality. Second point from the same
  profile: profile a 1-CPU box on ONE core (`psutil.Process().cpu_affinity([n])`). Unpinned, the load threads'
  GIL hand-offs across cores doubled and scattered every reading (5-10 s for a page that costs 2.1-2.9 s pinned).
  (2026-10-02, commitment 228; log `2026-10-02-commitments-182-228.md`. Written as "L-S19" on closed PR #222 and
  never merged; recovered 2026-10-10, renumbered because dev's L-S19 is another lesson.)
- **L-F7 · The serve path has the failed-vs-absent trap too.** A Supabase 429 on a regional tile made `/grid` answer
  from the 2-degree tier with `coverage_scope: regional`, `fallbackReason: null`, and the log called it
  "regional-quality at zoom-out" at INFO: 9 of 57 requests in one burst. A refused read must retry, then name its
  fallback in the payload. Sibling of L-F1, L-F2. (2026-09-30, W-23)
- **L-F9 · An object a cache handed you is still the cache's.** (Written as L-F8 on #211's branch; #210's L-F8
  merged first.) `ProductStore.load_product` copies the product and
  grid containers one level and SHARES the vector objects; `filter_grid_to_bbox` re-references them. The serve-time
  coarse fill assigned GFS values onto those vectors, so one world request rewrote the cached EURO product: live,
  119 of 399 cells of a later 40-degree clip went from masked to valid with no `coarse_fill` stamp, and a repeated
  coarse request lost its stamp (the first had already emptied the masked set). The fill's tests were green because
  they asserted the mutation itself, on objects no cache held. A serve-time step copies what it changes and rebinds
  on containers it owns; its test goes through the real cache and asserts the L1 entry is unchanged afterwards and
  that a second identical request answers identically. Siblings: L-F6, L-P17. (2026-10-01, coarse-fill PR)
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
- **L-P20 · Mutate the fix and watch the guard, not only the tests.** The AST guard built for `grid_resolver`'s shared
  diagnostics (2026-10-01) first accepted any copy on an EARLIER LINE of the same function. Reverting step 4's copy
  turned four behavioural tests red and left the guard green: the EURO -> GFS fallback's copy, inside its own branch
  ~180 lines up, "covered" the step-4 writes. The rule became structural dominance (an earlier statement of the
  write's own or an enclosing block), with that shape as a control. A guard is a test of the next change, so its
  mutation check is the same one the fix gets. (log `2026-10-01-grid-resolver-no-shared-diagnostics.md`)
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
- **L-P21 · Merge a queue of ledger-appending PRs as a STACK, not a line.** Every program PR appends to
  `ACTIONS.jsonl`, so each merge forks the others and serial merging costs a full CI cycle (~20 min) per PR. The
  completeness audit needs every merge recorded EXCEPT the newest, so a PR only has to record the merge two places
  back. Stacked (each branch merges the previous one's re-chained head, so they all run CI at once), #212 and #208
  merged at 03:48-03:50Z and #210 and #211 at 04:12-04:13Z (2026-10-01): two CI windows for four PRs, the only
  extra push being #210's record of #212's merge. Read the rule from the checker
  (`memory_audit.check_completeness`), not from habit. (log `2026-10-01-grid-resolver-no-shared-diagnostics.md`)
- **L-P22 · Replay the owner's own pattern against the unfixed build, seeded, before saying "fixed".** The exact-frame
  fix passed its unit tests and the one scrub replay that showed the bug, and was a no-op on the owner's actual pattern
  (erratic zoom at one timestamp: 8.4% of frames weak against 9.1% unfixed): it followed every thin commit with an
  upgrade, and the settle check put the thin frame back. Only a seeded A/B of that pattern against a build of the
  previous commit (5 seeds, then 10 new ones) showed it, and only a per-commit trace (lane, grid, zoom) showed why. Build
  the unfixed arm first, keep the seeds, trace every commit, and re-aim the harness when the clock moves it (the app's hour
  0 is the current time rounded to the hour). (2026-10-01, log `2026-10-01-far-zoom-max-thinning.md`)
- **L-F10 · A label is the identity of a request, not of the data.** At 3-hourly far range the frames serving one selected
  hour carry different `hourOffset` labels (series 145, exact grid 144, selection 146, all valid 15Z). "Rendered label !=
  selected hour" read as stale, so the settle check committed the thinned series frame over an exact frame of the same data
  again and again, and the commit arbiter's `hour_change` rule has the same hole. Ask "is this the same data" with
  `served_valid_time` and the run, never with the label; `keepExactResident` is the one place that now does. Other
  label-based checks in the engine may share the flaw. (2026-10-01)
- **L-F11 · A retained frame is a claim about an hour: check the claim when you DRAW it, not only when you store it.** The
  zoom-out bridge keeps one coarse base per model|layer|flavor and promotes it whatever hour it was made for. The seed that
  would have refreshed it was refused by an identity-only gate (model and layer) for as long as the page-load frame was held,
  and the engine discarded it for the same reason, so a Wednesday selection zoomed out drew the hour-0 field at full strength
  for 3.2 to 3.8 s offline (3 to 9 s in the live reads) under a readout that said Wed (the panel's own "Forecast time does not
  match this selection" line was showing: the app knew). Any holder that keeps a frame and draws it later (the bridge base, the wash base, a resident frame after an
  hour change) must carry the hour it was made for (valid time, never the label: L-F10) and be judged against the selection at
  the moment of drawing. `coarseBaseStaleForSeed` (replace a base made for another hour) and `resolveStaleWorldDim` (draw a
  world frame for another hour provisional) are the two places that now do. (2026-10-01, log `2026-10-01-far-zoom-max-thinning.md`)
- **L-P23 · Re-aiming a replay by hand twice is the signal to mechanize it: pin the clock.** The app's hour 0 is the current
  time rounded to the NEAREST hour, so a selected hour that was "Oct 7 16Z" at 18:20Z is another hour at 18:31Z, and an A/B
  whose arms straddle :30 compares different hours (L-P22 re-aimed it by hand; this fix needed it again). The harness now pins
  the app's anchor (`window.__MOCK_DATE_NOW__`, `PIN_NOW`) and states hour 0, the clicks and the target together, and the arms
  alternate their order (the basemap tiles come from the internet, so the second arm of a pair always saw a warmer edge cache:
  the first arm's 700 ms screenshots lacked basemap labels in both pairs I looked at). (2026-10-01)
- **L-P24 · A mock's flat latency decides what a replay can see: calibrate it against a live measurement of the same request
  class, and run both bounds.** The offline mock gave every world series request 8 s, including the one-hour "mini" the
  prewarm sends. The bounded background lane then starved the world grid behind it, and the unfixed build drew the wrong hour
  for 3.2 to 3.8 s (once 8.7 s), inside the live reads (3 to 9 s warm, over 75 s after a restart). With latency proportional to
  the frames built (a one-hour mini 0.3 s) the same flow drew it for 0.1 to 0.5 s, because the cached thin frame arrived at once.
  Live (the audit's own earlier harness runs, `scn_farzoom_cold`, `scn_farzoom`, `scn_timeline`): a regional one-hour mini 0.2 s,
  a world one-hour page 1.1 to 2.4 s, a 48-frame world page 2 s on a fresh box and 15 to 25 s after a restart, a world `/grid`
  0.7 to 4.9 s. So the flat 8 s is too slow for the mini and too fast for the big page, and the just-opened-page cells of the F-21
  matrix depend on that shape (the fetch path's own world series half holds the lane's slot, with the world grid queued behind
  it). I first wrote "the world mini was never measured" here: the measurement was already in the audit's evidence folder.
  State which regime a number comes from (`MOCK_WORLD_PAGE_SCALE=1` is the proportional one, `MOCK_WORLD_MINI_MS` the live-like
  mini), and grep the evidence you already hold for the live request class before saying it is unmeasured. (2026-10-01)
- **L-P25 · Say what holds a queue from the call's own timestamps, not from the code or the first trace.** The F-21 fix needed
  to know why the right-hour world grid had not arrived before a zoom-out. Reading the code and the first traces gave two
  different answers at different times (a 48-frame world page that starts at the selection; the prewarm's own series half), and
  neither was what the call's own record showed once it existed: `__MARINE_GLOBAL_PREWARM__.grid` carries `gridFirst`, `queuedAt`,
  `startedAt` and `doneAt`, and on a page that has just opened it showed the fetch path's own call owning the in-flight key with its
  grid queued behind its own world series half (`gridFirst:false`, queued, never started in 9 s). That is what happened on the
  mock, where the half costs 8 s; live it costs 1 to 2.4 s (L-P24), so the same record read on the live site is what says whether
  a just-opened page behaves that way. A request that can wait must record in its own telemetry when it was asked for, when it
  started, when it finished and who asked, before anyone names the blocker. (2026-10-01, log `2026-10-01-far-zoom-max-thinning.md`)
- **L-F12 · A cache-only lane in a latest-wins slot can cancel the fetch it was meant to leave alone: the guard must know what the
  PENDING run can do, not only what is in flight.** `useMarineDataFetcherCore.enqueueMarineUpdate` has ONE dispatch slot and every
  enqueue clears the pending timer and installs its own. The `series_upgrade` lane (2026-07-17, `f74214fd`) is cache-only by design
  and its comment says it must never displace a real fetch, but it guards only `locks.isFetching`. A series page landing in the 300 ms
  between a zoom-out's `moveend` dispatch and its run cancelled the pending `moveend` fetch and ran cache-only in its place; nothing
  re-armed the fetch, so the world `/grid` was never requested (offline, 24 traced runs: landings inside the window lost it 6 of 6,
  0 of 6 with one switch, 0 of 12 outside the window). The mirror order is a second hole: a fetch-capable enqueue that finds the slot
  taken by a cache-only run is dropped at the slot check (injected: lost 2 of 2, and the one-switch fix does not cover it). Rule for any
  coalescing dispatcher: carry a capability with every enqueue and keep the most capable pending run in BOTH orders, with a call-site
  test per order under fake timers. Diagnosed 2026-10-01 and fixed the same night (commit e29cddde, `marineEnqueueSlot.js`: the slot carries a capability per enqueue; kill `__RAW_DISABLE_SU_NO_CANCEL__`). (2026-10-01, log `2026-10-01-far-zoom-max-thinning.md`,
  audit REPORT F-23)
- **L-P26 · An intermittent loss in a harness is a question for the app's own event log, not for the environment: record the decisions,
  then split the runs by the one collision you suspect.** I wrote that the unsent zoom-out grid "looks like the over 75 s after a
  restart state" and told the owner it was "probably the state right after each hourly redeploy"; neither was supported (ledger seq 289).
  One scratch build that recorded the scheduler's enqueue, dispatch (and which pending run it cancels), run and fetch in the app's
  forensic ring showed the cause in the first failing run, and tabulating 24 traced runs by "did a series page land between the dispatch
  and the run" separated them completely, where 34 untraced runs had only been consistent with it. Before attributing an intermittent
  loss to a slow or stale live state, make the app write down each decision on the path; a guess about a state you cannot reproduce is
  a claim that outran its check (L-A7). The mechanization is in the harness: `TRACE_APP=1` in `scn_wronghour.js` records the app's
  console, every request the page issues and the forensic ring for any cell. (2026-10-01, same log)
- **L-P27 · A zero from one pass is a sample, not a rate: replicate it before it goes in a table, and count a frequency before you predict it.** REPORT V41 said weak far-zoom frames
  (the Florida swell under 75% of the exact frame) fell from 1.0% to 0% with the F-21 build, from one 5-seed pass (6,109 frames). The F-23 replays read that same build at 0.65% over 14,671 frames
  (and the F-23 fix at 0.69% over 14,971): the 0% was a lucky sample, and the 0.7% residue is the placeholder windows of the F-19 work. The same replays contradicted a code-reading prediction: the
  second ordering of the slot race (a fetch-capable enqueue dropped behind the cache-only lane in the same frame) was written up as "much rarer" because its window is one frame, and with the fix's
  own event recorded it fired 12 times in six 25 s erratic-zoom trials. A pass that reads zero of something other runs of the same build read as nonzero is a reason to run it again, and a
  frequency predicted from the code is a hypothesis until the event is counted. Mechanized in the harness: `run_f23_erratic.sh` replicates seeds and records the fetcher's events per trial.
  (2026-10-02, log `2026-10-01-far-zoom-max-thinning.md`, ledger seq 292)
- **L-F13 · When a fallback's trigger is narrowed, the invariant that pairs it with its gate must be a test, not a comment.** The layer's zoom-out gate hides a
  regional clip that covers under 0.6 of the viewport when `zoom <= 7 || span > 15`; the engine's bridge promotes the held world frame in its place. `8625841b` (2026-07-16) wrote the pairing
  down in a comment and a header: "gate shows >=0.6, bridge promotes <0.6 - no coverage band is resident-but-hidden". `06b3dbc2` (2026-07-22) narrowed the BRIDGE's trigger to `span > 40` (EURO's
  10-degree flash) and left the gate alone. Ten weeks later the band zoom <= 7 and span <= 40 degrees hides a clip with nothing promoted: 2.4 to 3.6% of frames offline, 8.3 s live in the
  10-01 nightly, the cause of its red on 09-28 to 10-01 (offline with the old rule restored: 0.0% of 6,042 frames). The change that broke it had a 3,000-fixture differential harness for the
  guard and the arbiter, and no test file mentions both the gate (`resolveRejectedOpacity`) and the bridge predicate (grep, 2026-10-02). Rule: when two predicates share a threshold by design, write the implication as a pure test over the whole input grid
  (gate hides => bridge fires), with the other side's constants in the grid. Mechanized with the F-22 fix (2026-10-02): `marineBridgeGateInvariant.test.js` (the layer's gate transcribed with its own constants: gate hides <=> bridge fires over a zoom x span x coverage grid, plus the mirror reject and the arbiter), `.wiring.test.js` (the REAL layer and the REAL engine method on one view, and the call sites) and `.sequence.test.js` (41,472 interleavings through both commit modes with the bridge in the loop: with the rule switched off 6,756 of them end with a clip the gate hides beside a held 2-degree base, with it on none); 12 mutations of the fix each turn a named test red. (2026-10-02, log `2026-10-01-far-zoom-max-thinning.md`)
- **L-P28 · Read one real instance of a finding type, with its state variables, before writing its cause: a name is not a measurement.** The nightly's verdict code names `MULT0_FRAME`
  the "blank-flash class" and a comment there says a frame drawn with no data reports mult 0, and the audit's section 8.7 (2026-10-01) built its hypothesis (late data misread as a renderer
  failure) on that comment without opening a failing run's frames; the program's own 08-15 work (`e17f0332`) had already measured the same frames as the coarse bridge's hold, wash drawn. The 10-01 artifact's per-frame engine state, five minutes to read, shows the same frames with
  the wash drawn, heat 0 by the gate's own decision and a covering clip not yet committed, in a run the verdict itself calls observable. My own harness had the same flaw: "HEAT0" was reported as
  "heat map faded" and read as vanished, while the wash stays. Say what a number is, not what its name suggests. Mechanized: `scn_heatfade.js` records the gate inputs and the pixels per frame;
  `runs/f22/nightly_2026-10-01_mult0_frames.json` keeps the extract. (2026-10-02, same log)
- **L-P29 · Speculative work belongs to the view that asked for it; count requests per gesture, offline, from the log's own sequence.** The wind map's warm effect made ONE
  `AbortController` per effect, so a pan never cancelled the previous pan's 14-day timeline: a mini plus two 48-frame pages (~20 s of the 1-CPU box each) per settled pan, and
  `/api/health` read 10-13 s while the owner panned (Render log, 2026-10-10 00:04Z). The marine lane already had the fix (`createMarineViewportIntent`: identity from the series key, the latest
  regional view owns the work) behind a build flag; wind never got it. Port what a sibling lane already has before inventing, and share one implementation (`createSeriesViewportIntent`). Two more rules from the
  measurement: (1) a convenience prefetch (the adjacent page) waits for evidence the user stayed, and a scrub still loads everything, so the contract that says never cap the scrubber holds;
  (2) do not touch the request box to dedupe: the server's resolution is a step function of the snapped area (`sqrt(area/400)`: 98 deg² -> 0.5°, 105 -> 1°) and the Gulf view sits on the step, so
  padding or a coarser lattice moves served values. The replay (`windSeriesPan.replay.test.js`) takes the view sequence straight from the request log and a mock `fetch` that honours `AbortSignal`: 8 fast pans
  go from 776 frames requested / 384 far-hour to 440 / 48, and the box builds 237 frames instead of 661. It does NOT remove the per-view build, and the server amplifier (a 16-day fetch and a serial,
  single-slot background build that the next box cancels) stays open. (2026-10-10, log `2026-10-10-wind-series-supersede.md`)
- **L-P30 · "Superseded" is a claim about the SOURCE; a closed PR also carries records, and they do not travel with a
  re-landed diff.** #222, #224 and #225 were closed after "a hunk-by-hunk comparison found the source fully integrated",
  which was true: 86-100% of each code file is on dev. What the comparison never looked at was lost for a week: two
  session logs, 99 lines of a third, a lesson, a still-live database finding (`public.surf_reports` grants nothing to
  `service_role`), and two read-back commitments, one of which had quietly been satisfied and one never done. Six older
  PRs were closed as "at least partly superseded" with no check at all; reading them against dev found a fix that
  failed the nightly the day before (an API timeout graded as a renderer crash) and a bounds mislabel still drawn on
  every thinned world frame. Before closing a PR unmerged: diff its `docs/weather-program/` and its ledger lines
  against dev as well as its source, carry over every finding and open commitment, and write down what was dropped
  on purpose. Presence of the PR's lines on dev is a first pass only (9-28% for the six, though most of their fixes
  were there in another form): classify each BEHAVIOUR as on dev, fixed differently, obsolete or still missing, and
  show the live defect before calling it missing. (2026-10-10, log `2026-10-10-closed-pr-audit.md`)
- **L-P31 · Profile one unit of an amplifier before choosing what to cut, and replay it on the heap it runs on.** The brief, and my first design, bounded HOURS (385 built per fresh wind box -> the asked-for ones plus a window). The profile of one fresh box said 163 of its 201 seconds were a FULL `gc.collect()` the background helper runs after every hour (`fbff4ace`, a June memory fix for a 512 MB box), on the event-loop thread, and 3.9 s were the normalizer: fewer hours alone would have left each at ~0.4 s. The same replay measured 0.047 s per collection in a bare test process and 0.42 s once the app was imported, because a full collection walks the whole heap, so a lean-heap harness understates this class of cost 9x (the serve process, ~1.65 GB RSS, matches the observed ~0.5 s per hour and the page tails that timed out at 20 s by construction). Say which heap each timing came from. A second amplifier hid behind the first: the next box's cancel fails the unresolved hour futures of the old task, its waiters take the self-heal path and cancel the NEW box's task in turn (19 cancels and 20 fetches for two boxes with a page in flight each; the pages got 30 and 33 of 48 frames), so look for cancel -> fail -> retry loops wherever one slot is shared. Mechanized: `test_wind_bg_build_bounded.py` counts hours, full collections, fetches and cancels per scenario with the flag off (pinned) and on; `HARNESS_TABLE=1 HARNESS_GC=real HARNESS_HEAP=app` prints the table. (2026-10-10, log `2026-10-10-wind-bg-build-bounded.md`)
- **L-F14 · An exhaustive sweep sees only what its fixtures contain: put the SERVED product in its alphabet, and read a divergence count against the rule switched off.** The 3,000-fixture guard-vs-arbiter
  differential and the 37,268-interleaving sequence sweep both use a 10-degree world grid; the backend has served a 2-degree world frame since 2026-07-23. The F-22 sweep (a bridge in the loop, both commit modes,
  41,472 interleavings) used the 2-degree frame and found two differences no earlier sweep could see, both older than this fix and not changed by it: the arbiter's rule 7 (`tier_downgrade`) rejects a 10-degree
  world frame offered over a 2-degree world resident while the guard chain commits it (arbiter mode, off by default); and a stale RATED clip over an unrated world frame commits as a deliberate flavor switch and the
  bridge hands the base back once (the same past the 40-degree ceiling since 07-16). My first run also diverged on thousands of sequences for a harness reason: the guard chain reads the GLOBAL `window.__SURF_MODE__`
  (`shouldRejectResolutionDowngrade` takes no `win`), the arbiter reads the `w` it is given, and I had set only `w`. Rule: when a served product changes, put its real grid in every sweep's alphabet in the same
  change; and before reading a divergence class as yours, run the sweep with the new rule's kill switch on, since classes present in both runs are not. Mechanized: `marineBridgeGateInvariant.sequence.test.js`
  uses the 2-degree world, an antimeridian view and both modes, and its header names the one class it leaves out and why. (2026-10-02, log `2026-10-01-far-zoom-max-thinning.md`)
- **L-F15 · When a rule's reach widens, read the arithmetic it now reaches for hidden assumptions before replaying anything.** The bridge's coverage math (and the guard's, and the arbiter's) has no longitude
  wrap. It never mattered while the bridge reached only world zoom. The F-22 fix widened its reach to z <= 7, where a Fiji-style view is MapLibre-unwrapped (east 192) and the backend returns the clip WRAPPED
  (west 170 > east -168, `marineBboxGeometry`): the engine reads that clip as covering 0 of a view the layer's wrap-aware gate sees it covering whole, so the first version would have promoted the world base over a
  covering clip and then rejected every clip as sub-covering. Found by reading my own diff against the bbox code, before the A/B. Rule: for each change that widens when a rule fires, list the inputs the
  newly reached region has that the old region never had (wrapped bounds, a view past +-180, unknown zoom, a different model) and give each one a test or a stated limit. Mechanized: `coverageWrapSafe` and its tests
  (a wrapped clip, a view past +-180 and a view at the edge of the world each have a case); the antimeridian keeps the old rule, a documented limit. (2026-10-02, same log)
- **L-F16 · A retained value that every writer replaces has no quality order: the fix that reads it stops acting the first time a worse value arrives.** The F-22 bridge needs the engine to hold a 2-degree world frame for the selected
  hour. The held "coarse base" was whatever coarse-global grid committed last, per model | layer | flavor slot, and it had two writers with no order between them: the commit path (a thin 8-degree series frame, committed because it is what
  serves a world view, replaced the exact frame held for the same data) and the seed path (its gate asked "same model, layer and hour: nothing to replace", so the exact frame could not come back over a thin one). The fix worked in every replay where
  the base happened to be exact and did nothing in the 390-px replay where it was thin 65% of the time. Rule: when a fix reads "the held X", list every writer of that slot and give the replacement rule a quality order (finer beats coarser at the same
  data time; another hour beats quality; an unknown input fails open), then test it as a state machine over the writers' interleavings against the REAL replacement code, with an oracle written from the inputs' attributes and a positive control
  (the rule switched off must reach the bad state thousands of times). Mechanized: `heldBaseKeeps` and `coarseBaseOutdatedBy`, `marineBaseHold.sequence.test.js` (46,137 sequences through both doors). (2026-10-02, `log/2026-10-01-far-zoom-max-thinning.md`)
- **L-F17 · One identity, two spellings: build the fixtures from each path's real output, not from one string given to both.** A rule that compares "the same model run" was written and tested with identical strings on both sides, and the offline mock
  (which stamps a series frame with the exact frame's run verbatim) could not see otherwise. Live, /grid serves the ingest clock with microseconds (`2026-09-30T23:34:21.292482Z`) and /grid_series cuts it to whole seconds when the product's run_time is a datetime
  (`grid_series_viewport._frame_provenance`, `strftime('%S')`; a string one passes through): recorded live samples hold both spellings, and for one run an equality on the parsed instants says "another run", which could have made both new rules inert wherever the two spellings meet. Found by the
  independent test review from recorded live samples (`audit/weather-stabilization-14.0`), not by a replay. Rule: for each identity a rule compares across two producers, take recorded samples of each producer's real field (name, precision, unit, which
  object carries it: the commit path's conform and the seed path's raw grid differ) and compare at the coarser granularity. Mechanized: `wholeSeconds`/`sameInstant`, the fixtures `conformedThin` and `rawExactSeed`, the sweep's spelled runs. The same exposure
  is in F-19's `exactResidentSupersedes` (`marineExactUpgrade.js`, millisecond equality); not verified live, not changed here. (2026-10-02, same log)
- **L-F18 · Before reading the treatment arm of an A/B, show that the scenario produces the defect in the control arm.** Five "band" scenarios (select the hour at a band zoom and stay there: zoom-outs, pans of 10 to 26 degrees, a visit to a world view; desktop and
  phone) hid 0.00% of frames in BOTH builds, and the first reading of that was "no effect": the scenarios cannot create the state, because a clip fetched at a band zoom is larger than the view and keeps covering it through the band; the hides in this program come from
  a clip fetched at z7 that a zoom-out outruns. A 0.00% against 0.00% is a null scenario, not a pass. The same A/B showed the opposite trap for an INTERMITTENT defect (a thin base replacing the exact one needs a thin frame to commit before the exact one is held): one run per arm shows it
  or not by timing (3 of 5 trials in one desktop set, none in another, 65% of the phone frames in an earlier run), so the replicates (3 sets per arm) show that the defect is real and the real-engine tests and the sweep carry the causal claim. Rule: print the control arm's table by the
  class of the state that decides whether the fix acts BEFORE the treatment arm's, and run replicates for anything that depends on timing. Mechanized: `f22_ab_classes_v2.py` (the control arm first), `f22b_tables.py` (the per-trial base class over time). (2026-10-02, same log)

### 2026-10-04 00:17Z — estimated source ownership is a measured contract

A stored estimate can be estimated again in a browser branch with different source times and masks. Check full per-coordinate fields and product/run/served-time identity; matching maxima or nonzero HTTP responses do not establish parity. A finite-difference source control distinguishes a displayed value that follows the served target from one that ignores it. Keep changed values dark under D-001; consistent inputs alone prove neither forecast skill nor a default-device graphics fix.

### 2026-10-08 — wind visuals: one variable at a time, the owner's eye decides

- **L-V1 · A visual redesign is judged on the live site, so it ships one variable at a time.** #273 ("particles v2")
  changed density model, lifetime, fade, mark stretch, speed, the trail compositing AND the particle colour together,
  default-on. The owner rejected it ("we were close before you made major changes in v2 by making solid color
  particles") and could not say which part helped or hurt. Rule: bug fixes may ship default-on; a VISUAL change ships
  behind a lever, is A/B'd in the owner's own pane (or the PR's Netlify deploy preview — the backend CORS allows
  `*.netlify.app`), and becomes a default only on the owner's explicit yes. #276 split #273 accordingly.
- **L-V2 · Survey research informs; the owner's taste decides.** A cited survey (reports/Wind particle color strategy.md)
  found every leading wind map uses neutral particles over a coloured field; the owner prefers the speed-coloured look.
  Keep particles speed-coloured and improve legibility inside that look unless the owner asks otherwise.
- **L-V3 · Calibrate to the approved look by measuring it.** "More density" was answered with the owner-approved
  pre-v2 view measured on dev (drawn marks per 100x100 css px: z2 487, z3 173, z4 78, z5 216, z6 493), not with a
  theory; #276 holds 490 at every zoom. Head count alone is not ink: v2's 2 s lives at the shipped head count
  carpeted 95% of the field.
- **L-V4 · Reset every lever after an A/B in the owner's pane, and say so.** A leftover mix (theme off + density 40 +
  fade 0.95) was judged as "the wind looks worse".
- **L-V5 · Live-test the dateline, wide zoom and close zoom before calling a wind change done.** The live test found
  three data bugs the offline harness could not: unwrapped `map.getBounds()` across +-180 requesting a fine box
  clamped at -180 (a seam line mid-Pacific, #275); a coarser grid overwriting a finer overlay still on screen (#275);
  the backend's two-slot sharpen queue filled by timeline-prefetch frames so the viewed hour never sharpened (open).
- **L-V6 · A flat head count is not a flat look: calibrate the INK at every zoom you ship.** #276 held 490 marks per
  100x100 css px at every zoom from anchors measured at z2-z6 only. Above z6 each mark lays far more ink (the z>6 step
  mode, zoom-grown marks), so the trail buffer saturated (z7.5: 99.8% of the screen inked vs 19.4% before) and the
  owner saw "diamonds in the red wind": the mark colour became the picture and the grid's top-speed cells read as solid
  bilinear diamonds. The instrument that settled it reads the trail framebuffer (mean brightness = the composite's
  alpha); a dose sweep per zoom then set the close-zoom curve to the approved ink (~150/255). L-V3's own caveat
  ("head count alone is not ink") was written and then not applied: the test suite asserted the flat count at z7.5-z14,
  so it encoded the bug. Measure the quantity the eye sees at every zoom the change touches, before shipping.
- **L-V7 · Know a grid's registration before you draw it.** The backend serves point-registered grids (bounds = sample
  extents, cols = span/res + 1); every heat-map shader drew them as cell-edge rasters, misplacing each sample by up to
  half a cell, differently per grid, so each post-pan viewport grid slid the field (the owner's "slight shift ... a
  second or two later"; 28 css px measured at z7). Nobody saw it for months because a single grid looks plausible;
  it only shows when two grids of the same place disagree. Instruments that settled it: still-camera frame
  cross-correlation with a null control, and a GPU placement check through the real shader (hot sample drawn at
  -3.636 vs the model's -3.636; -4.000 after the fix). Whenever two products of one field meet (base/fine, world/clip,
  hour A/hour B), test that they put the same coordinate in the same pixel (#279, gridPointRegistration.js).
- **L-V8 · A hard per-pixel threshold on an interpolated grid draws the grid.** DRAW_FS chose each mark's casing pole
  with step(0.179, fieldY). The field is a bilinear interpolation of 0.25-2 deg cells, so the threshold's contour around
  each top-speed cell is a diamond. Inside it the marks flipped to a dark core that the brightness-alpha composite nearly
  hides, which left a hole (0.56-0.69 of the surrounding ink). The marks just outside it over-inked into a ring (1.66x).
  The owner saw "diamonds" and "rectangles"; that first hurricane report ("44 kt or higher ... in the shape of a
  diamond") sat right on the dark-theme crossing at ~43-44 kn. Spot checks and theory missed it twice.
  What settled it was a whole-screen scanner: per-block ink against the median of its ring, with a permutation null
  (30 shuffles) so only clusters larger than chance count, calm air (<5 kn) labelled as natural, and a camera-stability
  guard. A real-engine bench then ran a synthetic field across 13 zooms x 3 themes, with a positive control that the
  shipped build fails. One pole for every mark removed every non-calm artifact. The same bench showed that the
  speed-aware cull is exact at z7 but over-culls where fast trails bead (z8.5+), so it fades out by z9.5. Test every
  lever across the whole zoom range against a significance-tested detector before shipping it.
- **L-V9 · Check a palette between its stops, over every real ground, not just at the stops on grey.** The owner saw
  light/beach ~15 kt wind "blending in with the color of the map". Every stop had passed its gates, which were scored at
  the stops and on a neutral bench grey. But the ramp interpolates, and on its way from periwinkle (6 kn) to spring
  green (21 kn) it crossed the pale-cyan WATER's hue at ~12-13 kn (beach twice, ~13 and ~17 kn: 0-4° gap). Hue cannot
  separate a crossing speed. A cyan multiply over cyan water also keeps only 0.51-0.68 of its over-land strength, so
  the "flat" field strength was flat only on grey. And a 2-3 arcmin streak is seen by lightness, yet it sat +1.5 L* above
  its own tint. The fix (#282) gives each layer the lever that works on its ground: darken the FIELD 3-4 L* (the legend
  never shows it) and hold the particle (legend) lightness while adding chroma. A maximin solver over 10-21 kn, with
  the repo's gates as hard constraints, found it within 2 CSS JND per stop. Instruments: a composite model
  re-implementing the GPU blend at 0.5 kn steps over water and land, then the real-engine bench painted in the water
  colour (reports/Wind particle color basemap contrast.md).
  The slight version was not enough for BEACH ("the issue is still persisting"). A refine cannot rescue a palette that
  uses the ground's own colour family: beach's 10-21 kn stops were sea-teal, lagoon and sea green, painted on grey-blue
  water. The streak's speed colour is only a ~1 px core inside a white ring, so the TINT is what reads as "the wind
  colour". Painters' rule: the same hue made darker reads as deeper water; a different hue family reads as something on
  the sea. At dark-parity strength a multiply clears the water's colour category (>= 35° hue) only for a tint hue
  <= ~165° OKLCH. So the band became jade -> emerald -> palm-frond: tint 36-89° off the water's hue, 18.5-30 dE00 from it
  (was 0-36°, 12.7-17). Search on the TINT first, because it drives what is seen. Add an even-darkening term, or the
  solver picks a neon tint whose lightness swings and draws false bands.
- **L-V10 · A data layer added with no anchor buries the map's context, so put it under the borders and labels.** The owner
  could not see "the continent/land below the hurricane" in light mode up close. Fix it without touching colour or
  animation. The wind custom layer was added with no `beforeId`, so it drew ABOVE every basemap layer, and the storm's
  tint and opaque streaks crossed the state lines and city names. The tinted basemaps open their borders+labels block at
  `admin-1-boundary-bg`. Insert the data layer just before the first `admin-*` layer; this is the weather-map
  convention (Windy, Ventusky). Labels name the land but do not draw it: light's blue-family tints make tinted land read
  as water, and these Mapbox styles have no coastline stroke. So draw the basemap's OWN water-polygon outline as a thin
  line just above the data layer. It uses the same source and source-layer as the `water` fill, so it sits exactly on
  the map's coast at every zoom. Opacity 0.42 read cleanly in light, while 0.6 got busy in the Mississippi delta. Beach got
  the same two changes at 0.28 (the owner asked for "slightly less bold"); dark keeps its approved look. To verify, use a
  local page with real MapLibre, the real Mapbox style and the real wind engine as a custom layer, side by side; unit
  tests cannot see layer order (WebGLWindUtils.windLayerBeforeId / windCoastlineLayer). Dark followed with a LIGHT line
  (pale slate 0.45): a warm sand line sank into dark's yellow-green tint, and at 0.28 the line was lost among the bright
  streaks. A test page on a white background shows dark's partly transparent composite as washed-out pastel; give the page
  the app's dark backdrop before judging dark.
- **L-V11 · On a saturated cyan ground, a violet -> green ramp must hand off across the ground's hue; a palette can only make
  the hand-off short.** Light's "under 15 kt looks like the water" was cerulean (10) and teal (16) sitting 0-26° off the
  water's hue from 8 to 18 kn. Splitting it, with 10 kn violet-side and 16 kn green-side, still crosses the water's hue
  between them, because the sRGB interpolation of violet and green runs through blue-grey. The solver's best leaves a ~1 kn
  hand-off at 13 kn instead of a 10 kn span. Softening the basemap water was measured as the alternative: +2-3 dE00, at
  the cost of the land/water step (16 -> 10-12). Pin the hand-off WIDTH, not a hue floor at every speed. Re-pick the
  streak colours with the field fixed: the first violet core went isoluminant with its own violet tint (-1.5 L*).
- **L-V12 · Before blaming the renderer, ask which upstream built each grid: a label is not a model.** The owner saw
  the hurricane eye change on a one-stop zoom at a fixed hour. The leading hypothesis was rendering (a few-cell eye
  resampled on another box). The null control killed it in one run: the same data cropped to the other box drew the
  identical eye (0 km, x1.00). The real cause was in the data. The two zoom stops' boxes came from two lanes that
  share the label GFS / `gfs_seamless`: Open-Meteo's `gfs_seamless` is HRRR inside HRRR's domain (405/405 nodes equal
  `gfs_hrrr`), and the native recovery is NOAA GFS. The engine's "never blend two models" check compares labels, so it
  could not see this. Instruments that settled it: the console's `maxWindSpeed` flipping per stop, Render's
  per-product upstream lines, Open-Meteo queried per model at the served nodes, and a bench with the real engine and
  the served grids as fixtures (log 2026-10-09-hurricane-eye-one-model). When two grids of one field disagree, diff
  their VALUES on shared nodes before their geometry.
- **L-V13 · A draw lever that steps at a zoom boundary reads as the picture changing shape.** Above z6 the speed-aware
  cull switches on at full strength in one step. It fades out at 7.5-9.5 but has no fade-in. With the grid fixed, the
  eye's trail ink over its wall's went 1.21 -> 1.77 from z6 to z6.5. Any lever gated on `zoom > N` needs a ramp, or
  a one-stop zoom across N will look like a different storm. Measure each zoom-gated lever with the grid FIXED at
  N-0.5 and N+0.5 before shipping it.
- **L-V14 · Trail ink is not land hidden. Calibrate what reaches the screen, per theme.** The close-zoom dose holds
  the trail buffer's brightness about level from z6 to z11. That was calibrated on dark, whose marks composite
  translucent (brightness alpha x 0.505). Light's marks composite premultiplied at opacity 1.0 and hide what they
  cover. So the same ink took 0.40 of light's land line contrast at z6 and 0.58-0.64 at z7-9 (dark 0.25-0.38). The
  owner saw it as "flooding ... drowns out the land". `land-run.js` measures the screen instead: a line grid on the
  land colour, the field alone vs the full pool. It found the field innocent (about 0.80 kept at every zoom). Light's
  mark opacity eased to 0.65 across z6-7.5 (`WIND_CLOSE_LAND`, a ramp per L-V13) holds z7-11 at 0.35-0.43. When a
  composite changes per theme, re-measure coverage on screen, not the shared intermediate.
- **L-V15 · A colour-blind solver passes by drawing stripes unless smoothness is a constraint; and a strength-pinned tint
  has a physical ceiling.** The first dark solve cleared the 5 dE floor (coloraide Viénot/Brettel) with tiny moves, by
  trading blue between 21 and 27 kn. 27 kn went paler than both neighbours: a chroma stripe that a lightness check
  cannot see. Pin "no NEW lightness or chroma peak/dip" in the legend AND the tint (keep the turns the palette
  already has, and let the tint turn where the legend turns). Then dark becomes a lightness arc, the cure the theory
  predicts. Light/beach tints are pinned to dark's strength (24-26 dE76), and a multiply that strong darkens cyan water
  by at most ~22 L*, so light's 40-75 kn tints are a near-grey there for everyone. A 5 dE floor on six fast-band steps
  was out of reach smoothly (1 run of 11, and only by a redesign). Measure the CEILING (maximin) before promising a
  floor, check the full pair matrix rather than the worst pair, and check land as well as water (log
  2026-10-09-wind-cvd-palettes).
- **L-V16 · A lever that reshapes the TRAIL must re-pass the scanner; one that scales the COMPOSITE cannot draw a
  pattern.** The research case for thinner marks over fainter ones was strong:
  - zoomBoost widens a dash to ~5.8 css px at z9, while no leading wind map draws wider than ~3 px;
  - opacity is the luminance contrast that carries motion;
  - at equal land returned, thin kept each mark's contrast (15.5 vs 15.7 dL* per marked pixel; opacity gave 13.1).

  The 3-seed scanner overruled it. Thin marks added recurring ink bands at ~17-24 kn and holes at ~8 kn at z6.5-8
  in every theme: 10 shapes in 7 of 12 views, against 4 in 3 on dev and on #292 alone. Width floors of 1.5 and 2.5 css
  px did not cure it. The bands sit where the speed-aware cull (calibrated on the wide mark) runs at full strength,
  and none appeared at z9. A composite factor scales the finished picture uniformly, so it shipped (light 0.65, beach
  0.65, dark 0.8). Thin stays a lever until V2_SPEED_KEEP_INK is re-calibrated for it. Theory picks the candidates;
  the forensic instruments pick the default.
- **L-V17 · Score a line between its own two pixels, and pin a positive control's inputs.** Two instruments went wrong
  quietly on 2026-10-09:
  - **The WCAG 3:1 check.** It took a 5x5 min/max after compositing, so a particle's bright ring counted as road
    contrast, and lines read as MORE legible with particles on (85% -> 94%). Find each line's line pixel and ground
    pixel on the bare basemap, then score those same two pixels (map-run.js).
  - **The scanner's positive control.** It went BLIND because #292 changed the dark palette, not because the
    scanner broke. Its arms now pin that palette (CONTROL_VARIANTS).

  Before trusting a new metric, ask whether the thing under test can supply the signal the metric is looking for,
  and whether an unrelated change can starve the control of its defect.
- **L-V18 · A colour encoding must be read back from the screen: check the hue against the legend at the TRUE value.**
  For weeks every palette round asked whether light's and beach's multiply tint was VISIBLE over the water (ΔE from the
  ground). None asked whether it still showed the legend's colour for that speed. The path bench's `hue30` samples the
  served grid under every pixel and compares the hue on screen with the legend's: on a z8 pan, 55% (light) and 43%
  (beach) of the wind-coloured pixels sat more than 30° off. A 33-40 kn gold multiplied into cyan water came out green,
  which is a 16-21 kn colour on the legend. Dark's alpha-over read 3%, the null control. The owner had called this
  "ambiguity between the wind colour and the map colour". Muting the ground's chroma under the wind (the leaders'
  answer) brought it to 2% and 1% (log 2026-10-09-wind-basemap-mute). Also gate the colour-blind floor on EVERY ground
  the tint sits on: light's field had collapsed to 1.8 on its own near-grey land all along, and the CI pin only looked
  at the water.
- **L-V19 · MapLibre paint changes are neither instant nor synchronous: settle before you read.** Two things went wrong
  in the bench, and both make paint state lag behind setPaintProperty:
  - `setPaintProperty` fades over the style's transition (300 ms by default). With the bench's virtual clock still
    during a capture, the water mask and the "original" frame were read mid-fade.
  - A data-driven colour (a `match` on class) makes MapLibre re-parse the source's tiles in a worker. One frame later,
    some layers still show the old colour. A per-sample mute toggle corrupted the frames after it, and a one-frame
    round trip read "exact" only because the mute had never landed.

  Set the transition to 0, take references in a separate settled pass (`idle`), and never toggle paint mid-path. In the
  app, the first mute re-parses the visible tiles once.
- **L-V20 · Every zoom tier is its own sampling lattice. A grid that repeats the base's nodes must never displace a finer
  one.** After #287/#293 made every tier one model, the owner still saw the eye move on a zoom stop. The tiers
  point-sample the field at 2°, 1°, 0.5° and 0.25°, and an eye smaller than a cell is redrawn from other nodes at each
  one. The eye bench measured the same storm at 1°: 17-25 km off, wall -8 to -12 kn, area x4. The 2° tier is the world
  base clipped to a box. Because it covered the view, it replaced the 1° box, and the next delivery filed the box again
  (last arrival wins). Ask what a candidate grid ADDS over what is already drawn: a base-resolution clip adds nothing.
  When two grids of one field draw a feature differently, compare their lattices as well as their values (L-V7).
- **L-V21 · A bench that draws the basemap alone cannot test a rule that reads the style. Give the instrument the app's
  layer stack, and make the read-back report the effect.** The basemap mute (#296) measured 38% -> 3% on the path bench,
  merged, and never ran in the app. Its rule stood down for any raster layer in the style, and the app keeps a satellite
  photo and 18 weather-wash slots mounted and hidden under the wind (`MapWebGL.js`). The bench's map had none of them.
  Two more things hid it:
  - `getStyle().layers` leaves custom layers out (MapLibre `_serializedAllLayers`), so the wind layer's slot was never
    found and "under the wind" meant the whole style, in the bench and in the app alike;
  - the read-back said `applied: true` with `layers: 0`, and I told the owner to read `applied: true` as success. The
    owner's console paste showed the 0.
  Rules:
  1. An instrument for code that READS app state carries that state (here the layer stack, pinned to the app's source
     by a wiring test), and its positive control is the shipped code run on it: `path-run.js --ref <commit>`,
     `--mute-check`.
  2. A read-back reports what was done (`layers > 0`, or the reason it stood down), never what was asked for.
  3. After a merge, read the effect on the deployed build before calling it live (the kin of L-V19: settle, then read).
- **L-V22 · When a coarser grid covers more, file it AROUND the finer one, not instead of it. And check the instrument
  is following the feature you named.** After #298 the eye still changed on a zoom-out: the engine holds one fine
  overlay, so the covering 0.5° or 1° box replaced the 0.25° box (ladder bench: 21 km, -12 kn and x2.9 in area at the
  1° step; x1.7 at the 0.5° step). Three things the measurement settled before any code:
  - **The tiers already agree** (0.009 kn at 405 shared nodes): the lattices nest on whole degrees. So "resample the
    tiers consistently" was not the fix; the area mean, the other consistent resample, loses the eye (35 km, x16).
  - **Keeping the fine box and letting the base draw the rest holds the eye and loses the picture** (9.6% of the view
    10 kn or more off, against 0.9%). Measure what an option gives up, on the whole view, beside what it fixes.
  - **A second texture level was not needed.** Resampling the coarse box onto the fine lattice on the CPU draws what
    the shader would have drawn from it (bilinear of bilinear on a nested lattice is exact), so one texture carries both
    (`windTierMosaic.js`).
  The instrument had its own defect: "the eye at T" was the nearest closed contour, and once the eye opened at 40 kn a
  9-km pocket 100 km away took its place, so the weakest wall read 2 kn high in every row. A feature tracked across a
  sweep must be the SAME feature at each step (here: nested, no smaller, centred within its own radius). Print the
  per-step geometry once before trusting a summary of it.
  And L-V21 nearly repeated itself: the merge rule first compared `run_time`, which on a dynamic box is the per-box
  ingest stamp, so in the app it would have refused every merge while the bench (fixtures with no run fields) passed
  every row. Build a rule's test inputs with the app's own mapper, and give the bench a control that fails when the
  rule under test never fires.
  A cold review then found what my own tests could not: I had re-pointed an existing guard (never downgrade the view)
  at a new object and lost its old meaning, and my "same valid time" compared a field the server fills with the ASKED
  hour. Tests written by the author pin the author's model of the change. For a default-on change, have someone who has
  not seen the reasoning read the diff and run it, and replay each guard the diff touches in its old cases.
- **L-V23 · A colour-blind redesign needs stripe rules on BOTH lightness and chroma, a hue-monotone rule, every Jest pin as a hard
  constraint, and the right starting basin.** The light fast bands (6-75 kn field tints, muted ground) could not pass 5 dE2000 at
  2.6 under #297's rules, and four solver traps hid the real answer:
  1. A solver given only a lightness rule reaches 5.22 on every seed by drawing CHROMA stripes (C* 23, 11, 33, 10, 7, 21); given
     lightness and chroma rules but free hue it zig-zags HUE between yellow and blue neighbours. Pin all three (L never rises, C no
     peak/dip > 1, hue monotone with a step bound).
  2. A stripe-free class with a ceiling of 5.7-7.3 existed all along (tint-space search); the stop-wise local search sat at 2.5-4
     because it started from today's flat-lightness basin. A ceiling from a local search is a lower bound. Build the shape (steady
     descent, 21 kn tint <= today's L*) and polish it.
  3. The binding gate was not the one I suspected: dropping one family at a time showed the 10-21 kn streak-vs-tint gate, not hue
     identity or the strength cap, held a stalled polish at 3.7-4.0. Run the one-family-at-a-time sensitivity before arguing.
  4. My replica of the Jest "no new lightness turn" pin was weaker than the real one (unmuted grounds, allowed turns at 16, 21, 40
     only): two candidates carried a 6 kn dip that real Jest caught. Run the real suites with the candidate as the default
     (`gatereport.js`) and read the failing tests; the replica is for solving, Jest is the authority.
  What gives for a smooth pass is only the dark-parity strength pin for 27-75 kn (about 1 dE of floor per 7 dE76). A wind A/B
  shows the wind AS DRAWN, colour and particles: a colour-only render is a labelled test view (owner, 2026-10-10). (log
  2026-10-09-light-fastband-cvd)
- **L-V24 · Try a rendering algorithm where it can be SEEN before porting it, measure the picture's own property, and have
  someone who did not write it read the diff.** Anchoring the wind's trails to the map (`windTrailAnchor.js`) was designed
  in a standalone lab page first. Two ideas that are correct on paper failed there in minutes:
  - resampling the trail buffer through the camera change every frame blurred the trails for as long as a zoom lasted
    (a bilinear resample per frame compounds);
  - re-laying the ink into a wider buffer on a zoom-out left a box where the old buffer had ended.
  The survivor (the buffer keeps its own camera: whole-pixel shifts for a pan, one resample at display for a zoom, a
  feathered re-lay) was ported once and passed its bench on the first run. Rules:
  1. For a change to how the picture is built, write the smallest page that can show the artifact, try the
     alternatives there, and port the one that survives.
  2. Measure the property the viewer reads, not a proxy for it. Flow mode asks "do the streaks run along the served
     wind?" of the composited frame, with the shipped engine as the positive control (it must fall while the camera
     moves) and bit-identical trail buffers at rest as the null control.
  3. A null control that asks for identical output will find every shared source of chance. It found that the bench's
     seeded runs depended on the run before (the engine and MapLibre both draw from `Math.random`), and that the canvas
     is not a fair thing to hash (the basemap under the wind is not bit-stable between runs). Hash what the code under
     test owns.
  4. Say where the result stops. Ground that has just come into view has no trail history, so a fling reads below rest,
     anchored or not; the gate there compares the arms, and the README says why.
  5. A passing bench is not a review. Every camera in my tests and my bench stayed in one copy of the world; a reader
     given the diff and seven questions found in fifteen minutes that crossing the date line cleared the trails, that a
     zoom wobble re-laid the ink every frame, and that the kill switch was not exact off desktop. The date line then
     taught the bench one more thing: a median cannot see one wiped frame (0.713 against 0.715), so the clear itself is
     gated from the engine's read-back. (log 2026-10-10-wind-trail-anchor)
- **L-V25 · When a new default replaces rows that older kill switches partly own, every older kill steps back past the new
  default first; and the old pictures are captured from the code, not typed.** Light's field has four older kills, each
  restoring a few rows. Making A the default by swapping the rows alone would have left each of them drawing a ramp nobody
  had measured: A's rows with a few older ones mixed in (the fast-band log saw it as two kill controls going red). Rules:
  1. A kill switch promises a picture that existed. When the default moves, an older kill first restores the whole
     default it was written against, then its own rows. One test pins every older kill's ramp, byte for byte.
  2. Take the "before" from the running code before the edit (a scratch test wrote the default, the candidate and each
     kill's ramp to a file) and generate the pins from that file. Hand-copied rows are a second source of truth.
  3. A re-scoped gate keeps its old form as a positive control behind the kill: the field before A still sits within
     1 dE76 of dark, and still reads ~2.6 on every ground. (log 2026-10-10-light-fastband-a-default)
- **L-V26 · Before copying a look, measure it; and the mirror of a look is a hypothesis.** The owner: "I like the way dark
  theme does the animations of the wind ... light and beach [should] reflect similarly". Weeks of palette work had never
  asked what dark's streaks ARE. Rules, each paid for the same day:
  1. **Turn "looks great / looks pale" into columns.** The bench's style columns (`style.js`) read three things off the
     picture: which side of their ground the mark pixels fall on, how far, and whether they keep its colour. Dark: all
     on one side (+10 to +14 L*), colour kept. Light and beach: a mix of both sides at a third of that, colour lost.
     The defect had a name within the hour: a mark whose halves cancel.
  2. **Build the obvious dual AND the literal port.** Ink (darker marks, multiplied in) was the mirror the theory and the
     research report both pointed to. It was right on land and failed in one view, wide zoom over warm water, because a
     darkened yellow is brown. Dark's own pipeline moved onto the light map looked impossible on paper ("a light ground
     has no room above it") and worked, because the field tint under the marks lowers the ground. Judge at device
     resolution, at more than one zoom, at storm strength too.
  3. **A string pin passes on broken GLSL.** Three shader bugs went through 30 green tests and were caught only by the GPU
     bench: a uniform declared behind a `//` comment, a composite branch left on for the buffer-to-buffer copy (nothing
     ever faded), and a tail law off by a power (the map whited out). Now pinned: the tests read the source the compiler
     sees (comments stripped), and a program used for two passes sets its mode uniform in both.
  4. **Research written before the bench is a hypothesis too.** The report concluded for ink from the first prototype;
     the bench then showed glow. The result went back to the writer. (log 2026-10-10-dark-style-light-beach)

- **L-V27 · A ramp is its path, not its stops; and a bar carries the ground it was set on.** The owner: "the light wind
  color also looks like fog". Every gate light's field had passed read the STOPS: the colour-blind floor, dark's strength
  per band, the hue against the legend. Between the 10 kn violet and the 16 kn green the field drew pure grey (C* 1.0 at
  13 kn), and no gate looked there. Rules:
  1. **Read a ramp between its stops.** Two neighbours on opposite sides of the hue wheel blend through grey on the
     straight sRGB line. The checker now reads the weakest colour on the PATH (`veilC`), and the app walks such a
     segment round the wheel.
  2. **A bar names a ground; when the ground changes, re-read the bar.** "Calm is clean" was right on a map that kept
     its colour and drew grey the day the basemap was muted under the wind. Nothing failed, because the test still used
     the unmuted surface. After any change to what the wind sits on, list the bars that say "the map" and re-run them
     on the new ground.
  3. **Before asking a tint for more colour, compute what exists.** A lilac over a near-white ground tops out at C* 15
     at L* 84.5. The first attempt deepened three stops and broke four bars in turn before the ceiling was computed.
  4. **White in a small mark is paid in colour only where the hue can be light.** Taking it out kept beach at 1.00
     lighter and dropped light to 0.83. Measure the polarity, not only the chroma, per theme.
  5. **Compare scanner SHAPES, not counts, between marks of different brightness.** Glow read 7 against 5; kind, band,
     size and place showed the same shapes, two of them crossing a counting threshold.
  6. **A shell default is not a place for JSON.** `${2:-{"a":{}}}` ends at the first closing brace: one bench arm ran
     where two were asked for. Read JSON from a file. (log 2026-10-10-dark-style-light-beach)
  7. **"Every" needs every one measured.** Two themes were measured and three were written: dark's nearest segment sat
     three percent from the trigger. A reviewer with no part in the work computed it in minutes, along with an older
     kill that no longer drew what it drew. Keep that review for any PR that changes what is drawn, and give a rule's
     trigger a margin a test can see. (same log, "Independent review")
- **L-V28 · A pick made on still crops is a hypothesis until the owner has seen it move.** Glow was picked from an A/B page of
  crops, scanned, benched and made light's default; live, it washed light out within the hour. The bench had the numbers
  (marks on 34-81% of the pixels, every one lighter, +5 to +12 L*) and no bar on their product. Rules: (1) a new default
  that has only been seen as stills ships to ONE theme or behind a lever first; (2) give the bench a wash number
  (coverage x lightness step, and the share of mark pixels darker than the ground) before the next mark design; (3) on a
  pale ground a mark that can only lighten has no edge: check polarity against the GROUND's lightness, not only for
  consistency. (log 2026-10-10-dark-style-light-beach, "20:23Z")
- **L-V29 · Test a bar on its anchors before you trust its form; the obvious product can rank the reference worst.** L-V28 asked
  for a wash number, "coverage x lightness step". Measured on one bench run, dark (the look being copied) added the MOST lightness
  (+7.8 over land), beach (liked live) +6.6, and light under dark's streak method (washed out live) the least, +3.3. The second form
  tried, the share of the ground's headroom used, ranked beach (0.17) above the failure (0.11). What separated all three was where the
  picture ENDS (field L* + coverage x step: dark 32, beach 68, the failure 74) and whether any mark keeps a darker edge. Rules: (1) put
  the reference and the known failure through a new bar before writing it into a test; (2) say how many anchors a bar stands on
  (here two) and call it provisional until it has more; (3) the same measure then caught a candidate (A moderate at z4 and in a
  storm) that every palette gate had passed. (log 2026-10-10-light-look-ab)
- **L-P32 · A branch cut from an open PR's head can miss its last commit; re-fetch the base before the first push.** This session
  branched from #310's head at 20:31Z; #310 had taken one more commit 56 s earlier (the owner's beach decision, ledger seq 1039) and
  merged two minutes later. The first push of #311 carried #310's older commits and ledger lines that forked dev's chain at 1039.
  Rules: (1) before the first push of a stacked branch, `git fetch` its base and compare heads; (2) if the base merged, rebuild on the
  merged commit in a separate worktree (L-P14) and re-append the ledger lines after the base's head; (3) read the base's newest
  commit message: here it carried the owner's newest words, which changed what this session owed. (log 2026-10-10-light-look-ab)
- **L-V30 · Restate a reference's rule in the form that holds on the new ground before you copy it.** Dark's streak composite
  (`c·b·op + dst·(1 − b·op)`) only "adds light" because its ground is near black: it removes b·op of the ground and adds colour in
  proportion to b², so on a lighter ground every fading tail darkens it (the Ground Truth lab: light's land −5 L*, 38% of streak
  pixels lighter). The 2026-10-09 "pale cream streaks" on light were the same law. The ground-independent form is #311's streak
  method, `Ŝ·b²·op + dst·(1 − b²·op)` (98-100% lighter in the same lab). Rule: when copying a look, derive which clause of its
  formula depends on its ground, and write that clause so it holds on every ground. (docs/research/FINDING-2026-10-11-dark-s-rules-on-any-ground.md)
- **L-V31 · Dim a ground by one factor; never push every band to one ceiling.** Making room for lighter streaks by clamping each
  band's ground to a ceiling equalised their lightness, the one channel colour-blind viewers keep: light's floor fell to 0.4.
  Dimming every band by one factor in linear light (dusk) kept 4.6. A guard set at a level two neighbouring bands both reach
  merged them the same way (guard L* 68: 0.42). Rule: any per-band lift or clamp is checked for bands it makes equal. (same note)
- **L-V32 · A colour can be renamed by its surround: a dim orange is brown and a dim yellow olive on a pale page.** Brown and olive
  are related colours that exist only below a brighter surround; the same chromaticity reads as yellow light on a night map. This
  is B ink's flat olive sea, and #311's A deep has it too: computed over light's muted land, its 33 kn ground is rgb(144, 127, 71)
  (L* 53.5, olive) and its 40 kn ground rgb(136, 106, 71) (L* 46.8, brown). No gate asked. Rule: a palette gate on a pale ground
  names its colours (hue family vs lightness), and orange-to-yellow grounds keep their lightness. (same note)
- **L-V33 · A relation to the ground means the ground actually under the mark: land and sea separately.** Dark's land and sea are
  both near black, so one streak colour per speed serves both. Light's sea is far darker than its land under the tint, so one colour
  stepped +24 L* over the sea and washed it (end 75.1). Solved per ground the sea read +17.3, end 68.1. The engine has no land mask,
  so this needs one. Rule: when a rule is relational, check every distinct ground it meets, not the one the table was solved on.
  (same note)
- **L-V34 · A rule about hue is a line in speed: read a solved table per knot, never only at its stops.** The name guard holds
  orange-to-yellow grounds light and hands over across 10 degrees of hue. Light's field leaves green for yellow-green between 25
  and 26 kn, so the ground stepped from L* 55.5 to 74.1 in ONE knot: 8 times the steepest step of the field before it, a contour
  line on every storm, and a threshold on an interpolated grid (L-V8). The lab and the FINDING scored the 13 Beaufort stops, which
  sit on either side of it (L-V9 again). Easing it to both sides dimmed the 27 kn stop toward 33 kn and took the colour-blind
  floor from 4.6 to 2.2; reaching outward only (4 kn) kept every untouched stop and the floor, at 4.4 L* a knot. Rule: every
  solved ramp gets a per-knot instrument (the steepest step, with the unfixed solver as its positive control), and a hand-over is
  sized in the unit the eye meets it in. (log 2026-10-11-dark-rules-default; `windDarkRules.test.js` "NO HARD LINE")
- **L-V35 · When a solver is ported, diff what each copy is FED, not only its formula.** The lab's solver read the field through
  `lut()`, which walks the hue path first. The port read the raw stops on the straight sRGB line, so light's 13 kn ground came out
  grey (C* 0.9): the fog D-019 had removed, back in the new default, with every existing test green because they read the tables
  the kill restores. A 3-line probe at the worst known speed found it. Rule: a new default re-states, on ITS OWN tables, every
  property an older fix bought (no grey on the path, a calm tint, no hard line), and a port is probed at the speeds old defects
  lived at before it is trusted. (same log)
- **L-V36 · A default that shares tables with older levers is swept against every one of them: whole, or not at all.** With dark's
  rules on by default, the ink and glow levers drew their marks on the new field and the new streak rows: looks nobody had built
  or measured, and every bench arm that names one would have compared a mix. Rule: one function decides whether a look draws, the
  tables, the mark model and the mask all ask it, and a test walks every combination of the levers (2,880 here) asserting they
  agree. (same log)
- **L-V37 · A module that touches GL inside an engine uses the engine's own state helpers, and an upload outside the frame sets its
  own unpack state.** The engine's `bindTexture` keeps a record of the active unit; a raw `activeTexture` beside it leaves the
  record wrong, and the next bind lands on another unit (it happened to line up in today's call order). The land mask is uploaded
  from an idle callback, where the unpack state is whatever the map or another layer left: flipped, the mask would lay the
  Arctic's rows on the Southern Ocean; and after a restored context its texture is gone while its object remains. Rule: bind
  through the engine's helper, pin FLIP_Y and alignment at every upload outside the frame, re-validate textures when the program
  changes, and publish the state for the read-back. (same log; `windLandMask.js`)
  - *Note, 2026-10-11 16:27Z (L-V36):* the sweep walked the LEVERS and missed the KILLS. An independent review found that under
    `__RAW_DISABLE_WIND_FIELD_TINT__` the field sampled the streaks' two-row table as an alpha-over field, and that every older
    palette kill now drew dark's rules solved on its rows instead of what its DECISIONS entry says it restores. Rule, sharpened: a
    new default lists every older kill and lever that changes what it was solved on, each one stands the default down, and a test
    reads the kills out of the source so an unclassified one fails (21 hold, 36 do not, 0 unclassified).
- **L-V38 · When a shared thing changes shape, every instrument that touches it is part of the change.** The marks' table went from
  one row to two. The eye and ladder benches swap a threshold ramp into that table with a one-row sub-image, so the second row kept
  the palette, dark's field read the mean of both, and every speed above the threshold read as below it: "no closed eye" on every
  row, exit 2, no GL error. The scanner was hit from the other side: the map runner wrote the land mask's file into the bench's
  shared output folder, and the next runner served it, so a scan reported as "no land mask" had one. Both were found by review, not
  by the runs that had passed. Rules: (1) before changing a texture's or a file's shape, grep the instruments for every writer
  and reader of it, and run each instrument once against the commit before; (2) an instrument's inputs are answered per run, never
  left in a folder the next run reads; (3) a run's report states what it measured from the run's own read-back (`mask 0` / `mask 1`),
  not from what the author believes was served. (log 2026-10-11-dark-rules-default, "Independent review")
- **L-V39 · A stopping rule that walks up from zero stops at the first bad step: read the whole trade before choosing a per-step
  test.** A rule against a pale band in #312's streaks (built on a local branch, never merged: D-021 overtook it) was specified as
  "take white only while each step of it pays". Read per knot, the first 1% of white on a red (light, 46 kn over land) buys 0.148
  L* a C*, under the threshold of 0.15, while its white as a whole buys 0.35, and with no white that streak is 1.7 L* DARKER than
  its ground; beach's reds at 51-54 kn would have lost about 10 L* the same way. A red's first white costs colour before it adds
  light, a yellow's the other way round: the curve's shape differs by hue. The rule was built on the white as a whole, walking
  DOWN from what was asked to the most that pays. Rules: (1) before a marginal criterion is written, read the gain and the cost at
  the start, the middle and the end of the walk for every hue it will meet; (2) the case that would have broken the naive form
  goes in a test by name. (log 2026-10-11-wind-pale-band, "The rule, and why it is on the white as a whole")
- **L-V40 · "Identical" from an instrument means identical in what it reads: name that quantity before believing a null.** The
  artifact scanner read a default and its kill the same on every number in all 26 views and printed "this engine reads none of
  the levers that tell them apart". The lever (the unmerged pale-band rule) moved only a full-brightness colour's share of white;
  every number the scanner prints is read from max(R,G,B), and that colour's strongest channel stays at 1. The instrument could
  not have seen it, and the lever was live: all 26 image pairs in the run's contact sheet differed. Read rightly the null said
  something useful (no trail changed shape or brightness), but only once a read that CAN move had shown the lever was read.
  Rules: (1) before a null is written down as "no change" or "dead lever", state what the instrument reads and whether the change
  can move it; (2) keep one read that can (here the images, and the map bench's chroma column); (3) an instrument's warning states
  what it observed and every cause that fits, not one. (same log; `scripts/wind-bench/report.js`)
- **L-V41 · Read what the reference DRAWS before measuring what it looks like: four copies of dark's wind failed on one misreading.**
  Glow (#309), light's look (#311), dark's rules (#312) and a pale-band rule (built, never merged) each started from one measured
  relation, "every dark streak is a brighter shade of the colour under it, chroma kept", and each gave light's and beach's streaks
  a colour of their own to reproduce it, with more machinery every time (a solver, land and sea rows, a land mask, a colour floor,
  then a rule about what white costs). The owner took beach for dark and rejected both themes. An hour with the mark shader and a
  still camera's frames showed what dark draws: a small colour core under a WHITE ring at 92% (`DRAW_FS`), laid at half strength
  (`SCREEN_FS`). A white wisp at half strength over a colour field reads as "that colour, lighter": the relation was right, the
  cause was not. One lever that already existed (`__RAW_WIND_GLOW_RING__ = 1`) reproduced dark's relation in both themes, and the
  owner picked that arm at the first showing. The owner's own words had said it: "It should be more simple than its been."
  Rules: (1) before designing a copy, read the reference's drawing code and say what it draws in two sentences, then check the
  sentence against frames of it in motion at every zoom it is used at; (2) try the smallest existing lever that could reproduce it
  before building anything; (3) measure a candidate by what MAKES the look (here: the streak's colour against its ground's, chroma
  ratio and hue turn) as well as by the relation the look shows; (4) when each attempt needs more rules than the last, suspect the
  model was misread. (log 2026-10-11-wind-pale-band, "Dark watched in motion"; DECISIONS D-021)
- **L-V42 · Show a look moving, beside its model, and let the owner point.** Days of still A/Bs, tables and crops ended in a look
  the owner could not tell from another theme. A 3 x 3 grid of five-second clips (the model in the left column, today's look in
  the top row, two candidates a theme under it, at two zooms) got "middle row for both, build it" in one message. A still also
  misleads in a known direction: glow was picked from stills on 2026-10-10 and "washes out" live the same day. Rules: (1) a
  visual candidate goes to the owner as motion at real speed, beside the reference, at a wide and a close zoom; (2) each pane is
  labelled with what differs in the owner's terms (which streak, which depth), not with a lever's name; (3) the build that follows
  is the arm that was shown, lever for lever, and a test pins its tables from the code before the default moved (L-V25), so
  "what was built" and "what was watched" cannot drift apart. (same log; `windWhiteStreak.test.js`)
- **L-P33 · Read the box's `uptime` before spending the one live map load: a merge has just restarted it.** (Reported by the
  session that read #312 back on the deployed build, 2026-10-11; recorded by this session, which did not observe it.) A
  frontend-only merge redeploys the backend. `/api/health` six minutes after #312's merge: 200 in 0.35 s, uptime 3 m 47 s. One map
  load later it answered in 10.8 to 15.4 s, and still 4.6 to 5.4 s two minutes on (71 requests over 5 s, the longest 74 s, two
  5xx). The health probe before the load read "fast" and was taken as "ready"; a box that young has cold caches and is fast only
  because nothing has asked it for anything. Rule: the probe before a live read checks `uptime` as well as latency, and the one
  live map load waits until the box has been warm for a while. (log 2026-10-11-wind-pale-band, the relayed section)
- **L-P34 · A branch stacked on an open PR is re-cut from the merged base, and work the owner has overtaken is parked, not pushed.**
  This session's first task (one rule against a pale band in #312's streaks) was built, gated and reviewed on a branch stacked on
  #312's head. #312 merged seconds after the start-of-session check, and then the owner's first-hand verdict on #312's look made
  the rule moot before it was pushed. It was left on its local branch, never pushed, and the next change was cut fresh from
  `origin/dev`: its log, the lessons and one instrument's wording were carried over file by file; its code, its decision
  amendment and its STATE bullet were not. Rules: (1) check the base PR's state again immediately before the first push, not only
  at the start; (2) when the owner's word overtakes unpushed work, say so in the log where the work is recorded and name what was
  carried and what was dropped; (3) never open a PR for work the owner has already moved past, however green its gates. (same log)
- **L-P35 · "It now does little" is a claim: before removing machinery called idle, list every number it writes and pull it out
  as a lever.** D-021's record said beach's land and sea streak rows, the land mask and the streak solver "now do little" under
  dark's white ring, and a cleanup was briefed on it: one row, no mask, no solver, identical pixels as the proof. The check behind
  the claim had read the head's CHROMA. A row is four numbers a knot, and the fourth, the mark's alpha, is the mark's cover and
  the scale of its light: with the land row alone 29 to 67% of the sea's pixels moved by more than dE00 2.3 (offline bench, zooms
  4 to 8, served) and a storm over the sea turned pale. The PR that merged after the brief was written (#314) had given the mask
  a second job, so a third of the brief was void before a line was measured. **Then this session's own write-up made the mirror
  error:** it took its model of ONE stamp (laid at its alpha squared: "19% weaker") for the trail's law. An independent review
  read the buffer's blend (stamps overlap and saturate; at 13 kn: 0.82 of the land row's strength for one stamp, 0.91 for
  two, 0.96 for three) and the motion data (4 to 9%), and a fallback built on that percentage was withdrawn before the PR. Rules: (1) before
  calling a table, a texture or a sample idle, list every channel it carries and every line that reads it (`color.a` and
  `u_white` were one search away); (2) test "idle" by taking it out as a lever with everything else held, on the GPU, with a case
  where it IS idle as the null control (light's equal rows and dark: 16 of 16 PNGs the same), and when two things read one sample
  switch the other off first (D-022's kill), or the test moves both; (3) a brief ages from the minute it is written: at the
  start read what merged SINCE, not only whether the PR it names merged; (4) a number from a model of one pixel is a bound:
  before it is written as "the effect", check it against what accumulates (the buffer's blend) and against the same quantity
  measured in motion; (5) "visible" is said per arm and per scene, with the region and its size, or not at all; and a scene is
  named by the WIND in it, not by the lever that made it (this log called the fixture as served and at `scale` 2.3 "served" and
  "storm": as served it is already a hurricane, 23 to 42 kn over the sea, and the lever multiplies only the fixture's box; the
  same slip as #315's L-V50, caught by the session leading the lanes), read on the region the instrument really cuts (this
  session's first wind table sat on a view 11% too wide with the crop misplaced: the bench's map is 897 x 914 CSS px at pixel
  ratio 2, a motion frame is that scaled to 1000 px, and a crop is placed by its corner). (log 2026-10-12-wind-streak-rows)

- **L-V43 · Read land and sea apart: one number over a mixed view can say "equal" while both grounds are wrong.** D-021's white
  streak was laid at one strength, calibrated on a bench view that is mostly land, and its lift over that view's centre read 1.05
  of dark's. Read apart, it was 0.30 to 0.93 of dark's over land and 1.06 to 1.64 over the sea: a model theme's map can be the
  test theme's turned over (dark: a near-black land and a slate sea; light and beach: a pale land and a deep sea), so the two
  errors cancel in a median. The owner looks at a surf map, which is mostly sea, and saw the half the number hid. Rules: (1) when a
  look is copied across themes, compare it per GROUND, never over a crop that mixes them; (2) the bench's view must contain what
  the owner's view contains, in the owner's proportions, or the comparison is of a different picture; (3) a fix that is "one
  number" is suspect until it has been read on each ground it touches: this session told the owner one would ship, then measured.
  (log 2026-10-11-wind-dark-white)
- **L-V44 · The instrument runs on the owner's screen, or it measures something else.** Two looks passed the bench and were
  rejected in the app (D-020, D-021). The bench rendered at device pixel ratio 1 on its own view; the owner's laptop is 1.5, on
  their own view, with the live wind. One probe now reads both (`mirror-probe.js`: the deployed canvas through a browser
  connector, and the bench's saved frames), so a number means the same thing in both places, and the first thing it showed was the
  owner's own sentence ("close up ... somewhat okay ... when you start zooming out"): streaks cover 9 to 18% of the view at zoom 9
  and 43 to 87% at zooms 6 and 4. Rules: (1) before a look ships, read it where the owner will, with the instrument that read the
  bench; (2) levers and even whole tables can be tried LIVE in the owner's tab through the engine's handle, with the owner
  watching, before a line of product code is written; (3) say on the page what a live prototype is, and leave nothing set that the
  owner did not ask to keep. (same log)
- **L-V45 · A palette's zigzag may be a floor's doing: run the colour-blind check before straightening a colour path.** Light's
  field hue turns back four times along speed and beach's lightness dips at 10 kn; dark's does neither, and a prototype that
  straightened both looked like dark's side by side. The palette checker then read light's colour-blind floor at 2.9 (5.5 before)
  and beach's at 1.3 (3.1), and light's field 30 degrees and more off its own legend bar: the reversals and the dip are what the
  colour-blind passes bought, and the legend had moved with them. Rules: (1) a colour table is changed with the checker in the
  loop, not after the screenshot; (2) the field and the legend move together or not at all; (3) when a look and a floor pull
  apart, solve with the floor as a constraint (here: 5.1, within 4 degrees of dark's hue) and bring the owner both. (same log)
- **L-V46 · Read where a thing is drawn before choosing how to fix it, and prove the reading with a control.** The brief for the
  border ink carried a fair hypothesis: a full-strength streak is opaque at its core, so a border under the wind is cut whatever
  its colour, and the layer ORDER might matter more than the ink. The style documents and `windLayerBeforeId` said the borders
  and the names were already above the wind in all three themes; the probe then showed it in pixels (a pixel a glyph covers whole
  moves 0.00 to 0.27 L* under the wind) and showed it could have seen the opposite (23 to 98 L* with the wind forced on top). The
  whole fault was the colour, and no layer was moved. Rules: (1) a hypothesis in a brief is a thing to measure first, not a
  design; (2) "it does not happen" needs the control in which it does; (3) read the style's order from the style, as served,
  for EVERY theme: beach's lines were a mid grey, not the pale tint read on light. (log 2026-10-12-wind-border-ink)
- **L-V47 · A column over everything cannot see a few things: score the object the owner named.** Map mode's line columns read
  light and beach level with dark over land (`retP` 0.62 to 0.70 against 0.60 to 0.67) while their borders stood 2.8 to 7.6 L*
  off the ground and the owner could not see them: map mode scored 75,000 to 148,000 edge pixels over land in a view (roads,
  coasts, rivers, label strokes), and the border lines' centres were 440 to 4,704 pixels of it. Read alone (the lines found from
  the style as a coverage mask, each scored against the ground beside it) the same pictures said 0.10 to 0.64 of dark's. Rules: (1) when the owner names a thing, the instrument's unit is that thing; (2) find it from the
  source that draws it (the style), not from the picture, so a line that has vanished is still counted; (3) keep the general
  column beside it: it moved too, and it is what says nothing else was harmed. (same log)
- **L-V48 · An older kill's meaning is written in its tests: run the neighbours' tests before designing a new kill beside it.**
  The ink was first built with a kill independent of the mute's, and the mute's own test ("the kill switch restores on the next
  sync") failed: with `__RAW_DISABLE_WIND_BASEMAP_MUTE__` set, a border was still inked, and that kill is documented as "the map
  keeps its own colours". L-V25 already says an older kill steps back past what was built on it; I had read the lesson and still
  designed past it. Rules: (1) a new restyle that rides an older one's machinery is laid only where the older one is drawing;
  (2) the first run after the first green is the WHOLE file the code lives in; (3) the newer kill may leave the older feature
  on, never the reverse. (same log)
- **L-V49 · A bench mode is the app only in what it runs: write down what each mode skips, at the mode.** Two were found while
  building border mode, and neither had a line in the README. Map mode never ran the app's restyle: the basemap mute went into
  path mode and then flow and motion modes, and `shoot` drew the wind over the style's own colours for every light and beach
  number taken there since 2026-10-09. And the engine sizes a mark by the PAGE's device pixel ratio while the bench map's canvas
  was always 2: at the default a mark is half its app size in CSS pixels, at `--dpr 1.5` three quarters, and no frame was the
  owner's 1.5 in both. The kin of L-V21 (give the instrument the app's layer stack) and L-V44 (the instrument runs on the owner's
  screen). Rules: (1) an instrument change is opt-in when recorded numbers were taken the old way, and the README says which
  way each number was taken; (2) a ratio is one number in the page AND in the canvas, or it is two; (3) what such a gap did to
  earlier numbers is a measurement owed, not a guess. (same log)
- **L-V51 · Test the CALLER's order of events, not only the module's states; and a read-back that counts the plan cannot see a
  write that was overwritten.** With the handler dev has had since #299, the basemap mute is left OFF after a theme change when
  the new style arrives after the layer's re-sync, which is what a style fetched over the network does (replayed on the real
  library and styles with dev's module and handler: 3 of 3 in that order; not observed in the app): the layer re-synced a frame
  after the change, on the old style under the new theme's name; the new style was then diffed in over the restyle; and the
  stale check, which compares the record and not the paint, answered "nothing to do". `__WIND_BASEMAP_MUTE__` said `applied`
  throughout, so a read-back taken after a theme change would agree with a map that was not muted. Three things hid it: the module's own tests ran the order that works (the diff, then a sync); every bench mode
  built a fresh map a theme, so the owner's own way of comparing themes had no instrument; and the read-back reported what was
  planned. It was found by an independent reviewer walking the caller by hand, and then observed in the first run of a short
  replay (19 ms to the re-sync, 121 ms to the style). Rules: (1) for code driven by events, write the test in the order the
  caller fires them, and find that order by reading the caller and the library, not the module; (2) an asynchronous step between
  "the name changed" and "the thing arrived" is a race until proved otherwise: force both orders; (3) a read-back that can be
  true while the effect is absent is not one (L-V21 said it of `layers: 0`; this is `layers: 9` on a map that held none of
  them): read the effect (`getPaintProperty`), or count what took; (4) give every flow the owner uses its own instrument: they
  compare themes by switching, and nothing switched. (same log)
- **L-V50 · A look calibrated at one wind speed does not hold at another: sweep the wind as well as the zoom, and read the
  scene variable WHERE THE CROP SITS.** D-022's sea strengths were solved on one view of one fixture: beach 0.77 read 1.01 of
  dark's lift. On the deployed build it read 1.37, and this session recommended 0.55 from that one read. It then called the
  bench's scene "the wind as served, a median near 13 kn" from the fixture's whole box, measured one stronger wind beside it,
  and wrote that 0.55 was right in a storm and short in a breeze. The fixture is a hurricane: the zoom 6 sea crop holds a 42 kn
  field, and the "stronger wind" was 95 kn. Swept properly (the crop's median 8 / 17 / 42 / 95 kn) beach at 0.55 reads 1.10 /
  0.96 / 0.80 / 1.07: the one low reading is the band where beach's own field is pale, which is the band 0.77 had been solved
  in. Two points at one end of a range had been read as its two ends. Rules: (1) a per-theme strength is read at four wind
  speeds at least, everyday winds among them (`motion-run.js` runs take `scale`), as it is at three zooms; (2) the speed that
  labels a scene is read from the fixture inside the crop, never from the fixture's summary or a README; (3) when the bench and
  a live read disagree, reproduce the live read on the bench (its wind, its pixel ratio, one at a time) BEFORE recommending a
  number from either; (4) a number goes to the owner with the scene it is true in. L-S10 again (sweep the interior of a range,
  not its ends): cited in this lesson's first version an hour before it was broken. (log 2026-10-11-wind-dark-white, "Beach's
  sea at 0.55" and its correction)
- **L-V52 · Check the premise before the solve: which parts already follow the model, and what "match" means.** The owner:
  "you need to double check all this ... It could be the way it is, or it could not be. It all has to make sense to match dark
  mode, but [in] their colors and maps". For an hour this session solved light onto dark's hues within 8 degrees, a figure taken
  from its brief, and was heading for a field 4 to 12 L* paler (against dark's hue as the instruments then read it). The check took minutes: dark's code is the ORDER of its hues;
  light already ran it at calm, 3, 6 and 16 kn and from 33 kn up, and broke it at exactly two stops. Rules: (1) before changing a
  theme, read the MODEL's rules off the model and each theme against them, speed by speed, and say what already holds: that part
  is not touched; (2) "match" is the same logic, not the same numbers: a tolerance in a brief is a hypothesis with a price, so
  price it (here 8 degrees cost 6 to 7 L* of depth at 6 kn and 2 to 5 from 16 to 21 kn; 20 kept it); (3) ask why a wrong band is wrong before moving it: both of light's were
  bought to avoid a cyan sea that the basemap mute had since greyed, a reason that no longer existed; (4) show the check as a
  sheet a person can read in a glance, with the breaks outlined. (log 2026-10-12-wind-light-path)
- **L-V53 · A constrained solve needs the authority's own arithmetic, one bar at a time, and a control for the solver itself.**
  L-V45 said to solve with the floor as a constraint. What made that workable: (1) port the checker's scoring to the solver's
  language and VERIFY it against the checker (4,000 random pairs, 2e-12 here), so a candidate costs 0.1 ms and the floor is a bar
  inside the search; the checker still judges every table that comes out; (2) map the frontier before choosing: drop one bar at a
  time at a fixed depth and read what each buys (stripes 0.85 of floor, a normal-vision bar 0.6, 2 L* of lightness 0.7); the
  binding bar was not the one expected; (3) a bar may be stricter than the model: "one chroma crest" failed dark itself, which
  dips through cyan; (4) the solver needs its own positive control: a trailing comment added to a penalty line commented out
  four bars, and one run returned a "feasible" table 0.8 L* over its depth cap. It was caught because every bar is printed with
  every solution. Print them all, and score a known-bad candidate before trusting a zero; (5) a candidate stored as OFFSETS from
  a reference moves when the reference is corrected: when dark's law changed, the saved vector no longer described the table
  that was filmed. Store what is drawn. (same log)
- **L-V54 · When two readers share a table and only one should move, split at the reader, not in the table.** Light's legend bar
  and its particle marks read one ramp. Under the white streak the marks no longer take their colour from it, so only the bar
  had to follow the field. Overlaying the new rows inside the shared resolver broke 28 tests in states the change never draws
  (every older look, kill and bench that reads the particle ramp), and would have fed new rows to marks nobody built. Giving the
  BAR its own resolver left the particle ramp untouched in every state: 16 pins moved, all of the old default, and each kill is
  exact by construction. Rules: (1) list a table's readers before changing it; (2) the reader that changes gets the new
  function, the table keeps its bytes; (3) every instrument that reads "the legend" is told which one it means (the checker,
  the bench's hue line). (same log; `WindColorRamp.js` `resolveLegendRamp`)
- **L-V60 · An instrument's model of the reference must be the engine's own law, in one place: check a model against a GPU
  read before anything is solved on it.** Two models of DARK's ground lived side by side. The engine lays dark's field at its
  alpha SQUARED (`HEATMAP_FS` returns it premultiplied and the engine blends it `SRC_ALPHA, ONE_MINUS_SRC_ALPHA`), and
  `windDarkRules.js` models that. `check.mjs` and `mirror-model.mjs` (written for D-022 by this session) lay it at its alpha,
  which reads dark's sea about 20 L* too light (66 against 45 at 13 kn), and the two hold different dark map colours as well.
  A whole-picture table built on the second model disagreed with the bench, which is how it was found; a solver in another
  lane had already been built on it. Rules: (1) one composite law is written once and imported, never copied into a second
  script; (2) a model is read against the GPU at three speeds on each ground before a number is solved on it; (3) when a model
  and the bench disagree, the model is the suspect. Not yet fixed: the checker's dark lines and their pins move with it, so it
  is its own change. (log 2026-10-11-wind-dark-white, "The lead")
- **L-V61 · Give the scene clean axes: one variable a direction, and nothing else changing along it.** D-022 read "zoom 4, 6, 9"
  on a hurricane fixture, where each zoom's crop holds a different wind and the land crop lies outside the fixture: zoom, speed
  and place moved together, and three lanes each found a number that failed in the next scene. A SPEED RAMP (the wind blows
  due north everywhere and its speed rises with longitude, 7 to 61 kn across the view) puts every speed over land and sea in
  one frame, and a column of the picture is one speed. Read that way in one capture: light's sea is dark's lift at every speed
  (0.93 to 1.05, read from 13 to 51 kn); beach's sea is short only from 26 to 38 kn (0.60 to 0.68), where its field is pale; the LAND is short in both
  (light 0.58 to 0.93 below 45 kn, beach 0.38 to 0.53 from 26 to 38 kn) because its ground is 25 to 35 L* paler than dark's
  land; and dark's land and sea grounds are within about 6 L* of each other where light's and beach's are 12 to 15 apart. Dark
  is one picture; they are two. Rules: (1) before tuning a number, build the scene in which only its variable moves; (2) read
  every output along that axis in one capture, the reference included; (3) a result that changes with "zoom" is checked for
  what else changed with the zoom. (same log)
- **L-V62 · While lanes are open, the lead's sample is the COMBINED build.** The owner, on two clips cut from this session's
  own branch: "we have to keep in mind the work the subtrees are doing. For example, one is working on borders and labels of
  the maps. I dont see those reflections in your samples above". A sample from one branch shows the owner a picture that will
  never ship. Rules: (1) merge every lane's committed work into a local preview branch (never pushed) and capture from that;
  (2) say in the caption what each pane includes and what is not in yet; (3) show before and combined in the same clip, beside
  the reference. (same log)
- **L-V63 · A checker that prints the weakest pair hides the others: read every pair before you size the fix.** The palette
  checker's beach lines read 3.1 and 3.2 (16-21 kn) for a day and a half; FOUR pairs were under the bar (27-33 kn 3.6, 47-55 and
  63-75 kn 4.6 over the sea). A fix aimed at the printed pair would have left the checker red and looked like a failed fix. Rules:
  (1) print every pair on every ground and viewer (`beach-path-solve.mjs --audit`); (2) the pairs decouple at every stop a change
  keeps, so solve them apart and join. (log 2026-10-12-wind-beach-path)
- **L-V64 · A bar read one step at a time passes a slow reversal: bound the WHOLE, and score a known-bad candidate before trusting
  "violation 0".** The solver's hue-order bar allowed 0.6 degrees a knot; a candidate set 10 kn 2.9 degrees BEHIND 16 kn across six
  knots and passed. The bar is now the whole turn back. The same holds for "never rises a knot" (read the whole climb). (same log)
- **L-V65 · Know what speeds a bench crop holds before you read a lift off it.** The wind bench's default scene is a hurricane: at
  zoom 6 its sea crop holds about 41 kn, its land about 8. This session reported "the sea barely moves" for a change that does not
  touch 33 to 47 kn; at 8 kn the sea's lift moved 0.18. Rules: (1) read a field change on a speed ramp, or scale the scene and name
  the speed; (2) land and sea crops of one view are different speeds as well as different grounds; (3) one run is not a number:
  where two arms' tables barely differ and their lifts differ by 1 L*, say "one run". (found by the lead and simplification lanes;
  same log)
- **L-V66 · The least change is not the best field: name what a constraint can be paid in before you solve.** Under a multiply tint
  at 0.60 strength, deep AND colourful does not exist over beach's land (C* 33 needs L* 54 or lighter), so one-way lightness is paid
  in depth (the streak's ground), in colour, or in hue. The first solve minimised the change and lifted the commonest winds' ground
  8.5 L*; the owner's standing preference, already stated for light, was the streak's ground first. Rules: (1) chart the frontier
  along each coin (`--aim least | colour | deep`) before recommending; (2) ask which coin the owner has already chosen elsewhere;
  (3) the looser hue match is what keeps depth (8 degrees: 6.7 L* of lift; 12 degrees: 4.3). (same log)
- **L-V67 · Show options moving through ONE lever in ONE capture, and make the default the bytes that were shown.** The pick was
  made on a clip the lead cut from this branch's lab lever (`__RAW_...`, default unchanged), with the branch's own kill and an
  earlier option in the same capture as controls. The default's field hashes are pinned to what that lever drew at that head, and
  the lever and the options not taken left with the PR. A sheet of swatches did not show the pale band; motion on a ramp did. (same log)
- **L-V68 · When the default ground changes, every reading is a reading of the OLD ground until it is taken again: re-run the
  strict reads too, not only the gate.** Beach's path was solved to hold the colour-blind bar over #320's deeper land, and the gate
  (the palette checker, on the table) read 5.0 there before and after the merge. The stricter read this lane had added after its
  review, the table as UPLOADED to the 8-bit texture, was pinned on the land before #320 (over 5.2) and was not taken on the deeper
  land until a question from the lead, minutes after the merge was pushed: 4.87 to 4.89 at the common maxima, under the bar. A solve
  that puts several pairs on a bar at once leaves no room for rounding. Rules: (1) when a merge changes a default, list every pinned
  read that names the old default and take each on the new one before reporting; (2) solve to the bar plus the rounding the pipeline
  adds, or say the uploaded number beside the table's. (log `2026-10-12-wind-beach-path`, the entry after the merge)
- **L-V69 · "As uploaded" is not "as drawn" until the lookup is the GPU's: read the law back from a GPU before quoting a number
  through a texture.** This lane's first read of beach's field through the engine's 8-bit texture looked the texture up at the
  table's own index (255 x speed / maximum). The shader samples at speed / maximum with LINEAR filtering, so the GPU reads position
  256 t - 0.5: up to half a texel away, which at an 80 kn maximum is the colour of a wind 0.16 kn slower at calm and 0.16 kn faster
  at the top. Three sets of numbers went to the lead in an hour (4.79 and 4.98, then 4.76 and 4.89, then 4.68 and 4.65), each lower
  than the last, because the model was refined instead of checked; the first set is in #319's records on dev. A 40-line readback of
  a texture that encodes its own position (`scripts/wind-color/lut-lookup-gpu.cjs`) settled it in a minute on two renderers. L-V60
  already said it of the composite law; it holds for every stage between a table and a pixel. Rules: (1) before a number "as drawn"
  is quoted, each stage it passes through (the fill, the lookup, the blend, the canvas) is either read back from a GPU or named as
  not modelled; (2) sweep what the engine can actually set (the maximum is clamped to 10..80 kn: 90 and 100 kn cannot happen, and
  10 to 20 kn can); (3) a solve told to reach a target it cannot reach will pay for it with any bar that is not held hard: a capped
  solve here traded 0.14 L* of one-way lightness for 0.02 of floor until a test read the bar over the candidate's own rows.
  (log `2026-10-12-wind-beach-path`, the entries after the merge)
- **L-V70 · Read EVERY output the eye uses, along the scene's whole range, before tuning any one of them.** For a day the lanes
  tuned one number (the lift of the picture over the sea, at the speeds one fixture happened to hold) and it came to equal
  dark's; the owner, in the app, still saw no dark. Asked to compare "the amount and density of the animations" and "how slower
  color wind is more transparent than faster", a profile of cover, flicker, lift, ground lightness and ground chroma at 14
  speeds from 1.8 to 45 kn, land and sea, took one afternoon and showed three things no tuned number had: over land under 10 kn
  light's streaks lift the picture a seventh to a half as far as dark's (most land, most days); light spends its whole
  lightness range by 10 kn and lays its strongest colour in its lightest winds, where dark builds to 26 kn; and beach is twice
  as colourful as dark from 15 to 32 kn. D-022's "no white can lift a pale land" had been read at one speed. Rules: (1) the
  first instrument on a "make X look like Y" task is the profile of every visible quantity along every scene axis, X beside Y;
  (2) a conclusion about a ground or a speed names the range it was read on; (3) when the owner's eye and a tuned number
  disagree, the number is measuring the wrong thing: widen the profile before defending it. (log 2026-10-12-wind-land-depth)
- **L-V71 · Before choosing between two designs, run the bars each must clear at the candidate values.** Two depths for the
  land were on the table: the sea's (0.81) and dark's own relation, deeper than the sea (0.70). The second matched dark's lift
  with no seam and was the better mirror on every picture measured; one run of the palette checker at that depth read light's
  colour-blind line over land at 4.4 against a floor of 5.0 (5.1 at 0.81, 4.9 at 0.76). The choice was made by a bar nobody
  had run until both arms were filmed. Rule: the checker (and any other floor) is run across the candidate values at the
  START of a design choice, as cheaply as it is run on a finished one. (same log)
- **L-V72 · An instrument that reads a canvas must lay behind it what the app lays behind it. The bench drew light over black
  for two days; the app's light page is near white.** The map's canvas is premultiplied: the screen shows `rgb + (1 - alpha) x
  page`. Two of the wind's passes left the canvas's alpha at 0.61 to 0.90, the bench saved frames from the bare canvas, and
  `MapPage.js` lays black behind dark and beach but gray-50 behind light. So in light every bench number and every sample of a
  look that runs dark's composite (the glow, 2026-10-10; dark's rules and the white streak, 10-11 on) showed a picture the app
  did not draw. A bare-canvas frame is not "the canvas over black" either: the encoder un-premultiplies (clamped at 255) and then
  fills, so a pixel held min(channel, alpha) and the brightest streak cores were clipped darker in every theme, dark's bar
  included (found by the independent review, after this lesson's first wording had called the old frames "over black"); the owner found light "washed out" live on 10-10 (as that session's memory records it) and said
  "I still do not visually see the improvements yet" on 10-12, and both times the tuning went on against the bench. One
  real screenshot of the page over each colour settled it in an afternoon. Rules: (1) an instrument's frame is the canvas LAID
  OVER the page behind it (drawn onto an opaque canvas of the page's colour, never exported bare), and it prints the canvas's
  alpha, on every read it scores, not only on the frames it saves; (2) the app's fact the instrument copies (here the
  page's class) is pinned by a test beside the copy; (3) **when the owner's eye and the instrument disagree a second time, the
  instrument is the suspect: before another round of tuning, compare one real screenshot of the app's own composition with the
  instrument's frame of the same thing;** (4) a pass drawn into a canvas someone else owns sets the alpha's blend on purpose
  (`blendFuncSeparate`), never by the colour's factors; (5) compare two arms at the same run position (a theme's first run on a
  fresh map differed from its second in 15 of 90 frames, whichever arm was which). (log 2026-10-12-wind-canvas-alpha)
- **L-V73 · A level measured as "the darkest moment of the thing present" is not the level with the thing absent; and a
  measure that reads two themes differently cannot rank them.** The mirror probe takes each pixel's darkest moment as the ground
  a streak is laid on, and its `lift` is the mean picture over that. Beside the same crop drawn with the colour field ALONE (a
  2 x 2 particle pool), on corrected frames (L-V72) with every open change, 3 to 39 kn: in DARK the darkest moment sits 2 to 4 L*
  UNDER the field over the sea to 18.5 kn (lossless at 15.3 kn: 19% of pixel-instants are 1.5 to 3 L* under it; dark's marks carry
  the legend's colour and take a little from the field beside their core); in LIGHT and BEACH it sits 1 to 12 L* OVER the field
  from 12 kn up (their pixels do not come back to the field between streaks). So the probe's lift over-read dark and under-read
  light and beach at once: over land in light air it said light lifts 0.15 to 0.55 of what dark does where the light actually
  added is 1.1 to 1.2 times dark's, and that reading was the stated reason for a change (D-026). By light added over the field
  alone, light and beach are at or above dark nearly everywhere (0.9 at the least); what differs is that dark's streaks return
  to the field and theirs linger. Rules: (1) a reference level is measured with the thing absent, not inferred from the minimum of the thing present;
  (2) before a number ranks two arms, check it reads both the same way: here, compare the probe's ground with the field alone in
  each theme; (3) a claim about a 1 px line is read on lossless crops at device resolution (the JPEG at 1000 px rings: at
  15.3 kn over land it read dark's dip as 2.0 L* where lossless reads 0.6); (4) when a ratio set a strength or justified a change, the
  bar is re-derived before either is trusted again. (As first written, on clipped frames and one ramp, this lesson gave "3.4 to
  5.5 L* low in dark, true in light" and "light at 1.6 to 1.7 times dark": the direction stood, the numbers did not. Log
  2026-10-12-wind-canvas-alpha, "After the review".)
  - *2026-10-12 22:00Z, a note on the cause given above (log `2026-10-12-wind-trails-linger`):* "dark's marks carry the legend's
    colour and take a little from the field beside their core" is not why dark's pixels sit under the field. With dark's white
    inner ring off it still dips, with its marks laid at light's level it still dips, and with its composite's branch alone
    swapped for the glow branch it stops: the cause is the composite's own veil (L-V76). The measurement above stands (lossless,
    the same crops: -2.2 L* at 15.3 kn over the sea, -0.6 over land); the parenthesis was a guess.

- **L-V74 · When the ground moves, everything laid on it is re-solved; and a line is checked by a shape the eye must find, not
  by its best pixels.** The wind's coastline stroke was solved on 2026-10-09 on light's and beach's pale ground (dark slate at
  0.42 and 0.28). The deep field, the white streak and the land's depth then put a deep ground under it, and each of those
  changes re-solved the streaks and the borders and left the stroke. By its best-covered pixels it still read level with dark's
  (16.9 against 17.1 L\* at zoom 4), and the owner could not see the map: at zoom 4 Florida was drawn in dark and absent in light
  and beach. A pale hairline on a deep ground carries; a dark hairline of the streaks' own width, among white streaks, does not,
  at the same number. **Do:** (1) a change that moves the ground under the wind lists what is drawn ON that ground (the coast
  stroke, the border lines, the names, the streak rows) and re-reads each; (2) read a line where the eye reads it: a land the
  viewer must find at the zoom they use (Florida at zoom 4), on a crop at device resolution, beside dark, before any number is
  believed; (3) when the eye and a number disagree, it is the number that has to explain itself (L-V72).
- **L-V75 · A map is seen THROUGH a layer when its own contrasts survive under it with their sign. "Nearly one ground" was dark's
  map.** D-026 drew light's and beach's land at the sea's depth on the reading that dark's land and sea "carry nearly one ground
  under the wind (L\* 33.5 and 42.5)". Those 9 L\* are what is left of dark's own 18: half of its land-sea contrast, with its
  sign, which is the condition for seeing a film rather than paint (Metelli 1974; Singh and Anderson 2002). Light and beach were
  left with 0.14 and 0.23 of theirs, and their field is a multiply, which passes the map through whole: it was the restyle that
  flattened the map, not the wind. **Do:** (1) before a difference is removed as "nearly nothing", ask what the eye uses it for;
  (2) measure a see-through on a speed ramp, the land against the sea inside one band of speed (`ground-run.js --fixture <ramp>
  --strips 12`): on the hurricane the sea is windier than the land and the field's own difference reads as the map's; (3) a
  theme is compared with dark by what it KEEPS of its own map, not by its level.
- **L-V76 · Before asking why two arms behave differently, read which code path each one RUNS; write the composite out as
  arithmetic; and then let a fit name the path.** For two days this program measured "the gap between light and beach and dark"
  (the probe's lift, D-022's strengths, D-026's land) round a difference nobody had read: `SCREEN_FS` has two branches, and light
  and beach had run the other one since dark's rules (D-020, rule 1). The lead's brief to the session that found it said "all
  three themes use the same trail composite" and listed six candidate causes; none was the cause. Written as one family,
  `screen - g = p (b c - b^2 g) - q b (1 - b) g`, dark is `p = q = 0.505` and the glow branch `q = 0`: the missing term is a black
  veil that dims the ground under every fading tail, and it predicts dark's dip (`op g^2 / 4C`: 2.5 L* over its 15 kn sea) to a
  few tenths of what was measured (2.2). (Note under L-V73: the cause it gave was a guess.) **Do:** (1) for each arm, read the
  uniforms and the branch that DRAW it before designing a measurement (a recording GL that keeps the uniforms at each draw, or
  one value forced on the real engine: `scripts/wind-bench/force-uniforms.js`); (2) write the composite for a fading tail and look
  for a term one arm lacks; (3) fit the law from the screen and the buffer (`truth-run.js --law`): a coefficient names the path
  without anyone's reading of the code, to 0.3 of a level; (4) isolate with ONE value changed, BOTH ways: a cause moves the
  behaviour with it in both directions (dark on the glow branch reads as light; light on dark's branch dips), a modulator (the
  fade, the trail count, the ground) moves its size and never its sign; (5) when a rule was written against a cost on one ground
  ("light only adds", for the pale fields of 2026-10-11), re-read it when the ground changes: D-021 and D-026 made the grounds
  deep, the rule's reason went, and its own cost (the trails linger) had never been measured as motion. And two lanes found this
  within the hour of each other with two instruments and two candidates (a cut and a veil): a finding goes into the shared record
  when it is made, not when its PR is opened. Log `2026-10-12-wind-trails-linger`.
- **L-V77 · A change that is ON by default is checked against every older kill by what the new thing RESTS ON, and the whole test
  tree is run before a review is asked for.** The veil (D-029) was first gated on the kills that share its tables (dark's rules,
  the white streak, D-022's strengths). An independent review found two more it rests on and was not gated on: under the opaque
  canvas's kill (D-027) the canvas's alpha is blended by the colour's factors, so the veil's alpha let light's page through and
  the veil LIGHTENED the trails it exists to dim (+5 to +10 levels, read on a GPU); under the land's depth kill (D-026) the land
  is pale again and the veil's dip is two to three times deeper. The same review found the commit red on four tests in files
  the session had not run (a line-count ratchet and three text pins of lines it had changed), and five mutants of the shader
  alive under tests that pinned its text. **Do:** (1) for a new default, write the list "this rests on ..." (the ground's depth,
  the canvas's opacity, the strengths, the branch) and test it under every kill that takes one of those away, not only the kills
  that share its tables; (2) run the WHOLE frontend tree before the review, not the suites you wrote (a change to one line of a
  shared file can break a ratchet two files away); (3) a shader's test RUNS its arithmetic (its statements turned to JavaScript,
  with a statement added as a positive control) and a GL trace keeps each program's uniforms as they stand AT EACH DRAW, not a
  log of what was sent; (4) a brief to a sub-session carries the owner's standing rules: this one asked for a default-off lever
  and the owner corrected it within the hour ("levers to turn on new updates need to be on by default"). Log
  `2026-10-12-wind-trails-linger`, "The independent review".

- **L-V80 · A fix is read at EVERY zoom the app can show before it is called a fix, and at the far end a land is carried by its
  tone, not by a line.** The coast in the borders' ink (D-028) was measured and filmed at zooms 4, 6, 8 and 10 and merged; the
  app's far end is zoom 2, and the owner looked there first: "I don't see the fix at higher out zooms". At zooms 2 and 3 the inked
  stroke read 1.6 times dark's line by its best pixels and the continents were not there, because a stroke is 0.4 px wide at that
  zoom in every theme: dark's continents are seen by a land 9 L\* under its sea. **Do:** (1) take the zoom list from the app
  (`minZoom`, the zoom it opens at, the closest it is used at), not from the last bench run; (2) at each zoom ask what CARRIES the
  thing being judged (a tone at the far end, a line in the middle, labels and roads close in) and measure that; (3) a number that
  says "stronger than dark's" beside a picture where the thing cannot be found is the wrong number for that zoom (L-V74).

- **L-V81 · A bar is read from the instrument's data, never by its position in a printed row; and a bar that sets a number is
  read by two routes before the number is written.** The land's streak strength (0.75) was picked to match "dark adds +14.8 L\*
  over land". 14.8 was dark's field CHROMA: an `awk` field counted from the end of the runner's line, and dark's line ends in a
  shorter cell than light's and beach's, so every field sat one place off for dark alone. The true bar, from the same run's JSON,
  is +11.8. The number survived only because the build it goes onto (with the tail's veil) happens to read +11.7 there; on dev as
  it stood it was 1.23 times dark's. Caught before any commit, by re-reading the row beside its header. **Do:** (1) take every
  number that will be compared across themes from the runner's `--json`; (2) when a row is printed for the eye, print the name
  with the value (`adds +11.8`), so a shifted column cannot pass for another; (3) a bar that sets a strength is read a second
  way (another script, another run, the header line) before the strength is written anywhere.

- **L-V82 · A switch read in two places on two clocks is two switches for as long as the clocks differ.** The land step's kill
  was read by the map's restyle at the next style event and by the streak's strength on every frame, so setting it in the
  console drew the new land with the old strength (or the reverse) until something touched the style: a picture nobody built,
  and exactly what the owner would see first when A/B-ing the kill. The depth's own kill never had this because its second
  reader read the sync's READ-BACK, not the flag. An independent review found it by flipping the flag with no sync; no test did,
  because every test synced after setting it. **Do:** (1) when a switch has two readers, one of them reads the other's
  record of what it DID, never the flag again; (2) test a kill three ways: set before the first sync, set after it with no
  sync, and set then synced; (3) while a resource a rule depends on is loading (a mask, a texture), say in code which side
  the rule falls to, and pin it: "every mark reads as land" was harmless while land and sea shared a strength and was a brighter
  sea the moment they did not.

- **L-V83 · A gauge that counts by a threshold cannot set a level near that threshold; where it and the eye disagree about what
  is VISIBLE, the level is set by the eye, beside the model, at three zooms, on the visible side.** Near-calm air: by streaks met
  and body share (a mark = a pixel more than 4 dE76 off the field) light's and beach's streaks matched dark's at a light level
  near 0.70 at zoom 6. A few hundredths under that the same gauge fell off a cliff (0.96 of dark's at 0.69, 0.38 at 0.66), at
  zoom 8 the matched level left 0.1 to 0.6 of dark's count, and on films beside dark 0.70 and 0.75 read fainter than dark's
  stipple: dark's near-calm mark is a speck with a core 29 to 37 L\* over a near-black ground, the dimmed white one stands 4 to
  6 L\* over L\* 65. Equal counts of marks at a threshold are not equal marks. And the cliff had a cause the gauge could not
  name: the veil under the trails is measured against a core at the full level, so under a level of about 0.65 it takes as much
  as the mark adds (found by the independent review, in the composite's own arithmetic). This is L-V74 (a line the eye must find) met again
  from the other side. **Do:** (1) when a metric has a threshold in it, sweep the parameter across the cliff and write down
  where the cliff is before picking a value; (2) pick on the far side from the cliff; (3) read the pick at every zoom the app
  shows, not at the zoom the fixture was built for (the ramp fixture reaches zooms 6 to 10 only); (4) say in the decision which
  instrument set the number, and what the other one reads there.
- **L-V84 · An identity check that finds "the same bytes" proves nothing until its positive control has been seen to differ.**
  `map-run.js --offline --crop` read 54 of 54 crops identical between the near-calm build and the build before it, in dark,
  under the kill AND at the default: the default should have differed. The bench had not run the app's basemap sync (no
  `--app-sync`), so the read-back the change rides on was never written and the change never drew, in any arm. The control was
  in the run and was read only because the table was looked at arm by arm. **Do:** every identity run carries an arm that MUST
  differ, and the report states it did; a change that rides a read-back is benched with the sync that writes it.
- **L-V85 · An instrument run while a mutation run holds the sources reads a mutant.** Light's margin read 5.03 over the sea
  by the solver's audit; a minute later the palette checker printed 4.99 and a red line for the same rows. Nothing had changed
  but this: a mutation script was running in the background, had rewritten `windLightPath.js` with one row moved, and the
  checker (which loads the app's own sources) read that row. The file was restored seconds later and the checker agreed with
  the audit again. The wrong number was caught only because two instruments had just agreed and then did not. **Do:** a
  mutation run is exclusive: nothing that reads the sources (a checker, a bench build, a second Jest run, a reviewer) runs
  until it has restored them; and a mutation script copies, mutates, runs and restores in one `try / finally`, so a crash
  cannot leave a mutant behind.
- **L-V86 · A floor held on the table is not held as drawn, and what the rounding takes is each pair's own: solve to targets
  set pair by pair, and read as drawn after every solve.** Light's path held 5.13 on the table over the sea and read 4.93
  through the engine's 8-bit texture. The loss was not one number: over the 281 maxima it ran from 0.06 dE (6-10 kn) to 0.26
  (3-6 kn, pale colours on few texels at a high maximum). A solve that lifted every pair to "5.0 plus 0.15" moved rows that
  needed nothing and still left one pair short. Giving each pair the target "the floor plus what the rounding took from THAT
  pair", reading the candidate as drawn after each solve and raising only the targets of pairs still short, found a field 0.11
  dE00 from the old one at the most. And a cap on the largest move was a help to the search, not a cost: the least-total
  solves with no cap put 0.4 to 0.5 dE00 on one row; capped, the total was lower too. **Do:** name the bar where it is drawn
  (L-V69); budget rounding per pair, not per table; print every bar with every candidate, because under the lowest cap the
  solve reached the floor only by leaving a bar.

- **L-P36 · Before telling the owner how a blocked merge can be released, read the WHOLE protection rule, not the one line
  that blocks.** A promotion to `main` was blocked by a required check that no longer exists. The owner was told twice, and
  the PR body said, that they could either fix the rule or "merge it yourself with your admin override". The rule also had
  `enforce_admins` on: there was no override, for anyone. One API call (`branches/main/protection`) had returned the required
  list and was read for that list only; the same answer held `enforce_admins`, twelve hours before it was looked at. Nothing
  was lost (the owner chose to fix the rule), but an option that does not exist was offered as a way out. And a rule the owner
  "does not see" is a classic branch protection rule being looked for under Rulesets: give the direct address
  (`settings/branch_protection_rules/<id>`, the id from GraphQL `branchProtectionRules`). **Do:** (1) when a merge is blocked,
  read required checks, strict, linear history, admin enforcement and rulesets together, and say which merge METHODS and which
  BYPASSES exist before proposing one; (2) name the setting's exact address; (3) a session never edits branch protection: it
  is the owner's security setting.

- **L-P37 · Before merging a lane's PR, read the lane's own branch against the PR's head; and a close-out ends with a sweep of
  every local branch against its upstream.** #327 was merged ten minutes after the colours lane committed its follow-up to
  the independent review (comments made true, a guard in its solver), and that commit was never pushed. The PR's checks were
  green, on the older head; "the review is answered" was true in the lane's worktree and not on GitHub. The lead read
  `gh pr view` before the merge, and that shows only what GitHub has. Nothing a user sees changed; two comments and a
  README line gave the wrong range on dev for fifteen hours, until a sweep asked for by the owner ("make sure everything is also
  pushed") found one branch `[ahead 1]`. **Do:** (1) before merging a lane's PR, compare `git rev-parse <lane branch>` with
  the PR's `headRefOid`, and read `git status --porcelain` in the lane's worktree (a read, not a write): a difference is a
  question to the lane, not a merge; (2) a lane's hand-back names the SHA it PUSHED, and the lead checks it is the PR's head;
  (3) at the end of a program run `git for-each-ref refs/heads --format='%(refname:short) %(upstream:track)'`: every
  `[ahead N]` on a branch that had a PR is landed or explained, and every branch with no upstream is named as left local on
  purpose.

### 2026-10-15 — Durable intent precedes every external checkout side effect

- The recoverable purchase is not the response URL. Commit identity, frozen provider parameters and any purchaser credit reservation before the SDK; commit the attempt checkpoint before calling it. Response loss and commit-ack loss must reuse one purchase, not create a new request identity. Never store API credentials with frozen parameters.
- A binding can be lost by a later rollback. Commit verified session identity before entering fulfillment that may deliberately roll back into a reconciliation case. Refresh terminal transaction state when an older open snapshot returns; recheck current availability after provider I/O before returning its URL.
- Preserve the existing payment-method contract during a recovery repair. Removing card-only parameters silently adds delayed-payment lifecycle requirements. A guard placed in a similarly named method broke a neighboring deposit route; independent review plus an actual neighboring-route regression found it.
- Unknown outcomes do not justify a fresh idempotency key, new deadline or automatic refund. Respect provider retention and creation-deadline limits; expose explicit owner/operator recovery and keep terminal case evidence. A pending credit reservation is not a photographer time-slot reservation.
- Compare inherited failures with immutable parent source. The same two old rollback expectations failed before/after; record them as a remaining red gate rather than weaken the tests or claim a fully green regression run. Local provider creation proof and real database contention do not certify hosted deployment, full UI or exact runtime parity.
- Isolation includes old test artifacts. The previous local database config failed its disposable-name guard, so this session created and stopped its own new cluster. Shared wind work, frozen candidate refs and current master adoption sequencing were preserved. Evidence: `docs/audits/2026-10-15-orphan-checkout-repair.md`, code46a1d1b8.


### 2026-10-15 — Publication, DEV adoption and rollout are separate facts

- Read the target and current rollout ownership before integration. An older branch can carry valid payment code and a diverged weather-memory ledger; publish the source without merging that history over newer wind work. Adopt confirmed records on the latest DEV and append new actions onto its exact ledger prefix.
- Provider deployment skips suppress this push, not later rollouts. Render supports `[skip render]`; Netlify supports `[skip netlify]` and explicitly deploys deferred changes on the next unskipped commit. Do not place unqualified schema-dependent code in DEV merely because this one push can skip deployment.
- Match a result to its boundary: fresh bounded152 passed, prior actual PG74 passed, inherited wider-suite2 failures remain open. Remote SHA read-back proves branch publication; it does not prove hosted CI, deployed schema, paid frontend acceptance or weather readiness. Evidence: `docs/audits/2026-10-15-orphan-checkout-repair.md`.


### 2026-10-17 — A gauge that reads zero is a defect until the population it counts is shown

- The one-step manifest lane's retention gauge read `0 unique manifest copies standing, 0 deleted` on 318 of 318 lines while Storage held 353 of them. The listing was 100 rows, oldest first, and 2,665 differently named
  legacy files sorted ahead of every copy the lane made. Seven independent reviews and 396 passing tests missed it because every test seeded only the lane's own names. A bounded, sorted listing is only as good as the
  population in the bucket it will meet: seed the production's pre-existing objects (read their names from `storage.objects` before writing the test), and read a zero from a gauge as "this cannot see its subject" until a
  second instrument (here a metadata select) shows the subject is really absent.
- A "first scheduled run" watch must include the storage and cost criteria, not only "no errors": the lane published correctly and quietly filled the bucket. The commitment that named "storage growth bounded" caught it on
  the first read, which is the reason to name the criteria before enabling.
- A logged count can be right and still describe the wrong thing: the gauge's own text said "listing capped at 100: there may be more". When a gauge states its blind spot, that sentence is the first thing to test.


### 2026-10-22 — L-S22 · A parity fixture is only as good as the population it holds: seed masked cells, and compare with what the route SERVES

- #453 shipped eight static world sets on an offline parity of 27.5 M nodes, 0 bad, over a synthetic store with NO masked cells.
  /grid runs `coarse_gulf_fill` on EURO/ICON grids of served span >= 350 deg (every world request) and rewrites masked cells with
  GFS coarse values. Over an all-ocean store that step is a no-op, so the parity could not see it. Live, one world /grid read
  2026-10-22 21:55Z: EURO 2,465 of 4,689 masked cells rewritten, ICON 1,708 of 3,788. Caught on review before any ICON/EURO frame
  was published; guard #461.
- Second trap, same day: the first synthetic land mask also masked the 10-deg GFS donor over whole continents, so no masked 2-deg
  cell had a donor within the fill's bucket reach and the fill still did nothing; my first offline number (1,757 of 2,066) had come
  from an all-valid donor. A fixture must reproduce the PRODUCTION shape of every input a transform reads (here: coarse cells valid
  wherever they hold ocean), not just the input under test.
- Rule: a parity that claims "static == /grid" runs over a store that carries the cells every serve-time step touches (masked
  cells, enclosed seas, estimated tails), compares against the route's full output (resolve_grid, then every post-resolve step in
  routes/weather.py: coarse_gulf_fill, wind_lane), and carries a POSITIVE CONTROL that is seen to fail (`serve_synthetic.py
  --land-mask 1` + `scn_static_parity.mjs` reads ICON/EURO world frames bad > 0; GUARD=1 reads 0). When the live product holds a
  population the fixture lacks, measure one live response's stamp (here `coarse_fill.cells_filled`) before trusting the fixture.


### 2026-10-23 — L-P38 · A shared append-only file with a global sequence serialises every writer: give each writer its own file and one folder

- Every PR appended to ACTIONS.jsonl and moved STATE's anchor, so any two open PRs claimed the same seq; the second to merge
  conflicted and was re-chained by hand, then waited ~25 min for CI again (about 15 merges on 2026-10-22, most re-chained).
  Auto-merge could never run unattended. Re-chaining also looked like tampering to a permission classifier ("stripping
  ledger lines"), because from outside a re-chain and a rewrite are the same diff.
- Fix (D-0XX): per-PR fragments (`ledger.d/<branch-slug>.jsonl`, no seq/prev/at) and one writer of the chain (the lead's
  `fold-pr`), which folds in MERGE ORDER, verifies, content-matches every line and only then deletes the fragments. The guard
  recomputes the fold from dev and requires equality, so a fold is checkable, not trusted.
- Rule: when N writers share an ordered log, separate WRITING (one file each, no shared counter) from ORDERING (one writer, after
  the merge, from an order git already records). A reference to a line that has no number yet needs a name of its own
  (`@frag:<name>:N`), and the folded line keeps that name (`fragment`) so the reference still resolves after the file is gone.


### 2026-10-23 — L-P39 · Git conflicts on ADJACENT lines: give each independent writer its own block, and re-derive a same-block collision

- Once the ledger fragments ended the ACTIONS.jsonl collisions, the next hotspot was `_FLOOR_SET_FROM` in
  `backend/tests/test_ci_floor_staleness.py`: `{"guards": ..., "chain": ..., "estate": ...}` on ONE line, so any two PRs
  that moved floors in DIFFERENT lanes conflicted (#470 estate vs #467 chain, #474 guards vs #467 chain, #475 estate).
- "One key per line" alone does not fix it. Measured in a throwaway repo: two branches that change ADJACENT lines conflict;
  one blank line between them merges clean (`test_rederive_floor.py` pins both, on the real block). The map is now one
  block per lane (its provenance comment line + its key) with a blank line between lanes, and a PR REPLACES its lane's
  provenance line instead of appending history next to the map (appending at the same spot is a conflict of its own).
- A same-lane collision still conflicts, and should: the right answer is neither side. Re-derive it. Take dev's side of
  both files, then `python backend/scripts/rederive_floor.py --lane <lane> --add <N> [--add-files <M>]` (or `--add auto`
  mid-conflict: the PR's own change, read as its HEAD minus its merge base with dev, which also works for a PR still on
  the old one-line map). It works out:
  - base = max(dev's last GREEN hosted read, dev's `_FLOOR_SET_FROM`), because the map can be ahead of the last
    green run when a PR merged after it;
  - set-from = base + N;
  - floor = set-from - the lane's budget (guards/chain 6, estate 2);
  - files = max(hosted, dev's MIN_FILES) + M.

  It writes ci.yml and the map together, and the PR must then read set-from passed.
- Rule: before calling two writers "independent", check what separates their edits in the file. If nothing does
  (same line, or adjacent lines), they are one writer to git.
- ⬆ Correction, 2026-10-24: "`--add auto` ... read as its HEAD minus its merge base" was wrong for any branch whose
  floor the helper had already set. The helper bases its value on dev's map, which can be NEWER than the branch's
  merge base, so the difference also counts other PRs' tests (#513 read +43 for its own +17). `--add auto` now reads
  the branch's own tagged note (`+ N new test(s)`, and `M new file(s)` from 2026-10-24); the difference is only the
  fallback for a branch the helper never ran on. A value derived from a later read is not a delta against the base.


### 2026-10-23 — L-S23 · "Valid" for a masked field is a per-region count from the data, never a sentence
- What happened: #463 and its DECISIONS draft said the 2-deg Gulf fill "has no enclosed-sea job (EURO's global_mid Gulf is
  valid, ICON has no holes)". Nobody had counted. The lead counted on the published frames: EURO masks 870 of 10,168 GFS-sea
  nodes, 44 of 113 in the Mediterranean and 15 of 59 in the Gulf of Mexico. Had the owner flipped the fill off on that sentence,
  real sea would have gone blank. The evidence pack's own diff showed the problem too (2,465 painted cells include sea), but
  it was read as "land painted" because the categories were land vs. not-land, never sea vs. not-sea.
- Root cause of the mask, found by measuring the source: ECMWF's native cell at each such node is land, the height is block-
  meaned but direction and period are point-sampled, and the normalizer drops a node with no direction.
- Rule: before a claim that a masked field is (in)valid somewhere, count it per named region against an independent
  reference mask (here GFS's), and put the table in the claim. An evidence pack categorises against sea AND land, not one.


### 2026-10-23 — L-P40 · A snapshot's cut-off is when it READ, not when it landed

- The audit's fold point was the fold PR's MERGE time. `fold-pr --record-merges` records the merges that exist when it
  reads dev, so a PR that merged between the fold PR's open and its merge (#494 at 21:30Z before fold #495; #498 at
  22:03Z before fold #499) fell older than the fold point unrecorded: the audit FAILed it, every open PR's verify went
  red, and the fix-up fold could race again.
- Fix: the fold point is the fold's own `at`, taken before its fetch (so every older merge was in its base), less 5
  minutes of clock slack, read from the folded lines in ACTIONS.jsonl, not from a squash commit's message, which a
  repo setting can strip. On dev, #498 went from FAIL to WARN.
- Rule: anything that "covers everything up to now" must carry its own "now" (the moment it read its input), and
  everything downstream judges against that moment, never against when the snapshot happened to be merged or deployed.


### 2026-10-23 — L-S24 · Parity is checked against the path the user gets, not the path the test server has

- What happened: #491's regional bundles passed offline parity against /grid_series (598,464 nodes, 0 bad) and failed it
  live (lattice mismatch; 465 of 585 sub-box nodes bad). Live, the resolver answers in-tile z7-9 GFS waves from the dynamic
  lane (Open-Meteo "ncep_gfswave025" resampled to an 11x13 viewport lattice) because Steps 1-2 (the dynamic cache on the
  1-deg snapped key) run before the stored tile. The offline serve_synthetic has no dynamic lane, so it could only ever
  agree. One live session mixed the two products (first frame from the dynamic mini, scrub frames from the bundle).
- Rule: a parity gate names every lane the live route can take for the box and runs against the one users actually get
  (a health-gated live read, or a test server that includes that lane). An offline pass is necessary, never sufficient.
  The owner chose one source (the stored tile, 2026-10-23 18:13 EDT); #500 keeps the client dark until it passes live.

### 2026-10-23 — L-P41 · A change to request or reload behaviour is armed only after every mode arm is measured

- What happened: #501 (pan snap, reuse, supersede, debounce, settle reload guard) was armed on its surf-mode replay alone
  and merged before the swell arm ran. The swell arm showed the "never reload when a covering frame exists" guard
  suppressed the interim-to-fine upgrade (swell GFS z8 /grid 11 -> 19, pages 6 -> 8). Fixed by #505's per-view budget.
- Rule: before arming, measure surf AND swell, for every affected model, to the point the client stops asking; a guard
  that only removes requests can still remove the one that upgrades the picture.

### 2026-10-23 — L-P42 · A conflicting PR runs no CI

- What happened: #476's checks read "1 pass, 3 skipping" for an hour while its session waited for CI; GitHub does not run
  pull_request workflows on a conflicting PR. Two more PRs sat the same way after neighbours merged.
- Rule: a watcher reads `mergeable` before it reads checks; CONFLICTING means merge dev (floor map by lane, append-only
  logs and fragments dev-first, SCOREBOARD rows by time), push, and re-arm.

### 2026-10-23 — L-O6 · A red E2E during a saturated box is the box until shown otherwise

- What happened: E2E on #476's dev push failed 3 and flaked 2 (admin panel, /auth redirect, explore cards). Every failure
  sat in 19:47-19:5xZ, when the live box was at 100% CPU (15 s axios timeouts); the same tests had passed minutes earlier,
  and the next dev run was green (67 passed). E2E mocks weather but its other routes call the LIVE backend.
- Rule: before blaming code for a red E2E, read /api/health and Render CPU at the failure timestamps.

### 2026-10-23 — L-O7 · A live timing read needs an unthrottled window

- What happened: the lead's #491 live read logged a 5.7 s first frame and 1-2 s steps; an idle two-rAF in that window took
  1,725 ms while visible and focused (CPU 15-25%). The timings measured the automation window's throttling, not the app.
- Rule: measure an idle two-rAF first; above about 40 ms the window is throttled, so report request counts only.

### 2026-10-23 — L-O8 · One session can saturate the box when four small multipliers line up

- What happened: from 19:44Z one session with Surf Rating ON, panning ICON/EURO at z7-9, held the 1-CPU box at 100% CPU
  for 20 minutes (health 11-25 s): an unsnapped request box per pan (a new 16-hour surf page, 10-25 s of CPU each), a mini
  per pan, sibling surf prefetch of hidden layers, and a settle tick force-reloading a product that could never sharpen.
  Fixes: #492 (no sibling warm in surf mode), #501 (snap, reuse, supersede, debounce, low priority), #505 (reload budget).
- Rule: every client request that a gesture can repeat is snapped, reused, superseded and bounded; replay the owner's real
  gesture pattern (mode, model, zoom, pan count) to the point the client stops asking, with the box's cost modelled.
