"""skill_direction_consensus.py -- the three-model consensus swell DIRECTION and peak PERIOD, scored at the buoys.

S8's follow-up (log/2026-09-30-audit-sota.md section 4, ordered path item 4: "then test a consensus direction/period").
`skill_direction_period` grades each lane alone; `skill_consensus` grades a consensus for HEIGHT only, and the consensus
product keeps the served GFS direction and period. Direction carries 33% of the served rating's variance and period 10%
(audit section 3.3), so before anything is blended it has to beat the best single model on rows it never saw.

The rows already exist: each lane's scored ledger row carries `dir_deg`, `tp_s` and the buoy's `obs_mwd_deg`,
`obs_dpd_s`, `obs_hs_m`. No fetch, no new pending rows, and NO served number changes.

  * Pairs: a (buoy, target hour, lead) where ALL members were scored, so every number compares like with like.
  * DIRECTION candidates: `equal` (the unit-vector mean of the members' directions), `pair_gfs_euro` (the same without
    ICON), `medoid` (the member direction closest to the others: robust to one wild member). Directions are circular:
    350 and 10 degrees average to 0, not 180. When the members cancel (resultant length below MIN_RESULTANT) the mean
    is UNDEFINED; the row is then graded as the SERVED lane's own direction (what a serve rule would fall back to) and
    counted in `n_fallback`, never dropped, so a consensus cannot look better by discarding its hard cases.
    Graded only where the observed Hs >= DIR_MIN_OBS_HS_M, as skill_direction_period does (a flat sea's direction is noise).
  * PERIOD candidates: `equal`, `pair_gfs_euro`, `median`, and `debiased_equal` (each member's mean error per lead,
    learned on pairs OLDER than the held-out week and removed before averaging: the members' period biases differ in
    sign and size, GFS +0.5 / EURO -0.7 / ICON -1.7 s on the first graded week).
  * Graded on the held-out week against each member and the best of them; `*_beats_best` is true only when STRICTLY
    better. Thin leads refuse with a status.

Changes no served number.
"""
import math
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple

from services.weather_pipeline.skill_direction_period import (
    DIR_MIN_OBS_HS_M, MIN_N, _dir_stats, _num, circular_error_deg)
from services.weather_pipeline.skill_mos import HOLDOUT_DAYS, _lead, _parse

MEMBERS = ("raw_surf", "raw_surf:ICON", "raw_surf:EURO")      # the served GFS lane first
PAIR = ("raw_surf", "raw_surf:EURO")                          # the equal mean without ICON
MIN_RESULTANT = 0.35      # |mean of the unit vectors| below this: the members disagree too much to name a direction


def circular_mean_deg(angles: List[float]) -> Tuple[Optional[float], float]:
    """(mean direction in [0, 360), resultant length in [0, 1]); (None, r) when r < MIN_RESULTANT or empty. PURE."""
    if not angles:
        return None, 0.0
    s = sum(math.sin(math.radians(a)) for a in angles) / len(angles)
    c = sum(math.cos(math.radians(a)) for a in angles) / len(angles)
    r = math.hypot(s, c)
    if r < MIN_RESULTANT:
        return None, r
    return math.degrees(math.atan2(s, c)) % 360.0, r


def medoid_deg(angles: List[float]) -> Optional[float]:
    """The member direction with the smallest summed circular distance to the others (ties: the first). PURE."""
    if not angles:
        return None
    return min(angles, key=lambda a: sum(circular_error_deg(a, b) or 0.0 for b in angles))


def _period_stats(errs: List[float]) -> Dict:
    if len(errs) < MIN_N:
        return {"n": len(errs), "mae_s": None, "bias_s": None}
    return {"n": len(errs), "mae_s": round(sum(abs(e) for e in errs) / len(errs), 3),
            "bias_s": round(sum(errs) / len(errs), 3)}


def _median(v: List[float]) -> float:
    s = sorted(v)
    n = len(s)
    return s[n // 2] if n % 2 else 0.5 * (s[n // 2 - 1] + s[n // 2])


def _beats(cand: Dict, members: Dict[str, Dict], key: str) -> Optional[bool]:
    """True only when the candidate is STRICTLY better than the best member; None when anything is unscored."""
    vals = [m[key] for m in members.values() if m.get(key) is not None]
    if cand.get(key) is None or len(vals) != len(members):
        return None
    return cand[key] < min(vals)


def _direction_block(test: List[Dict], members) -> Dict:
    """Held-out direction grades. Each pair is {member: row}; only pairs with every direction, the buoy's MWD and a
    non-flat sea are graded."""
    pairs = [p for p in test
             if all(_num(p[m].get("dir_deg")) for m in members)
             and _num(p[members[0]].get("obs_mwd_deg")) and _num(p[members[0]].get("obs_hs_m"))
             and p[members[0]]["obs_hs_m"] >= DIR_MIN_OBS_HS_M]
    if len(pairs) < MIN_N:
        return {"status": "insufficient", "n": len(pairs)}
    obs = [p[members[0]]["obs_mwd_deg"] for p in pairs]
    served = members[0]
    fb = {"equal": 0, "pair_gfs_euro": 0}
    cands: Dict[str, List[float]] = {m: [circular_error_deg(p[m]["dir_deg"], o) for p, o in zip(pairs, obs)] for m in members}
    eq, pr, md = [], [], []
    for p, o in zip(pairs, obs):
        ds = [p[m]["dir_deg"] for m in members]
        m_eq, _ = circular_mean_deg(ds)
        if m_eq is None:
            fb["equal"] += 1
            m_eq = p[served]["dir_deg"]
        m_pr, _ = circular_mean_deg([p[m]["dir_deg"] for m in PAIR if m in members])
        if m_pr is None:
            fb["pair_gfs_euro"] += 1
            m_pr = p[served]["dir_deg"]
        eq.append(circular_error_deg(m_eq, o))
        pr.append(circular_error_deg(m_pr, o))
        md.append(circular_error_deg(medoid_deg(ds), o))
    per = {m: _dir_stats(cands[m]) for m in members}
    out = {"status": "scored", "n": len(pairs), "members": per, "equal": _dir_stats(eq),
           "pair_gfs_euro": _dir_stats(pr), "medoid": _dir_stats(md), "n_fallback": fb["equal"],
           "n_fallback_pair": fb["pair_gfs_euro"]}
    best = min(per, key=lambda m: per[m]["mae_deg"] if per[m]["mae_deg"] is not None else 1e9)
    out["best_member"] = best
    for k in ("equal", "pair_gfs_euro", "medoid"):
        out[k + "_beats_best"] = _beats(out[k], per, "mae_deg")
    return out


def _period_block(train: List[Dict], test: List[Dict], members) -> Dict:
    def ok(p):
        return all(_num(p[m].get("tp_s")) and p[m]["tp_s"] > 0 for m in members) \
            and _num(p[members[0]].get("obs_dpd_s")) and p[members[0]]["obs_dpd_s"] > 0
    tr, te = [p for p in train if ok(p)], [p for p in test if ok(p)]
    if len(te) < MIN_N:
        return {"status": "insufficient", "n": len(te)}
    served = members[0]
    obs = [p[served]["obs_dpd_s"] for p in te]
    bias = {m: (sum(p[m]["tp_s"] - p[m]["obs_dpd_s"] for p in tr) / len(tr) if tr else 0.0) for m in members}
    per = {m: _period_stats([p[m]["tp_s"] - o for p, o in zip(te, obs)]) for m in members}
    eq = [sum(p[m]["tp_s"] for m in members) / len(members) - o for p, o in zip(te, obs)]
    pr = [sum(p[m]["tp_s"] for m in PAIR if m in members) / len([m for m in PAIR if m in members]) - o
          for p, o in zip(te, obs)]
    med = [_median([p[m]["tp_s"] for m in members]) - o for p, o in zip(te, obs)]
    deb = [sum(p[m]["tp_s"] - bias[m] for m in members) / len(members) - o for p, o in zip(te, obs)]
    out = {"status": "scored", "n": len(te), "n_train": len(tr), "members": per,
           "member_bias_train_s": {m: round(b, 3) for m, b in bias.items()},
           "equal": _period_stats(eq), "pair_gfs_euro": _period_stats(pr), "median": _period_stats(med),
           "debiased_equal": _period_stats(deb)}
    best = min(per, key=lambda m: per[m]["mae_s"] if per[m]["mae_s"] is not None else 1e9)
    out["best_member"] = best
    for k in ("equal", "pair_gfs_euro", "median", "debiased_equal"):
        out[k + "_beats_best"] = _beats(out[k], per, "mae_s")
    return out


def consensus_direction_period(rows, now: datetime, holdout_days: int = HOLDOUT_DAYS, members=MEMBERS) -> Dict:
    """PURE: the held-out consensus direction/period evaluation over scored ledger rows (see the module docstring)."""
    cutoff = now - timedelta(days=holdout_days)
    keys: Dict[tuple, Dict[str, Dict]] = {}
    for r in rows or []:
        src = str(r.get("source"))
        if src not in members:
            continue
        t, lead = _parse(r.get("target_time")), _lead(r.get("lead_h"))
        if t is None or lead is None or t > now:
            continue
        keys.setdefault((r.get("buoy_id"), t.isoformat(), lead), {})[src] = dict(r, _t=t)
    by_lead: Dict[int, Dict[str, list]] = {}
    for (_, _, lead), got in keys.items():
        if len(got) != len(members):
            continue                                   # like with like: every member on every pair
        g = by_lead.setdefault(lead, {"train": [], "test": []})
        (g["train"] if got[members[0]]["_t"] < cutoff else g["test"]).append(got)
    out = []
    for lead, g in sorted(by_lead.items()):
        entry = {"lead_h": lead, "n_train": len(g["train"]), "n_test": len(g["test"])}
        if len(g["test"]) < MIN_N:
            out.append({**entry, "status": "insufficient"})
            continue
        entry.update({"status": "scored", "direction": _direction_block(g["test"], members),
                      "period": _period_block(g["train"], g["test"], members)})
        out.append(entry)
    return {"method": "three_model_consensus_direction_period", "members": list(members),
            "holdout_days": holdout_days, "cutoff": cutoff.isoformat(), "min_n": MIN_N,
            "dir_min_obs_hs_m": DIR_MIN_OBS_HS_M, "min_resultant": MIN_RESULTANT,
            "paired_keys": sum(e["n_train"] + e["n_test"] for e in out), "by_lead": out}
