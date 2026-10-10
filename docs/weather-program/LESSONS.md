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
