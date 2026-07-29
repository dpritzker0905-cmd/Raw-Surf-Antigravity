"""sim_explain.py — WHY is it that score?

WHY THIS EXISTS
---------------
The rating is a product of nine factors:

    score = 100 * size_gate * swell_exposure * sea_clean * tide_fit * breaker_type
                * wind_gate * oversize_gate * period_gate * (0.60*wind_q + 0.40*period_q)

A product has exactly one way to be low: some factor is low. But the sim could only ever report the
FINISHED number, so "why is my offshore-wind day only poor-to-fair?" was unanswerable without
writing a bespoke script against the engine internals — which is precisely what had to be done on
2026-07-29 to answer that exact question from the owner. The answer took twenty minutes of
scripting and about four seconds of reading once the factors were on screen.

★ THE DIAGNOSTIC VALUE IS THE *LIMITER*, NOT THE LIST. With nine factors, the one nearest zero is
the whole story: it is the single change that would move the score most. Reporting it turns "the
rating disagrees with me" into "the rating says your period is 7.9 s", which is a claim the owner
can check against a buoy.

⚠️ THIS COMPUTES NOTHING NEW. Every factor is read back from `surf_rating`'s own public functions
with the same arguments `sim_rating.calculate_surf_rating` passes, and the reconstructed product is
CHECKED against the engine's own score (`reconstruction_error`). If those ever disagree, this
module is lying and says so rather than quietly presenting a second opinion — the same rule that
makes the sim mirror production instead of re-deriving it (CLAUDE.md: ONE FORECAST COMPOSITION).

⛔ It does NOT change any score. It is read-only explanation.
"""
import os
from typing import Any, Dict, Optional

from services.weather_pipeline import surf_rating as SR

MS_TO_KT = 1.94384

# How the factors are described to a caller who does not know the engine's variable names.
_MEANING = {
    "size_gate": "wave size vs the reference good-day size",
    "swell_exposure": "how square the swell angle is to the beach",
    "sea_cleanliness": "how much of the sea is windsea rather than swell",
    "tide_fit": "tide level vs the spot's preferred tide",
    "breaker_type": "breaker shape from the bottom slope",
    "wind_gate": "onshore-wind veto",
    "oversize_gate": "too big for the spot to hold",
    "period_gate": "short-period veto (under ~7 s)",
    "wind_quality": "wind speed and direction",
    "period_quality": "how long the period is",
}

# The factors that MULTIPLY. `wind_quality`/`period_quality` are the blended additive term and are
# reported separately, because a caller who sees 0.50 next to nine multipliers will read it as a
# veto when it is a weighted average that floors at 0.40.
_MULTIPLIERS = ("size_gate", "swell_exposure", "sea_cleanliness", "tide_fit", "breaker_type",
                "wind_gate", "oversize_gate", "period_gate")


def enabled() -> bool:
    return os.environ.get("SIM_EXPLAIN", "1") != "0"


def explain(*, surf_h_m: float, tp_s: float, wind_speed_knots: float,
            wind_from_deg: Optional[float] = None, shore_normal_deg: Optional[float] = None,
            swell_from_deg: Optional[float] = None, reference_size_m: Optional[float] = None,
            break_depth_m: Optional[float] = None,
            engine_score: Optional[float] = None) -> Dict[str, Any]:
    """Every factor behind a score, plus the one that limits it.

    Mirrors `sim_rating.calculate_surf_rating`'s call exactly — same optional inputs, passed by
    name. Never raises: an explanation must not be able to break the answer it annotates.
    """
    if not enabled():
        return {}
    try:
        wind_ms = float(wind_speed_knots) / MS_TO_KT
        f = {
            "size_gate": SR.size_score(surf_h_m, reference_size_m),
            "swell_exposure": SR.swell_exposure(swell_from_deg, shore_normal_deg),
            "sea_cleanliness": 1.0,          # partitions are not wired into the sim yet
            "tide_fit": SR.tide_fit(None, SR.parse_best_tide(None)),
            "breaker_type": SR.breaker_type_quality(None),
            "wind_gate": SR.wind_gate(wind_ms, wind_from_deg, shore_normal_deg),
            "oversize_gate": SR.oversize_gate(surf_h_m, reference_size_m,
                                              break_depth_m=break_depth_m),
            "period_gate": SR.period_gate(tp_s),
        }
        wq = SR.wind_quality(wind_ms, wind_from_deg, shore_normal_deg)
        pq = SR.period_quality(tp_s)
        blend = SR.W_WIND * wq + SR.W_PERIOD * pq

        product = 100.0
        for v in f.values():
            product *= v
        recon = round(product * blend, 1)

        factors = [{"factor": k, "value": round(v, 3), "means": _MEANING[k]}
                   for k, v in f.items()]
        factors.sort(key=lambda r: r["value"])

        # The limiter is the smallest MULTIPLIER — but only if it is actually holding the score
        # down. Everything at 1.0 means nothing is vetoing and the blend is the ceiling.
        low = factors[0]
        if low["value"] >= 0.999:
            limiter = {"factor": "wind_and_period_blend", "value": round(blend, 3),
                       "means": "nothing is vetoing; the score is the wind/period blend",
                       "detail": f"wind_quality {wq:.2f}, period_quality {pq:.2f}"}
        else:
            limiter = dict(low)
            # What the score would be if this one factor were perfect — the actionable number.
            if low["value"] > 0:
                limiter["score_if_this_were_1_0"] = round(recon / low["value"], 1)

        out = {
            "score": recon,
            "level": SR.score_to_level(recon),
            "limiting_factor": limiter,
            "multipliers": factors,
            "blend": {"value": round(blend, 3), "wind_quality": round(wq, 3),
                      "period_quality": round(pq, 3),
                      "means": "0.60*wind + 0.40*period; floors near 0.40, so it cannot veto"},
            "inputs": {"breaking_height_ft": round(surf_h_m / 0.3048, 1),
                       "period_sec": round(float(tp_s), 1),
                       "wind_knots": round(float(wind_speed_knots), 1),
                       "shore_normal_deg": shore_normal_deg,
                       "reference_size_m": reference_size_m},
        }
        if engine_score is not None:
            # ⚠️ THE HONESTY CHECK. If this ever fires, the explanation is describing a different
            # composition than the one that produced the score, and saying so is the whole point.
            err = round(recon - float(engine_score), 2)
            out["reconstruction_error"] = err
            if abs(err) > 0.15:
                out["warning"] = (
                    f"This explanation reconstructs {recon} but the engine returned "
                    f"{engine_score} (delta {err:+.2f}). The factor list is missing something the "
                    f"engine applies — trust the engine's score, not this breakdown.")
        return out
    except Exception as e:                    # never break the answer being annotated
        return {"error": f"explanation unavailable: {e}"}


def summarize(exp: Dict[str, Any]) -> Optional[str]:
    """One sentence a caller can show a surfer."""
    if not exp or "limiting_factor" not in exp:
        return None
    lim = exp["limiting_factor"]
    base = (f"{exp['score']}/100 ({exp['level']}) — limited by {lim['factor'].replace('_', ' ')} "
            f"at {lim['value']}: {lim['means']}")
    if "score_if_this_were_1_0" in lim:
        base += f". Fix that alone and it would score {lim['score_if_this_were_1_0']}"
    return base + "."
