"""wind_lr_score.py - score the long-range wind hindcast against the PRE-REGISTERED gate. Serves nothing.

Gate: docs/weather-program/log/2026-11-15-wind-long-range.md, 21:45Z (+ amendment 23:30Z). Every PASS line is read
on the TEST half (runs on EVEN day-of-month); the FIT half (ODD days) only fits the de-bias factor k per lead bin and
the GEFS gust factor. Paired differences on identical (station, run, lead) rows; day-block bootstrap over valid-time
UTC dates, 2000 resamples, seed 20261115, 95% percentile interval.

The pure scoring functions (`bins_of`, `day_block_ci`, `metrics`, `verdict`) are unit-tested on synthetic rows
(tests/test_wind_lr_score.py), including both controls.
"""
import csv
import json
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional

import numpy as np

from services.weather_pipeline import ens_wind_core as ec

import wind_lr_obs as obs

BINS = {"B1_180_216": (180, 216), "B2_216_264": (216, 264), "B3_264_336": (264, 336)}
SEED = 20261115
REPS = 2000
ARMS = ["loop", "gfs_standin", "ens_mean_raw", "ens_mean_debias", "ens_cf", "gefs_mean", "climatology", "persist180",
        "aifs_ens_mean"]
GUST_EVENT = 15.0         # m/s, the gust-peak line P5 (amendment 2)
EVENTS_MIN = 30
TOTAL_RUNS = 122
DROP_MAX = 0.10
LOOP_DAYS_H = 168


def bin_of(lead: float) -> Optional[str]:
    for name, (lo, hi) in BINS.items():
        if lo < lead <= hi:
            return name
    return None


def bins_of(leads) -> List[Optional[str]]:
    return [bin_of(L) for L in leads]


def day_block_ci(diff: np.ndarray, days: np.ndarray, reps: int = REPS, seed: int = SEED):
    """(mean, lo, hi) of the mean of `diff` with whole valid-days resampled. NaN rows dropped."""
    ok = np.isfinite(diff)
    diff, days = diff[ok], days[ok]
    if diff.size == 0:
        return (float("nan"),) * 3
    uniq, inv = np.unique(days, return_inverse=True)
    sums = np.bincount(inv, weights=diff, minlength=len(uniq))
    cnts = np.bincount(inv, minlength=len(uniq)).astype(float)
    rng = np.random.default_rng(seed)
    pick = rng.integers(0, len(uniq), size=(reps, len(uniq)))
    boot = sums[pick].sum(axis=1) / cnts[pick].sum(axis=1)
    return float(diff.mean()), float(np.percentile(boot, 2.5)), float(np.percentile(boot, 97.5))


def circ_diff(a, b):
    return np.abs((np.asarray(a) - np.asarray(b) + 180.0) % 360.0 - 180.0)


def errors(fc_u, fc_v, fc_spd, fc_gust, ob_spd, ob_dir, ob_gust):
    """Per-row error columns for one arm."""
    ob_u = -ob_spd * np.sin(np.radians(ob_dir))
    ob_v = -ob_spd * np.cos(np.radians(ob_dir))
    _, fdir = ec.to_speed_dir(fc_u, fc_v)
    dir_err = np.where(ob_spd >= 3.0, circ_diff(fdir, ob_dir), np.nan)
    return {"ae": np.abs(fc_spd - ob_spd), "err": fc_spd - ob_spd,
            "vsq": (fc_u - ob_u) ** 2 + (fc_v - ob_v) ** 2, "dae": dir_err,
            "gae": np.abs(fc_gust - ob_gust), "gerr": fc_gust - ob_gust}


def metrics(e: Dict[str, np.ndarray], mask: np.ndarray) -> dict:
    def m(x):
        x = x[mask & np.isfinite(x)]
        return float(x.mean()) if x.size else float("nan"), int(x.size)
    ae, n = m(e["ae"])
    vs, _ = m(e["vsq"])
    return {"speed_mae": ae, "n": n, "speed_bias": m(e["err"])[0], "vector_rmse": math.sqrt(vs) if vs == vs else vs,
            "dir_mae_ge3": m(e["dae"])[0], "n_dir": m(e["dae"])[1], "gust_mae": m(e["gae"])[0],
            "gust_bias": m(e["gerr"])[0], "n_gust": m(e["gae"])[1]}


def paired(ea, eb, key, mask, days):
    d = ea[key] - eb[key]
    return day_block_ci(np.where(mask, d, np.nan), days)


def verdict(rows: dict, chosen: str, seam: dict) -> dict:
    """Apply P1-P4, R1, C1, C2 to the error columns in `rows` (TEST half only)."""
    E, days, b = rows["E"], rows["days"], rows["bin"]
    out = {"chosen": chosen, "lines": {}}
    ok_all = True
    for name in BINS:
        mask = b == name
        for comp, line in (("loop", "P1"), ("gfs_standin", "P2")):
            m, lo, hi = paired(E[chosen], E[comp], "ae", mask, days)
            passed = hi < 0
            out["lines"][f"{line}_{name}"] = {"diff_mae": m, "ci": [lo, hi], "pass": passed}
            ok_all &= passed
        m, lo, hi = paired(E[chosen], E["climatology"], "ae", mask, days)
        out["lines"][f"R1_{name}"] = {"diff_mae_vs_clim": m, "ci": [lo, hi],
                                      "label": "skill" if hi < 0 else "low skill"}
        # C1: shifted +48 h vs climatology at the same (shifted) obs rows: point estimate must be worse
        sh = rows["E_shift"][name]
        c1 = sh["shift_mae"] > sh["clim_mae"]
        out["lines"][f"C1_{name}"] = {**sh, "pass": c1}
        # C2: a seeded +1 m/s speed bias must be found: bias difference CI contains 1.0 and excludes 0
        seeded = dict(E[chosen], err=E[chosen]["err"] + 1.0)
        m2, lo2, hi2 = paired(seeded, E[chosen], "err", mask, days)
        c2 = lo2 <= 1.0 <= hi2 and lo2 > 0
        out["lines"][f"C2_{name}"] = {"bias_diff": m2, "ci": [lo2, hi2], "pass": c2}
        # REPORTED ONLY (not a PASS line; Reflection 2026-11-16: C2 passes by construction): +1 m/s plus N(0, 2) noise
        # per row must still be found (CI excludes 0 and contains 1)
        noise = np.random.default_rng(SEED + 1).normal(0.0, 2.0, E[chosen]["err"].shape)
        md, lod, hid = paired(dict(E[chosen], err=E[chosen]["err"] + 1.0 + noise), E[chosen], "err", mask, days)
        out["lines"][f"D_C2_noisy_{name}"] = {"bias_diff": md, "ci": [lod, hid], "found": bool(lod > 0 and lod <= 1.0 <= hid),
                                              "reported_only": True}
    allmask = np.isin(b, list(BINS))
    m, lo, hi = paired(E[chosen], E["loop"], "gae", allmask, days)
    out["lines"]["P3_gust_pooled"] = {"diff_gust_mae": m, "ci": [lo, hi], "pass": hi < 0}
    ok_all &= hi < 0
    # P5 gust peak (amendment 2): Brier for gust >= 15 m/s vs loop AND gfs_standin, pooled; UNDERPOWERED < 30 events
    n_ev = int(rows.get("n_events", 0))
    p5 = {}
    for comp in ("loop", "gfs_standin"):
        if "brier" in E[chosen] and "brier" in E[comp]:
            mb, lb, hb = paired(E[chosen], E[comp], "brier", allmask, days)
            p5[comp] = {"diff_brier": mb, "ci": [lb, hb], "beats": hb < 0}
    if n_ev < EVENTS_MIN:
        out["lines"]["P5_gust_peak"] = {"vs": p5, "n_events": n_ev, "pass": True, "status": "UNDERPOWERED (not blocking)"}
    else:
        p5_ok = bool(p5) and all(v["beats"] for v in p5.values())
        out["lines"]["P5_gust_peak"] = {"vs": p5, "n_events": n_ev, "pass": p5_ok}
        ok_all &= p5_ok
    p4 = seam.get("seam_p95", float("nan")) <= seam.get("within_p95", float("nan"))
    out["lines"]["P4_seam_euro"] = {**seam, "pass": bool(p4)}
    ok_all &= bool(p4)
    controls_ok = all(v["pass"] for k, v in out["lines"].items() if k.startswith(("C1_", "C2_")))
    out["controls_ok"] = controls_ok
    out["verdict"] = "VOID" if not controls_ok else ("PASS" if ok_all else "FAIL")
    out["note"] = "P4 is the EURO seam only; the ICON seam is read forward on >= 10 live runs (pre-registered)."
    return out


# ---------------------------------------------------------------------------------------------- assembly
def _arm_fields(z, L, k_by_bin, gf_gefs, gf_aifs=1.0):
    """{arm: (u, v, speed, gust)} at lead L for every station from one run's npz."""
    out = {}
    U, V, G = z[f"ens_10u_{L}"], z[f"ens_10v_{L}"], z[f"ens_10fg_{L}"]
    r = ec.reduce_members(U, V, G)
    out["ens_mean_raw"] = (r["u"], r["v"], r["speed"], r["gust"])
    k = k_by_bin.get(bin_of(L), 1.0)
    out["ens_mean_debias"] = (r["u"] * k, r["v"] * k, r["speed"] * k, r["gust"])
    c = ec.control_only(U, V, G)
    out["ens_cf"] = (c["u"], c["v"], c["speed"], c["gust"])
    for arm, lead in (("loop", L % LOOP_DAYS_H), ("persist180", 180)):
        if f"hres_10u_{lead}" in z:
            u, v, g = z[f"hres_10u_{lead}"], z[f"hres_10v_{lead}"], z[f"hres_10fg_{lead}"]
            out[arm] = (u, v, np.hypot(u, v), g)
    if f"gfs_u_{L}" in z:
        u, v = z[f"gfs_u_{L}"], z[f"gfs_v_{L}"]
        out["gfs_standin"] = (u, v, np.hypot(u, v), z[f"gfs_g_{L}"])
    if f"gefs_u_{L}" in z:
        u, v = z[f"gefs_u_{L}"], z[f"gefs_v_{L}"]
        sp = np.hypot(u, v)
        out["gefs_mean"] = (u, v, sp, np.maximum(sp * gf_gefs, sp))
    if f"aifs_10u_{L}" in z:
        ra = ec.reduce_members(z[f"aifs_10u_{L}"], z[f"aifs_10v_{L}"])
        out["aifs_ens_mean"] = (ra["u"], ra["v"], ra["speed"], np.maximum(ra["speed"] * gf_aifs, ra["speed"]))
    return out


def event_prob(z, L, af, arm, i) -> float:
    """P(gust >= GUST_EVENT) for P5: the IFS member fraction for the ENS mean arms, 0/1 for the deterministic ones."""
    if arm in ("ens_mean_raw", "ens_mean_debias"):
        g = z[f"ens_10fg_{L}"][:, i]
        g = g[np.isfinite(g)]
        return float(np.mean(g >= GUST_EVENT)) if g.size else float("nan")
    src = af.get(arm)
    if src is None:
        return float("nan")
    gv = float(src[3][i])
    return float(gv >= GUST_EVENT) if gv == gv else float("nan")


def csi(fc_gust, ob_gust) -> dict:
    ok = np.isfinite(fc_gust) & np.isfinite(ob_gust)
    f, o = fc_gust[ok] >= GUST_EVENT, ob_gust[ok] >= GUST_EVENT
    hits, miss, fa = int(np.sum(f & o)), int(np.sum(~f & o)), int(np.sum(f & ~o))
    return {"csi": hits / (hits + miss + fa) if hits + miss + fa else float("nan"), "hits": hits, "misses": miss,
            "false_alarms": fa}


def main_score(session, cache, stations, out_dir) -> int:
    os.makedirs(out_dir, exist_ok=True)
    from wind_lr_hindcast import OBS_END, SCORED_LEADS, WINDOW
    start, end = WINDOW[0], OBS_END
    st_obs, clim = [], []
    for st in stations:
        if st["kind"] == "ndbc":
            o = obs.ndbc_window(session, cache, st["id"])
            z = st["anemometer_m"]
            fix = (lambda x, z=z: obs.to_10m(x, z))
            o = {t: (float(fix(w)), float(fix(g)) if g == g else g, d) for t, (w, g, d) in o.items()}
            years = [obs.ndbc_year(session, cache, st["id"], y) for y in range(2016, 2026)]
            years = [{t: (float(fix(w)), g, d) for t, (w, g, d) in yo.items()} for yo in years]
        else:
            o = obs.asos_range(session, cache, st["id"], start, end)
            years = [obs.asos_range(session, cache, st["id"], datetime(2016, 1, 1, tzinfo=timezone.utc),
                                    datetime(2025, 12, 31, tzinfo=timezone.utc))]  # one archive request per station
        st_obs.append(o)
        clim.append(obs.climatology(years))
    run_dir = os.path.join(cache, "runs")
    runs = sorted(f for f in os.listdir(run_dir) if f.endswith(".npz"))
    # amendment 2: contiguous blocks, FIT = runs started in September, TEST = October
    fit_runs = [r for r in runs if r[4:6] == "09"]
    test_runs = [r for r in runs if r[4:6] == "10"]
    dropped = sorted(f.split(".")[0] for f in os.listdir(run_dir) if f.endswith((".failed.json", ".missing.json")))

    def obs_rows(run_dt, L, i):
        V = run_dt + timedelta(hours=L)
        w = obs.wind_at(st_obs[i], V)
        g = obs.gust_window(st_obs[i], V, 6, gust_absent_is_wind=stations[i]["kind"] == "asos")
        return V, w, g

    # ---- FIT half: de-bias k per bin (ens_mean_raw speed vs obs speed), GEFS gust factor
    fit_o, fit_f, gf_o, gf_f, ga_o, ga_f = {b: [] for b in BINS}, {b: [] for b in BINS}, [], [], [], []
    for fn in fit_runs:
        z = np.load(os.path.join(run_dir, fn))
        run_dt = datetime.strptime(fn[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        for L in SCORED_LEADS:
            r = ec.reduce_members(z[f"ens_10u_{L}"], z[f"ens_10v_{L}"])
            gefs = np.hypot(z[f"gefs_u_{L}"], z[f"gefs_v_{L}"]) if f"gefs_u_{L}" in z else None
            for i in range(len(stations)):
                _V, w, g = obs_rows(run_dt, L, i)
                if w:
                    fit_o[bin_of(L)].append(w[0])
                    fit_f[bin_of(L)].append(r["speed"][i])
                if g is not None and gefs is not None:
                    gf_o.append(g)
                    gf_f.append(gefs[i])
                if g is not None and f"aifs_10u_{L}" in z:
                    ga_o.append(g)
                    ga_f.append(ec.reduce_members(z[f"aifs_10u_{L}"][:, i:i + 1], z[f"aifs_10v_{L}"][:, i:i + 1])["speed"][0])
    k_by_bin = {b: ec.fit_speed_factor(fit_o[b], fit_f[b]) for b in BINS}
    gf_gefs = ec.fit_speed_factor(gf_o, gf_f)
    gf_aifs = ec.fit_speed_factor(ga_o, ga_f)

    # ---- TEST half rows
    cols = {a: {k: [] for k in ("u", "v", "s", "g", "p")} for a in ARMS}
    meta = {k: [] for k in ("run", "station", "kind", "hawaii", "lead", "valid", "day", "os", "od", "og")}
    # C1 is recorded for BOTH ENS arms; the chosen arm's rows are read once the arm is chosen (fix 2026-11-16 00:20Z:
    # it always read the raw arm)
    shift = {arm: {b: {"shift": [], "clim": []} for b in BINS} for arm in ("ens_mean_raw", "ens_mean_debias")}
    seam_raw, seam_deb, within_d = [], [], []
    for fn in test_runs:
        z = np.load(os.path.join(run_dir, fn))
        run_dt = datetime.strptime(fn[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        for L in SCORED_LEADS:
            af = _arm_fields(z, L, k_by_bin, gf_gefs, gf_aifs)
            for i, st in enumerate(stations):
                V, w, g = obs_rows(run_dt, L, i)
                if not w:
                    continue
                c = clim[i].get(V)
                af_c = (np.array([c[1]]), np.array([c[2]]), np.array([c[0]]), np.array([np.nan])) if c else None
                for a in ARMS:
                    src, j = (af_c, 0) if a == "climatology" else (af.get(a), i)
                    vals = [float(x[j]) for x in src] if src is not None else [np.nan] * 4
                    for k, v in zip(("u", "v", "s", "g"), vals):
                        cols[a][k].append(v)
                    cols[a]["p"].append(float("nan") if a == "climatology" else event_prob(z, L, af, a, i))
                for k, v in (("run", fn[:10]), ("station", st["id"]), ("kind", st["kind"]), ("hawaii", obs.is_hawaii(st)),
                             ("lead", L), ("valid", V.isoformat()), ("day", V.strftime("%Y%m%d")), ("os", w[0]),
                             ("od", w[1]), ("og", g if g is not None else np.nan)):
                    meta[k].append(v)
                # C1: the forecast for V scored at V + 48 h, against that hour's climatology
                V2 = V + timedelta(hours=48)
                w2 = obs.wind_at(st_obs[i], V2)
                c2 = clim[i].get(V2)
                if w2 and c2:
                    for arm in shift:
                        shift[arm][bin_of(L)]["shift"].append(abs(float(af[arm][2][i]) - w2[0]))
                        shift[arm][bin_of(L)]["clim"].append(abs(c2[0] - w2[0]))
        # P4 EURO seam: HRES 240 vs the ENS arm at 243 (same run, interpolated 240..246), station cells
        if "hres_10u_240" in z:
            f0 = ec.reduce_members(z["ens_10u_240"], z["ens_10v_240"])
            f1 = ec.reduce_members(z["ens_10u_246"], z["ens_10v_246"])
            mid = ec.interp_step(f0, f1, 240, 246, 243)
            hres240 = np.hypot(z["hres_10u_240"], z["hres_10v_240"])
            seam_raw.append(np.abs(mid["speed"] - hres240))
            seam_deb.append(np.abs(mid["speed"] * k_by_bin["B2_216_264"] - hres240))
            for L in range(222, 241, 6):
                if f"hres_10u_{L}" in z and f"hres_10u_{L - 6}" in z:
                    a = np.hypot(z[f"hres_10u_{L}"], z[f"hres_10v_{L}"])
                    b = np.hypot(z[f"hres_10u_{L - 6}"], z[f"hres_10v_{L - 6}"])
                    within_d.extend((np.abs(a - b) / 2.0).tolist())  # served 3 h step = half the 6 h change
    days = np.array(meta["day"])
    bins = np.array(bins_of(meta["lead"]), dtype=object)
    os_, od, og = (np.array(meta[k], dtype=float) for k in ("os", "od", "og"))
    E = {a: errors(*(np.array(cols[a][k], dtype=float) for k in ("u", "v", "s", "g")), os_, od, og) for a in ARMS}
    # chosen arm (pre-registered rule)
    m, lo, hi = paired(E["ens_mean_debias"], E["ens_mean_raw"], "ae", np.ones(len(days), bool), days)
    chosen = "ens_mean_debias" if hi < 0 else "ens_mean_raw"
    E_shift = {b: {"shift_mae": float(np.mean(v["shift"])) if v["shift"] else float("nan"),
                   "clim_mae": float(np.mean(v["clim"])) if v["clim"] else float("nan"), "n": len(v["shift"])}
               for b, v in shift[chosen].items()}
    # the seam of the CHOSEN arm: the de-bias factor only when the de-biased arm was chosen (fix 2026-11-16 00:20Z)
    seam_d = np.concatenate(seam_deb if chosen == "ens_mean_debias" else seam_raw).tolist() if seam_raw else []
    seam = {"seam_p95": float(np.nanpercentile(seam_d, 95)) if seam_d else float("nan"),
            "within_p95": float(np.nanpercentile(within_d, 95)) if within_d else float("nan"),
            "n_seam": len(seam_d), "n_within": len(within_d)}
    oev = np.where(np.isfinite(og), (og >= GUST_EVENT).astype(float), np.nan)
    for a in ARMS:
        E[a]["brier"] = (np.array(cols[a]["p"], dtype=float) - oev) ** 2
    n_events = int(np.nansum(oev))
    rows = {"E": E, "days": days, "bin": bins, "E_shift": E_shift, "n_events": n_events}
    rep = verdict(rows, chosen, seam)
    n_ndbc = sum(1 for s in stations if s["kind"] == "ndbc")
    n_asos = len(stations) - n_ndbc
    test_days = sorted({r[:8] for r in test_runs})
    void = []
    if n_ndbc < 30 or n_asos < 30:
        void.append(f"stations {n_ndbc} NDBC / {n_asos} ASOS (< 30)")
    if len(test_runs) < 60 or len(test_days) < 30:
        void.append(f"test half {len(test_runs)} runs over {len(test_days)} days")
    if len(dropped) > DROP_MAX * TOTAL_RUNS:
        void.append(f"{len(dropped)} of {TOTAL_RUNS} runs dropped (> {DROP_MAX:.0%})")
    if void:
        rep["verdict"] = "VOID"
    rep.update({"void_reasons": void, "k_by_bin": k_by_bin, "gefs_gust_factor": gf_gefs,
                "debias_vs_raw": {"diff_mae": m, "ci": [lo, hi]}, "fit_runs": len(fit_runs), "test_runs": len(test_runs),
                "dropped_runs": dropped, "aifs_gust_factor": gf_aifs, "n_gust_events": n_events,
                "csi_ge15": {a: csi(np.array(cols[a]["g"], dtype=float), og) for a in ARMS if a != "climatology"},
                "test_days": len(test_days), "stations": {"ndbc": n_ndbc, "asos": n_asos}})
    strata = {"pooled": np.ones(len(days), bool), "ndbc": np.array(meta["kind"]) == "ndbc",
              "asos": np.array(meta["kind"]) == "asos", "hawaii": np.array(meta["hawaii"], dtype=bool)}
    rep["metrics"] = {s: {b: {a: metrics(E[a], sm & (bins == b)) for a in ARMS} for b in BINS} for s, sm in strata.items()}
    json.dump(rep, open(os.path.join(out_dir, "report.json"), "w"), indent=1, default=float)
    with open(os.path.join(out_dir, "rows.csv"), "w", newline="") as f:
        wr = csv.writer(f)
        keys = list(meta)
        wr.writerow(keys + [f"{a}_{k}" for a in ARMS for k in ("u", "v", "s", "g", "p")])
        for n in range(len(days)):
            wr.writerow([meta[k][n] for k in keys] + [cols[a][k][n] for a in ARMS for k in ("u", "v", "s", "g", "p")])
    print(json.dumps({k: rep[k] for k in ("verdict", "chosen", "void_reasons", "k_by_bin", "stations", "test_runs")},
                     default=float))
    return 0
