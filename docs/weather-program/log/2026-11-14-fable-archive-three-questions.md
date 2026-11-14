# 2026-11-14 · fable · the scored-archive job: three questions, rules fixed before reading

Session: the Fable repair lead (worktree `fable-repairs-ec7369`). Step 1 of the revised order in
`log/2026-11-13-fable-sota-path-review.md` (#866). Docs only so far: no code, flag, served number or live backend call.

**Approval, as relayed.** The director session (`local_d6b521eb`) relayed the owner's words of 2026-11-13 19:05 EST,
said in that session: "Yes, run it", answering "Run the one-time batch job over the scored archive (step 1 of the #866
plan)?". The owner did not say it in this session; it is recorded here as a relay. Scope: one dispatch-only,
aggregates-only job. Nothing else.

## 00:08Z Rules, written before any result was read

The job is the existing `scored-rows-gate.yml` (on dev since #357; GET only, enforced in code; cells under n = 10
suppressed; no artifact). No new code. I have not read the log of any run of it, nor the addendum of
`log/2026-11-12-claude-consensus-gate-diagnosis.md`, at the time of this commit.

**Q1. Which side of the model mean's offset at +48 and +72 h is wrong?** Table: "Built CONSENSUS shadow vs the computed
equal mean", grouped by "member tiers". "Mixed rows" = every group with n >= 100 in which EURO or ICON is `unknown`.
- CONTROL (must hold, else Q1 = INVALID): at +24 h, group "all", |shadow - equal signed mean| < 0.020 m.
- SHADOW IS THE WORSE SIDE: on mixed rows, shadow MAE - equal MAE >= +0.010 m at BOTH +48 and +72 h.
- LANE MEAN IS THE WORSE SIDE: equal MAE - shadow MAE >= +0.010 m at BOTH leads.
- Otherwise UNDECIDED: the offset is real but costs under 0.010 m either way.
- Also reported, fixed now: group "all" at +48 and +72 h, shadow MAE - equal MAE. If <= +0.005 m at both, the built
  product is no worse than its definition and the 14-day shadow run of step 2 may be proposed on the product as built.
- Limit, stated now: this table has no interval. The verdict is indicative; requiring both leads to agree is the only
  guard. A cell printed `n<10` or under n = 100 does not count.

**Q2. Do per-region skill weights beat the equal mean?** Fixed on 2026-11-05
(`evidence/skill-weighted-consensus-preregistration-2026-11-05.md`): test window 11-06..11-26, scorable from 11-30.
Today's answer is therefore NOT YET, by that rule. No test-window number for the weights is read today. I said in #866
that this job settles it "at once"; that was wrong.

**Q3. The per-buoy split with a count of "no data" answers.** The merged split (`accuracy-per-buoy-split.yml`) does
not print that count and this job has no per-buoy line. Today's answer is NOT ANSWERED. It needs a small code change,
merged on the owner's word, and its own dispatch.

**Never:** the live backend; a row, a per-buoy value or a credential in any output; a second dispatch.

## 00:10Z No dispatch was made; the result was read from an existing public log

- I tried one `gh workflow run scored-rows-gate.yml --ref dev`. This session's permission check refused it: the approval
  was relayed by another session, not given here. I did not retry or route around it. No ledger line: nothing was dispatched.
- The same job already ran on dev on 2026-11-12 07:20Z (run 43174501916, `ecde55374`, success; window 2026-10-03 .. then,
  588,295 rows read, 473,713 graded). Its log is public and holds aggregates only. I read that log (`gh run view --log`)
  after the rules above were pushed (`d98473bf5`). A fresh run would add about two days of rows.
- **Already known, and I had missed it:** `log/2026-11-12-claude-consensus-gate-diagnosis.md` Addenda 3 and 4 read the same
  run two days ago and reached the same conclusion. Step 1 of #866 asked for a read that was largely done. What is new
  here is the rule fixed in advance and the verdict against it.

## Result against the rules (run 43174501916; n = pairs, not independent stations; in sample, no interval)

| lead | member tiers (EURO / ICON) | n | shadow MAE | lane-mean MAE | shadow - lane mean | shadow bias | lane-mean bias |
|---|---|---|---|---|---|---|---|
| +24 h | all (control) | 25749 | 0.243 | 0.231 | signed mean +0.003 | +0.040 | +0.037 |
| +48 h | unknown / global_mid | 9653 | 0.344 | 0.244 | +0.100 | +0.237 | +0.094 |
| +48 h | unknown / unknown | 4103 | 0.432 | 0.230 | +0.202 | +0.308 | -0.024 |
| +48 h | global_mid / global_mid | 10539 | 0.298 | 0.302 | -0.004 | -0.009 | +0.035 |
| +48 h | all | 24377 | 0.339 | 0.267 | +0.072 | +0.143 | +0.049 |
| +72 h | unknown / global_mid | 8701 | 0.350 | 0.248 | +0.102 | +0.231 | +0.087 |
| +72 h | unknown / unknown | 3823 | 0.442 | 0.242 | +0.200 | +0.293 | -0.029 |
| +72 h | global_mid / global_mid | 9956 | 0.301 | 0.306 | -0.005 | -0.020 | +0.024 |
| +72 h | all | 22560 | 0.344 | 0.273 | +0.071 | +0.131 | +0.040 |

- **Control: holds** (+0.003 m at +24 h, under 0.020).
- **Q1: THE BUILT SHADOW IS THE WORSE SIDE.** On every mixed group with n >= 100 it loses by 0.100 to 0.202 m at both
  leads (rule: 0.010). Where both members come from stored frames it matches the lane mean (-0.004, -0.005).
- **The built product is worse than its definition:** +0.072 and +0.071 m on all rows (rule: 0.005). The 14-day shadow
  run of step 2 must NOT be proposed on the product as built.
- The frame and cycle groupings do not separate it: shadow on-frame and snapped read the same (+0.201 / +0.199 at +48 h),
  fresh and stale the same (+0.207 / +0.195). So frame snapping and cycle age are not the cause. Not a pre-registered
  reading; descriptive.
- By coast the shadow is high in pacific_ne and atlantic_se and matches in hawaii (MAE 0.433 vs 0.438). Descriptive.
- **Q2: NOT YET** (scorable from 11-30). **Q3: NOT ANSWERED** (needs code that is not on dev).

## Not established, and the next instrument

- The cause. A fitting hypothesis, not measured: on the mixed rows the point has no stored EURO or ICON cell, so the
  shadow's value there comes from the sampler's fallback to a neighbouring ocean cell, which is the far-water reach
  this lane measured at buoy 46267 (`log/2026-11-13-fable-strait-fallback.md`). The diagnosis log lists it as hypothesis 2.
- The instrument exists since #857 (2026-11-13 04:45Z): scored rows may carry `interp` and `sampled`. Whether the shadow
  lane's rows carry them is unchecked. `construction` has no grouping by them, and +48 h rows written after #857 are not
  scored before 2026-11-15. The next step is a grouping by the shadow's `interp` in `scored_rows_analysis.construction`,
  merged and dispatched on the owner's word, read from 2026-11-16.
