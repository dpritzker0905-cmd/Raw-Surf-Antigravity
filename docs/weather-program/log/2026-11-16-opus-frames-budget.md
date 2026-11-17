# 2026-11-16 — opus: the pilots frames budget (77-143 sets skipped a run), measured, and a pre-registered fix

Session: the frame-carry side session, asked by the director (2026-11-16 18:20 EST): measure first, propose the smallest fix,
pre-register a gate of skips at or near 0 in 3 of 4 runs, and send it to the advisor before building. Written 23:33Z, before any code.

## Measured (pilots 43803432374, 43863453856, 43950205417; per-set `frame_sets` reports from the jobs-API logs)

**There are TWO budgets, not one.**
- **The frames step** (`publish_frame_images.py`, FRAME_PUBLISH_BUDGET_S 960 s, step timeout 22 min) spends 874-937 s a run:

| kind | sets | seconds a run |
|---|---|---|
| world | 11 | 331-466 |
| filled | 7 | 241-288 (after #922) |
| regional bundles | 43-118 built | 146-272 |
| wind | 1 | 29-38 |

  It skips 14, 89 and 38 regional sets.
- **The rated step** (`--only rated`, the Surf Rating band sets, FRAME_PUBLISH_BUDGET_S 600 s, step timeout 14 min) spends
  589-597 s and builds only 21-30 of its 84 sets a run (median 13.6-15.5 s a set, max 47-105 s). It skips 54-63 every run. So a
  rated set is refreshed about every third pilots run, about once a day. #975 (merged) already orders GFS waves first, so the
  band's waves bundles keep current (run 3 built GFS waves first, 387 s); the swell and wind-wave rated sets rotate.
- **Staleness now** (the public latest.json, 2026-11-16 ~23:25Z): plain regional marine sets have a run-age median of 11-17 h, max
  23 h, none over 24 h. The fair-order stagger catches the skipped plain sets up the next run. The rated sets are the stale ones.
- **Headroom:** the pilots job took 165, 171 and 162 min against its 300-minute timeout (05:23-08:08Z, 12:46-15:37Z,
  20:29-23:11Z). The cron is every 8 h, so about 130 min of room.

## Proposed: the smallest fix is a budget raise inside the measured headroom (no code)

- **Frames step:** FRAME_PUBLISH_BUDGET_S 960 -> 1260 s (when FRAME_TAIL_DOWNLOAD is on), step timeout 22 -> 27 min. The skipped
  regional sets cost about 2 s each (14-89 sets: about 30-180 s), so +300 s covers the worst run measured.
- **Rated step:** its budget 600 -> 1500 s, step timeout 14 -> 30 min. 84 sets at the measured ~14 s median is about 1,200 s; 1,500
  s leaves room for the long sets. #975's waves-first order is kept.
- **Cost:** at most about +20 min of job time a run (the 300 s and 900 s raises), about 185-195 min against 300; the next cron is
  8 h away. No Render load (Actions only); storage unchanged (the same sets, just not skipped).
- **Not chosen now:** a separate rated job (more moving parts for the same seconds), ordering by views (it moves staleness, it does
  not remove it), a raster cap (raster steps are separate steps, not in these budgets).

## The gate (pre-registered)

Over the 4 pilots runs after the change is live, in at least 3 of 4:
1. The frames step skips at most 2 sets, and the rated step at most 2.
2. No step times out, and the job finishes under 240 min.
3. Every rated set's run equals its plain sibling's run at the end of the run (no rated set more than one run behind), counted
   from the public latest.json.
4. #975's order holds: the rated GFS waves bundles are built first.

Fail = a timeout, or skips over the line in 2 of 4 runs: revert the variables. Rollback: the two numbers back (repo variable or
revert).

## 23:48Z: addendum before any code: the rated step's own numbers (the rating-band session), and two corrections

The rating-band session (PR #991, its log section 13) read the rated step of run 43950205417 (the first run with #975) by tier:
- **Tier 0**, the 19 GFS regional waves bundles: 19 built, 290 s.
- **Tier 1**, GFS world waves: 96 s.
- **Tier 2**, the other 64 rated sets (swell_1 / swell_2 / wind_waves regional bundles plus the EURO / ICON / GFS world rated
  sets): 5 built in 202 s, 59 skipped. Their per-set cost: regional 8-33 s, world 36-105 s. All 64 would take about 900-1,100 s on
  top of tiers 0-1.
- **Tier 2 on the public index at 23:14Z:** 8 equal to their plain sibling, 34 behind by 6 h, 13 by 12 h, 9 by 18 h. Under #933's
  bound, the 22 sets more than one cycle behind send their rated asks to /grid on the box. **So the rated backlog also loads the
  serve box**, not only staleness.
- In the same run the plain step skipped 14 of the 19 plain GFS regional waves bundles, so in those boxes the rated band was one run
  NEWER than the plain wave layer.

**Corrections to the proposal above:**
1. The rated step's budget is `FRAME_RATING_BUDGET_S` (600 s; its step timeout allows about 780 s), not FRAME_PUBLISH_BUDGET_S.
2. The rated raise must cover tiers 0-2: about 390 s + 900-1,100 s, so about 1,300-1,500 s. The proposal is **FRAME_RATING_BUDGET_S
   600 -> 1,800 s** with the rated step timeout 14 -> 35 min, not 1,500 s. The frames-step proposal (960 -> 1,260 s, timeout 22 ->
   27 min) stands; it also covers the 14 skipped plain GFS waves bundles (about 2 s each).
3. Cost, restated: at most about +25 min of job time a run (+300 s frames, +1,200 s rated), so about 190-200 min against the 300-min
   timeout.
4. The gate gains one line: **5. no rated set more than one cycle behind its plain sibling at the end of the run** (so #933's
   bound sends nothing to /grid on the box).

## 00:26Z: the advisor's read (00:14Z, ACCEPTABLE TO BUILD with five changes), written in before any code

**1. Frames budget re-sized: 960 -> 1,500 s, step timeout 22 -> 32 min.** The advisor's sum holds. Worst cases together: world 466 +
filled 288 + wind 38 = 792 s. Built plus skipped regional is about 132 sets a run, at 2.3-3.4 s each (146 s / 43, 272 s / 118), so
about 450 s. Total about 1,240 s, which left 18 s under 1,260. At 1,500 s the margin is about 260 s (about 76 sets at 3.4 s).
**The timeout tail was also wrong.** The step runs past its budget by the time the budget does not count (setup, tail downloads,
the set in flight when the budget passes). Measured from the jobs API: frames step 1,124 / 1,053 / 1,127 s against 960, so 93-167 s
over. Rated step 648 / 645 / 649 s against 600, so 45-49 s over. My "360 s tail" assumed no overrun; the real margin under 22 min
was 193 s. Worst frames step at 1,500 s is about 1,500 + 167 = 1,667 s. A 32-min timeout (1,920 s) keeps about 250 s, a little
more than today's 193 s, for a world set (about 42 s) ending the run under the fair order. **Rated: FRAME_RATING_BUDGET_S 600 ->
1,800 s, step timeout 14 -> 35 min**, as the addendum said: worst about 1,800 + 49 + a 105 s set = 1,954 s against 2,100 s.
**Job time:** +540 s frames, +1,200 s rated, at most +29 min, so 162-171 -> about 191-200 min against the 300-min timeout.

**2. The gate, restated (final; it replaces both lists above).** In at least 3 of the 4 counted runs:
1. The frames step skips at most 2 sets, and the rated step at most 2. Counted from the step's own log lines AND its frame_sets
   report; the two must agree.
2. No step times out (both steps conclude success), and the job finishes under 240 min.
3. **No rated set BEHIND its plain sibling** at the end of the run, from each set's OWN latest.json entry (`run`). A rated set one
   run NEWER than its plain sibling is not a failure. (This is the "lag 0" wording the advisor restated on #975. It also covers
   the addendum's line 5, now dropped as a weaker duplicate.)
4. **No plain GFS regional waves bundle skipped** by the frames step (the mirror gap: run 43950205417 skipped 14 of 19).
5. #975's order holds: the rated GFS waves bundles are built first (read by hand from the rated step's log).
Fail = a timeout in any counted run, or lines 1, 3 or 4 failed in 2 of the 4: revert the PR. Rollback is the PR's revert (the
numbers live in the file, item 4).

**3. Which runs count (decided now, before any run).**
- The first pilots run after the change is live is a catch-up run: reported, not counted.
- A run in which a format change forces every content-carried set to rebuild is not ordinary. One example is the gusts lane's
  one-byte field, which does that once. Such a run is excluded and named, and counts as neither pass nor fail.
- So is a run whose frames step does not run (the ingest failed upstream, or the run was cancelled).
- The counted runs are the next 4 ordinary runs after those.

**4. Where the four numbers live (checked 00:20Z with `gh variable list`).** All four change by PR, in
`.github/workflows/forecast-ingest-pilots.yml`; no repository variable changes.
- FRAME_PUBLISH_BUDGET_S: a file expression, `vars.FRAME_TAIL_DOWNLOAD == '1' && '960' || '600'`; FRAME_TAIL_DOWNLOAD is '1'.
  The PR changes the literal '960' to '1500'.
- The frames step timeout (22) is a file literal.
- FRAME_RATING_BUDGET_S: `vars.FRAME_RATING_BUDGET_S || '600'`. **The variable is NOT set**, so the file default governs, and
  the PR changes '600' to '1800'. If that variable is ever set, it overrides the file. Setting it is the owner's word, typed by
  David.
- The rated step timeout (14) is a file literal.

**5. The reader is committed with the plan:** `backend/scripts/frames_budget_gate.py --run <id> --base <public URL>`. It reads the
run's step times and job log from the GitHub API and the PUBLIC latest.json; it never calls the box. It prints skips from the log
lines and from the frame_sets report (they must agree), one line per rated set (rated run, plain run, difference in hours), and
PASS/FAIL for lines 1-4. **Null control:** on run 43950205417 (before the change), with the latest.json read at ~23:25Z, it prints:
- frames 38 skips (log and report agree), rated 59 (agree);
- 14 plain GFS waves bundles skipped;
- 56 rated sets behind their plain sibling;
- lines 1, 3 and 4 FAIL, line 2 PASS (162 min).
The advisor checks one of the four counted runs against its job log.

**The tripwire.** The job goes from about 165 to about 190-200 min. Gusts, currents and the 0.5-degree tier are still to come.
If any run passes 240 min, no new set or step is added to the pilots job until this budget plan is redone and re-read by the
advisor.

## 00:41Z: named exclusion, from the #928 gusts/currents lane

The first pilots run after #928 merges is excluded under item 3, if the gust or currents FRAME_RASTER_* variables are on by then
(today they are off). #928 moves gusts and current speed to one-byte band fields 12 and 13, so every frame's content hash changes
and that run rebuilds those sets in full, once. Those sets publish in their own raster steps, not in the frames or rated budgets.
So the exclusion is about gate line 2 (job time). If the variables are still off when #928 merges, that run is ordinary.
