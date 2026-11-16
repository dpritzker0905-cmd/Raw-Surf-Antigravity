"""The pre-registered gate (#989 gate items 1-4, amendment 2 A-K): naive baseline, scoring of the PREDICTED REPORT,
randomized PIT coverage, Wilson per class, two-way bootstrap, FRAGILE label, controls, verdict. numpy only.

The model supplies, for each scored target, posterior-predictive DRAWS of the target's report in metres of the
target's declared scale (model.predict_targets). Everything here is model-agnostic.
"""
from __future__ import annotations

import math
from collections import defaultdict
from typing import Optional

import numpy as np

from .prep import FT, entry_interval_m, entry_point_m, independent

SEED = 20261116
SCALE_TO_FACE = {"face": 1.0, "hawaiian": 2.0}


def naive_baseline_report(target: dict, others: list[dict]) -> Optional[float]:
    """Amendment 2 C: the median of the cell's OTHER entries, each to face metres by its DECLARED scale only,
    then back to the target's declared scale. No model parameter. Target excluded (amendment 2 A)."""
    faces = [entry_point_m(o) * SCALE_TO_FACE[o["height_scale"]] for o in others]
    if not faces:
        return None
    return float(np.median(faces)) / SCALE_TO_FACE[target["height_scale"]]


def abs_log_error(predicted_m: float, target: dict) -> float:
    """Gate item 1 error for one target: |log predicted report - log target point| (a range at its geometric
    centre, Flat 0.25 ft, 8ft+ at 8 ft: the appended definition)."""
    return abs(math.log(max(predicted_m, 1e-3)) - math.log(max(entry_point_m(target), 1e-3)))


def randomized_pit(draws: np.ndarray, target: dict, rng: np.random.Generator) -> float:
    """Amendment 2 F: u uniform between the predictive CDF at the entry's low and high edges (8ft+: [CDF(8 ft), 1])."""
    lo, hi = entry_interval_m(target)
    draws = np.sort(np.asarray(draws, dtype=float))
    cdf_lo = np.searchsorted(draws, lo, side="right") / draws.size
    cdf_hi = 1.0 if hi is None else np.searchsorted(draws, hi, side="right") / draws.size
    return float(rng.uniform(cdf_lo, max(cdf_hi, cdf_lo)))


def covered(u: float) -> bool:
    return 0.1 <= u <= 0.9


def wilson(k: int, n: int, z: float = 1.959964) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    p = k / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return centre - half, centre + half


def bootstrap_ratio_ci(model_err, base_err, groups, n_boot: int = 2000, seed: int = SEED) -> tuple[float, float]:
    """95% CI of the relative improvement 1 - MAE_model/MAE_base, resampling whole GROUPS (day blocks or anchors)."""
    rng = np.random.default_rng(seed)
    model_err, base_err, groups = np.asarray(model_err), np.asarray(base_err), np.asarray(groups)
    uniq = np.unique(groups)
    idx = {g: np.flatnonzero(groups == g) for g in uniq}
    stats = []
    for _ in range(n_boot):
        pick = np.concatenate([idx[g] for g in rng.choice(uniq, size=uniq.size, replace=True)])
        stats.append(1.0 - model_err[pick].mean() / max(base_err[pick].mean(), 1e-12))
    return float(np.percentile(stats, 2.5)), float(np.percentile(stats, 97.5))


def score(targets: list[dict], predictive: dict, others_by_target: dict, spot_class: dict) -> dict:
    """Score every target. `predictive[row_key]` = posterior-predictive draws (metres, target's declared scale);
    `others_by_target[row_key]` = the cell's non-target rows (inputs at scoring, amendment 2 B)."""
    rng = np.random.default_rng(SEED)
    recs = []
    for t in targets:
        others = [o for o in others_by_target[t["row_key"]] if independent(t, o)]
        base = naive_baseline_report(t, others_by_target[t["row_key"]])
        if not others or base is None:
            continue                                   # not scoreable (amendment 2 A)
        draws = np.asarray(predictive[t["row_key"]], dtype=float)
        recs.append({
            "class": spot_class[t["spot_id"]], "anchor": t["observer_key"], "day": t["received_at"][:10],
            "err_model": abs_log_error(float(np.median(draws)), t), "err_base": abs_log_error(base, t),
            "covered": covered(randomized_pit(draws, t, rng)),
        })
    return summarize(recs)


def summarize(recs: list[dict]) -> dict:
    if not recs:
        return {"n": 0, "verdict": "NOT RUNNABLE", "reason": "no scoreable targets"}
    em = np.array([r["err_model"] for r in recs])
    eb = np.array([r["err_base"] for r in recs])
    improvement = 1.0 - em.mean() / max(eb.mean(), 1e-12)
    ci_day = bootstrap_ratio_ci(em, eb, [r["day"] for r in recs])
    ci_anchor = bootstrap_ratio_ci(em, eb, [r["anchor"] for r in recs])
    wider = ci_day if (ci_day[1] - ci_day[0]) >= (ci_anchor[1] - ci_anchor[0]) else ci_anchor   # J: wider governs
    pooled_cov = float(np.mean([r["covered"] for r in recs]))
    per_class = defaultdict(list)
    for r in recs:
        per_class[r["class"]].append(r)
    classes = {}
    for c, rs in per_class.items():
        k, n = sum(r["covered"] for r in rs), len(rs)
        lo, hi = wilson(k, n)
        e_m = np.mean([r["err_model"] for r in rs])
        e_b = np.mean([r["err_base"] for r in rs])
        classes[c] = {"n": n, "coverage": k / n, "wilson95": [lo, hi], "wilson_ok": lo <= 0.80 <= hi,
                      "improvement": 1.0 - e_m / max(e_b, 1e-12)}
    per_anchor = {}
    for a in sorted({r["anchor"] for r in recs}):
        rs = [r for r in recs if r["anchor"] == a]
        per_anchor[a] = {"n": len(rs), "coverage": float(np.mean([r["covered"] for r in rs])),
                         "improvement": 1.0 - np.mean([r["err_model"] for r in rs]) /
                         max(np.mean([r["err_base"] for r in rs]), 1e-12)}
    n_days, n_anchors = len({r["day"] for r in recs}), len(per_anchor)
    item1 = improvement >= 0.10 and wider[0] > 0.0
    item2 = 0.75 <= pooled_cov <= 0.85 and all(c["wilson_ok"] for c in classes.values())
    passed = item1 and item2
    return {
        "n": len(recs), "improvement": improvement, "ci_day_block": ci_day, "ci_anchor": ci_anchor,
        "ci_governing": wider, "pooled_coverage": pooled_cov, "per_class": classes, "per_anchor": per_anchor,
        "day_blocks": n_days, "anchors": n_anchors, "item1_accuracy": item1, "item2_calibration": item2,
        "verdict": "PASS" if passed else "FAIL",
        "fragile": passed and (n_days < 20 or n_anchors < 5),
        "certifies": "consistency on the ANCHOR SCALE only; not physical accuracy; cells are a forecast-selected "
                     "sample (#989 amendment 2 K)",
    }


def final_verdict(gate: dict, controls: dict, diagnostics: dict) -> str:
    """VOID beats everything: a failed control or a failed convergence rule (amendment 2 D, I)."""
    if not diagnostics.get("converged", False):
        return "VOID (convergence)"
    if not all(controls.values()):
        return "VOID (control: " + ", ".join(k for k, ok in controls.items() if not ok) + ")"
    if gate.get("verdict") == "PASS" and gate.get("fragile"):
        return "PASS (FRAGILE)"
    return gate.get("verdict", "FAIL")


__all__ = ["FT", "SEED", "naive_baseline_report", "abs_log_error", "randomized_pit", "covered", "wilson",
           "bootstrap_ratio_ci", "score", "summarize", "final_verdict"]
