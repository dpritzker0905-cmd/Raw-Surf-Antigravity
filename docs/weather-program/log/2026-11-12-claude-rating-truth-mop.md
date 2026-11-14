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

## 2026-11-13 02:55Z: merges and the flip (owner's words in this session)

The verdict section above says "this session does neither". That was true when written; the owner then asked for both, in
this session, on 2026-11-12: "mark #839 ready once CI is green", "merge #839 too once it's green", "merge #771 once #839 is in",
"then flip RATING_REF_PRIOR on after #771 merges", "merge #771 yourself if CI goes green first".

- **#839** merged by the integrator's pinned job: squash `97d136e6e` from `a037cf64c`, 00:56Z. Hosted guards read 3,788 passed,
  exactly the fragment's number. Its `pr_merge` line is in the integrator's fragment.
- **#771** needed three repairs after the dev merges, all pushed by this session as the branch's only writer: `9ff5db611` (dev
  merge; `runtime_flags.GUARDED` conflict, both sides kept; the owed chain floor fragment, +27 tests / +1 file), `99c360d3f` (the
  guardrail `COVERAGE` entry dev now requires; `surf_forecast.py` back to 800 lines, entry text identical by `ast`), `5c209be00`
  (dev merge carrying #839). CI: the guards job hit its 25-minute limit once (25 min 16 s, cancelled, not a test failure); the
  rerun passed. Merged by this session: squash `394731b92`, pinned with `--match-head-commit 5c209be00`, 02:30:42Z. Render
  deployed it at 02:33:56Z (`dep-dbr7cl61egvs73fftnfg`).
- **The flip:** before it, Render's env (59 keys, names only) and every workflow leave `RATING_REF_PRIOR` unset, so the manifest
  governs every lane. `gh workflow run flag-guardrail.yml --ref dev -f reenable=RATING_REF_PRIOR -f owner_words="then flip
  RATING_REF_PRIOR on after #771 merges"` gave run 43354377100, success, enforce mode. Its artifact's manifest:
  `{"state": "on", "reason": "owner re-enabled: then flip RATING_REF_PRIOR on after #771 merges", "set_by": "owner",
  "set_at": "2026-11-13T02:47:53Z", "evidence": "workflow_dispatch by dpritzker0905-cmd"}`. The previous scheduled run
  (43311056089) had read an empty manifest, so no entry was dropped.
- **Not verified:** the served value on the live box (the admin status endpoint needs a login, and CLAUDE.md forbids load on
  the live backend). The guardrail cannot judge a rating against observations, so it is effectively blind to a regression here.
  The reference-less path it moves is small today (0 of 1,773 catalogue spots).
- **Guards timeout:** not raised. The rerun passed, so no `ci.yml` change was needed (it would have waited for Codex's
  merge-window hold).
- **Kill:** an explicit `RATING_REF_PRIOR=0` on Render AND in the ingest/precompute workflow env (env beats manifest), or
  remove the manifest entry (as the guardrail does, with the service key).
