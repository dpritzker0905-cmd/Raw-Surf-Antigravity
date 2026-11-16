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

## 2. Result (run 2026-11-15 19:44Z): VOID by the pre-registered controls. No verdict on the flip.

Instrument: `scripts/euro_scalar_shadow_read.py` at dev `e4005562a` (#925 merged 19:43:13Z), one dispatch of
`euro-scalar-shadow-read.yml` on the owner's word (2026-11-15 13:36 EST: "Yes, run it once"), Actions run 43754098448
(19:44:30-19:46:44Z), `--since 2026-11-02`. The job exits 2 on a VOID, so the run reads "failure".

**Coverage held:** 7,787 / 6,989 / 6,344 pairs at +24/48/72 h, 56 buoys, 12/11/10 target days, 0 observation
mismatches. **C0 held** (identity dMAE 0.0 at every lead). **C2 held** (+0.05 m planted: [+0.046, +0.051],
[+0.034, +0.055], [+0.028, +0.056]). **C1 FAILED at +48 h:** the random-swap null's 3-day interval is [+0.001, +0.002],
clear of 0 (+24 h [-0.001, +0.001] and +72 h [-0.002, +0.001] held). Section 1 says every control must hold or the run is
void. It is void.

**Why C1 failed (a reading after the result, not a tested claim).** The control was badly designed, and that is my error.
Swapping a FIXED random half of the pairs leaves the realised swap share a little off 0.5, so the null statistic is
(1 - 2p) x the true gap, a few thousandths of a metre, and its interval (resampling days, not the swap) is narrow enough to
exclude 0 by 0.001 m. A valid null re-draws the swap inside every bootstrap draw (or uses a sign-flip permutation).

**What the table shows, for the record only (dMAE = MAE(scalar) - MAE(vector), m; 3-day 95% interval).**

| Cell | n | MAE vec / scal | bias vec / scal | dMAE [3-day] |
|---|---|---|---|---|
| pooled +24 h | 7,787 | 0.284 / 0.283 | +0.089 / +0.109 | -0.002 [-0.004, +0.001] |
| pooled +48 h | 6,989 | 0.385 / 0.379 | +0.144 / +0.201 | -0.006 [-0.016, +0.005] |
| pooled +72 h | 6,344 | 0.400 / 0.392 | +0.149 / +0.204 | -0.008 [-0.022, +0.006] |
| hawaii +24/48/72 h | 719 / 649 / 589 | 0.410/0.419, 0.688/0.715, 0.679/0.697 | +0.25..+0.61 -> +0.30..+0.69 | +0.009 [+0.005, +0.014], +0.027 [+0.019, +0.033], +0.018 [+0.004, +0.040] |
| pacific_ne +24/48/72 h | 3,037 / 2,717 / 2,464 | 0.361/0.362, 0.456/0.463, 0.475/0.481 | +0.14..+0.21 -> +0.15..+0.22 | +0.001 [+0.000, +0.004], +0.007 [+0.006, +0.009], +0.006 [+0.005, +0.010] |
| atlantic_ne +24/48/72 h | 1,687 / 1,520 / 1,390 | 0.190/0.194, 0.294/0.269, 0.304/0.279 | -0.04..-0.01 -> -0.01..+0.12 | +0.003 [+0.001, +0.006], -0.025 [-0.049, +0.014], -0.026 [-0.067, +0.006] |
| atlantic_se +24/48/72 h | 1,739 / 1,564 / 1,422 | 0.174/0.177, 0.227/0.218, 0.243/0.233 | +0.06..+0.11 -> +0.11..+0.12 | +0.003 [+0.002, +0.005], -0.008 [-0.023, +0.009], -0.011 [-0.022, +0.006] |
| gulf +24/48/72 h | 176 / 151 / 126 | 0.109/0.104, 0.111/0.097, 0.136/0.129 | -0.08..-0.01 -> -0.08..+0.02 | -0.006 [-0.010, -0.001], -0.014 [-0.027, -0.003], -0.008 [-0.015, -0.002] |
| other +24/48/72 h | 429 / 388 / 353 | 0.424/0.345, 0.484/0.412, 0.503/0.438 | -0.06..+0.05 -> +0.04..+0.13 | -0.080 [-0.116, -0.052], -0.072 [-0.106, -0.050], -0.065 [-0.092, -0.052] |

- Had the run been valid: no pooled lead is significantly worse (the pooled scalar is 0.002-0.008 m better, not
  significant), but several region cells have intervals wholly above 0 (Hawaii at all three leads, pacific_ne at +48 and
  +72 h, both Atlantic coasts at +24 h). Holm was not computed for a void run; on these intervals the rule would most
  likely have returned AGAINST, carried by Hawaii (+0.027 m at +48 h).
- The scalar raises the bias everywhere: pooled +0.109 / +0.201 / +0.204 m against +0.089 / +0.144 / +0.149 m (the
  pre-registered bias flag trips at every lead). Where the vector reads low (gulf, "other", atlantic_ne at +48/72 h) the
  scalar helps; where EURO already reads high (Hawaii, pacific_ne) it adds error.
- These rows are now seen. No rerun on them with a repaired control by this author: a second pre-registration (C1
  re-drawn inside each bootstrap draw, nothing else changed) is for the director to ask for and should be scored by
  someone else.

**Consequence for #663 (D-073):** it stays held. The shadow lane gives no case FOR the flip as built: a pooled gain under a
centimetre, a rising high bias, and a regional pattern (Hawaii, pacific_ne worse) that a global switch would apply
everywhere.
