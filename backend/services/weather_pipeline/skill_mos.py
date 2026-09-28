"""skill_mos.py — a SHADOW Model Output Statistics correction scored on the skill ledger (roadmap stage 5, step 1).

The roadmap's learning loop starts by correcting each source's offshore Hs against buoys. Before anything is
corrected in the product, the correction has to beat the raw forecast on data it never saw. This is that
measurement, and nothing else: it changes no served number.

  * Per (source, lead) — `raw_surf` and each `raw_surf:MODEL` lane, the Open-Meteo competitor and its GFS
    control, persistence — fit `obs = a + b * forecast` by least squares on scored rows whose TARGET hour is
    older than the held-out window, then score it on the rows inside the window. A time split, not a random
    one: a correction is used on the future, so it is graded on the future.
  * Report raw vs corrected MAE and bias, and the same for big swell, next to the roadmap's done-when targets.

BIG SWELL, SELECTED TWO WAYS (2026-09-28). `big_swell_*` selects pairs by the OBSERVED height (>= 3 m). That
view is biased against every imperfect forecast: observed = forecast + error, so picking large observations
picks large positive errors. A perfectly calibrated forecast (E[obs | forecast] = forecast) with the ledger's
error levels reads -0.23 / -0.31 / -0.44 m there at MAE 0.24 / 0.29 / 0.36 m (Monte Carlo, lognormal sea);
the ledger's Open-Meteo GFS reads -0.24 / -0.34 / -0.68 m at MAE 0.27 / 0.29 / 0.36 m. A correction that
shrinks toward the mean (b < 1, as MOS does) reads WORSE there by construction, which is how the linear MOS
came to be "rejected" on this number. `big_swell_by_forecast_*` selects by the forecast being scored (>= 3 m):
"when it said big, what came?", the reliability a surfer reading the number relies on, and ~0 for a
calibrated forecast. Judge a correction, and the under-read, on that one; the observed view stays because a
paired comparison on the SAME observed hours (skill_attribution's big_swell block) is still fair.

Classic MOS (NWS practice since the 1970s) is the right first rung: two coefficients per group are
auditable, need no new dependency, and set the baseline a gradient-boosted correction has to beat. Groups
with too few rows say so rather than print a number.
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Tuple

HOLDOUT_DAYS = 7
MIN_TRAIN = 30
MIN_TEST = 10
BIG_SWELL_M = 3.0
LEADS_H = (24, 48, 72)
# Roadmap stage 5, "done when": held-out MAE at 48 h and 72 h, and the big-swell bias cut in half.
# ⚠️ The -0.86 was measured selecting by the OBSERVED height (n = 5 at 48 h); see the module docstring.
TARGETS = {"mae_48h_m": 0.38, "mae_72h_m": 0.49, "big_swell_bias_m_today": -0.86}
# Published beside the numbers so nobody reads one selection as the other.
BIG_SWELL_SELECTION = {
    "big_swell_*": "pairs whose OBSERVED Hs >= 3 m; negative for any imperfect forecast, calibrated or not",
    "big_swell_by_forecast_*": "pairs whose SCORED forecast >= 3 m (the corrected one for _mos); ~0 when calibrated",
}


def _parse(s) -> Optional[datetime]:
    try:
        t = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def _finite(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _lead(lead_h) -> Optional[int]:
    if not _finite(lead_h):
        return None
    return min(LEADS_H, key=lambda b: abs(b - lead_h))


def fit_linear(pairs: List[Tuple[float, float]]) -> Tuple[float, float]:
    """Least-squares (a, b) for obs = a + b * forecast. A degenerate forecast spread falls back to a
    bias-only correction (b = 1), never a division by zero."""
    n = len(pairs)
    mx = sum(x for x, _ in pairs) / n
    my = sum(y for _, y in pairs) / n
    sxx = sum((x - mx) ** 2 for x, _ in pairs)
    if sxx <= 1e-9:
        return my - mx, 1.0
    b = sum((x - mx) * (y - my) for x, y in pairs) / sxx
    return my - b * mx, b


def _mae(errs):
    return round(sum(abs(e) for e in errs) / len(errs), 3)


def _bias(errs):
    return round(sum(errs) / len(errs), 3)


def shadow_report(rows, now: datetime, holdout_days: int = HOLDOUT_DAYS,
                  min_train: int = MIN_TRAIN, min_test: int = MIN_TEST) -> Dict:
    """PURE: the held-out MOS evaluation over scored ledger rows (see the module docstring)."""
    cutoff = now - timedelta(days=holdout_days)
    groups: Dict[Tuple[str, int], Dict[str, list]] = {}
    for r in rows or []:
        x, y, t, lead = r.get("hs_m"), r.get("obs_hs_m"), _parse(r.get("target_time")), _lead(r.get("lead_h"))
        if not (_finite(x) and _finite(y)) or x <= 0 or y < 0 or t is None or lead is None or t > now:
            continue
        g = groups.setdefault((str(r.get("source")), lead), {"train": [], "test": []})
        g["test" if t >= cutoff else "train"].append((float(x), float(y)))
    out = []
    for (source, lead), g in sorted(groups.items()):
        entry = {"source": source, "lead_h": lead, "n_train": len(g["train"]), "n_test": len(g["test"])}
        if len(g["train"]) < min_train or len(g["test"]) < min_test:
            out.append({**entry, "status": "insufficient"})
            continue
        a, b = fit_linear(g["train"])
        raw = [x - y for x, y in g["test"]]
        mos = [a + b * x - y for x, y in g["test"]]
        big = [(x, y) for x, y in g["test"] if y >= BIG_SWELL_M]
        entry.update({"status": "scored", "a": round(a, 3), "b": round(b, 3),
                      "mae_raw_m": _mae(raw), "mae_mos_m": _mae(mos),
                      "bias_raw_m": _bias(raw), "bias_mos_m": _bias(mos), "big_swell_n": len(big)})
        if big:
            entry["big_swell_bias_raw_m"] = _bias([x - y for x, y in big])
            entry["big_swell_bias_mos_m"] = _bias([a + b * x - y for x, y in big])
        # Selected by the forecast being scored: the raw forecast for raw, the corrected one for MOS.
        big_raw = [x - y for x, y in g["test"] if x >= BIG_SWELL_M]
        big_mos = [a + b * x - y for x, y in g["test"] if a + b * x >= BIG_SWELL_M]
        entry["big_swell_by_forecast_n_raw"], entry["big_swell_by_forecast_n_mos"] = len(big_raw), len(big_mos)
        if big_raw:
            entry["big_swell_by_forecast_bias_raw_m"] = _bias(big_raw)
        if big_mos:
            entry["big_swell_by_forecast_bias_mos_m"] = _bias(big_mos)
        out.append(entry)
    return {"method": "linear_mos_per_source_lead", "holdout_days": holdout_days,
            "cutoff": cutoff.isoformat(), "rows_used": sum(e["n_train"] + e["n_test"] for e in out),
            "targets": TARGETS, "big_swell_selection": BIG_SWELL_SELECTION, "by_source_lead": out}
