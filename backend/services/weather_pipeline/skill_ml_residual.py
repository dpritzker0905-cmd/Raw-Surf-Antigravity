"""SHADOW measurement: a gradient-boosted residual correction of offshore wave height, against Move 4's ocf_rolling.

Pre-registered in docs/weather-program/log/2026-11-16-claude-verifier-ml-residual-shadow.md (section 1, fe5a9143f, before
any row was read). Serves nothing. scikit-learn and numpy are imported lazily, so the module imports anywhere; the
dispatch-only workflow pins them.

Pairs: one (buoy, target, lead) where `raw_surf`, `raw_surf:EURO` and `raw_surf:ICON` all scored the same observation.
Target: observed minus served. Cross-validation: leave-buoy-group-out AND forward 7-day blocks, so no prediction comes
from a model that saw its buoy or its future. Hole buoys are out of the fit and the score.
"""
import hashlib
import math
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

from services.weather_pipeline.skill_consensus import region_of
from services.weather_pipeline.skill_ocf import HOLE_BUOYS, MIN_WINDOW, ROLL_DAYS, _Rolling

SERVED, EURO, ICON = "raw_surf", "raw_surf:EURO", "raw_surf:ICON"
MEMBERS = (SERVED, ICON, EURO)            # skill_consensus.MEMBERS' order (served first)
LEADS = (24, 48, 72)
GROUPS = 5
BLOCK_DAYS = 7
BLOCK_ORIGIN = datetime(2026, 8, 1, tzinfo=timezone.utc)
MIN_TRAIN = 2000
PLANT_M, PLANT_TP = 0.30, 12.0
SEED = 20261116
REGIONS = ("atlantic_ne", "atlantic_se", "gulf", "hawaii", "other", "pacific_ne")
FEATURES = ("lead", "hs", "tp", "dir_s", "dir_c", "wind", "wf_s", "wf_c", "hs_euro", "hs_icon", "spread",
            "doy_s", "doy_c", "region")
HGB = dict(loss="absolute_error", learning_rate=0.05, max_iter=300, max_leaf_nodes=15, min_samples_leaf=50,
           l2_regularization=1.0, early_stopping=False, random_state=SEED)


def _f(v) -> Optional[float]:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != math.inf else None


def _t(v) -> Optional[datetime]:
    if not isinstance(v, str):
        return None
    try:
        t = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def build_pairs(rows) -> List[dict]:
    """Paired three-member keys with the same verifying observation; hole buoys dropped."""
    holes = {str(b) for b in HOLE_BUOYS}
    by = {}
    for r in rows or []:
        s = r.get("source")
        if s not in MEMBERS or str(r.get("buoy_id")) in holes:
            continue
        hs, obs = _f(r.get("hs_m")), _f(r.get("obs_hs_m"))
        t = _t(r.get("target_time"))
        if hs is None or hs <= 0 or obs is None or obs < 0 or t is None or not r.get("obs_time"):
            continue
        lead = int(round((r.get("lead_h") or 0) / 24.0)) * 24
        if lead not in LEADS:
            continue
        by.setdefault((str(r.get("buoy_id")), t, lead), {})[s] = r
    out = []
    for (buoy, t, lead), got in by.items():
        if len(got) != 3:
            continue
        o = {(g.get("obs_time"), g.get("obs_hs_m")) for g in got.values()}
        if len(o) != 1:
            continue
        sv = got[SERVED]
        rad = lambda d: math.radians(d) if d is not None else None  # noqa: E731
        di, wf = rad(_f(sv.get("dir_deg"))), rad(_f(sv.get("wind_from_deg")))
        doy = 2 * math.pi * t.timetuple().tm_yday / 365.25
        hs3 = [float(got[m]["hs_m"]) for m in MEMBERS]
        reg = region_of(buoy)
        out.append({"buoy": buoy, "t": t, "lead": lead, "region": reg, "obs": float(sv["obs_hs_m"]),
                    "fc": {m: float(got[m]["hs_m"]) for m in MEMBERS},
                    "x": [lead, hs3[0], _f(sv.get("tp_s")), math.sin(di) if di is not None else None,
                          math.cos(di) if di is not None else None, _f(sv.get("wind_kt")),
                          math.sin(wf) if wf is not None else None, math.cos(wf) if wf is not None else None,
                          float(got[EURO]["hs_m"]), float(got[ICON]["hs_m"]), max(hs3) - min(hs3),
                          math.sin(doy), math.cos(doy), REGIONS.index(reg) if reg in REGIONS else len(REGIONS)]})
    out.sort(key=lambda p: (p["t"], p["buoy"], p["lead"]))
    return out


def buoy_group(buoy: str) -> int:
    return int(hashlib.sha256(buoy.encode()).hexdigest(), 16) % GROUPS


def block_of(t: datetime) -> int:
    return int((t - BLOCK_ORIGIN).total_seconds() // (BLOCK_DAYS * 86400))


def ocf_rolling(pairs: List[dict], members=MEMBERS) -> Dict[int, float]:
    """{id(pair): Move 4's ocf_rolling forecast}: the members' equal mean, each minus its own 14-day per-region bias as of
    issue time; when that window holds < MIN_WINDOW pairs, the member's bias over all earlier pairs of the coast, else 0.
    members=(SERVED,) gives the served lane minus its own rolling bias (printed beside, not gating)."""
    out = {}
    for lead in LEADS:
        lp = [p for p in pairs if p["lead"] == lead]
        roll = _Rolling(lp, members)
        for p in lp:
            issue = p["t"] - timedelta(hours=lead)
            rb, n = roll.bias(p["region"], issue - timedelta(days=ROLL_DAYS), issue)
            if rb is None or n < MIN_WINDOW:
                rb, n2 = roll.bias(p["region"], datetime(2000, 1, 1, tzinfo=timezone.utc), issue)
                rb = rb if (rb is not None and n2 >= MIN_WINDOW) else {m: 0.0 for m in members}
            out[id(p)] = max(0.0, sum(p["fc"][m] - rb[m] for m in members) / len(members))
    return out


def cross_validate(pairs: List[dict], plant: bool = False, null: bool = False) -> Dict[int, float]:
    """{id(pair): out-of-sample predicted residual} under leave-buoy-group-out x forward blocks. plant: +PLANT_M on the
    observation where served tp >= PLANT_TP (train and test). null: training labels permuted per test cell."""
    import numpy as np
    from sklearn.ensemble import HistGradientBoostingRegressor

    def y_of(p):
        bump = PLANT_M if (plant and p["x"][2] is not None and p["x"][2] >= PLANT_TP) else 0.0
        return p["obs"] + bump - p["fc"][SERVED]

    def mat(ps):
        return np.array([[np.nan if v is None else v for v in p["x"]] for p in ps], dtype=float)

    preds = {}
    blocks = sorted({block_of(p["t"]) for p in pairs})
    for b in blocks:
        start = BLOCK_ORIGIN + timedelta(days=BLOCK_DAYS * b)
        cutoff = start - timedelta(hours=72)
        for g in range(GROUPS):
            test = [p for p in pairs if block_of(p["t"]) == b and buoy_group(p["buoy"]) == g]
            if not test:
                continue
            train = [p for p in pairs if p["t"] < cutoff and buoy_group(p["buoy"]) != g]
            if len(train) < MIN_TRAIN:
                continue
            y = np.array([y_of(p) for p in train])
            if null:
                np.random.default_rng(SEED + 1000 * b + g).shuffle(y)
            model = HistGradientBoostingRegressor(categorical_features=[FEATURES.index("region")], **HGB)
            model.fit(mat(train), y)
            for p, r in zip(test, model.predict(mat(test))):
                preds[id(p)] = float(r)
    return preds


def block_interval(diffs: List[float], days: List[str], block_days: int, draws: int = 2000, seed: int = SEED):
    """95% day-block bootstrap of the mean of `diffs` (numpy, block sums). None with < 3 blocks."""
    import numpy as np
    if not diffs:
        return None
    first = min(days)
    sums, counts = {}, {}
    for d, day in zip(diffs, days):
        k = (datetime.fromisoformat(day) - datetime.fromisoformat(first)).days // block_days
        sums[k] = sums.get(k, 0.0) + d
        counts[k] = counts.get(k, 0) + 1
    ks = sorted(sums)
    if len(ks) < 3:
        return None
    s = np.array([sums[k] for k in ks])
    c = np.array([counts[k] for k in ks])
    idx = np.random.default_rng(seed).integers(0, len(ks), size=(draws, len(ks)))
    means = np.sort(s[idx].sum(axis=1) / c[idx].sum(axis=1))
    return float(means[int(0.025 * draws)]), float(means[min(draws - 1, int(0.975 * draws))])


def grade(pairs: List[dict], ml: Dict[int, float], base: Dict[int, float]):
    """Per lead pooled and per region x lead: n, MAE(ML), MAE(base), dMAE and intervals; only pairs both scored."""
    out = {"pooled": {}, "regions": {}}
    for lead in LEADS:
        ps = [p for p in pairs if p["lead"] == lead and id(p) in ml and id(p) in base]
        cells = {"all": ps}
        for p in ps:
            cells.setdefault(p["region"], []).append(p)
        for name, cp in cells.items():
            if not cp:
                continue
            e_ml = [abs(max(0.0, p["fc"][SERVED] + ml[id(p)]) - p["obs"]) for p in cp]
            e_b = [abs(base[id(p)] - p["obs"]) for p in cp]
            diffs = [a - b for a, b in zip(e_ml, e_b)]
            days = [f"{p['t']:%Y-%m-%d}" for p in cp]
            rec = {"n": len(cp), "buoys": len({p["buoy"] for p in cp}), "days": len(set(days)),
                   "mae_ml": sum(e_ml) / len(cp), "mae_base": sum(e_b) / len(cp), "dmae": sum(diffs) / len(cp),
                   "i3": block_interval(diffs, days, 3), "i1": block_interval(diffs, days, 1)}
            (out["pooled"] if name == "all" else out["regions"])[lead if name == "all" else (name, lead)] = rec
    return out


def verdict(main, null_g, plant_shift, coverage_ok):
    """(call, reasons) by the pre-registered rule."""
    reasons = []
    null_g1 = [lead for lead in LEADS if (c := null_g["pooled"].get(lead)) and c["i3"] and c["i3"][1] < 0]
    if null_g1:
        reasons.append("N: the shuffled-label null meets G1 at %s" % null_g1)
    if not (plant_shift["planted"] is not None and plant_shift["planted"] >= PLANT_M / 2
            and plant_shift["other"] is not None and abs(plant_shift["other"]) <= 0.05):
        reasons.append("P: planted shift recovered %s (need >= %.2f), others %s (need within 0.05)"
                       % (plant_shift["planted"], PLANT_M / 2, plant_shift["other"]))
    if not coverage_ok:
        reasons.append("coverage short")
    if reasons:
        return "VOID", reasons
    g1 = [lead for lead in LEADS if not ((c := main["pooled"].get(lead)) and c["i3"] and c["i3"][1] < 0)]
    g2 = [k for k, c in main["regions"].items() if c["n"] >= 100 and c["days"] >= 7 and c["i3"] and c["i3"][0] > 0]
    if g1 or g2:
        return "FAIL", (["G1 not met at %s" % g1] if g1 else []) + (["G2: worse in %s" % g2] if g2 else [])
    return "PASS", []


def plant_recovery(pairs, clean: Dict[int, float], planted: Dict[int, float]) -> Dict[str, Optional[float]]:
    a = [planted[id(p)] - clean[id(p)] for p in pairs if id(p) in clean and id(p) in planted
         and p["x"][2] is not None and p["x"][2] >= PLANT_TP]
    b = [planted[id(p)] - clean[id(p)] for p in pairs if id(p) in clean and id(p) in planted
         and not (p["x"][2] is not None and p["x"][2] >= PLANT_TP)]
    return {"planted": sum(a) / len(a) if a else None, "other": sum(b) / len(b) if b else None,
            "n_planted": len(a), "n_other": len(b)}

