"""currents_skill_metrics.py - M1 (HF radar, 25 h low-passed vector error) and M2 (72 h Lagrangian separation on low-passed
tracks) rows of the currents-skill-v1 registration (section 4). Serves nothing.

M1. For an init, a region and a lead day Dn (valid centre 24 n h): the truth is the centred 25 h mean of the cell's valid
hours (>= 20 of 25); each arm's steps are interpolated linearly to the same hours and averaged over EXACTLY those hours
(the shared mask). A row with the truth or ANY arm missing is dropped for all arms (identical rows; each arm's own count of
missing rows is reported). Also kept per row: the unfiltered values at the centre step (reported only).

M2. A drifter-init needs the smoothed position at the init and at +72 h (>= 20 good hours each). Each arm advects one
particle from the smoothed init position through its own 25 h low-passed field (RK4, 1 h, bilinear over the wet corners);
no drifter velocity enters. A particle entering a land cell of the arm's grid stops at its last wet position and is
scored from there (beached, counted). STILL is the drifter's own smoothed 72 h displacement.
"""
import math
from typing import Callable, Dict, List, Optional

import numpy as np

import currents_skill_arms as A
import currents_skill_geo as G
import currents_skill_truth as T

LEAD_DAYS = (1, 3, 5, 7)
M2_HOURS = 72
# Amendment 1 (A3): M2 seeds after the init so the >= 20 of 25 rule holds for every arm's field and for the truth track.
# The advisor's ruling says +12 h; with the first scored step at 6 h, the window at +12 h (0..24 h) holds 19 defined hours
# (6..24), one short, so the first lead that meets the rule, +13 h, is used. Stated in the amendment; one constant.
M2_SEED_H = 13
DIR_MIN_SPEED = 0.1          # m/s: rows entering the direction error
PLANT_FRACTION = 0.15
PLANT_SEED = 20261122


def plant_mask(init_index: int, n: int, fraction=PLANT_FRACTION, seed=PLANT_SEED):
    """The same random 15% of rows for every plant of one init (section 7, seed 20261122)."""
    return np.random.default_rng([seed, int(init_index)]).random(n) < fraction


def rotate(u, v, deg):
    r = math.radians(deg)                 # +deg = clockwise on the compass (direction toward increases)
    return u * math.cos(r) + v * math.sin(r), -u * math.sin(r) + v * math.cos(r)


def m1_rows(truth: T.HfrTruth, cells, init_h: int, init_index: int, arms: Dict[str, A.ArmField], lead_days=LEAD_DAYS,
            obs_shift_h=0, rotations=None, all_arms=None):
    """{lead_day: {"cell", "uo", "vo", "fc": {arm: (u, v)}, "raw_o": (u, v), "raw": {arm: (u, v)}, "missing": {arm: n}}}.
    `obs_shift_h` pairs the forecast with truth that much later (the shuffled control). `rotations` {new arm: (arm, deg)}
    adds arms whose step vectors are rotated by deg on this init's plant rows BEFORE the low-pass (the direction plants);
    plant arms never drop rows. `all_arms` names arms absent at this init: they get NaN columns and drop no rows (per-arm
    pairing, section 2)."""
    cells = np.asarray(cells, dtype=np.int64)
    la, lo = truth.cell_latlon()
    la, lo = la[cells], lo[cells]
    steps, src = {}, dict(arms)
    for name, arm in arms.items():
        steps[name] = arm.sample_steps(la, lo, strict=True)
    m = plant_mask(init_index, cells.size)
    for name, (base, deg) in (rotations or {}).items():
        if base not in steps:
            continue
        us, vs = steps[base][0].copy(), steps[base][1].copy()
        us[:, m], vs[:, m] = rotate(us[:, m], vs[:, m], deg)
        steps[name], src[name] = (us, vs), arms[base]
    plants = set(rotations or {})
    out = {}
    for n in lead_days:
        t = 24 * n
        hrs = init_h + obs_shift_h + A.window_hours(t)
        ou, ov = truth.series(hrs)
        ou, ov = ou[:, cells], ov[:, cells]
        uo, vo, mask = T.lowpass_obs(ou, ov)
        keep = np.isfinite(uo)
        fc, raw, missing = {}, {}, {}
        for name, arm in src.items():
            us, vs = steps[name]
            W = A.hourly_weights(arm.steps_h, A.window_hours(t))
            if not np.isfinite(W).all():
                fu = fv = np.full(cells.size, np.nan)
            else:
                Fu, Fv = W @ np.nan_to_num(us, nan=0.0), W @ np.nan_to_num(vs, nan=0.0)
                bad_step = (W @ (~np.isfinite(us)).astype(float)) > 0      # a NaN step used at some hour
                with np.errstate(invalid="ignore", divide="ignore"):
                    fu = np.where(mask, Fu, 0).sum(0) / mask.sum(0)
                    fv = np.where(mask, Fv, 0).sum(0) / mask.sum(0)
                anybad = (bad_step & mask).any(0)
                fu, fv = np.where(anybad, np.nan, fu), np.where(anybad, np.nan, fv)
            fc[name] = (fu, fv)
            k = np.nonzero(np.isclose(arm.steps_h, t))[0]
            raw[name] = (us[k[0]], vs[k[0]]) if k.size else (np.full(cells.size, np.nan),) * 2
            missing[name] = int((keep & ~np.isfinite(fu)).sum())
            if name not in plants:
                keep &= np.isfinite(fu)
        for name in all_arms or ():
            if name not in fc:
                fc[name] = raw[name] = (np.full(cells.size, np.nan),) * 2
                missing[name] = 0
        rk = int(A.HALF_WINDOW_H)                                # the centre hour inside the 25 h window
        sel = np.nonzero(keep)[0]
        out[n] = {"cell": cells[sel], "uo": uo[sel], "vo": vo[sel], "raw_o": (ou[rk, sel], ov[rk, sel]),
                  "fc": {k: (a[sel], b[sel]) for k, (a, b) in fc.items()},
                  "raw": {k: (a[sel], b[sel]) for k, (a, b) in raw.items()}, "missing": missing,
                  "init_h": init_h, "init_index": init_index, "valid_h": init_h + t}
    return out


def advect(vel: Callable, lat, lon, hours=M2_HOURS, is_land: Optional[Callable] = None, t0=0.0):
    """RK4, 1 h steps from lead hour t0, every particle at once. Returns {"lat", "lon": [hour 0..hours, particle],
    "beached", "stalled": [particle]}. A step that would put a particle on the arm's land mask stops it at its last wet
    position (beached); a step where the field has no value (off the arm's grid) stops it too (stalled)."""
    dt = 3600.0
    la = np.atleast_1d(np.asarray(lat, float)).copy()
    lo = np.atleast_1d(np.asarray(lon, float)).copy()
    n = la.size
    beached, stalled = np.zeros(n, bool), np.zeros(n, bool)
    tla, tlo = [la.copy()], [lo.copy()]
    for step_k in range(hours):
        live = ~(beached | stalled)
        if live.any():
            a, b = la[live], lo[live]
            h = t0 + step_k
            k1 = vel(a, b, h)
            p2 = _step(a, b, k1[0], k1[1], dt / 2)
            k2 = vel(p2[0], p2[1], h + 0.5)
            p3 = _step(a, b, k2[0], k2[1], dt / 2)
            k3 = vel(p3[0], p3[1], h + 0.5)
            p4 = _step(a, b, k3[0], k3[1], dt)
            k4 = vel(p4[0], p4[1], h + 1.0)
            u = (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6.0
            v = (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6.0
            ok = np.isfinite(u) & np.isfinite(v)
            na, nb = _step(a, b, np.where(ok, u, 0.0), np.where(ok, v, 0.0), dt)
            land = np.asarray(is_land(na, nb), bool) if is_land is not None else np.zeros(a.size, bool)
            idx = np.nonzero(live)[0]
            stalled[idx[~ok]] = True
            beached[idx[ok & land]] = True
            mv = ok & ~land
            la[idx[mv]], lo[idx[mv]] = na[mv], nb[mv]
        tla.append(la.copy())
        tlo.append(lo.copy())
    return {"lat": np.array(tla), "lon": np.array(tlo), "beached": beached, "stalled": stalled}


def _step(lat, lon, u, v, dt_s):
    lat2 = lat + v * dt_s / 1000.0 / G.KM_PER_DEG
    coslat = np.maximum(np.cos(np.radians(lat)), 1e-6)
    return lat2, G.wrap_lon(lon + u * dt_s / 1000.0 / (G.KM_PER_DEG * coslat))


def m2_rows(tracks, init_h: int, arms: Dict[str, A.ArmField], bathy=None, raw=False, vel_fns=None, stats=None,
            seed_h=M2_SEED_H):
    """Every drifter-init of one init: list of {"platform", "drogue", "zone", "still_km", "sep_km": {arm}, "sep24_km": {arm},
    "lw_skill": {arm}, "beached": {arm}, "stalled": {arm}}. A drifter whose observed (smoothed) track misses the >= 20 h rule
    at the seed (init + seed_h) or 72 h later is not used (for any arm), and counted in `stats["excluded"]` when it has any fix
    in that span (amendment 1, A6: reported). `raw`: the unsmoothed track and the unfiltered field (reported)."""
    pick = (lambda tr, h: tr.raw(h)) if raw else (lambda tr, h: tr.smoothed(h))
    t0 = init_h + seed_h
    rows, seeds, obs = [], [], []
    for tr in tracks:
        s, e = pick(tr, t0), pick(tr, t0 + M2_HOURS)
        if s is None or e is None:
            if stats is not None and any(t0 - A.HALF_WINDOW_H <= h <= t0 + M2_HOURS + A.HALF_WINDOW_H for h in tr.hourly):
                stats["excluded"] = stats.get("excluded", 0) + 1
            continue
        hourly = [pick(tr, t0 + h) for h in range(M2_HOURS + 1)]
        rows.append({"init_h": init_h, "valid_h": t0 + M2_HOURS, "platform": tr.platform, "drogue": tr.drogue,
                     "zone": G.zone_of(s[0], s[1], bathy) if bathy is not None else None,
                     "still_km": float(G.distance_km(s[0], s[1], e[0], e[1])), "end": e, "end24": hourly[24],
                     "sep_km": {}, "sep24_km": {}, "lw_skill": {}, "beached": {}, "stalled": {}})
        seeds.append(s)
        obs.append((hourly, tr.path_km(t0, t0 + M2_HOURS, smooth=not raw)))
    if not rows:
        return rows
    sla, slo = np.array([s[0] for s in seeds]), np.array([s[1] for s in seeds])
    for name, arm in arms.items():
        vel = (vel_fns or {}).get(name) or (A.unfiltered_velocity_fn(arm) if raw else A.lowpassed_velocity_fn(arm))
        res = advect(vel, sla, slo, M2_HOURS, is_land=arm.is_land, t0=seed_h)
        for k, row in enumerate(rows):
            e, e24 = row["end"], row["end24"]
            if res["stalled"][k] and res["lat"][1, k] == sla[k] and res["lon"][1, k] == slo[k]:
                row["sep_km"][name] = row["sep24_km"][name] = row["lw_skill"][name] = None    # the seed is off this arm's grid
                row["beached"][name], row["stalled"][name] = False, True
                continue
            row["sep_km"][name] = float(G.distance_km(res["lat"][M2_HOURS, k], res["lon"][M2_HOURS, k], e[0], e[1]))
            row["sep24_km"][name] = (float(G.distance_km(res["lat"][24, k], res["lon"][24, k], e24[0], e24[1]))
                                     if e24 is not None else None)
            row["beached"][name], row["stalled"][name] = bool(res["beached"][k]), bool(res["stalled"][k])
            row["lw_skill"][name] = liu_weisberg(list(zip(res["lat"][:, k], res["lon"][:, k])), obs[k][0], obs[k][1])
    for row in rows:
        row.pop("end")
        row.pop("end24")
    return rows


def liu_weisberg(model_track, obs_track, path_cum):
    """Liu & Weisberg (2011) skill, n = 1: s = sum of hourly separations / sum of cumulative observed path lengths,
    skill = max(0, 1 - s). None when an observed hour is missing or the drifter did not move."""
    if path_cum is None or any(o is None for o in obs_track):
        return None
    seps = [float(G.distance_km(m[0], m[1], o[0], o[1])) for m, o in zip(model_track[1:], obs_track[1:])]
    denom = float(np.sum(path_cum[1:]))
    if denom <= 0:
        return None
    return max(0.0, 1.0 - float(np.sum(seps)) / denom)


def flatten_m1(batches: List[dict], arms, region):
    """Concatenate per-(init, lead day) M1 batches into per-lead-day column arrays (one row per cell-init)."""
    out = {}
    for b in batches:
        for n, d in b.items():
            col = out.setdefault(n, {"date": [], "init_index": [], "uo": [], "vo": [], "fc": {a: ([], []) for a in arms},
                                     "raw_o": ([], []), "raw": {a: ([], []) for a in arms}, "missing": {a: 0 for a in arms}})
            k = d["uo"].size
            day = d["valid_h"] // 24
            col["date"].append(np.full(k, day, dtype=np.int64))
            col["init_index"].append(np.full(k, d["init_index"], dtype=np.int64))
            col["uo"].append(d["uo"])
            col["vo"].append(d["vo"])
            col["raw_o"][0].append(d["raw_o"][0])
            col["raw_o"][1].append(d["raw_o"][1])
            for a in arms:
                col["fc"][a][0].append(d["fc"][a][0])
                col["fc"][a][1].append(d["fc"][a][1])
                col["raw"][a][0].append(d["raw"][a][0])
                col["raw"][a][1].append(d["raw"][a][1])
                col["missing"][a] += d["missing"][a]
    cat = lambda xs: np.concatenate(xs) if xs else np.zeros(0)
    for n, col in out.items():
        for key in ("date", "init_index", "uo", "vo"):
            col[key] = cat(col[key])
        col["raw_o"] = tuple(cat(x) for x in col["raw_o"])
        col["fc"] = {a: tuple(cat(x) for x in v) for a, v in col["fc"].items()}
        col["raw"] = {a: tuple(cat(x) for x in v) for a, v in col["raw"].items()}
        col["region"] = region
    return out


def err2(col, arm, raw=False):
    fu, fv = col["raw"][arm] if raw else col["fc"][arm]
    ou, ov = col["raw_o"] if raw else (col["uo"], col["vo"])
    return (fu - ou) ** 2 + (fv - ov) ** 2


def speed_err(col, arm, plant_ms=0.0):
    fu, fv = col["fc"][arm]
    return (np.hypot(fu, fv) + plant_ms) - np.hypot(col["uo"], col["vo"])


def signed_dir_err(col, arm):
    """Forecast minus observed direction toward, wrapped to (-180, 180], NaN where the observed speed < 0.1 m/s."""
    fu, fv = col["fc"][arm]
    d = np.degrees(np.arctan2(fu, fv)) - np.degrees(np.arctan2(col["uo"], col["vo"]))
    d = (d + 180.0) % 360.0 - 180.0
    return np.where(np.hypot(col["uo"], col["vo"]) >= DIR_MIN_SPEED, d, np.nan)


def speed_plant(col, arm, plant_ms, name):
    """Speed plant: +plant_ms added along the arm's (filtered) forecast vector on every row; returns a column dict with
    `name` as an extra arm (section 7)."""
    fu, fv = col["fc"][arm]
    s = np.hypot(fu, fv)
    with np.errstate(invalid="ignore", divide="ignore"):
        k = np.where(s > 0, (s + plant_ms) / s, 1.0)
    col = dict(col, fc=dict(col["fc"], **{name: (fu * k, fv * k)}))
    return col
