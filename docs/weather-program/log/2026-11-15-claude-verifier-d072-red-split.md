# 2026-11-15: D-072, the accuracy monitor's RED split into three rules; pre-registered replay (pr-verifier)

Append-only. D-072 was approved by the owner on 2026-11-15 at 16:14 EST ("Yes to all"). This is brief 2 of the senior
research lead's plan (#929), assigned to this session by the director. All times UTC.

## 1. Pre-registration, written 2026-11-15 ~21:55Z, BEFORE any scored row was read

**What I had seen.** D-072's text and its estimates from logged aggregates:
- rule-1 basis max +0.057 / +0.046 / +0.041 m;
- rule-2 basis max about +0.25 m;
- the hole-key gap since 11-01 at +0.291 / +0.340 / +0.354 m;
- our hole-key MAE going from 0.24 to 0.58 m.

I have read no scored row. The scored segments are in private Storage and this machine holds no key. The replay runs
only in a dispatch-only Actions job that prints aggregates, the per-buoy split's pattern, dispatched on the owner's word.

**Instrument.** The pure rules are in `services/weather_pipeline/accuracy_red_split.py`. The replay and audit are in
`scripts/accuracy_red_split_replay.py`.

**Pairing.** Exactly `forecast_skill.head_to_head`: the same buoy, target time and lead bucket (+24 / +48 / +72 h), AND the
same verifying observation (time and height). Rows need a finite `err_m`.

**Rules.** Each fires at a lead when the paired table is gradeable, delta = MAE(ours) - MAE(theirs) exceeds the rule's
bound, and the win rate is under 50%. These are the monitor's `_gradeable` floor and `_loses` test.

| Rule | Ours against | Keys | n floor |
|---|---|---|---|
| 1, same-model regression | `open_meteo:ncep_gfswave025` | the keys it scores | 200 |
| 2, hole buoys | `open_meteo_marine` (best_match) | best_match keys with NO same-model row | 30 |
| 3, best_match where both score | `open_meteo_marine` | best_match keys the same-model control also scores | 200 |

**Replay.** One simulated monitor run per day at 00:00Z, from 2026-08-15 to 2026-11-14. Each run uses the monitor's
trailing paired window: targets with 0 <= run - target <= 7 days.

**Bounds, set blind to November.** Each rule gets one bound across all leads: 1.24 x the worst gradeable delta over the
basis days 2026-08-15 .. 10-31, floored at +0.03 m and rounded up to the centimetre. That is D-072's "~1.24x the worst
recorded" method. The script computes the bounds from the basis days alone, before it grades any later day.

**The four checks (brief 2). All must hold for PASS.**
- **P1 negative, our chain did not regress.** Rule 1 fires on NONE of the episode days, 2026-11-10 .. 11-14.
- **P2 positive.** With +0.08 m added to our absolute error on every rule-1 key, rule 1 fires on >= 80% of the days
  2026-11-01 .. 11-14. Those days are outside the basis, so the bound is not fitted on the seeded data.
- **P3.** Rule 2 fires on >= 3 of the 5 episode days.
- **P4 null.** None of the three rules fires on any replay day under a per-key label swap: ours and the reference trade
  places at random, with the swap RE-DRAWN for every replay day (seed 20261115 plus the day). The brief calls this the
  "lead-shuffled null"; I asked the senior lead which construction is meant. A lead permutation keeps the real gap and
  so cannot be a null, which is why the swap is registered. A fixed swap set is what voided my EURO read
  (`2026-11-15-claude-verifier-euro-scalar-read.md` section 2), so it is re-drawn here.
- **VOID** if no basis day is gradeable for any rule.

**Hole-buoy audit (Reflection's step, reported, not part of PASS).** For each data-derived hole buoy (best_match rows
with no same-model row), before (08-15 .. 10-31) against November (11-01 .. 11-14):
- n, our MAE and best_match's MAE;
- observations <= 0.05 m and > 15 m;
- "frozen" predictions: the same served height on consecutive targets at the same lead;
- duplicate keys.

A data or build defect would show as a jump in obs anomalies, frozen predictions or duplicates at the November
change, rather than as a rise in both our error and best_match's.

**Limits stated before the result.**
- The replay recomputes the rules from rows. It is not a re-read of the monitor's logs, so its bounds can differ from
  D-072's aggregate estimates.
- One autumn: the basis is summer and early autumn, and the episode is the first winter swell.
- Rule 2 is empirical. The audit can show a defect but cannot prove the nearest-ocean fallback causes the gap.

### 1a. Amendment, written 2026-11-15 ~22:15Z, still BEFORE any scored row was read

The senior research lead (local_ae420832) answered the null question at 22:06Z:
- pre-register (b), the per-key label swap re-drawn every replay day;
- (a), the lead permutation, keeps the real gap, so it is a non-gating diagnostic;
- run >= 200 independent re-draws, record each rule's false-fire rate, and fail the gate when any rule fires on more
  than 5% of the draws.

**P4 now reads:**
- **200 independent null draws**, seed 20261115. Each draw re-signs every paired value on every replay day afresh: a
  numpy sign matrix per day and per (rule, lead) cell, one row per draw. The paired values are computed once.
- A draw "fires" a rule when the rule fires at any lead on any replay day, under the same bounds, n floors and
  win-rate test.
- The **false-fire rate** of a rule is the share of draws that fire it.
- **P4 holds when every rule's rate is <= 5%.**

This replaces section 1's "fires on no day under one re-drawn swap". Nothing else in section 1 changes.

**Diagnostic, reported and not gating:** one lead permutation (seed 20261115). Within each (buoy, target), the lead
labels are permuted jointly across all three lanes, and the replay prints the days each rule fires. Rule 2 is expected
to keep firing there, because the hole gap does not depend on lead.

**A sensitivity stated now:** a rule whose bound sits inside its own null noise fails P4. The noise is roughly sd/sqrt(n)
of the paired differences, and the case is a bound at the +0.03 m floor over a large real gap.
`tests/test_accuracy_red_split.py::test_the_swap_null_fails_a_rule_whose_bound_sits_inside_its_noise` pins that the gate
catches it.

**1a, refined 2026-11-15 ~22:25Z (still before any row was read), on the senior lead's check.** "Fires at any lead on
any day" across the whole replay is family-wise over ~270 chances per draw. A rule that pages falsely on 0.1% of days
would fail it in ~24% of draws, yet be operationally fine. The monitor pages at most once a day, so the gate reads the
operational rate:
- A null draw **pages a rule on a replay day** when the rule fires at any lead that day.
- **false pages per 30 days** = mean over the 200 draws of (paging days / replay days) x 30.
- **P4 holds when every rule's rate is <= 1.0 per 30 days.**
- The family-wise share (draws with >= 1 false page anywhere in the history) is printed as a diagnostic, not gating.

**Correction, 2026-11-15 23:20Z.** Section 1's header says "written 2026-11-15 ~21:55Z". That is an estimate, not a
clock reading: section 1 was committed at 21:51:26Z (`ffe6ec99e`), before any code or row, so the true time is no later
than 21:51:26Z. Nothing else in section 1 changes.
