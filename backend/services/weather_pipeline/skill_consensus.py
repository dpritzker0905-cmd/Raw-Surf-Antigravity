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
  * `weighted` (2026-09-28): the debiased members weighted by 1 / their debiased MSE on the training rows, so a
    weaker model counts for less. Measured the same day: over the held-out week our ICON lane's MAE is ~40%
    above the GFS and EURO lanes (0.44 vs 0.33 m at 48 h) with a slope of 0.65, and it is DWD's GWAM itself
    (ours 2.725 m vs Open-Meteo's dwd_gwam 2.70 m at 46086), not our pipeline, so it stays a member, weighted.
  * `pair_gfs_euro` (2026-09-29): the plain mean of the served GFS lane and EURO, i.e. the equal mean WITHOUT ICON.
    The nearshore judge's consensus arm (#155) graded the members after the transform on identical hours: GFS 0.156,
    equal mean 0.117, EURO alone 0.102, ICON 0.203 m (ICON +0.12 m high), so dropping ICON is the next candidate.
    Scored on the SAME pairs as the equal mean (all three members present), so the two compare like with like.
  * `by_region` (2026-09-29): the same held-out pairs, pooled over the leads, split by coast. GFS-Wave's input bias
    changes SIGN by region (Florida east x1.10-1.27 HIGH; SoCal x0.85-0.89 and the Gulf x0.54-0.85 LOW, measured
    2026-09-28), so which consensus helps depends on where, and one global MAE can hide a candidate that wins on
    one coast and loses on another.
  * `by_band` (2026-09-29): the same held-out pairs split by the OBSERVED sea state (forecast_skill.OBS_BANDS: flat
    <0.5 m, small 0.5-1.5, rideable 1.5-3, big >3), with `equal_over_primary` -- the median ratio of the equal mean to
    the served lane's own forecast. The ratio is what a surfer would SEE move: on the Florida east tile at 06Z on
    2026-09-29 (GFS 0.30 m, EURO 0.52, ICON 0.67 median) the equal mean was x1.31 the served height at the median cell
    and x3.6 at p90, because calm-sea denominators are small. An all-sea MAE cannot show that.
  * Graded on the held-out week against each member and the best of them. Thin leads refuse with a status.

Changes no served number.
"""
import math
from datetime import datetime, timedelta
from typing import Dict, List

from services.weather_pipeline.skill_mos import HOLDOUT_DAYS, _lead, _parse

MEMBERS = ("raw_surf", "raw_surf:ICON", "raw_surf:EURO")
PAIR = ("raw_surf", "raw_surf:EURO")      # the served GFS lane + EURO: the equal mean without ICON
# NDBC's WMO numbering carries the region in the first two digits of a five-digit station id.
NDBC_REGIONS = {"41": "atlantic_se", "42": "gulf", "44": "atlantic_ne", "46": "pacific_ne", "51": "hawaii"}


def region_of(buoy_id) -> str:
    """The coast a ledger buoy sits on, from its NDBC id; "other" for anything that is not a five-digit id in a
    listed region (CDIP-only ids, the western Pacific, Europe). PURE."""
    s = str(buoy_id or "")
    return NDBC_REGIONS.get(s[:2], "other") if len(s) == 5 and s.isdigit() else "other"
MIN_TEST = 10
# BIG SWELL (2026-09-28): a mean is smoother than any member, so it can shave the peaks of the days that matter
# most for surf, and the all-sea MAE would hide that behind the many small days. Two selections, as #132 taught:
# `paired` takes the hours whose OBSERVED Hs >= 3 m and grades every forecast on those SAME hours (the selection
# biases all of them low alike, so the comparison between them stays fair; a consensus that shaves peaks loses
# here); `by_forecast` selects each forecast's own >= 3 m calls (its calibration where it claims big surf).
BIG_SWELL_M = 3.0


def _ok(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _stats(errs: List[float]) -> Dict[str, float]:
    return {"mae_m": round(sum(abs(e) for e in errs) / len(errs), 3), "bias_m": round(sum(errs) / len(errs), 3)}


def _big_swell(fc: Dict[str, List[float]], obs: List[float], members, min_test: int) -> Dict:
    """Held-out big-swell grades for each member and the equal/weighted consensus (see BIG_SWELL_M)."""
    idx = [i for i, o in enumerate(obs) if o >= BIG_SWELL_M]
    out: Dict = {"threshold_m": BIG_SWELL_M, "paired_n": len(idx)}
    if len(idx) >= min_test:
        out["paired"] = {k: _stats([f[i] - obs[i] for i in idx]) for k, f in fc.items()}
        best = min(members, key=lambda m: out["paired"][m]["mae_m"])
        out["paired_best_member"] = best
        out["weighted_beats_best"] = out["paired"]["weighted"]["mae_m"] < out["paired"][best]["mae_m"]
        if "pair_gfs_euro" in out["paired"]:
            out["pair_beats_best"] = out["paired"]["pair_gfs_euro"]["mae_m"] < out["paired"][best]["mae_m"]
    else:
        out["status"] = "insufficient"
    out["by_forecast"] = {}
    for k, f in fc.items():
        sel = [f[i] - obs[i] for i in range(len(obs)) if f[i] >= BIG_SWELL_M]
        out["by_forecast"][k] = {"n": len(sel), **(_stats(sel) if len(sel) >= min_test else {})}
    return out


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
    held_out_by_region: Dict[str, list] = {}
    held_out_by_band: Dict[str, list] = {}
    from services.weather_pipeline.forecast_skill import obs_band     # lazy: forecast_skill imports this module
    for (buoy, _, lead), got in keys.items():
        if len(got) != len(members):
            continue                                   # like with like: every member on every pair
        t = next(iter(got.values()))[2]
        by_lead.setdefault(lead, {"train": [], "test": []})["test" if t >= cutoff else "train"].append(got)
        if t >= cutoff:
            held_out_by_region.setdefault(region_of(buoy), []).append(got)
            band = obs_band(next(iter(got.values()))[1])
            if band:
                held_out_by_band.setdefault(band, []).append(got)
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
        mse = {m: (sum((p[m][0] - bias[m] - p[m][1]) ** 2 for p in g["train"]) / len(g["train"])
                   if g["train"] else 1.0) for m in members}
        inv = {m: 1.0 / max(v, 1e-6) for m, v in mse.items()}
        weight = {m: inv[m] / sum(inv.values()) for m in members}
        weighted = [sum(weight[m] * (p[m][0] - bias[m]) for m in members) for p in g["test"]]
        best = min(members, key=lambda m: per[m]["mae_m"])
        entry.update({
            "status": "scored", "members": per, "best_member": best,
            "member_bias_train_m": {m: round(b, 3) for m, b in bias.items()},
            "equal": _stats([f - o for f, o in zip(equal, obs)]),
            "debiased": _stats([max(0.0, f) - o for f, o in zip(debiased, obs)]),
            "member_weight": {m: round(w, 3) for m, w in weight.items()},
            "weighted": _stats([max(0.0, f) - o for f, o in zip(weighted, obs)]),
        })
        entry["equal_beats_best"] = entry["equal"]["mae_m"] < per[best]["mae_m"]
        entry["debiased_beats_best"] = entry["debiased"]["mae_m"] < per[best]["mae_m"]
        entry["weighted_beats_best"] = entry["weighted"]["mae_m"] < per[best]["mae_m"]
        fc = {m: [p[m][0] for p in g["test"]] for m in members}
        fc["equal"], fc["weighted"] = equal, [max(0.0, f) for f in weighted]
        if all(m in members for m in PAIR):
            pair = [sum(p[m][0] for m in PAIR) / len(PAIR) for p in g["test"]]
            entry["pair_gfs_euro"] = _stats([f - o for f, o in zip(pair, obs)])
            entry["pair_beats_best"] = entry["pair_gfs_euro"]["mae_m"] < per[best]["mae_m"]
            entry["pair_beats_equal"] = entry["pair_gfs_euro"]["mae_m"] < entry["equal"]["mae_m"]
            fc["pair_gfs_euro"] = pair
        entry["big_swell"] = _big_swell(fc, obs, members, min_test)
        out.append(entry)
    return {"method": "three_model_consensus_equal_debiased_weighted", "members": list(members),
            "holdout_days": holdout_days, "cutoff": cutoff.isoformat(),
            "paired_keys": sum(e["n_train"] + e["n_test"] for e in out), "by_lead": out,
            "by_region": _graded_groups(held_out_by_region, members, min_test),
            "by_band": _graded_groups(held_out_by_band, members, min_test)}


def _graded_groups(groups: Dict[str, list], members, min_test: int) -> Dict:
    """Held-out pairs per group (a coast, a sea-state band), pooled over the leads: each member, the equal mean and
    (with GFS and EURO among the members) the pair, as MAE and bias; the best member; whether the equal mean or the
    pair beats it; and `equal_over_primary`, the median equal-mean / served-lane (members[0]) forecast ratio."""
    out = {}
    for region, pairs in sorted(groups.items()):
        if len(pairs) < min_test:
            out[region] = {"n": len(pairs), "status": "insufficient"}
            continue
        obs = [p[members[0]][1] for p in pairs]
        per = {m: _stats([p[m][0] - p[m][1] for p in pairs]) for m in members}
        best = min(members, key=lambda m: per[m]["mae_m"])
        entry = {"n": len(pairs), "status": "scored", "members": per, "best_member": best,
                 "equal": _stats([sum(p[m][0] for m in members) / len(members) - o for p, o in zip(pairs, obs)])}
        entry["equal_beats_best"] = entry["equal"]["mae_m"] < per[best]["mae_m"]
        ratios = sorted(sum(p[m][0] for m in members) / len(members) / p[members[0]][0] for p in pairs)
        entry["equal_over_primary"] = {"p10": round(ratios[len(ratios) // 10], 3),
                                       "median": round(ratios[len(ratios) // 2], 3),
                                       "p90": round(ratios[min(len(ratios) - 1, 9 * len(ratios) // 10)], 3)}
        if all(m in members for m in PAIR):
            entry["pair_gfs_euro"] = _stats([sum(p[m][0] for m in PAIR) / len(PAIR) - o for p, o in zip(pairs, obs)])
            entry["pair_beats_best"] = entry["pair_gfs_euro"]["mae_m"] < per[best]["mae_m"]
        out[region] = entry
    return out
