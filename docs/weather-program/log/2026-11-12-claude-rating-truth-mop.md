# 2026-11-12 · claude/rating-truth-mop · the MOP rating-truth check that gates #771 (JAC-2)

Session started from the coordinator session. Task: build and run gate 2 of #771 (`RATING_REF_PRIOR`, the catalogue
reference prior), which the owner decided at 17:06 EST that #771 waits for. Branch `claude/rating-truth-mop` off dev
`46d6ed596`; PR #839 (draft). **No served number changes in this PR.** #771 is not merged and the flag is not flipped.

## What was built

- `backend/scripts/rating_truth_mop.py` (I/O) + `rating_truth_mop_core.py` (pure), tests `backend/tests/
  test_rating_truth_mop.py` (32, guards lane, fragment `.github/ci-floors.d/claude-rating-truth-mop.guards.json`).
- One MOP-derived breaking height (`eval_scoring.hb_proxy`, the #773 frozen Komar-Gaughan operator on MOP v1.1 Hs/Tp at
  the point depth) graded three ways. The category is read off `surf_rating.size_score` / `oversize_gate`: flat / small /
  fun / solid / overhead / big. Truth = the spot's own measured-water typical day (`reference_from_hist`, 2018-2021).
  OFF = legacy curve. ON = leave-one-out baseline median (1.1415 m at every spot).
- ON arm checked against #771's code (`f81a293b2`, flag ON): 0 mismatches at 1,600 heights from 0 to 16 m.
- Data: CDIP THREDDS OPeNDAP ASCII, public, no credentials, 21 MB cached outside the repo. The app backend was never
  called.

## Order (pre-registration)

1. 23:00Z: MOP series downloaded (fetch only). Unit tests run on synthetic data only.
2. `3adfe0588`: instrument + `evidence/rating-truth-mop-2026-11-12/PREREGISTRATION.md` committed and pushed. Draft PR
   #839 opened with the rule in its body.
3. Then the run (12 s): `cd backend && python scripts/rating_truth_mop.py --cache <dir> --out <json>`. The result is in
   `evidence/rating-truth-mop-2026-11-12/result.json`.

## Result: PASS under the pre-registered rule

19 California spots, 270,408 scored spot-hours (2022-01..2025-03, every 2nd hour), 1,186 days. Exact size-category
agreement with measured water, with a 95 % day-block bootstrap CI of prior − legacy:

| variant | prior | legacy | prior − legacy [95 % CI] | null swap CI | wrong 4 m yardstick − prior [CI] |
|---|---|---|---|---|---|
| `kg_frozen` (×1.0) | **0.728** | 0.242 | **+0.486 [0.478, 0.494]** | [−0.030, 0.029] ✓ | −0.245 [−0.264, −0.227] ✓ |
| `h110_served` (×1.27) | **0.600** | 0.115 | **+0.486 [0.478, 0.495]** | [−0.027, 0.033] ✓ | −0.107 [−0.129, −0.085] ✓ |

Regions (prior − legacy, CI). None is worse in either variant:

| region (spots) | `kg_frozen` | `h110_served` |
|---|---|---|
| north_central (6) | +0.603 [0.591, 0.614] | +0.393 [0.380, 0.405] |
| santa_barbara_ventura (5) | +0.203 [0.186, 0.222] | +0.615 [0.606, 0.623] |
| la_orange (4) | +0.672 [0.660, 0.685] | +0.620 [0.605, 0.636] |
| san_diego (4) | +0.477 [0.467, 0.489] | +0.330 [0.314, 0.347] |

Seasons (descriptive): prior ahead in DJF, MAM, JJA and SON in both variants (the smallest lower bound is 0.419, JJA
`kg_frozen`).

## What the numbers say

- **Legacy's agreement is chance.** If each spot's truth is rotated by a random number of days, legacy still scores
  0.259 (`kg_frozen`), against 0.242 on the real timing. Its size category carries no information about the day. That
  is #771's defect as measured in water: above 1.2 m the legacy curve calls everything "solid" (103,859 of 138,085
  truth-"fun" hours). The prior's rotated-truth agreement is 0.484 against 0.728 real, so +0.24 of its agreement is
  timing.
- **Adjacent-category agreement** (within one category): prior 0.995 / 0.981, legacy 0.894 / 0.746.
- **Where the prior loses: small-wave spots.** Sands Beach (measured typical day 0.58 m; legacy 0.77 vs prior 0.66) and
  La Jolla Shores (0.67 m; 0.76 vs 0.54) in `kg_frozen`; the same two in `h110_served`. A single 1.14 m prior over-calls
  their size, which is the failure the synthetic FAIL test models. Their regions are still positive.
- **Weakest wins: the biggest spots.** Ocean Beach SF (typical day 2.05 m) and Carmel (1.84 m). The prior beats legacy
  there (0.31 vs 0.02, 0.45 vs 0.04) but under-calls them. A regional or depth-aware prior, which #771 already lists as
  a possible follow-up, would help both tails.
- **Side validation.** Measured-water references rank-correlate with the served climatology references at Spearman
  0.83 (19 spots). Under H1/10 their scale matches too (median truth/served 0.95; 0.75 on the frozen operator). So
  `h110_served` is the production-faithful variant, and the rule passed there too.

## Limits (all stated in the pre-registration before the run)

California only; MOP is a model at 10-15 m depth, and the breaking height is a proxy operator on it; the 19 spots all
have served references, so leave-one-out simulates the reference-less case. The live reference-less population is
band cells, new spots, outages and the eval replay. Break depth is None for every grader, so the oversize tier is
graded on the reference alone. This is gate 2 of #771's four; it does not replace gate 1 (all 1,773 spots,
own-reference agreement) if the owner wants that too.

## Verdict

**PASS.** Under the pre-registered rule, #771 may merge (it stays held OFF at merge) and the flag may later be flipped
through the runtime manifest. Merging and flipping are the owner's calls; this session does neither.
