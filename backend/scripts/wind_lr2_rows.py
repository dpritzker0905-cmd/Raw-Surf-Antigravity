"""wind_lr2_rows.py - turn collected run files, climatology, coefficients and truth into the scoring row table for the
long-range wind v2 registration. Serves nothing; pure numpy over arrays handed in (the loaders sit in wind_lr2_run.py).

One row = (run, station, lead). Columns (all numpy arrays of equal length):
  run (ordinal of init day), hour (init hour), init_ts (hours since epoch, for ordering/halves), st (station index),
  lead, vday (valid-date ordinal), region (str), marine (bool), has_spot (bool), sn (shore normal, NaN if none),
  o_u o_v o_s o_d o_g (truth at 10 m), o_s_p7 (truth speed at valid + 7 d), o_s_p48 (at valid + 48 h),
  and per arm A: A_u A_v A_s A_g.
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional, Sequence

import numpy as np

import wind_lr2_fit as F
import wind_lr2_runs as R

UTC = timezone.utc
SYSTEMS = ("aigefs", "gefs", "ifs")
CAL_SETS = {"GRAND_CAL": SYSTEMS, "AIGEFS_CAL": ("aigefs",), "IFS_CAL": ("ifs",), "GEFS_CAL": ("gefs",)}
RAW_SETS = {"GRAND_RAW": SYSTEMS, "IFS_RAW": ("ifs",)}
GATED = ("GRAND_CAL", "AIGEFS_CAL", "CLIM_SERVE")
EPOCH = datetime(1970, 1, 1, tzinfo=UTC)
LOOP_DAYS_H = 168          # extend_icon_wind_to_14d: lead L replays lead L mod 168


def ifs_keys(step: int):
    return f"ifs_10u_{step}", f"ifs_10v_{step}"


def system_mean(z, system: str, step: int):
    """(m_u, m_v, s) per station: mean member vector and mean member speed. `z` is a dict-like of arrays."""
    if system == "ifs":
        ku, kv = ifs_keys(step)
    else:
        ku, kv = f"{system}_u_{step}", f"{system}_v_{step}"
    u, v = np.asarray(z[ku], float), np.asarray(z[kv], float)
    return u.mean(axis=0), v.mean(axis=0), np.hypot(u, v).mean(axis=0)


def pool(z, systems: Sequence[str], step: int):
    """Equal SYSTEM weights (registration section 2: 'system weights equal, fixed now'): the mean of the systems' mean
    vectors and of their mean speeds. A reading of the registration, recorded in amendment A6."""
    parts = [system_mean(z, s, step) for s in systems]
    return tuple(np.mean([p[i] for p in parts], axis=0) for i in range(3))


def ifs_gust_median(z, step: int):
    return np.median(np.asarray(z[f"ifs_10fg_{step}"], float), axis=0) if f"ifs_10fg_{step}" in z else None


def wind_factor(speed, from_deg, shore_normal):
    """The rating's wind factor wq * wg, IMPORTED from surf_rating (never re-coded). NaN without a shore normal."""
    from services.weather_pipeline import surf_rating as SR
    s = np.asarray(speed, float)
    d = np.asarray(from_deg, float)
    n = np.asarray(shore_normal, float)
    out = np.full(s.shape, np.nan)
    for i in range(s.size):
        if math.isfinite(s.flat[i]) and math.isfinite(d.flat[i]) and math.isfinite(n.flat[i]):
            out.flat[i] = SR.wind_quality(float(s.flat[i]), float(d.flat[i]), float(n.flat[i])) * \
                SR.wind_gate(float(s.flat[i]), float(d.flat[i]), float(n.flat[i]))
    return out


def from_dir(u, v):
    return (np.degrees(np.arctan2(-np.asarray(u, float), -np.asarray(v, float))) + 360.0) % 360.0


def vec_from_obs(speed, direction):
    speed, direction = np.asarray(speed, float), np.asarray(direction, float)
    return -speed * np.sin(np.radians(direction)), -speed * np.cos(np.radians(direction))


def station_truth_fn(truth: Dict[int, dict], height: Dict[int, Optional[float]], convert: Callable, wind_at: Callable,
                     gust_window: Callable):
    """truth[st] = {datetime: (wspd, gust, wdir)}. Returns f(st, valid_dt) -> (u, v, speed, dir, gust) at 10 m or None.
    `convert(speed, z)` is obs.to_10m (NDBC log law); ASOS stations have height None and are used as is."""
    def f(st, valid):
        rec = wind_at(truth.get(st, {}), valid)
        if rec is None:
            return None
        sp, d = rec
        z = height.get(st)
        sp10 = float(convert(sp, z)) if z else float(sp)
        g = gust_window(truth.get(st, {}), valid, 6, gust_absent_is_wind=(not z))
        g10 = float(convert(g, z)) if (g is not None and z) else (float(g) if g is not None else float("nan"))
        u, v = vec_from_obs(sp10, d)
        return float(u), float(v), sp10, float(d), g10
    return f


def build_rows(runs: Dict[datetime, dict], stations: List[dict], pairing: Dict[str, dict],
               clim_at: Callable[[datetime], tuple], coefs: Dict[str, dict], truth_fn: Callable,
               clim_fields_ok: bool = True) -> Dict[str, np.ndarray]:
    """runs: {init datetime: npz-like dict}. clim_at(valid) -> (c_u, c_v, c_s) arrays over stations.
    coefs: {arm: coefficient doc from wind_lr2_fit.fit_all} for the calibrated arms. truth_fn(st, valid) as above.
    A row is kept only if truth exists at the valid time; rows for the shifted-truth controls carry NaN when absent."""
    cols: Dict[str, list] = {}

    def put(k, v):
        cols.setdefault(k, []).append(v)

    regions = [R.region_of(s["lat"], s["lon"]) for s in stations]
    for init in sorted(runs):
        z = runs[init]
        for step in R.SCORED_LEADS:
            valid = init + timedelta(hours=step)
            c_u, c_v, c_s = clim_at(valid)
            arms: Dict[str, tuple] = {}
            for arm, systems in CAL_SETS.items():
                mu, mv, s = pool(z, systems, step)
                u_, v_, s_, g_ = [], [], [], []
                for i in range(len(stations)):
                    k = F.coef_at(coefs[arm], regions[i], step)
                    uu, vv, ss, gg = F.apply_cal(mu[i], mv[i], s[i], c_u[i], c_v[i], c_s[i], k)
                    u_.append(float(uu)), v_.append(float(vv)), s_.append(float(ss)), g_.append(float(gg))
                arms[arm] = (np.array(u_), np.array(v_), np.array(s_), np.array(g_))
            for arm, systems in RAW_SETS.items():
                mu, mv, s = pool(z, systems, step)
                arms[arm] = (mu, mv, s, np.full(len(stations), np.nan))
            arms["CLIM_SERVE"] = (c_u, c_v, c_s, np.full(len(stations), np.nan))
            arms["CLIM"] = arms["CLIM_SERVE"]
            if "cmp_hres_10u_%d" % (step % LOOP_DAYS_H or LOOP_DAYS_H) in z:
                k = step % LOOP_DAYS_H or LOOP_DAYS_H
                hu, hv = np.asarray(z[f"cmp_hres_10u_{k}"], float), np.asarray(z[f"cmp_hres_10v_{k}"], float)
                arms["LOOP_PROXY"] = (hu, hv, np.hypot(hu, hv), np.full(len(stations), np.nan))
            if f"cmp_gfs_u_{step}" in z and step > 240:
                gu, gv = np.asarray(z[f"cmp_gfs_u_{step}"], float), np.asarray(z[f"cmp_gfs_v_{step}"], float)
                arms["GFS"] = (gu, gv, np.hypot(gu, gv), np.asarray(z[f"cmp_gfs_g_{step}"], float))
            for i, st in enumerate(stations):
                tr = truth_fn(i, valid)
                if tr is None:
                    continue
                t7 = truth_fn(i, valid + timedelta(days=7))
                t48 = truth_fn(i, valid + timedelta(hours=48))
                sid = str(st["id"])
                pr = pairing.get(sid, {})
                put("run", init.toordinal())
                put("hour", init.hour)
                put("init_ts", (init - EPOCH).total_seconds() / 3600.0)
                put("st", i)
                put("lead", step)
                put("vday", valid.toordinal())
                put("region", regions[i])
                put("marine", bool(pr.get("marine")))
                sn = pr.get("shore_normal")
                put("has_spot", sn is not None)
                put("sn", float(sn) if sn is not None else float("nan"))
                put("o_u", tr[0]), put("o_v", tr[1]), put("o_s", tr[2]), put("o_d", tr[3]), put("o_g", tr[4])
                put("o_s_p7", t7[2] if t7 else float("nan"))
                put("o_s_p48", t48[2] if t48 else float("nan"))
                put("hres240_s", float(np.hypot(z["cmp_hres_10u_240"][i], z["cmp_hres_10v_240"][i]))
                    if "cmp_hres_10u_240" in z else float("nan"))
                for arm in set(list(CAL_SETS) + list(RAW_SETS) + ["CLIM_SERVE", "CLIM", "LOOP_PROXY", "GFS"]):
                    a = arms.get(arm)
                    for j, nm in enumerate("uvsg"):
                        put(f"{arm}_{nm}", float(a[j][i]) if a is not None else float("nan"))
    return {k: np.array(v) for k, v in cols.items()}


def native_changes(runs: Dict[datetime, dict], n_st: int) -> np.ndarray:
    """Absolute 6 h speed changes of the native model (HRES) over its last 24 native hours (216 -> 240), every run and
    station: the yardstick for the G4 seam. 6-hourly because that is what is collected (amendment A6)."""
    out = []
    for z in runs.values():
        leads = [216, 222, 228, 234, 240]
        if not all(f"cmp_hres_10u_{k}" in z for k in leads):
            continue
        sp = [np.hypot(np.asarray(z[f"cmp_hres_10u_{k}"], float), np.asarray(z[f"cmp_hres_10v_{k}"], float)) for k in leads]
        for a, b in zip(sp, sp[1:]):
            out.append(np.abs(b - a))
    return np.concatenate(out) if out else np.zeros(0)


def m1(rows: Dict[str, np.ndarray], arm: str, truth_col: str = "o_s") -> np.ndarray:
    """Speed absolute error per row (NaN where the arm or truth is missing)."""
    return np.abs(rows[f"{arm}_s"] - rows[truth_col])


def m2(rows: Dict[str, np.ndarray], arm: str) -> np.ndarray:
    """|wq*wg(forecast) - wq*wg(station wind)| at the paired spot's shore normal; NaN without a paired spot."""
    fd = from_dir(rows[f"{arm}_u"], rows[f"{arm}_v"])
    wf = wind_factor(rows[f"{arm}_s"], fd, rows["sn"])
    wo = wind_factor(rows["o_s"], rows["o_d"], rows["sn"])
    return np.abs(wf - wo)


def cell_mask(rows: Dict[str, np.ndarray], b: str, population: Optional[np.ndarray] = None) -> np.ndarray:
    """Rows of a comparator-bin cell: B1/B2/B3, or 'B2>240' (the part of B2 above 240 h)."""
    lo_hi = {"B1": (180, 216), "B2": (216, 264), "B3": (264, 336)}
    if b == "B2>240":
        m = (rows["lead"] > 240) & (rows["lead"] <= 264)
    else:
        lo, hi = lo_hi[b]
        m = (rows["lead"] > lo) & (rows["lead"] <= hi)
    return m if population is None else (m & population)


def fit_rows(runs: Dict[datetime, dict], stations: List[dict], systems: Sequence[str],
             clim_at: Callable[[datetime], tuple], truth_fn: Callable) -> Dict[str, np.ndarray]:
    """Rows for the calibration fit of one arm (pooled over `systems`): the columns wind_lr2_fit.fit_all reads. A row needs
    truth at the valid time; the station and valid-day ordinals feed the station-day count and the 5-day CV blocks."""
    cols: Dict[str, list] = {k: [] for k in ("m_u", "m_v", "s", "c_u", "c_v", "c_s", "o_u", "o_v", "o_s", "o_gust", "block",
                                           "day", "station", "lead", "region")}
    regions = [R.region_of(s["lat"], s["lon"]) for s in stations]
    for init in sorted(runs):
        z = runs[init]
        for step in R.SCORED_LEADS:
            valid = init + timedelta(hours=step)
            c_u, c_v, c_s = clim_at(valid)
            mu, mv, s = pool(z, systems, step)
            for i in range(len(stations)):
                tr = truth_fn(i, valid)
                if tr is None:
                    continue
                for k, v in (("m_u", mu[i]), ("m_v", mv[i]), ("s", s[i]), ("c_u", c_u[i]), ("c_v", c_v[i]), ("c_s", c_s[i]),
                             ("o_u", tr[0]), ("o_v", tr[1]), ("o_s", tr[2]), ("o_gust", tr[4]),
                             ("block", valid.toordinal() // R_BLOCK), ("day", valid.toordinal()), ("station", i),
                             ("lead", step), ("region", regions[i])):
                    cols[k].append(v)
    return {k: np.array(v) for k, v in cols.items()}


R_BLOCK = 5
