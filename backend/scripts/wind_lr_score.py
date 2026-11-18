"""wind_lr_score.py - score the long-range wind hindcast against the PRE-REGISTERED gate. Serves nothing.

Gate: docs/weather-program/log/2026-11-15-wind-long-range.md, 21:45Z + amendments 1-4. Every PASS line is read on the
TEST block (runs started in October 2026); the FIT block (runs started 09-01..09-24, amendment 4) only fits the
non-primary de-bias factor k and the GEFS/AIFS gust factors. P1 and P2 share ONE row set (amendment 4). Day-block
bootstrap over valid-time UTC dates (1-day blocks decide; 5-day blocks are reported, and a line that passes at 1 day
but fails at 5 is labelled FRAGILE), 2000 resamples, seed 20261115, 95% percentile interval. VOID controls: C2
(seeded +1 m/s), C3 (stations shuffled), C4 (+48 h time shift); C1 is reported only (amendment 4).

The pure scoring functions (`bins_of`, `day_block_ci`, `metrics`, `verdict`) are unit-tested on synthetic rows
(tests/test_wind_lr_score.py), including every control.
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
        "aifs_ens_mean", "grand_ifs_gefs", "grand_ifs_gefs_aifs", "ens_lag24", "ens_lag48"]
# Amendment 3: reported-only arms (no PASS line); compared per bin against these
REPORTED_ARMS = ["aifs_ens_mean", "grand_ifs_gefs", "grand_ifs_gefs_aifs", "ens_lag24", "ens_lag48", "gefs_mean", "ens_cf"]
REPORTED_VS = ["loop", "gfs_standin", "ens_mean_raw", "climatology"]
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


def _block_ids(days: np.ndarray, block_days: int) -> np.ndarray:
    """Valid-date strings (YYYYMMDD) -> block ids of `block_days` consecutive calendar days."""
    if block_days <= 1:
        return days
    ords = np.array([datetime.strptime(str(d), "%Y%m%d").toordinal() if len(str(d)) == 8 else int(d) for d in days])
    return ords // int(block_days)


def day_block_ci(diff: np.ndarray, days: np.ndarray, reps: int = REPS, seed: int = SEED, block_days: int = 1):
    """(mean, lo, hi) of the mean of `diff` with whole valid-days (or `block_days`-day blocks) resampled. NaN rows
    dropped."""
    ok = np.isfinite(diff)
    diff, days = diff[ok], _block_ids(np.asarray(days)[ok], block_days) if ok.any() else np.asarray(days)[ok]
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
    return {"fs": np.asarray(fc_spd, dtype=float), "os": np.asarray(ob_spd, dtype=float),
            "ae": np.abs(fc_spd - ob_spd), "err": fc_spd - ob_spd,
            "vsq": (fc_u - ob_u) ** 2 + (fc_v - ob_v) ** 2, "dae": dir_err,
            "gae": np.abs(fc_gust - ob_gust), "gerr": fc_gust - ob_gust}


def metrics(e: Dict[str, np.ndarray], mask: np.ndarray) -> dict:
    def m(x):
        x = x[mask & np.isfinite(x)]
        return float(x.mean()) if x.size else float("nan"), int(x.size)
    ae, n = m(e["ae"])
    vs, _ = m(e["vsq"])
    sd_ratio, top_bias, dec_bias = float("nan"), float("nan"), float("nan")
    if "fs" in e and "os" in e:
        ok = mask & np.isfinite(e["fs"]) & np.isfinite(e["os"])
        if ok.sum() > 2 and np.std(e["os"][ok]) > 0:
            sd_ratio = float(np.std(e["fs"][ok]) / np.std(e["os"][ok]))     # < 1: the forecast is too smooth
            top = ok & (e["os"] >= np.percentile(e["os"][ok], 100 * 2 / 3))
            top_bias = float(np.mean(e["fs"][top] - e["os"][top])) if top.any() else float("nan")
            dec = ok & (e["os"] >= np.percentile(e["os"][ok], 90))       # director 2026-11-16: the windiest decile
            dec_bias = float(np.mean(e["fs"][dec] - e["os"][dec])) if dec.any() else float("nan")
    return {"speed_mae": ae, "n": n, "speed_bias": m(e["err"])[0], "vector_rmse": math.sqrt(vs) if vs == vs else vs,
            "sd_ratio": sd_ratio, "bias_top_third_obs": top_bias, "bias_top_decile_obs": dec_bias,
            "dir_mae_ge3": m(e["dae"])[0], "n_dir": m(e["dae"])[1], "gust_mae": m(e["gae"])[0],
            "gust_bias": m(e["gerr"])[0], "n_gust": m(e["gae"])[1]}


def paired(ea, eb, key, mask, days):
    d = ea[key] - eb[key]
    return day_block_ci(np.where(mask, d, np.nan), days)


def _line(ea, eb, key, mask, days, value_key):
    """A PASS line: 1-day blocks decide; 5-day blocks reported; FRAGILE when it passes at 1 day but not at 5."""
    d = np.where(mask, ea[key] - eb[key], np.nan)
    n = int(np.isfinite(d).sum())
    m, lo, hi = day_block_ci(d, days)
    _m5, lo5, hi5 = day_block_ci(d, days, block_days=5)
    passed = bool(hi < 0)
    return {value_key: m, "ci": [lo, hi], "ci_5day": [lo5, hi5], "n": n, "pass": passed,
            "fragile": bool(passed and not hi5 < 0)}


def verdict(rows: dict, chosen: str, seam: dict) -> dict:
    """Apply P1-P5, R1, C2-C4 (+ reported C1) to the error columns in `rows` (TEST block only)."""
    E, days, b = rows["E"], rows["days"], rows["bin"]
    out = {"chosen": chosen, "lines": {}}
    ok_all = True
    for name in BINS:
        mask = b == name
        # R1 first: the SKILL line (amendment 4); P1/P2 are easy for any smooth field
        m, lo, hi = paired(E[chosen], E["climatology"], "ae", mask, days)
        out["lines"][f"R1_{name}"] = {"diff_mae_vs_clim": m, "ci": [lo, hi],
                                      "label": "skill" if hi < 0 else "low skill"}
        # P1 and P2 on ONE row set: chosen, loop and gfs_standin all present (amendment 4)
        common = mask & np.isfinite(E[chosen]["ae"]) & np.isfinite(E["loop"]["ae"]) & np.isfinite(E["gfs_standin"]["ae"])
        for comp, line in (("loop", "P1"), ("gfs_standin", "P2")):
            out["lines"][f"{line}_{name}"] = _line(E[chosen], E[comp], "ae", common, days, "diff_mae")
            ok_all &= out["lines"][f"{line}_{name}"]["pass"]
        assert out["lines"][f"P1_{name}"]["n"] == out["lines"][f"P2_{name}"]["n"], "P1/P2 row sets differ"
        # C1 REPORTED only (amendment 4): shifted +48 h vs climatology
        sh = rows["E_shift"][name]
        out["lines"][f"R_C1_{name}"] = {**sh, "shift_loses_to_clim": bool(sh["shift_mae"] > sh["clim_mae"]),
                                         "reported_only": True}
        # C3 VOID control: stations shuffled within (run, lead) must be WORSE (CI lower > 0)
        if "ae_shuffled" in rows:
            d3 = np.where(mask, rows["ae_shuffled"] - E[chosen]["ae"], np.nan)
            m3, lo3, hi3 = day_block_ci(d3, days)
            out["lines"][f"C3_{name}"] = {"diff_mae_shuffled": m3, "ci": [lo3, hi3], "pass": bool(lo3 > 0)}
        # C4 VOID control: the +48 h shifted arm must NOT be significantly better than unshifted
        if "ae_shift48" in rows:
            d4 = np.where(mask, rows["ae_shift48"] - E[chosen]["ae"], np.nan)
            m4, lo4, hi4 = day_block_ci(d4, days)
            out["lines"][f"C4_{name}"] = {"diff_mae_shift48": m4, "ci": [lo4, hi4], "n": int(np.isfinite(d4).sum()),
                                          "pass": not bool(hi4 < 0)}
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
    out["lines"]["P3_gust_pooled"] = _line(E[chosen], E["loop"], "gae", allmask, days, "diff_gust_mae")
    ok_all &= out["lines"]["P3_gust_pooled"]["pass"]
    # P5 gust peak (amendment 2): Brier for gust >= 15 m/s vs loop AND gfs_standin, pooled; UNDERPOWERED < 30 events
    n_ev = int(rows.get("n_events", 0))
    p5 = {}
    for comp in ("loop", "gfs_standin"):
        if "brier" in E[chosen] and "brier" in E[comp]:
            ln = _line(E[chosen], E[comp], "brier", allmask, days, "diff_brier")
            p5[comp] = dict(ln, beats=ln["pass"])
    if n_ev < EVENTS_MIN:
        out["lines"]["P5_gust_peak"] = {"vs": p5, "n_events": n_ev, "pass": True, "status": "UNDERPOWERED (not blocking)"}
    else:
        p5_ok = bool(p5) and all(v["beats"] for v in p5.values())
        out["lines"]["P5_gust_peak"] = {"vs": p5, "n_events": n_ev, "pass": p5_ok}
        ok_all &= p5_ok
    p4 = seam.get("seam_p95", float("nan")) <= seam.get("within_p95", float("nan"))
    out["lines"]["P4_seam_euro"] = {**seam, "pass": bool(p4)}
    ok_all &= bool(p4)
    controls_ok = all(v["pass"] for k, v in out["lines"].items() if k.startswith(("C2_", "C3_", "C4_")))
    out["controls_ok"] = controls_ok
    out["verdict"] = "VOID" if not controls_ok else ("PASS" if ok_all else "FAIL")
    out["fragile_lines"] = sorted(k for k, v in out["lines"].items() if isinstance(v, dict) and v.get("fragile"))
    if out["verdict"] == "PASS" and out["fragile_lines"]:
        out["verdict_label"] = "PASS (FRAGILE: " + ", ".join(out["fragile_lines"]) + ")"
    out["note"] = "P4 is the EURO seam only; the ICON seam is read forward on >= 10 live runs (pre-registered)."
    return out


# ---------------------------------------------------------------------------------------------- assembly
def _grand(parts, gust):
    """Equal-weight grand ensemble (amendment 3): speed = mean of the systems' speeds, direction from the mean of their
    mean vectors. parts = [(u, v, speed), ...]."""
    sp = np.mean([p[2] for p in parts], axis=0)
    u = np.mean([p[0] for p in parts], axis=0)
    v = np.mean([p[1] for p in parts], axis=0)
    mag = np.hypot(u, v)
    scale = np.where(mag > 1e-6, sp / np.where(mag > 1e-6, mag, 1.0), 0.0)
    return (u * scale, v * scale, sp, gust)


def _arm_fields(z, L, k_by_bin, gf_gefs, gf_aifs=1.0, lags=None):
    """{arm: (u, v, speed, gust)} at lead L for every station from one run's npz."""
    out = {}
    U, V, G = z[f"ens_10u_{L}"], z[f"ens_10v_{L}"], z[f"ens_10fg_{L}"]
    r = ec.reduce_members(U, V, G)
    out["ens_mean_raw"] = (r["u"], r["v"], r["speed"], r["gust"])
    k = k_by_bin.get(bin_of(L), 1.0)
    out["ens_mean_debias"] = (r["u"] * k, r["v"] * k, r["speed"] * k, r["gust"])
    if int(z["ens_has_cf"]) if "ens_has_cf" in z else True:   # amendment 5: no control after 2026-05-13 00Z
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
    ifs = (r["u"], r["v"], r["speed"])
    if "gefs_mean" in out:
        g = out["gefs_mean"][:3]
        out["grand_ifs_gefs"] = _grand([ifs, g], r["gust"])
        if "aifs_ens_mean" in out:
            out["grand_ifs_gefs_aifs"] = _grand([ifs, g, out["aifs_ens_mean"][:3]], r["gust"])
    for lag, zl in (lags or {}).items():          # the run `lag` h earlier, at lead L + lag (<= 360 h)
        Ll = L + lag
        if zl is not None and f"ens_10u_{Ll}" in zl:
            rl = ec.reduce_members(zl[f"ens_10u_{Ll}"], zl[f"ens_10v_{Ll}"], zl[f"ens_10fg_{Ll}"])
            out[f"ens_lag{lag}"] = (rl["u"], rl["v"], rl["speed"], rl["gust"])
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


def _debias_by_network(E, meta, days, bins) -> dict:
    """REPORTED ONLY (senior lead 2026-11-16): the de-bias factor is fitted on September, when only ASOS has truth
    (NDBC realtime2 starts 10-02), so its October effect is shown per network: de-biased minus raw speed MAE."""
    kinds = np.array(meta["kind"])
    out = {}
    for net in ("asos", "ndbc"):
        for b in BINS:
            m, lo, hi = paired(E["ens_mean_debias"], E["ens_mean_raw"], "ae", (kinds == net) & (bins == b), days)
            out[f"{net}_{b}"] = {"diff_mae": m, "ci": [lo, hi]}
    return out


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
    fit_runs = [r for r in runs if r[4:6] == "09" and int(r[6:8]) <= 24]   # amendment 4: no shared observations
    test_runs = [r for r in runs if r[4:6] == "10"]
    # a drop marker counts only while its run file is still missing (FILL mode re-collects a reused run's drops)
    dropped = sorted({f.split(".")[0] for f in os.listdir(run_dir) if f.endswith((".failed.json", ".missing.json"))
                      and not os.path.exists(os.path.join(run_dir, f.split(".")[0] + ".npz"))})

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
    shift_rows = {arm: [] for arm in shift}        # per row, aligned with meta (C4, amendment 4)
    seam_raw, seam_deb, within_d = [], [], []
    def _lagged(run_dt, lag):
        fn_l = f"{run_dt - timedelta(hours=lag):%Y%m%d%H}.npz"
        return np.load(os.path.join(run_dir, fn_l)) if fn_l in runs else None
    for fn in test_runs:
        z = np.load(os.path.join(run_dir, fn))
        run_dt = datetime.strptime(fn[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        lags = {24: _lagged(run_dt, 24), 48: _lagged(run_dt, 48)}
        for L in SCORED_LEADS:
            af = _arm_fields(z, L, k_by_bin, gf_gefs, gf_aifs, lags)
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
                for arm in shift:
                    shift_rows[arm].append(abs(float(af[arm][2][i]) - w2[0]) if w2 else float("nan"))
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
    # C3: observations permuted across stations within each (run, lead), seeded (amendment 4)
    rng = np.random.default_rng(SEED + 3)
    perm = np.arange(len(days))
    groups: dict = {}
    for n_, key in enumerate(zip(meta["run"], meta["lead"])):
        groups.setdefault(key, []).append(n_)
    for idx in groups.values():
        idx = np.asarray(idx)
        perm[idx] = idx[rng.permutation(len(idx))]
    fs_chosen = np.array(cols[chosen]["s"], dtype=float)
    rows = {"E": E, "days": days, "bin": bins, "E_shift": E_shift, "n_events": n_events,
            "ae_shuffled": np.abs(fs_chosen - os_[perm]), "ae_shift48": np.array(shift_rows[chosen], dtype=float)}
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
                "retries_by_shard": {f: json.load(open(os.path.join(run_dir, f))) for f in sorted(os.listdir(run_dir))
                                     if f.endswith(".retries.json")},
                "debias_by_network": _debias_by_network(E, meta, days, bins),
                "reported_arms": {a: {f"vs_{c}_{b}": dict(zip(("diff_mae", "lo", "hi"), paired(E[a], E[c], "ae", bins == b, days)))
                                      for c in REPORTED_VS for b in BINS} for a in REPORTED_ARMS},
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
