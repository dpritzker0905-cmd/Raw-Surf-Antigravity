"""skill_ocf_idw.py: the `ocf_idw` arm of the 11-30 bias-correction test (measurement only; changes no served number).

RULE: docs/weather-program/log/2026-11-15-fable-idw-bias-arm-prereg.md, pushed 2026-11-15 23:03Z before any row dated
2026-11-16 or later existed. This file implements that rule and adds no freedom to it. The arm was ADDED LATE (11-15, after
the other arms were registered on 11-13), which the report states in `added_late`.

The arm has `ocf_region`'s form (skill_ocf): each member minus a bias, clipped at 0, then the equal mean. Only the bias
differs. For a held-out pair at buoy b it is the inverse-distance mean (weight 1 / d^2, d in km floored at 1, neighbours
within 500 km) of the TRAINING biases of the OTHER buoys on b's coast, NEVER b's own: a surf spot has no buoy, so the arm
is useful only if a neighbour's error predicts this place's. With no qualifying neighbour the pair takes the `ocf_region`
bias and is counted; a lead where more than half the held-out pairs fall back is NOT TESTED.

Per lead: PASS needs the day-block interval of the MAE gain over served above 0, no coast worse than served by more than
0.01 m, and the gain above the 97.5th percentile of the same arm with the training biases SHUFFLED among the buoys of each
coast (a gain that survives shuffling is the coast mean, which `ocf_region` already has). The paired gain over `ocf_region`
is reported and is not a gate. A planted +0.30 m on one coast must be removed by at least 0.25 m at every scored lead, or
the whole run is INVALID. Hole buoys are out of every pair, so out of the fit and the score.

Implementation detail the rule left open, chosen here before any scored run: the positive control's coast is the one
with the most held-out pairs at the first scored lead (ties broken by name)."""
import math
import random
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from services.weather_pipeline.skill_consensus import MEMBERS, MIN_TEST
from services.weather_pipeline.skill_mos import HOLDOUT_DAYS, MIN_TRAIN
from services.weather_pipeline.skill_ocf import BOOT_SEED, EXPECTED_LEADS, HOLE_BUOYS, _mean, _pairs

RULE_LOG = "docs/weather-program/log/2026-11-15-fable-idw-bias-arm-prereg.md"
ADDED_LATE = "2026-11-15"
MIN_BUOY_TRAIN = 20
REACH_KM = 500.0
FLOOR_KM = 1.0
DRAWS = 2000
NULL_SHUFFLES = 200
NULL_SEED = 20261130
REGION_TOLERANCE_M = 0.01
POS_DELTA_M = 0.30
POS_MIN_REMOVED_M = 0.25
ARMS = ("served", "ocf_region", "ocf_idw")


def km_between(a, b) -> float:
    """Great-circle distance in km between two (lat, lon) pairs in degrees."""
    la1, lo1, la2, lo2 = (math.radians(float(x)) for x in (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(min(1.0, math.sqrt(h)))


def _position(coords, buoy):
    p = (coords or {}).get(str(buoy).upper()) or (coords or {}).get(str(buoy))
    try:
        return (float(p[0]), float(p[1])) if p is not None else None
    except (TypeError, ValueError, IndexError):
        return None


def buoy_biases(train, members) -> Dict[str, Dict[str, float]]:
    """Mean (forecast - observation) per member for every buoy with at least MIN_BUOY_TRAIN training pairs."""
    by: Dict[str, List[dict]] = {}
    for p in train:
        by.setdefault(str(p["buoy"]), []).append(p)
    return {b: {m: _mean([p["fc"][m] - p["obs"] for p in ps]) for m in members}
            for b, ps in by.items() if len(ps) >= MIN_BUOY_TRAIN}


def predict_bias(buoy, region, biases, regions, coords, members) -> Optional[Dict[str, float]]:
    """The inverse-distance bias for `buoy` from the OTHER same-coast buoys, or None with no neighbour in reach."""
    here = _position(coords, buoy)
    if here is None:
        return None
    tot, acc = 0.0, {m: 0.0 for m in members}
    for other in sorted(biases):
        if other == str(buoy) or regions.get(other) != region:
            continue
        there = _position(coords, other)
        if there is None:
            continue
        d = km_between(here, there)
        if d > REACH_KM:
            continue
        w = 1.0 / max(d, FLOOR_KM) ** 2
        tot += w
        for m in members:
            acc[m] += w * biases[other][m]
    return {m: acc[m] / tot for m in members} if tot > 0 else None


def _coast_bias(train, members):
    """`ocf_region`'s bias: per coast with at least MIN_TRAIN training pairs, else the pooled bias; and buoy -> coast."""
    pooled = {m: _mean([p["fc"][m] - p["obs"] for p in train]) for m in members}
    by_region: Dict[str, Dict[str, float]] = {}
    for region in {p["region"] for p in train}:
        grp = [p for p in train if p["region"] == region]
        if len(grp) >= MIN_TRAIN:
            by_region[region] = {m: _mean([p["fc"][m] - p["obs"] for p in grp]) for m in members}
    return pooled, by_region, {str(p["buoy"]): p["region"] for p in train}


def _arm(train, test, members, coords, biases=None, coast=None):
    """Per held-out pair the three forecasts, and how many pairs fell back to the coast bias. `biases` overrides the
    per-buoy training biases (the shuffled null); `coast` reuses a `_coast_bias` result, which a shuffle does not change."""
    pooled, by_region, regions = coast or _coast_bias(train, members)
    if biases is None:
        biases = buoy_biases(train, members)
    pred: Dict[str, Optional[Dict[str, float]]] = {}
    fell, out = 0, []
    for p in test:
        b = str(p["buoy"])
        if b not in pred:
            pred[b] = predict_bias(b, p["region"], biases, regions, coords, members)
        reg = by_region.get(p["region"]) or pooled
        idw = pred[b]
        fell += idw is None
        fc = p["fc"]
        out.append({"served": fc[members[0]],
                    "ocf_region": max(0.0, _mean([fc[m] - reg[m] for m in members])),
                    "ocf_idw": max(0.0, _mean([fc[m] - (idw or reg)[m] for m in members]))})
    return out, fell, biases


def _gain(test, fcs, base: str, arm: str) -> float:
    return _mean([abs(f[base] - p["obs"]) - abs(f[arm] - p["obs"]) for p, f in zip(test, fcs)])


def paired_gain(test, fcs, base: str, arm: str) -> Dict:
    """MAE gain of `arm` over `base` (positive = better) with a 95% bootstrap interval over target DAYS."""
    days: Dict[str, list] = {}
    for p, f in zip(test, fcs):
        d = days.setdefault(p["t"].strftime("%Y-%m-%d"), [0.0, 0])
        d[0] += abs(f[base] - p["obs"]) - abs(f[arm] - p["obs"])
        d[1] += 1
    vals = list(days.values())
    out = {"gain_m": round(sum(g for g, _ in vals) / sum(c for _, c in vals), 4), "n_days": len(vals), "ci95_m": None}
    if len(vals) >= 3:
        rng = random.Random(BOOT_SEED)
        means = []
        for _ in range(DRAWS):
            draw = [vals[rng.randrange(len(vals))] for _ in vals]
            means.append(sum(g for g, _ in draw) / sum(c for _, c in draw))
        means.sort()
        out["ci95_m"] = [round(means[int(0.025 * DRAWS)], 4), round(means[int(0.975 * DRAWS) - 1], 4)]
    return out


def shuffled_null(train, test, members, coords, biases) -> Dict:
    """The arm's gain over served with the training biases shuffled among the buoys of each coast, NULL_SHUFFLES times."""
    coast = _coast_bias(train, members)
    regions = coast[2]
    groups: Dict[str, List[str]] = {}
    for b in sorted(biases):
        groups.setdefault(regions.get(b, "other"), []).append(b)
    rng = random.Random(NULL_SEED)
    gains = []
    for _ in range(NULL_SHUFFLES):
        shuffled = {}
        for names in groups.values():
            order = names[:]
            rng.shuffle(order)
            shuffled.update({dst: biases[src] for dst, src in zip(names, order)})
        fcs, _fell, _b = _arm(train, test, members, coords, biases=shuffled, coast=coast)
        gains.append(_gain(test, fcs, "served", "ocf_idw"))
    gains.sort()
    return {"shuffles": NULL_SHUFFLES, "seed": NULL_SEED, "p975_m": round(gains[int(0.975 * NULL_SHUFFLES) - 1], 4),
            "median_m": round(gains[NULL_SHUFFLES // 2], 4),
            "shufflable_coasts": sorted(r for r, names in groups.items() if len(names) >= 2)}


def _split(pairs, now, holdout_days):
    cutoff = now - timedelta(days=holdout_days)
    return [p for p in pairs if p["t"] < cutoff], [p for p in pairs if p["t"] >= cutoff]


def _lead_entry(lead, pairs, now, holdout_days, min_test, members, coords) -> Dict:
    train, test = _split(pairs, now, holdout_days)
    entry: Dict = {"lead_h": lead, "n_train": len(train), "n_test": len(test)}
    if len(train) < MIN_TRAIN or len(test) < min_test:
        return {**entry, "status": "insufficient", "verdict": "NOT TESTED"}
    fcs, fell, biases = _arm(train, test, members, coords)
    entry.update({"buoys_with_a_bias": len(biases), "fallback_to_region_bias": fell,
                  "n_buoys": len({str(p["buoy"]) for p in test})})
    if fell * 2 > len(test):
        return {**entry, "status": "mostly_fallback", "verdict": "NOT TESTED"}
    obs = [p["obs"] for p in test]
    entry["mae_m"] = {k: round(_mean([abs(f[k] - o) for f, o in zip(fcs, obs)]), 4) for k in ARMS}
    entry["bias_m"] = {k: round(_mean([f[k] - o for f, o in zip(fcs, obs)]), 4) for k in ARMS}
    entry["gain_over_served"] = paired_gain(test, fcs, "served", "ocf_idw")
    entry["gain_over_ocf_region"] = paired_gain(test, fcs, "ocf_region", "ocf_idw")      # reported, not a gate
    regions, worse = {}, []
    for region in sorted({p["region"] for p in test}):
        idx = [i for i, p in enumerate(test) if p["region"] == region]
        if len(idx) < min_test:
            regions[region] = {"n": len(idx), "status": "insufficient"}
            continue
        loss = -_gain([test[i] for i in idx], [fcs[i] for i in idx], "served", "ocf_idw")
        regions[region] = {"n": len(idx), "status": "scored", "worse_than_served_m": round(loss, 4)}
        if loss > REGION_TOLERANCE_M:
            worse.append(region)
    null = shuffled_null(train, test, members, coords, biases)
    ci = entry["gain_over_served"]["ci95_m"]
    entry.update({"by_region": regions, "worse_regions": worse, "null": null, "status": "scored",
                  "interval_above_zero": bool(ci and ci[0] > 0),
                  "null_beaten": bool(entry["gain_over_served"]["gain_m"] > null["p975_m"])})
    entry["verdict"] = "PASS" if (entry["interval_above_zero"] and not worse and entry["null_beaten"]) else "NOT SHOWN"
    return entry


def positive_control(by_lead_pairs, now, holdout_days, min_test, members, coords, scored_leads) -> Dict:
    """+POS_DELTA_M on every member at the buoys of one coast, in training AND held-out pairs: the arm must remove at
    least POS_MIN_REMOVED_M of it on that coast at every scored lead."""
    if not scored_leads:
        return {"status": "not_runnable", "recovered": None}
    _train, first_test = _split(by_lead_pairs[scored_leads[0]], now, holdout_days)
    counts: Dict[str, int] = {}
    for p in first_test:
        counts[p["region"]] = counts.get(p["region"], 0) + 1
    coast = sorted(counts, key=lambda r: (-counts[r], r))[0]
    out: Dict = {"coast": coast, "seeded_m": POS_DELTA_M, "must_remove_m": POS_MIN_REMOVED_M, "by_lead": {}}
    ok = True
    for lead in scored_leads:
        pairs = by_lead_pairs[lead]
        seeded = [{**p, "fc": {m: v + POS_DELTA_M for m, v in p["fc"].items()}} if p["region"] == coast else p for p in pairs]
        left = []
        for ps in (pairs, seeded):
            train, test = _split(ps, now, holdout_days)
            fcs, _fell, _b = _arm(train, test, members, coords)
            sel = [f["ocf_idw"] - p["obs"] for p, f in zip(test, fcs) if p["region"] == coast]
            left.append(_mean(sel) if sel else None)
        if left[0] is None or left[1] is None:
            out["by_lead"][str(lead)] = {"status": "no_pairs_on_coast"}
            ok = False
            continue
        removed = POS_DELTA_M - (left[1] - left[0])
        out["by_lead"][str(lead)] = {"removed_m": round(removed, 4), "recovered": bool(removed >= POS_MIN_REMOVED_M)}
        ok = ok and removed >= POS_MIN_REMOVED_M
    out["recovered"] = bool(ok)
    return out


def idw_report(rows, now: datetime, coords, holdout_days: int = HOLDOUT_DAYS, min_test: int = MIN_TEST,
               members=MEMBERS, expected_leads=EXPECTED_LEADS, exclude_buoys=HOLE_BUOYS) -> Dict:
    """PURE: the `ocf_idw` arm on scored ledger rows and a {STATION: (lat, lon)} map (see the module docstring)."""
    by_lead_pairs = _pairs(rows, now, members, exclude_buoys)
    by_lead = [_lead_entry(lead, by_lead_pairs[lead], now, holdout_days, min_test, members, coords)
               for lead in sorted(by_lead_pairs)]
    scored = [e["lead_h"] for e in by_lead if e.get("status") == "scored"]
    control = positive_control(by_lead_pairs, now, holdout_days, min_test, members, coords, scored)
    buoys = sorted({str(p["buoy"]) for ps in by_lead_pairs.values() for p in ps})
    missing_leads = [l for l in expected_leads if l not in scored]
    if scored and control.get("recovered") is False:
        verdict = "INVALID"
    elif missing_leads:
        verdict = "NOT TESTED"
    else:
        verdict = "PASS" if all(e["verdict"] == "PASS" for e in by_lead if e["lead_h"] in expected_leads) else "NOT SHOWN"
    return {"method": "ocf_idw_leave_self_out_inverse_distance_bias", "rule": RULE_LOG, "added_late": ADDED_LATE,
            "note": ("one arm added on 2026-11-15, after the other arms were registered; six variants are compared beside "
                     "served with no multiplicity correction; a PASS is not a served change"),
            "members": list(members), "exclude_buoys": sorted({str(b) for b in exclude_buoys}),
            "holdout_days": holdout_days, "cutoff": (now - timedelta(days=holdout_days)).isoformat(),
            "reach_km": REACH_KM, "power": 2, "min_buoy_train": MIN_BUOY_TRAIN, "draws": DRAWS,
            "region_tolerance_m": REGION_TOLERANCE_M,
            "positions": {b: list(_position(coords, b)) for b in buoys if _position(coords, b) is not None},
            "buoys_without_a_position": [b for b in buoys if _position(coords, b) is None],
            "by_lead": by_lead, "leads_scored": scored, "expected_leads": list(expected_leads),
            "missing_leads": missing_leads, "positive_control": control, "verdict": verdict}
