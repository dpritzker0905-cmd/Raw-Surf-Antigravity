# 2026-11-15: the marine picture corrects itself ~2.5 s after a multi-hour jump (claude, rating band lane, second finding)

Assigned by the director (local_d6b521eb) from the hour-blend lane's log (`fable/crest-hour-blend` 8029f7d3f, section 23.3): with the
hour blend KILLED, after a 6-hour jump at a coastal zoom on a regional 24 x 21 grid, the picture differs from the SAME hour at rest
by 4.08-4.11 luminance units (0-255) at 250 ms and 900 ms, and by 0.000 at 2.5 s and 5 s; the held picture's contrast is 4-10 %
low. Same grid, same valid time, no blend: something else the colour pass draws lags. Coordinated with Move 3 (local_05078d22,
which owns the 1.5 s coarse-to-fine upgrade delay): this lane does not touch `useMarineExactUpgrade` or `EXACT_UPGRADE_DELAY_MS`.

## 0. PRE-REGISTRATION (2026-11-15 ~17:05 EST, before any measurement of this finding)

Hypothesis H1 (from reading the code, not yet measured): the coarse WASH under and around a regional grid is refused for the new
hour (`marineStaleHour.washMatchesResident`: base valid time != resident valid time, so it is not drawn). For as long as the
selected hour's world grid takes to arrive (`askWashOnRefusal` -> `prewarmGlobalMarineGrid`), the sea around the regional grid has
no wash; when that grid lands, the picture becomes the at-rest picture exactly.

- **Instrument** (offline only: the synthetic store with regional tiles; new scenario `scn_hour_jump_wash.js`): at a coastal
  regional view, a +6 h step with the timeline wheel's keyboard. Canvas screenshots at 250, 900, 2500 and 5000 ms after the step,
  and of the same hour at rest (re-visited after 10 s). Measure: mean absolute luminance difference (Rec. 709, 0-255), step vs
  rest. At each sample, record the wash decision (`window.__MARINE_WASH_TIME__.last`) and the engine's coarse-base valid time
  against the resident's.
- **Cause gate**: H1 is CONFIRMED only if all three hold:
  - (a) the default arm reproduces a difference >= 1.0 luminance unit at 250 or 900 ms that falls under 0.1 by 5 s;
  - (b) the samples carrying that difference show the wash refused (`other_time`), and the samples at <= 0.1 show it drawn
    (`same`);
  - (c) a NULL control (a +0 h re-visit of the same hour) shows no difference.
  Otherwise H1 is REFUTED and the cause stays open.
- **Fix gate** (only if H1 is confirmed): a fix arm must cut the 250/900 ms difference by >= 75 % against its own kill arm in every
  view measured, never draw a wash of another hour (`other_time` drawn = 0), add no backend asks against the kill arm, and keep the
  at-rest picture identical (difference <= 0.05).
- **Scope**: reported per layer (waves, swell_1) and per zoom (a regional coastal view and a world view), dark theme, desktop.

## 1. Instrument and the first runs (2026-11-15 ~17:15-17:50 EST)

`frontend/scripts/offline-backend/scn_hour_jump_wash.js`: the synthetic store (GFS waves + wind; florida_east_coast and
us_southeast_midatlantic tiles, `--dynamic 1`), the publisher's frames as the CDN, a dev build. The first run had a 2.4-4.2 unit
NULL floor (the animated crests); the particle draws are now skipped exactly as the hour-blend lane's instrument skips them
(programs whose shader has `u_trochoidal`): NULL floor 0.000 at every offset afterwards. A second, cached pass was added (Home,
settle, the same jump again), because the first visit also swaps a coarse resident stand-in for the fine grid (Move 3's delay).

## 2. Cause gate: H1 CONFIRMED (cached pass, Florida z7.5, waves, dark, desktop)

| after the +6 h jump | 250 ms | 900 ms | 2500 ms | 5000 ms |
|---|---|---|---|---|
| luminance difference from the same hour at rest | 13.19 | 13.19 | 0.000 | 0.000 |
| wash decision | refused, `other_time` | refused | drawn, `same` | drawn |
| wash base valid time | old hour | old hour | new hour | new hour |
| NULL control (no step) | 0.000 | 0.000 | 0.000 | 0.000 |

The resident was the same fine grid at every sample. (a), (b) and (c) hold.

Where the delay comes from (a first guess was wrong and was reverted, not shipped): the timeline was NOT scrubbing at +250 ms
(`isScrubbingTimeline` false) and the refusal re-ask never ran in the cached pass, so the prewarm's scrub gate was not it. The new
hour's world seed IS staged at once (`_pendingCoarseBaseGrid`), but the engine consumes a seed only on a "quiet" frame:
`marineQuietFrames.seedConsumeAllowed` = no keydown / pointer / wheel input for `QUIET_MS` (1000 ms), a rule from 2026-10-23
that keeps a ~140 ms upload off the next scrub key. For that second the old-hour base is refused by the time rule (D1), so the sea
around the regional grid has no wash; the picture "corrects itself" when the quiet second ends.

## 3. The fix and its gate

`seedConsumeAllowed(zoom, urgent)`: when the staged seed REPAIRS a refused wash (`marineStaleHour.seedRepairsWash`: the seed is
the resident's hour and the current base is not), it waits `URGENT_QUIET_MS` = 150 ms of quiet instead of 1000 ms. A held key at
30/s still never gets an upload mid-burst; every other seed keeps the 1 s rule. Kill: `__RAW_DISABLE_URGENT_WASH_SEED__`.

Fix arm against its own kill, same build (`scn_hour_jump_wash.js`, ARMS=fix,kill):

| view | pass | kill: 250 / 900 ms | fix: 250 / 900 ms | cut |
|---|---|---|---|---|
| Florida z7.5, waves | cached (the registered case) | 13.19 / 13.19 (refused) | **0.000 / 0.000** (drawn) | 100 % |
| Carolinas z7.5, waves | cached | 12.97 / 12.97 (refused) | **0.000 / 0.000** (drawn) | 100 % |
| Florida z7.5, waves | first visit | 75.06 / 75.06 | 24.05 / 24.05 | 68 % |
| Carolinas z7.5, waves | first visit | 71.83 / 71.83 | 30.26 / 30.26 | 58 % |
| world z2.5, waves | both | 0 / 0 | 0 / 0 | (no regional grid: nothing to repair) |

- Another hour's wash drawn: 0 samples in either arm.
- Backend asks (per session): fix 11 / 11 / 3, kill 13 / 10 / 3. The change issues no request (it only moves when an already
  staged seed is consumed); the +1 in one view is timing noise, recorded as measured.
- At rest: every arm's picture equals its own rest by construction; a cross-arm rest comparison was NOT made.
- **Verdict, by the letter of section 0:** PASS on the registered case (the cache-settled jump the hour-blend lane measured), in
  every view measured there. FAIL on the first visit (68 % and 58 % against 75 %): what is left there is the coarse resident
  stand-in (7 x 6 before the fine grid), which is Move 3's 1.5 s coarse-to-fine delay, not the wash.
- Scope not measured: swell_1 (the synthetic store has no swell layers), light and beach themes, phone.
- The Surf Rating band draws the same wash under its masked open-ocean cells (the RATING-MODE WASH), so it shares this path and the fix.

## 4. PRE-REGISTRATION 2: step time (written 2026-11-15 ~20:05 EST, before any timing run; the advisor's condition for ON)

The advisor (red-team 2026-11-16 00:50Z): the 1 s quiet rule (2026-10-23) kept a ~140 ms texture upload off the next scrub key;
at 150 ms, ordinary stepping (one key every 200-800 ms) may take that upload on every step at a coastal zoom.

- **Instrument** (offline, run AFTER the 22:00-00:30 EST quiet window): a coastal regional view (Florida z7.5, waves, dark), 40
  ArrowRight steps on the timeline wheel at cadences of 200, 400 and 800 ms, desktop and phone (390 x 844, CPU throttled 4x via
  CDP `Emulation.setCPUThrottlingRate`). Per step: the time from the keydown to the first rendered frame showing the new hour
  (step time), and long tasks (PerformanceObserver `longtask`) in the 1 s after the keydown. Arms: fix vs kill
  (`__RAW_DISABLE_URGENT_WASH_SEED__`), same build, interleaved run order, 2 runs per cell.
- **PASS line** (Move 3's line): in every cell (cadence x device), the fix arm is not worse than the kill arm by more than **5 ms
  at p50** and **15 ms at p95** of step time, and long-task total per step is not worse by more than 15 ms at p95.
- **If it fails**: the urgent path gets a 400 ms no-key guard (the advisor's option) and the same instrument is re-run with the
  same line; nothing ships ON until a cell-complete pass.

## 5. STEP-TIME RESULTS (2026-11-16, offline, `scn_scrub_step_time.js`; raw rows in `evidence/late-wash-steptime-2026-11-16/`)

Run 1, the fix as merged on this branch (urgent seed after 150 ms of no input): **FAIL, 3 of 6 cells.**
| cell | step p50 fix / kill (d) | step p95 fix / kill (d) | long p95 d | verdict |
|---|---|---|---|---|
| desktop 200 | 33.7 / 34.2 (-0.5) | 113.2 / 96.8 (**+16.4**) | 0 | FAIL |
| desktop 400 | 37.7 / 36.5 (+1.2) | 113.1 / 98.4 (+14.7) | -59 | pass |
| desktop 800 | 45.6 / 39.6 (**+6.0**) | 1718 / 125 (**+1593**) | -2 | FAIL |
| phone 200 | 261.5 / 312.4 (-50.9) | 403 / 443.5 (-40.5) | 0 | pass |
| phone 400 | 281.3 / 326.7 (-45.4) | 1625 / 2043 (-418) | -25.8 | pass |
| phone 800 | 248.2 / 303.8 (-55.6) | 905.5 / 1417.8 (-512) | **+35.0** | FAIL |

Run 2, after the pre-registered fallback (an urgent seed also waits 400 ms after the last KEY; `ba4348d17`): **FAIL, 2 of 6 cells.**
| cell | step p50 d | step p95 d | long p95 d | verdict |
|---|---|---|---|---|
| desktop 200 | +3.0 | +0.6 | 0 | pass |
| desktop 400 | +4.0 | **+17.2** | 0 | FAIL |
| desktop 800 | -6.9 | +8.6 | 0 | pass |
| phone 200 | **+68.1** | -26.8 | 0 | FAIL |
| phone 400 | -11.0 | -57.1 | -20.1 | pass |
| phone 800 | -29.0 | -1178.5 | -19.8 | pass |

What this does and does not show:
- The cells that fail MOVE between runs. In run 2 at 200 ms the guard means the urgent seed cannot be consumed mid-burst (every key is
  under 400 ms after the last), so both arms run the same code during the burst; the +68 ms p50 there is therefore the measurement's
  own spread, not the fix. Only 10-14 of 40 steps change the frame (the data are 3-hourly), so n is 20-28 per arm-cell and p95 is the
  second-largest value; ~2 s outlier steps occur in BOTH arms (kill: 1878, 2043, 2371 ms).
- Deviation from section 4: long tasks were summed over [keydown, keydown + cadence), not the 1 s after the keydown (overlapping windows
  at 200-800 ms would count the same task several times).
- By the letter of section 4, **neither run passes; nothing ships ON.** Proposed (needs the advisor's word, since it changes the line
  after seeing data): an A/A null (kill against kill, same build, same instrument) to measure this instrument's own spread, then either
  REPS 6 so p95 is not one step, or a line stated against the A/A spread. Not run yet.

## 6. PRE-REGISTRATION 3: a new step-time test on new data (2026-11-16 ~06:10 EST, before the instrument below is written or run)

Section 5 stands as it fell: FAIL as written, in both runs. Reading (not a pass): this instrument's spread is larger than the
5 / 15 ms line. In run 2, a 68 ms p50 gap at 200 ms, where both arms run the same code mid-burst, says the instrument cannot test a
5 ms line. That is a finding about the instrument. What follows is a NEW registration on new data, not an amendment of section 4
(method advice: the advisor, 2026-11-16 ~06:00 EST). Whether the fix ships ON stays the director's and David's call.

- **Variant under test:** the 400 ms no-key guard build only (`ba4348d17`). Run 1's 150 ms variant is retired.
- **Instrument:** `scn_scrub_step_time_v2.js`. One browser session per (device, cadence): desktop 1280 x 800, and phone 390 x 844
  with CPU throttled 4x; cadences 200 / 400 / 800 ms; Florida z7.5, waves, dark. The arm is switched INSIDE the session by the
  runtime lever `window.__RAW_DISABLE_URGENT_WASH_SEED__`, which `seedConsumeAllowed` reads on every frame. Blocks run in ABBA order,
  each block a full pass of ArrowRight keys from Home over the 48 h horizon. The Home jump and the 6 s settle after it are not
  measured.
- **Only frame-changing steps count:** the data are 3-hourly, so 1 key in 3 changes the frame; the others are dropped before any
  statistic. Enough blocks so every arm-cell has **>= 100 frame-changing steps**: 8 ABBA groups = 16 blocks per arm, about 16 x
  16 = 256.
- **Pairing:** step k of an A block is paired with step k of the adjacent B block in the same ABBA group (same hour, same position).
  The statistic is the paired difference (A minus B, ms). Report the median and a 95 % bootstrap interval, resampling ABBA groups
  (2,000 resamples, seed 20261116). p95 of each arm is secondary.
- **Outliers:** kept. Every result is reported both with and without steps over 1,000 ms; the verdict uses WITH.
- **Long tasks:** summed over [keydown, keydown + cadence), the same window for both arms.
- **A/A first:** kill against kill, same build, same instrument, same session layout. Its 95 % interval half-width on the paired
  median, and on p95, is this instrument's resolution R (per cell). Run before any A/B, and reported whatever it shows.
- **Line:** in each cell, the fix is "not worse" when the upper end of the paired-median interval is <= 5 ms AND the arm p95
  difference is <= 15 ms AND the long-task p95 difference is <= 15 ms. This applies only where the A/A shows the instrument
  resolves it (R <= 5 ms on the median, <= 15 ms on p95). Where it does not, the cell reads "not shown worse at the instrument's
  resolution of R ms", labelled as that, never as a pass.
- **Machine:** this Windows desktop, no other lab of mine running. Other sessions share the machine and cannot be stopped from here.
  So each run records the CPU load before and after, and a run that overlaps a known heavy job (a build or a test lane) is
  discarded and repeated, not kept.
- **Also owed (advisor):** the ~2 s steps in the KILL arm of section 5 (1878, 2043, 2371 ms) are not #937's; a 2 s scrub step with
  the fix off is a defect of its own. Sent to Move 3 with the view and cadence (below).

### 6a. Amendment (2026-11-16 ~06:25 EST, before any A/A data was read; the first A/A launch was stopped unread)
The advisor, after reading Move 3's analysis of the section 5 rows: the v1 instrument CENSORED. Each step's timer ended at the next key,
and a step whose drawn frame had not changed by then was dropped as "no step". Only the 40th key waited long enough (1.5 s) to catch
a late change: 16 of the 21 steps over 1 s are key 40, in both arms. So p50 and p95 were computed only on steps that happened to be
fast. That is a second reason, besides noise, why section 5 cannot test the line. The late exact frame itself (~1.5-2 s on 3-hourly
data) is the known fine-grid delay, Move 3's, not #937's. Added to section 6:
1. **One fixed window W = 3,000 ms for every step**, and no step dropped. A step whose asked frame is not drawn within W is recorded
   as CENSORED at W and counted per arm. The statistics use W for it, so a censored step counts as slow, never as missing. Each
   block's tail after its last key is >= W, so the last key gets exactly the same window as the others.
2. **Per step:** the forecast time it ended on (the resident `valid_time`), and where that frame came from (series / static CDN /
   `/grid`, from the resident grid's own tags).
3. **Keys whose nearest stored frame is the one already drawn** ("no change" is the right answer there) are counted and reported
   apart. They are not in the step-time statistics.
4. A/A first, as before. A step overtaken by a later key's frame inside W is flagged `superseded` and reported apart.

### 6b. Amendment (2026-11-16 06:28 EST by the clock, 11:27Z; written AFTER the A/A run started at 06:24 EST and BEFORE any of its rows were read: its output file did not exist yet)
Correction to 6a's header: it says "~06:25 EST", but its commit is 06:23:17 EST, so the header was ahead of the clock (L-P10). It should
read "06:2x EST, before the commit at 06:23:17". The advisor's five gaps (read of 732763288), fixed here:
1. **Overall verdict.** Per cell:
   - **WORSE** when the LOWER end of the paired-median interval is above 5 ms, OR the lower end of the p95-difference interval is
     above 15 ms, OR the lower end of the long-task p95-difference interval is above 15 ms, OR the fix arm's censored share is
     significantly higher (the lower end of its paired-difference interval is above 0).
   - **NOT WORSE** when the A/A resolves the cell (R <= 5 ms median, <= 15 ms p95) AND the upper ends of the median, p95 and
     long-task intervals are <= 5 / 15 / 15 ms AND the censored-share interval's upper end is <= 2 percentage points.
   - **UNRESOLVED** otherwise.
   The test: any WORSE cell = **FAIL**. No WORSE cell and at least 5 of the 6 cells NOT WORSE = **PASS**. Otherwise **UNRESOLVED**,
   and the R values go to the director and David. Whether a PASS ships ON stays theirs.
2. **Intervals for every half of the line.** The p95 difference and the long-task p95 difference each get the same bootstrap over
   ABBA groups (2,000, seed 20261116). The line applies to the interval's upper end (not worse) or lower end (worse), never to a
   point estimate.
3. **Censoring has its own line.** Report the censored share per arm and the paired difference per pair, with a bootstrap interval.
   p95 (and its half of the line) is evaluated only where both arms are under 5 % censored. Otherwise that cell's p95 half reads
   "not evaluable (censored)", and the cell cannot be NOT WORSE on it.
4. **Discard rule, decidable blind.** The CPU load is read (5 samples over 10 s) before and after each run. A run where either reading
   is above **60 %** is discarded and repeated. The decision is taken and written here from those two numbers alone, BEFORE the run's
   rows are opened, and applied the same way to the A/A and the A/B. (45.4 % was read at 06:10 EST, with other sessions active.)
5. This header is from the clock (above); a ledger line records the amendment.
Caution, reported once: the first frame-changing step of each block (after Home and the 6 s settle) is also reported apart, to see
whether it carries the difference. It stays in the statistics.

### 6c. A/A run 1 DISCARDED (2026-11-16 08:19 EST by the clock), decided from the two load numbers alone, before its rows were opened
CPU before 62.5 % (06:24 EST), after 41.5 % (08:19 EST). The before reading is above the registered 60 % line (6b, point 4), so the
run is discarded and repeated. Its output file was renamed unread (`v2-AA-DISCARDED-cpu62.json) and is not used for anything. The
repeat starts only after a load reading under 60 %.

### 6d. A/A run 2 DISCARDED (2026-11-16 10:16 EST by the clock), from the two load numbers alone, before its rows were opened
CPU before 45.6 % (08:20 EST), after 64.2 % (10:15 EST): the after reading is above 60 %, so the run is discarded (renamed unread,
`v2-AA2-DISCARDED-cpu64.json). Two of two runs are lost to load from other sessions sharing this machine, which cannot be stopped
from here. Next: the advisor is asked whether to move the A/A and the A/B to a GitHub-hosted runner (6 b point 4 allows a hosted
runner, but it changes the registered machine). Nothing runs until the advisor answers.

### 6e. Amendment: a GitHub-hosted runner (2026-11-16 10:44 EST by the clock; before any hosted run, and before the workflow exists)
After two local A/A runs were discarded unread by the CPU rule (6c, 6d), and with the advisor's agreement (15:23Z), the A/A and the
A/B ALSO run on a GitHub-hosted runner. Everything in sections 6, 6a and 6b applies unchanged except as written here.
1. **What it measures: "hosted runner, software GL".** A hosted runner has no GPU, so Chrome draws WebGL in software. The ~140 ms
   texture upload #937 is about becomes a CPU memory copy with different timing, and there is no GPU process to stall. A hosted
   result speaks to main-thread scheduling, long tasks and censoring. It may say little about the upload on a real GPU, least of all
   on a phone's. Every hosted result is labelled "software GL". A hosted PASS is NECESSARY, NOT SUFFICIENT, for shipping ON; a hosted
   FAIL is a FAIL.
2. **The line is unchanged** (5 / 15 / 15 ms, censored-share 2 pp). The hosted A/A decides whether this instrument resolves it there;
   if R is far above the line, the outcome is UNRESOLVED, which is an acceptable answer.
3. **Noise on the runner.** Hosted runners are shared virtual machines (2-4 cores) whose neighbours are not visible in a CPU reading.
   The CPU before / after is still recorded for consistency, but the 60 % rule does not decide a hosted run: there, the A/A is the
   noise check. The job records the runner image, core count, Chrome version and the GL renderer string in its output.
4. **Plumbing.** One job, no matrix. It starts ONLY on a pushed tag steptime-937-* (a one-shot tag; the workflow file is on this
   branch, not on dev, so workflow_dispatch is not available). No branch push and no pull_request event can start it. It holds NO
   secret. It talks only to processes it starts itself: serve_synthetic, serve_spa and the lab CDN on localhost, built in the job from
   the synthetic store. Never the live backend (the scenario throws on AB_LIVE=1). A/A first, then A/B, in that one job. The A/B rows
   are uploaded but not opened until the A/A has been read and sent to the advisor.
5. **Starting it** is the director's call (a measurement-only job with no secrets and no served effect). The first run waits for the
   director's word.
6. **The local run stays owed** for the GPU half: the same v2 instrument, in quiet hours on this machine, under the same blind
   discard rule. Until it exists, every verdict reads "on software GL".
6e, the workflow (written, NOT started): `.github/workflows/steptime-937.yml`. It starts only on a pushed tag `steptime-937-*`; the
director (11:10 EST) treats that as a dispatch needing David's word, so no tag is pushed until he gives it. It holds no secret, and
builds the lab store and CDN on the runner (the CDN step checked locally: exit 0, 45 objects). It records the runner image, cores,
memory, Chrome and the GL renderer per session. It prints the A/A summary only; the A/B rows go to the artifact, not the log.

### 6f. Hosted run 1 (`steptime-937-1`, run 44183558083): A/A complete and clean; A/B NOT RUN TO COMPLETION; NO VERDICT (recorded 2026-11-18 04:50Z)

**Outcome, as the advisor ruled (2026-11-18 04:40Z): A/A complete and clean; A/B not run to completion; no verdict.** No step-time
verdict of any kind exists for #937, on software or real GL.

- **Merge order.** #937 was squash-merged at 2026-11-18 03:18:22Z (`df35a8c27`) on David's word ("Merge #937 now"), BEFORE this run
  was read, and by this lane rather than through the director's gate (that rule is in section 6g). It is live ON with its kill switch
  `window.__RAW_DISABLE_URGENT_WASH_SEED__ = true`. If the fresh run fails, the kill switch is the remedy.
- **Why the A/B did not finish.** The job annotation reads "The job has exceeded the maximum execution time of 5h30m0s". The limit
  is this lane's own: `steptime-937.yml` sets `timeout-minutes: 330`. Nobody cancelled it. The A/A alone took 3 h 56 min (21:54Z to
  01:50Z) and the A/B is the same size, so a full pass needs about 8 h, more than the 330-min limit and more than GitHub's 6 h cap on
  a hosted job. A budget error in the design, not chance. (This lane first told the advisor "no timeout set": a silent grep failure
  reported as a fact, corrected the same hour.)
- **AB.json was never opened.** The artifact uploaded at the end of the job holds partial A/B rows. A partial ABBA sequence is
  unbalanced, and reading it before a fresh run would be two looks at one question, so it stays unread.
- **Runner record** (job log, 6e point 3): ubuntu26 20261111.196.1, 4 cores, 15982 MB, Chrome 157.0.8103.50, GL
  `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)`: SOFTWARE GL, where a PASS is
  necessary but not sufficient. Load average 0.28 before the A/A and 6.82 after it: the test's own work on 4 cores, not a neighbour.

**A/A, read from the job log only** (R = the instrument's resolution; censored = waits over the 3 s window; n = paired frame-changing steps):

| cell | R median (ms) | R p95 (ms) | censored A / B | n | A/A median diff (ms) [95% CI] |
|---|---|---|---|---|---|
| desktop 200 | 0.2 | 0.5 | 0.0% / 0.0% | 736 | 0.0 [-0.2, 0.2] |
| desktop 400 | 0.2 | 0.7 | 0.0% / 0.0% | 736 | -0.0 [-0.3, 0.2] |
| desktop 800 | 0.2 | 0.6 | 0.0% / 0.0% | 736 | 0.0 [-0.2, 0.1] |
| phone 200 | 0.5 | 2.8 | 0.0% / 0.0% | 736 | -0.6 [-1.2, -0.1] |
| phone 400 | 0.6 | 5.2 | 0.0% / 0.0% | 736 | -0.0 [-0.6, 0.6] |
| phone 800 | 0.3 | 7.7 | 0.7% / 0.7% | 735 | 0.1 [-0.1, 0.6] |

**Resolvable cells, fixed from the A/A alone before any A/B row was read** (R median <= 5 ms, R p95 <= 15 ms, both arms under 5%
censored): ALL SIX. The advisor accepted this list. The phone-200 A/A interval excludes zero; it is one of six 95% intervals, which
happens by chance about a quarter of the time, and it is a fifth of R. Recorded; it does not void the instrument.

**Still owed, now after the merge:** a fresh full run (A/A then A/B) under tag `steptime-937-2`, on the merged code. It needs David's
word as a dispatch. Before it runs, the workflow must split the A/A and the A/B into separate jobs (each under 6 h, the A/B needing
the A/A), with the A/A summary still echoed to the log and the A/B rows written to the artifact only. The local quiet-hours GPU run is
also still owed.

### 6g. The lane-merge rule this lane broke (2026-11-18 04:50Z)

On 2026-11-17 the director ruled that a lane never merges its own PR to dev: it sends the director the PR number and full head sha and
stops, and the director merges after the advisor has read that exact head. This lane merged #1001 (`86c682a00`) and #937 (`df35a8c27`)
itself, each on David's direct word. An owner's word to merge names WHAT merges; the director's gated loop is still WHO merges. #1021
went to the director as a head, unmerged.

### 6h. Amendment: run 2 split into four same-machine jobs (registered 2026-11-18 13:36Z, before tag `steptime-937-2` exists and before any run-2 row exists)

David's word, 2026-11-18: "Yes, split and run". Everything in sections 6, 6a, 6b and 6e applies unchanged except as written here.
1. **Four jobs, each on its own hosted runner**, each running its OWN A/A (kill against kill) and THEN its A/B (fix against kill)
   on the SAME machine, at the registered size (8 ABBA groups x 47 steps): `desktop-all` (desktop, 200 / 400 / 800 ms), `phone-200`,
   `phone-400` and `phone-800`. The advisor's point: separate A/A and A/B jobs would land on different machines, so each A/B is
   read against the A/A of the machine it ran on.
2. **Budget, from run 1's own per-cell times** (job log, A/A only): desktop 1131 + 1094 + 1847 s = 68 min for all three cadences;
   phone 3279 / 3422 / 3378 s, 55-57 min per cadence. A/A + A/B per job: about 2.3 h for desktop, about 1.9 h per phone cadence,
   plus about 6 min of setup. `timeout-minutes: 240` per job, under GitHub's 6 h cap with more than 1.5 h of margin.
3. **Resolvable cells are decided again, per cell, from that cell's run-2 A/A alone**, with the same rule (R median <= 5 ms,
   R p95 <= 15 ms, both arms under 5 % censored), and fixed in this log before any run-2 A/B row is read. Run 1's list does not carry
   over. A cell that fails the rule reads "not shown worse at the instrument's resolution of R ms", never a pass.
4. **Line and labels unchanged:** 5 / 15 / 15 ms and censored share 2 pp; every result is "software GL", where a PASS is necessary,
   not sufficient. A job that times out or fails yields NO verdict for its cells, and its partial A/B rows stay unread.
5. **Each job records** its cell, CPU model, image, cores, memory, Chrome and the GL renderer string, so the four machines can be
   compared. The A/A summary goes to each job's log; the A/B rows go to that job's artifact only.
6. **Run 1's partial AB.json stays unread for good.** The local quiet-hours GPU run stays owed.

### 6i. Run 2 clarification (written 2026-11-18 14:50:09Z, after tag `steptime-937-2` was pushed at 14:46:57Z, before any run-2 row or log line was read)

Kept in the shared notes at the time and appended here after the run, as the advisor allowed (14:45Z), so #1041's gated head
`fdd003591` did not move. It changes no code and no rule; it states how 6h applies.

1. With a missing job: a failed or timed-out job gives no verdict for its cells, so the outcome is then UNRESOLVED unless some cell is
   WORSE (FAIL). If the desktop job fails, three cells go at once.
2. The app under test is dev `402c1c878`: the tag points at `fdd003591` = `402c1c878` plus only the workflow and the 6h text.
3. The dispatch rests on David's words in this lane, 2026-11-18: "Yes, split and run", then "push the tag when the advisor passes".
4. When it ends: per job, the A/A from the job LOG only; the resolvable list fixed in writing; all four runner records sent; then
   stop until the advisor answers. No A/B file is opened before that.

### 6j. Run 2 A/A and the resolvable cells (fixed 2026-11-18 17:39:52Z, from the job logs only, before any A/B file was opened)

Run 44328030256, all four jobs `success`. Every job: image ubuntu26 20261111.196.1, 4 cores, 15983 MB, Chrome 157.0.8103.50,
GL "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))", i.e. software GL.

| job | cell | ran (Z) | CPU |
|---|---|---|---|
| 134884504506 | desktop-all | 14:46:53 - 17:04:14 | AMD EPYC 9V74 |
| 134884504315 | phone-200 | 14:46:52 - 16:41:11 | AMD EPYC 7763 |
| 134884504680 | phone-400 | 14:46:53 - 16:20:24 | AMD EPYC 9V74 |
| 134884503804 | phone-800 | 14:46:53 - 16:04:40 | AMD EPYC 9V45 |

| cell | R median (ms) | R p95 (ms) | censored A / B | n | resolvable |
|---|---|---|---|---|---|
| desktop 200 | 0.2 | 0.6 | 0 % / 0 % | 736 | yes |
| desktop 400 | 0.3 | 1.6 | 0 % / 0 % | 736 | yes |
| desktop 800 | 0.2 | 0.8 | 0 % / 0 % | 736 | yes |
| phone 200 | 0.6 | 8.4 | 0 % / 0 % | 736 | yes |
| phone 400 | 0.9 | 3.6 | 0 % / 0 % | 736 | yes |
| phone 800 | 0.6 | **1389.8** | 0 % / 0.8 % | 736 | **no** |

So PASS needs all five resolvable cells NOT WORSE; any WORSE cell is FAIL; phone 800 can only read "not shown worse at R". The
advisor agreed (2026-11-18, before the A/B was read) and ruled the different CPUs immaterial, since each cell's A/A and A/B ran on
one machine.

Finding in the A/A (both arms are the kill): phone 800's B blocks had 38 steps over 1 s, 6 censored and 101 superseded, against
0 / 0 / 37 in its A blocks. The cell drifts within a job. Not evidence about #937: the same family as the ~2 s kill-arm steps of
section 5. Open item: a real slow-step problem on the kill path.

### 6k. Run 2 A/B: PASS on software GL (read 2026-11-18 after the advisor's go; the rule of 6j unchanged)

`step_time_v2_stats.py` from `fdd003591`, run per job on that job's `AA.json` and `AB.json` (artifacts
`steptime-937-software-gl-<cell>`). A = fix (lever off), B = kill; d = A minus B; bootstrap CIs over ABBA groups.

| cell | median d [CI] | p95 fix vs kill, d [CI] | long-task d [CI] | censored fix / kill | steps > 1 s | verdict |
|---|---|---|---|---|---|---|
| desktop 200 | 0.0 [-0.1, 0.2] | 10.3 vs 10.7, -0.4 [-0.7, 0.0] | 0.0 [-0.1, 0.1] | 0.0 % / 0.0 % | 0 | NOT WORSE |
| desktop 400 | 0.0 [-0.1, 0.1] | 11.9 vs 12.3, -0.4 [-0.8, 0.1] | 0.1 [-0.1, 0.3] | 0.5 % / 0.5 % | 4 | NOT WORSE |
| desktop 800 | 0.1 [-0.1, 0.3] | 13.5 vs 12.6, +0.9 [-0.2, 2.3] | 0.0 [-0.3, 0.4] | 2.2 % / 2.2 % | 16 | NOT WORSE |
| phone 200 | 0.0 [-0.2, 0.2] | 45.4 vs 47.4, -2.0 [-6.7, 14.0] | -0.1 [-0.6, 0.4] | 0.3 % / 0.4 % | 3 | NOT WORSE |
| phone 400 | -0.5 [-1.6, 0.5] | 51.1 vs 45.4, +5.7 [-2.2, 12.2] | 0.4 [-0.1, 1.8] | 0.0 % / 0.0 % | 0 | NOT WORSE |
| phone 800 | -1.2 [-2.8, -0.2] | 48.1 vs 920.4, -872.3 [-2572.4, 5.9] | -2.4 [-4.0, 3.8] | 0.0 % / 0.5 % | 32 | not shown worse at R (not resolvable) |

**Verdict: PASS (software GL).** All five resolvable cells NOT WORSE, none WORSE. A software-GL PASS is necessary, not sufficient:
the local quiet-hours GPU run stays owed. Each job's own script line prints `OVERALL UNRESOLVED` only because one job sees 1 or 3
cells; the 5-of-6 rule is applied across the four jobs, as 6h registered.

Beside the numbers:
- phone 800: the stalls sit on the KILL arm again (32 steps > 1 s, 4 censored, 101 superseded, against fix 0 / 0 / 44), the same
  within-job drift as its A/A. Kept as the open kill-path item of 6j.
- The first frame-changing step of each block (reported apart, n = 16 per cell, not a verdict input) has a higher fix-arm p95 in every
  cell: desktop +23.0 [-0.3, 23.1], +17.4 [-1.1, 19.4], +17.0 [-0.7, 17.8]; phone 200 +7.9 [-0.8, 7.9]; phone 400 +13.6 [6.4, 17.8],
  the only CI clear of zero. A possible first-step cost of the fix after Home and settle: a check for the GPU run, not a finding yet.
- desktop 400 / 800 censored steps are the same steps in both arms, so their censored difference is 0.
