"""skill_consensus.py — the three-model consensus, scored at the buoys (roadmap stage 5, measurement only).

The roadmap's first free ingredient is "three global wave models", and the skill ledger already forecasts every
buoy from all three of our lanes: `raw_surf` (the served model) and the `raw_surf:ICON` / `raw_surf:EURO`
compare lanes, on the same target hours. A multi-model consensus usually beats every member (the errors are
partly independent), so before any blended number is served it has to beat the best single model on data it
never saw. This is that measurement, from rows the ledger already scored: no fetch, no new pending rows.

  * Pairs: a (buoy, target hour, lead) where ALL members were scored, so every number compares like with like.
  * `equal`: the plain mean of the members.
  * `debiased`: each member's mean error per lead, learned on rows whose target is older than the held-out week,
    removed before averaging. The members' biases differ a lot (at 48 h, one run: GFS -0.01, EURO +0.15,
    ICON +0.21 m), and a plain mean inherits them.
  * Graded on the held-out week against each member and the best of them. Thin leads refuse with a status.

Changes no served number.
"""
import math
from datetime import datetime, timedelta
from typing import Dict, List

from services.weather_pipeline.skill_mos import HOLDOUT_DAYS, _lead, _parse

MEMBERS = ("raw_surf", "raw_surf:ICON", "raw_surf:EURO")
MIN_TEST = 10


def _ok(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _stats(errs: List[float]) -> Dict[str, float]:
    return {"mae_m": round(sum(abs(e) for e in errs) / len(errs), 3), "bias_m": round(sum(errs) / len(errs), 3)}


def consensus_report(rows, now: datetime, holdout_days: int = HOLDOUT_DAYS, min_test: int = MIN_TEST,
                     members=MEMBERS) -> Dict:
    """PURE: the held-out consensus evaluation over scored ledger rows (see the module docstring)."""
    cutoff = now - timedelta(days=holdout_days)
    keys: Dict[tuple, Dict[str, tuple]] = {}
    for r in rows or []:
        src = str(r.get("source"))
        if src not in members:
            continue
        x, y, t, lead = r.get("hs_m"), r.get("obs_hs_m"), _parse(r.get("target_time")), _lead(r.get("lead_h"))
        if not (_ok(x) and _ok(y)) or x <= 0 or y < 0 or t is None or lead is None or t > now:
            continue
        keys.setdefault((r.get("buoy_id"), t.isoformat(), lead), {})[src] = (float(x), float(y), t)
    by_lead: Dict[int, Dict[str, list]] = {}
    for (_, _, lead), got in keys.items():
        if len(got) != len(members):
            continue                                   # like with like: every member on every pair
        t = next(iter(got.values()))[2]
        by_lead.setdefault(lead, {"train": [], "test": []})["test" if t >= cutoff else "train"].append(got)
    out = []
    for lead, g in sorted(by_lead.items()):
        entry = {"lead_h": lead, "n_train": len(g["train"]), "n_test": len(g["test"])}
        if len(g["test"]) < min_test:
            out.append({**entry, "status": "insufficient"})
            continue
        bias = {m: (sum(p[m][0] - p[m][1] for p in g["train"]) / len(g["train"]) if g["train"] else 0.0)
                for m in members}
        per = {m: _stats([p[m][0] - p[m][1] for p in g["test"]]) for m in members}
        obs = [p[members[0]][1] for p in g["test"]]
        equal = [sum(p[m][0] for m in members) / len(members) for p in g["test"]]
        debiased = [sum(p[m][0] - bias[m] for m in members) / len(members) for p in g["test"]]
        best = min(members, key=lambda m: per[m]["mae_m"])
        entry.update({
            "status": "scored", "members": per, "best_member": best,
            "member_bias_train_m": {m: round(b, 3) for m, b in bias.items()},
            "equal": _stats([f - o for f, o in zip(equal, obs)]),
            "debiased": _stats([max(0.0, f) - o for f, o in zip(debiased, obs)]),
        })
        entry["equal_beats_best"] = entry["equal"]["mae_m"] < per[best]["mae_m"]
        entry["debiased_beats_best"] = entry["debiased"]["mae_m"] < per[best]["mae_m"]
        out.append(entry)
    return {"method": "three_model_consensus_equal_and_debiased", "members": list(members),
            "holdout_days": holdout_days, "cutoff": cutoff.isoformat(),
            "paired_keys": sum(e["n_train"] + e["n_test"] for e in out), "by_lead": out}
