"""gate_v2_config.py - EVERY threshold of validation gates v2, in one place. PURE, stdlib only. Serves nothing.

WHY (science audit 2026-11-01, docs/research/science-sota-2026-11-01.md section 8.1 and 8.6 #1; Reflection's review).
The v1 flip gate (`scored_rows_analysis.gate`) is MAE only. MAE is minimised by the MEDIAN of the forecast distribution
(Gneiting 2011, JASA), and Hs is right-skewed, so an MAE gate can prefer a forecast that under-reads big swells; RMSE can
do the same when scatter is large (Mentaschi et al. 2013). It also has no significance test, so a 3 mm "win" over
autocorrelated hours reads the same as a real one. Gate v2 keeps MAE (the "typical" error) and adds:
  * a Diebold-Mariano test with a Newey-West (HAC) variance, and a moving-block bootstrap CI, on the loss differential;
  * big-swell bands gated on BIAS as well as error, so a peak-shaving candidate cannot win on MAE alone;
  * no lead allowed to degrade significantly, with Holm's correction across the family of harm tests;
  * strata by lead, buoy hull and sea state; blocked cross-validation by buoy and by week (replication);
  * periods scored against NDBC DPD AND a parabolic-fit Tp from `data_spec`, because DPD is the max band with no fit
    (quantised ~1-1.5 s at swell periods), with multi-peaked spectra flagged.

A threshold lives ONLY here. Changing one is a decision: say why in DECISIONS.md, because every later flip is judged on it.

THE FLAG. `GATES_V2` (default off) makes the one-off scored-rows job run v2 BESIDE v1 on the same rows. It changes no
served number and no v1 verdict or exit code; it adds a report section.
"""
import os
from dataclasses import dataclass
from typing import Optional, Tuple

FLAG = "GATES_V2"
_ON = ("1", "true", "yes", "on")


def enabled(env=None) -> bool:
    """True when the GATES_V2 flag is on. Read at call time (house rule for flags)."""
    return str((os.environ if env is None else env).get(FLAG, "0")).strip().lower() in _ON


@dataclass(frozen=True)
class Band:
    """A big-swell band selected by the OBSERVED Hs of the pair (the same hours for both lanes, so the comparison
    between them is fair even though the selection biases both low: skill_consensus.BIG_SWELL_M's rule).
    Exactly one of `min_obs_m` / `top_share` is set. `max_bias_worsen_m`: the most |bias| may grow, candidate vs
    reference, in metres, before the gate fails."""
    label: str
    min_obs_m: Optional[float] = None
    top_share: Optional[float] = None
    max_bias_worsen_m: float = 0.05


@dataclass(frozen=True)
class GateV2Config:
    # --- significance -------------------------------------------------------------------------------------------
    alpha_overall: float = 0.05          # one-sided: the candidate's loss is LOWER (DM with HAC), primary loss
    alpha_harm: float = 0.05             # family-wise, Holm, over every "the candidate is WORSE" test
    fdr_q: float = 0.10                  # Benjamini-Hochberg q-values are reported beside Holm (advisory)
    primary_loss: str = "abs"            # "abs" (MAE: typical error, elicits the median) or "sq" (MSE: the mean)
    secondary_losses: Tuple[str, ...] = ("sq",)   # each must not be significantly WORSE (enters the harm family)
    require_bootstrap_agree: bool = True  # overall pass also needs the block-bootstrap CI of the gain to exclude 0
    # --- dependence ---------------------------------------------------------------------------------------------
    # BLOCK-LENGTH RULE (stated in every report): the loss differential is averaged over buoys per target hour, giving
    # one series of length T. k = the first lag whose |autocorrelation| < 2/sqrt(T) (inside the white-noise band),
    # searched up to T * max_block_frac. Bootstrap block b = max(k, ceil(T ** (1/3))) (Kunsch 1989; Hall et al. 1995
    # scaling), capped at T * max_block_frac. HAC lag L = max(k - 1, floor(4 (T/100) ** (2/9))) (Newey & West 1994),
    # Bartlett kernel; the DM statistic carries the Harvey-Leybourne-Newbold small-sample factor with h = L + 1.
    max_block_frac: float = 0.25
    bootstrap_reps: int = 2000
    bootstrap_seed: int = 20261101       # fixed: the same rows always give the same CI
    ci_level: float = 0.95
    min_series_len: int = 20             # target hours a series needs before DM/bootstrap say anything
    # --- sample floors ------------------------------------------------------------------------------------------
    min_cell_print: int = 10             # a cell below this prints `n<10` and nothing else (aggregates only)
    min_n_overall: int = 100             # pairs the pooled comparison needs, else REFUSED
    min_n_decide: int = 30               # pairs a lead / band / stratum needs to enter the gate
    # --- strata -------------------------------------------------------------------------------------------------
    leads: Tuple[int, ...] = (24, 48, 72)
    bands: Tuple[Band, ...] = (
        Band("obs >= 2 m", min_obs_m=2.0, max_bias_worsen_m=0.05),
        Band("obs >= 4 m", min_obs_m=4.0, max_bias_worsen_m=0.10),
        Band("obs top 5%", top_share=0.05, max_bias_worsen_m=0.10),
    )
    required_bands: Tuple[str, ...] = ("obs >= 2 m",)   # untestable -> REFUSED; the others untestable -> a warning
    period_strata_s: Tuple[Tuple[float, float], ...] = ((0.0, 8.0), (8.0, 12.0), (12.0, 99.0))  # by observed DPD
    nomad_suspect_hs_m: float = 6.0      # NOMAD hulls read Hm0 low above ~6-7 m (Ocean Dynamics 2021)
    # --- blocked cross-validation (replication) -----------------------------------------------------------------
    cv_buoy_folds: int = 5               # buoys hashed (stable, id never printed) into this many folds
    cv_min_fold_n: int = 30
    cv_min_positive_share: float = 0.75  # share of held-out folds whose own gain is > 0
    cv_is_gate: bool = False             # ADVISORY by default: the owner's three criteria are the gate
    # --- spectra (period truth) ---------------------------------------------------------------------------------
    spec_join_tol_min: float = 35.0      # data_spec stamps sit 10-20 min off the .txt stamps
    spec_hm0_tol_m: float = 0.2          # spectral Hm0 must match the row's observed Hs within max(this,
    spec_hm0_tol_rel: float = 0.10       # ... this share), else the join is refused (wrong record)
    multi_peak_rel: float = 0.50         # a secondary peak counts when its density >= this x the global max
    multi_peak_trough: float = 0.75      # ... and the trough between the two dips below this x the smaller peak


DEFAULT = GateV2Config()
