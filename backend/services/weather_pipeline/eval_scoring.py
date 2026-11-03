"""eval_scoring.py - truth joins, baselines, scores and controls for the evaluation harness. PURE (no I/O).

QUANTITIES (each scored against a truth it can honestly be compared with; `QUANTITIES` holds the definitions):
  hs_station   PRIMARY. The served chain's components evaluated at the CDIP buoy's depth
               (nearshore_validation.model_hs_at_station, input = the served offshore field at the anchor spot,
               geometry = the station's) vs the buoy's Hs. A measured quantity on both sides: no proxy.
  hb_proxy     The served BREAKING height (rate_one_spot's surf_height_m at the anchor spot) vs a FIXED observation
               operator applied to the buoy: deshoal Hs from the station depth (linear theory), then Komar & Gaughan
               (1972) Hb = 0.56 H0 (H0/L0)^(-1/5). Frozen here, independent of the served code, so a candidate that
               changes the transform cannot move its own truth. It is a PROXY: its absolute bias mixes the served
               convention (H1/10, Kr) with forecast error. Read DIFFERENCES between arms, never its bias alone.
  hs_offshore  The served offshore Hs (marine point.speed) at an NDBC buoy vs WVHT: verification of the INPUT.

BASELINES (forecasts built from truth alone, available at issue time):
  persistence  the QC-good observation at or before the cycle time t0 (within 90 min), held for every lead;
  climatology  the station's mean over its truth panel EXCLUDING the target's ISO week (station x week holdout).

SCORES: bias, MAE, RMSE, SI, HH (gate_v2_stats.point_metrics); CRPS (a deterministic forecast's CRPS IS its
absolute error, so CRPS == MAE until an ensemble or spread arm exists: `crps_kind` says which); threshold-weighted
CRPS above the observed p90 (twCRPS, Allen et al. 2023: CRPS of the chained values max(x, t)); top-decile bias.
"""
import math
import random
from typing import Callable, Dict, List, Optional, Sequence, Tuple

from services.weather_pipeline import gate_v2_stats as st
from services.weather_pipeline import eval_reference as ref

G = 9.80665
MATCH_TOL_S = 1800.0          # the nearshore lane's tolerance (nearshore_validation.match)
PERSIST_TOL_S = 5400.0
CLUSTER_BINDING_MIN = 10      # stations needed before the station-cluster bootstrap CI becomes a gate rule
QUANTITIES = {
    "hs_station": {"role": "nearshore", "units": "m", "truth": "CDIP Hs (waveFlagPrimary == 1)",
                   "forecast": "nearshore_validation.model_hs_at_station(served offshore field at the anchor spot)"},
    "hb_proxy": {"role": "nearshore", "units": "m", "truth": "Komar-Gaughan 1972 on deshoaled CDIP Hs/Tp (PROXY)",
                 "forecast": "rate_one_spot surf_height_m at the anchor spot"},
    "hs_offshore": {"role": "offshore", "units": "m", "truth": "NDBC WVHT (realtime2)",
                    "forecast": "served marine point.speed at the buoy"},
}


# ---- the frozen proxy operator -------------------------------------------------------------------------------------
def wavenumber(t_s: float, depth_m: float) -> float:
    """Linear dispersion w^2 = g k tanh(k h), Newton from the deep-water guess."""
    w = 2 * math.pi / t_s
    k = w * w / G
    for _ in range(50):
        th = math.tanh(k * depth_m)
        f = G * k * th - w * w
        df = G * th + G * k * depth_m * (1 - th * th)
        step = f / df
        k -= step
        if abs(step) < 1e-12 * k:
            break
    return k


def shoaling_ks(t_s: float, depth_m: float) -> float:
    k = wavenumber(t_s, depth_m)
    kh = k * depth_m
    n = 0.5 * (1 + (2 * kh / math.sinh(2 * kh) if kh < 20 else 0.0))
    c = (G / k * math.tanh(kh)) ** 0.5
    cg0 = 0.5 * G * t_s / (2 * math.pi)
    return math.sqrt(cg0 / (n * c))


def hb_proxy(hs_m: Optional[float], tp_s: Optional[float], depth_m: float) -> Optional[float]:
    if not hs_m or not tp_s or hs_m <= 0 or tp_s <= 0 or depth_m <= 0:
        return None
    h0 = hs_m / shoaling_ks(tp_s, depth_m)
    l0 = G * tp_s * tp_s / (2 * math.pi)
    return 0.56 * h0 * (h0 / l0) ** (-0.2)


# ---- truth panels ----------------------------------------------------------------------------------------------
def truth_value(quantity: str, o: dict, depth_m: float) -> Optional[float]:
    if quantity == "hb_proxy":
        return hb_proxy(o.get("hs_m"), o.get("tp_s"), depth_m)
    return o.get("hs_m")


def _forecast(quantity: str, row: dict) -> Optional[float]:
    if quantity == "hs_station":
        return row.get("hs_station_m")
    if quantity == "hb_proxy":
        return (row.get("outputs") or {}).get("surf_height_m")
    return (row.get("inputs") or {}).get("offshore_hs_m")


def _iso_week(t) -> str:
    y, w, _ = t.isocalendar()
    return f"{y}-W{w:02d}"


def climatology(obs_good: List[dict], quantity: str, depth_m: float) -> Dict[str, Tuple[float, int]]:
    """{iso week: (mean over every OTHER week, n)} of the station's quantity."""
    by_w: Dict[str, List[float]] = {}
    for o in obs_good:
        v = truth_value(quantity, o, depth_m)
        if v is not None:
            by_w.setdefault(_iso_week(o["time"]), []).append(v)
    tot, n = sum(sum(v) for v in by_w.values()), sum(len(v) for v in by_w.values())
    return {w: ((tot - sum(v)) / (n - len(v)), n - len(v)) for w, v in by_w.items() if n - len(v) > 0}


def build_items(quantity: str, rows: Sequence[dict], truth_by_station: Dict[str, dict], stations: Dict[str, dict],
                hull_of: Callable = None) -> Tuple[Dict[tuple, dict], dict]:
    """({(station, valid, lead): item}, qc counts) for ONE arm's rows. An item holds obs, f, the two baselines and
    the observed Hs/Tp. Only anchor rows of the quantity's role; one item per key."""
    qc = {"rows": 0, "no_forecast": 0, "no_truth": 0, "no_persistence": 0, "no_climatology": 0, "items": 0,
          "truth_dt_s_p50": None, "persistence_age_s_p50": None}
    dts, ages = [], []
    role = QUANTITIES[quantity]["role"]
    clim_cache, out = {}, {}
    for r in rows:
        if r.get("role") != role or not r.get("anchor"):
            continue
        qc["rows"] += 1
        sid = r["station"]
        st_ = stations[sid]
        depth = float(st_.get("depth_m") or 20.0)
        f = _forecast(quantity, r)
        if f is None or not math.isfinite(f):
            qc["no_forecast"] += 1
            continue
        good = truth_by_station.get(sid) or []
        t = _parse(r["valid"])
        o = ref.nearest(good, t, MATCH_TOL_S)
        obs = truth_value(quantity, o, depth) if o else None
        if obs is None:
            qc["no_truth"] += 1
            continue
        t0 = _parse(r["cycle"])
        p = ref.nearest(good, t0, PERSIST_TOL_S, before_only=True)
        pv = truth_value(quantity, p, depth) if p else None
        if sid not in clim_cache:
            clim_cache[sid] = climatology(good, quantity, depth)
        cv = clim_cache[sid].get(_iso_week(t), (None, 0))[0]
        dts.append(abs((o["time"] - t).total_seconds()))
        if p is not None:
            ages.append((t0 - p["time"]).total_seconds())
        qc["no_persistence"] += pv is None
        qc["no_climatology"] += cv is None
        hull = hull_of(sid, t) if hull_of else ("waverider" if st_["source"] == "cdip" else "unknown")
        out[(sid, t, int(r["lead_h"]))] = {"buoy": sid, "t": t, "lead": int(r["lead_h"]), "obs": obs, "f": f,
                                           "persistence": pv, "climatology": cv, "obs_hs": o["hs_m"],
                                           "dpd": o.get("tp_s"), "hull": hull, "hull_inferred": False, "multi": None,
                                           "score": (r.get("outputs") or {}).get("score"),
                                           "level": (r.get("outputs") or {}).get("level")}
    qc["items"] = len(out)
    qc["truth_dt_s_p50"], qc["persistence_age_s_p50"] = quantile(dts, 0.5), quantile(ages, 0.5)
    return out, qc


def pair(ref_items: Dict[tuple, dict], cand: dict, cand_field: str = "f",
         ref_field: str = "f") -> List[dict]:
    """gate_v2 items {buoy, t, lead, obs, f_ref, f_cand, obs_hs, hull, ...} on the keys both sides hold."""
    out = []
    for k, it in sorted(ref_items.items(), key=lambda kv: (kv[0][1], kv[0][0], kv[0][2])):
        c = cand.get(k) if isinstance(cand, dict) else None
        cv = c.get(cand_field) if isinstance(c, dict) else c
        rv = it.get(ref_field)
        if cv is None or rv is None:
            continue
        out.append(dict(it, f_ref=rv, f_cand=cv))
    return out


def _parse(s):
    from services.weather_pipeline.eval_replay import parse_time
    return parse_time(s) if isinstance(s, str) else s


# ---- scores -----------------------------------------------------------------------------------------------------
def twcrps_point(f: float, o: float, thr: float) -> float:
    """Threshold-weighted CRPS, weight 1{z >= thr}, of a POINT forecast: |max(f, thr) - max(o, thr)|."""
    return abs(max(f, thr) - max(o, thr))


def quantile(xs: Sequence[float], q: float) -> Optional[float]:
    s = sorted(x for x in xs if x is not None and math.isfinite(x))
    if not s:
        return None
    pos = q * (len(s) - 1)
    lo = int(math.floor(pos))
    return s[lo] + (s[min(lo + 1, len(s) - 1)] - s[lo]) * (pos - lo)


def arm_scores(items: Sequence[dict], field: str, thr: Optional[float], min_n: int = 10) -> Optional[dict]:
    """Point metrics + CRPS + twCRPS + top-decile bias of forecast `field` against obs."""
    fo = [(i[field], i["obs"]) for i in items if i.get(field) is not None]
    if len(fo) < min_n:
        return {"n": len(fo), "suppressed": True}
    m = st.point_metrics([f for f, _ in fo], [o for _, o in fo], min_n)
    m["crps"], m["crps_kind"] = m["mae"], "deterministic (CRPS == absolute error)"
    if thr is not None:
        m["twcrps_p90"] = st.mean([twcrps_point(f, o, thr) for f, o in fo])
        top = [(f, o) for f, o in fo if o >= thr]
        m["top_decile_n"] = len(top)
        m["top_decile_bias"] = st.mean([f - o for f, o in top]) if top else None
    return m


def twcrps_series(items: Sequence[dict], thr: float) -> List[float]:
    """Per target hour, mean twCRPS(ref) - twCRPS(cand): positive = candidate better above the p90."""
    return st.series_by_time(items, lambda i: twcrps_point(i["f_ref"], i["obs"], thr)
                             - twcrps_point(i["f_cand"], i["obs"], thr))


def twcrps_test(items: Sequence[dict], thr: Optional[float], cfg) -> Optional[dict]:
    if thr is None:
        return None
    d = twcrps_series(items, thr)
    if not d:
        return None
    dep = st.dependence(d, cfg.max_block_frac)
    return {"threshold": thr, "mean_gain": st.mean(d), "flat": all(abs(x) < 1e-12 for x in d),
            "dm": st.diebold_mariano(d, dep["hac_lag"], cfg.min_series_len),
            "boot": st.block_bootstrap(d, dep["block"], cfg.bootstrap_reps, cfg.bootstrap_seed, cfg.ci_level,
                                       min_len=cfg.min_series_len)}


def station_cluster_boot(items: Sequence[dict], reps: int = 2000, seed: int = 20261102, level: float = 0.95) -> dict:
    """Bootstrap of the mean absolute-error gain resampling STATIONS (clusters) with replacement."""
    by: Dict[str, List[float]] = {}
    for i in items:
        by.setdefault(i["buoy"], []).append(abs(i["f_ref"] - i["obs"]) - abs(i["f_cand"] - i["obs"]))
    keys = sorted(by)
    if len(keys) < 2:
        return {"clusters": len(keys), "ci": None}
    rng = random.Random(seed)
    vals = []
    for _ in range(reps):
        pick = [by[keys[rng.randrange(len(keys))]] for _ in keys]
        flat = [x for g in pick for x in g]
        vals.append(st.mean(flat))
    vals.sort()
    a = (1 - level) / 2
    binding = len(keys) >= CLUSTER_BINDING_MIN
    return {"clusters": len(keys), "ci": [vals[int(a * reps)], vals[min(reps - 1, int((1 - a) * reps))]],
            "binding": binding,
            "note": "" if binding else f"advisory: {len(keys)} clusters < {CLUSTER_BINDING_MIN} for a binding cluster CI"}


def station_week_folds(items: Sequence[dict], min_n: int = 10) -> dict:
    """Gain inside each station x ISO-week block (the holdout unit); the positive share of scored blocks."""
    by: Dict[str, List[float]] = {}
    for i in items:
        by.setdefault(f"{i['buoy']}:{_iso_week(i['t'])}", []).append(
            abs(i["f_ref"] - i["obs"]) - abs(i["f_cand"] - i["obs"]))
    scored = [st.mean(v) for v in by.values() if len(v) >= min_n]
    return {"blocks": len(by), "scored": len(scored),
            "positive_share": (sum(1 for g in scored if g > 0) / len(scored)) if scored else None}


# ---- controls ---------------------------------------------------------------------------------------------------
def control_items(base: Sequence[dict], kind: str, seed: int = 20261102) -> List[dict]:
    """Synthetic candidates on the served baseline's own items (f_ref = served):
    null_identical  f_cand = f_ref                           -> gain exactly 0; must never PASS
    null_swap       per hour, a seeded coin assigns (served, persistence) or (persistence, served) to (ref, cand):
                    exchangeable, so the expected gain is 0 and the CI should cover it (advisory)
    positive        f_cand = obs + 0.8 (f_ref - obs)          -> 20% less error everywhere; must PASS
    negative        f_cand = obs + 1.25 (f_ref - obs)         -> 25% more error everywhere; must FAIL"""
    out = []
    coins: Dict[object, bool] = {}
    rng = random.Random(seed)
    for i in base:
        e = i["f_ref"] - i["obs"]
        if kind == "null_identical":
            out.append(dict(i, f_cand=i["f_ref"]))
        elif kind == "positive":
            out.append(dict(i, f_cand=i["obs"] + 0.8 * e))
        elif kind == "negative":
            out.append(dict(i, f_cand=i["obs"] + 1.25 * e))
        elif kind == "null_swap":
            if i.get("persistence") is None:
                continue
            if i["t"] not in coins:
                coins[i["t"]] = rng.random() < 0.5
            a, b = (i["f_ref"], i["persistence"]) if coins[i["t"]] else (i["persistence"], i["f_ref"])
            out.append(dict(i, f_ref=a, f_cand=b))
        else:
            raise ValueError(kind)
    return out


def hours_span(items: Sequence[dict]) -> Optional[str]:
    ts = sorted({i["t"] for i in items})
    if not ts:
        return None
    return f"{ts[0]:%Y-%m-%dT%HZ} .. {ts[-1]:%Y-%m-%dT%HZ} ({len(ts)} target hours)"


def weeks(items: Sequence[dict]) -> List[str]:
    return sorted({_iso_week(i["t"]) for i in items})


def lead_hours(items: Sequence[dict]) -> List[int]:
    return sorted({i["lead"] for i in items})
