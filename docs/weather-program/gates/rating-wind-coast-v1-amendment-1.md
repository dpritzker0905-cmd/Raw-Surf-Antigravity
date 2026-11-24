# Amendment 1 to rating-wind-coast-v1 (a program-level report; reported only)
Stamp: 2026-11-23T12:18:47Z (research lead, on the director's instruction after the three-way review). Written before any data: no station list is frozen, nothing is collected, and no arm has been paired with any station. The advisor may veto it.
Candidate: unchanged, `rating-wind-coast-v1` (#1165).
Metric: unchanged. This amendment adds one REPORTED quantity, the program-level pass count (section 2), beside the registered per-region decisions.
Pass threshold: unchanged. The per-region rules in sections 5-8 of the gate still decide everything.
Controls: unchanged. The report reuses the gate's own permutation null (section 7) jointly across regions.
Decision rule: unchanged. The program-level report cannot pass, fail, void, adopt or block anything. It is read beside the per-region verdicts.
Unmeasured items: unchanged.
Served change: none.

## 1. Why (three-way review, 2026-11-23)
- Reflection and LongCat both said the decision rule ("BETTER on DAWN and not WORSE on ALL") lacks family-wise control across strata AND regions. SubQ was borderline: Holm over 4 lines per region, with 5 regions not jointly corrected, rated adequate at model confidence 0.54.
- **What the gate already controls:** within each region, Holm covers candidate × stratum (4 lines; 2 in Hawaii and Puerto Rico). The WORSE lines form their own family, and the NBM-vs-HRRR head-to-head runs only conditionally, as a tie-break.
- **What it does not:** regions are separate adoption decisions, each at family-wise alpha 0.05. Across 5 regions, a program with no real effect anywhere could still adopt a candidate in one region by chance (up to about 5 × 0.05 = 0.25 expected false adoptions).
- **Why not correct jointly:** a joint correction across regions would change the registered decision after the reviews and lower power in every region. Instead, the program-level chance rate is reported, so a reader can tell "one region passed" from "noise".

## 2. The report (one table in the result, beside the per-region verdicts)
- **Observed pass count K:** the number of (region, candidate) lines that end BETTER on DAWN under the gate's own rule, and separately the number of regions that adopt a candidate (section 8 of the gate).
- **Null distribution of K, from the gate's own null:**
  - In each of the 200 permutations of section 7 (seed 1163), arm labels are swapped within 7-day blocks in ALL regions at once, with the same block draw for every region.
  - Each region's lines are re-labelled under the registered rules, and K is counted.
  - Reported: the mean of K under the null (the expected false passes), and the share of permutations with K >= the observed K (a program-level p-value).
  - Swapping jointly keeps the dependence between regions, such as shared synoptic weather, which a binomial(5, 0.05) bound would ignore. That bound is reported beside it for reference.
- **Wording, fixed now:**
  - If the program-level p >= 0.05, the result reads "the number of regions that passed is not distinguishable from chance at the program level", next to the per-region verdicts.
  - Otherwise: "more regions passed than chance would explain (program-level p = x)".
  - Neither wording changes any region's verdict.

## 3. What this does not change
- **The decisions do not change.** Each region's adoption, the WORSE family, the controls, the floors, the tie-break and the serving read rule all stand as registered.
- **Any later decision to correct jointly across regions** would be a new registration on new data, not an amendment to this one.
