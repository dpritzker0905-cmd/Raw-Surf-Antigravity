# 2026-11-15: does the EURO scalar-height shadow lane support the flip (#663 / D-073)? Pre-registered read (pr-verifier)

Append-only. Asked by the director (local_d6b521eb, 2026-11-15 ~17:55Z): read the `raw_surf:EURO_SCALAR` shadow lane,
armed since 2026-11-01, before #663 (SAMPLER_SCALAR_HEIGHT_MODELS GFS -> GFS,EURO) can merge. All times UTC.

## 1. Pre-registration, written 2026-11-15 18:07Z, BEFORE any row was read

**What I had seen.** D-073's own offline evidence (scalar = the heat map's value in 100% of 14,104 samples; vector > 5%
below in 22%; NDBC 0.25-deg tier MAE 0.169 -> 0.158 m, n=756; 2-deg coastal +0.004 m, n=100) and the D-073 note that EURO
already reads +0.05 to +0.09 m high at +24-72 h. I have read NO scored ledger row: the scored segments live in private
Storage and this machine holds no key, so the read runs only in an Actions job that prints aggregates (the per-buoy
split's pattern), dispatched on the owner's word.

**The question.** On the same buoys, target hours, leads and observations, is EURO's scalar-height answer
(`raw_surf:EURO_SCALAR`) at least as accurate as the vector answer EURO serves today (`raw_surf:EURO`)?

**Data.** The skill ledger's scored rows (`calibration/skill/scored-YYYY-MM*.json`), every row with a finite `err_m`,
target time from 2026-11-02T00:00Z (the first full day with the shadow armed) to the read. Lanes `raw_surf:EURO` (V,
vector) and `raw_surf:EURO_SCALAR` (S, scalar). Pairs: same (buoy, target_time, lead bucket) AND the same verifying
observation (time and height), the per-buoy split's `paired()` rule. Leads +24, +48, +72 h.

**Cells.** Pooled per lead (the decision), and region x lead with the ledger's own `skill_consensus.region_of`
(atlantic_se, gulf, atlantic_ne, pacific_ne, hawaii, other). A region cell is testable with >= 100 pairs on >= 7
distinct target days; else it is reported as UNTESTABLE.

**Metrics.** Per cell: n, MAE(V), MAE(S), bias(V), bias(S) (mean signed `err_m`), dMAE = MAE(S) - MAE(V) (negative = the
scalar is better), and the share of pairs where S is closer. Interval: 95% day-block bootstrap of dMAE, 2000 draws,
seed 20261115, with 1-day and 3-day blocks. The 3-day interval decides (storms span days); the 1-day one is printed.

**Controls, each must hold or the read is VOID (no verdict).**
- C0 identity: V against itself gives dMAE = 0 exactly at every lead.
- C1 null: S and V swapped at random per pair (seed 20261115): the pooled 3-day interval contains 0 at all three leads.
- C2 positive: +0.05 m added to S's absolute error: the pooled 3-day interval lies wholly above 0 at all three leads.
- Coverage: pooled n >= 300 pairs at every lead, from >= 10 distinct buoys.

**Decision rule (D-065's "not significantly worse" bar, the one every served-number flip uses).**
- **SUPPORTS the flip** when no pooled lead is significantly worse (3-day interval lower bound > 0) AND no testable
  region x lead cell is significantly worse after Holm (bootstrap one-sided p = share of draws with dMAE <= 0, Holm across
  all testable region cells at alpha 0.05).
- **AGAINST** when any pooled lead, or any testable region cell after Holm, is significantly worse.
- "Better" is reported separately (pooled 3-day upper bound < 0 at >= 2 leads) and is not required.
- **Bias flag (reported, not a blocker):** the scalar can only raise a height, so if bias(S) exceeds +0.10 m pooled at any
  lead, the verdict carries "watch the high bias" for the post-flip monitor.

**Limits stated before the result.** About two weeks of one late-autumn window. NDBC buoys sit offshore of the surf
zone. The ledger scores whatever EURO tier resolves at each buoy (2-deg world vs 0.25-deg pilot tiles), not split here.
A SUPPORTS verdict says the flip is not measurably worse at buoys; it is not proof that surf-zone heights improve.
