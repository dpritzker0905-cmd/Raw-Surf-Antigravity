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
