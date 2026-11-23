"""wind_emos_fit.py - fit and score long-range wind EMOS against the PRE-REGISTERED gate. Serves nothing.

Pre-registration: docs/weather-program/log/2026-11-16-wind-emos-preregistration.md (gate + amendments 1-3).
Reads the collector's run files (scripts/wind_emos_collect.py: station values of 51 IFS ENS members at 6 leads), the
same station truth as the long-range hindcast, and the seasonal climatology (2016-2024). Two modes:

  python scripts/wind_emos_fit.py coverage --cache C --runs DIR      # the FIRST read: coverage only, no fit
  python scripts/wind_emos_fit.py score    --cache C --runs DIR --out O

`score` fits truncated-normal EMOS by minimum CRPS per cell (lead bin x network x region) on runs issued in
[T - 59 d, T - 14 d] for every TEST run T (issued 2026-01-01..2026-10-31), plus one fixed split (fit 2025-06-01..12-17).
"""
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import buoy_holdout  # noqa: E402
import emos_core as E  # noqa: E402
import wind_emos_collect as C  # noqa: E402
import wind_lr_obs as obs  # noqa: E402
from wind_lr_score import BINS, bin_of, day_block_ci  # noqa: E402

TEST = (datetime(2026, 1, 1, tzinfo=timezone.utc), datetime(2026, 10, 31, tzinfo=timezone.utc))
FIXED_FIT = (datetime(2025, 6, 1, tzinfo=timezone.utc), datetime(2025, 12, 17, tzinfo=timezone.utc))
TRAIN_FROM_D, TRAIN_TO_D = 59, 14          # amendment 1: runs issued in [T - 59 d, T - 14 d]
MIN_ROWS = 300
IFS_CYCLE_DATES: list = []          # set from ECMWF's change log before the one read (amendment 3 a); empty = not yet
REGIONS = ("us_east_gulf", "us_west", "hawaii", "alaska")


def region_of(st) -> str:
    lat, lon = st["lat"], st["lon"]
    if obs.is_hawaii(st):
        return "hawaii"
    if lat >= 50.0 or (lon < -130.0 and lat > 45.0):
        return "alaska"
    if 24.0 <= lat < 50.0 and -126.0 <= lon <= -100.0:
        return "us_west"
    if 24.0 <= lat < 50.0 and -100.0 < lon <= -65.0:
        return "us_east_gulf"
    return "other"                     # outside the four regions: not fitted, not served (amendment 1 item 4)


class ClimSample:
    """Seasonal climatology as a DISTRIBUTION (G5): observed speeds within +-15 d of day of year at the UTC hour."""

    def __init__(self, years, cap=400):
        self.v = {}
        for o in years:
            for t, (w, _g, _d) in o.items():
                if w != w or 10 < t.minute < 50:
                    continue
                tt = t + timedelta(minutes=30)
                self.v.setdefault((tt.timetuple().tm_yday, tt.hour), []).append(float(w))
        self.cap = cap

    def sample_cached(self, V):
        key = (V.timetuple().tm_yday, V.hour)
        cache = self.__dict__.setdefault("_cache", {})
        if key not in cache:
            cache[key] = self.sample(V)
        return cache[key]

    def sample(self, V):
        doy, h = V.timetuple().tm_yday, V.hour
        out = []
        for d in range(doy - 15, doy + 16):
            out.extend(self.v.get((((d - 1) % 366) + 1, h), []))
        if len(out) < 20:
            return None
        if len(out) > self.cap:                     # deterministic thinning
            out = out[:: max(1, len(out) // self.cap)][: self.cap]
        return np.asarray(out)


class FastObs:
    """Sorted-array truth for one station, equal in meaning to wind_lr_obs.wind_at / gust_window (pinned by
    tests/test_wind_emos_fit.py) but O(log n) per valid time: the full record is ~1.2 M rows."""

    def __init__(self, o, gust_absent_is_wind=False):
        items = sorted(o.items())
        t = np.array([k.timestamp() for k, _ in items], dtype=float)
        w = np.array([v[0] for _, v in items], dtype=float)
        g = np.array([v[1] for _, v in items], dtype=float)
        d = np.array([v[2] for _, v in items], dtype=float)
        okw = np.isfinite(w)
        self.tw, self.w, self.d = t[okw], w[okw], d[okw]
        gv = np.where(np.isfinite(g), g, w if gust_absent_is_wind else np.nan)
        okg = np.isfinite(gv)
        self.tg, self.g = t[okg], gv[okg]

    def wind_at(self, V, tol_s=1800.0):
        if self.tw.size == 0:
            return None
        x = V.timestamp()
        k = int(np.searchsorted(self.tw, x))
        best = None
        for j in (k - 1, k):
            if 0 <= j < self.tw.size and abs(self.tw[j] - x) <= tol_s:
                if best is None or abs(self.tw[j] - x) < abs(self.tw[best] - x):
                    best = j
        return (float(self.w[best]), float(self.d[best])) if best is not None else None

    def gust_window(self, V, hours=6):
        x = V.timestamp()
        lo = int(np.searchsorted(self.tg, x - hours * 3600.0, side="right"))
        hi = int(np.searchsorted(self.tg, x, side="right"))
        n = hi - lo
        return float(self.g[lo:hi].max()) if n and n >= 0.5 * hours else None


def load_truth(session, cache, stations):
    st_obs, clim = [], []
    end = TEST[1] + timedelta(days=15)
    for st in stations:
        if st["kind"] == "ndbc" and buoy_holdout.is_locked(st["id"]):
            o, years = {}, []            # a LOCKED buoy: its truth is never read, so it makes no row
        elif st["kind"] == "ndbc":
            z = st["anemometer_m"]
            o = dict(obs.ndbc_year(session, cache, st["id"], 2025))
            o.update(obs.ndbc_window(session, cache, st["id"], months=tuple((2026, m) for m in range(1, 10))))
            o = {t: (float(obs.to_10m(w, z)), float(obs.to_10m(g, z)) if g == g else g, d) for t, (w, g, d) in o.items()}
            years = [obs.ndbc_year(session, cache, st["id"], y) for y in range(2016, 2025)]
            years = [{t: (float(obs.to_10m(w, z)), g, d) for t, (w, g, d) in yo.items()} for yo in years]
        else:
            o = obs.asos_range(session, cache, st["id"], C.PERIOD[0], end)
            years = [obs.asos_range(session, cache, st["id"], datetime(2016, 1, 1, tzinfo=timezone.utc),
                                    datetime(2024, 12, 31, tzinfo=timezone.utc))]
        st_obs.append(FastObs(o, gust_absent_is_wind=st["kind"] == "asos"))
        clim.append(ClimSample(years))
    return st_obs, clim


def build_rows(run_dir, stations, st_obs, clim):
    """One row per (run, lead, station) with truth: member-mean speed m, member variance s2, raw-ensemble CRPS, the
    gust features, and the climatology CRPS."""
    names = sorted(f for f in os.listdir(run_dir) if f.endswith(".npz"))
    R = {k: [] for k in ("run", "lead", "st", "valid_day", "m", "s2", "raw_crps", "y", "gm", "gs2", "graw_crps", "yg",
                         "clim_crps", "net", "region")}
    for fn in names:
        run = datetime.strptime(fn[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        with np.load(os.path.join(run_dir, fn)) as z:
            for L in C.LEADS:
                spd = np.hypot(z[f"u_{L}"], z[f"v_{L}"]).astype(float)        # [51, stations]
                g = z[f"g_{L}"].astype(float)
                V = run + timedelta(hours=L)
                ys, ygs = [], []
                for i, st in enumerate(stations):
                    w = st_obs[i].wind_at(V)
                    gg = st_obs[i].gust_window(V, 6)
                    ys.append(w[0] if w else np.nan)
                    ygs.append(gg if gg is not None else np.nan)
                ys, ygs = np.array(ys), np.array(ygs)
                raw = E.crps_ensemble(spd, np.nan_to_num(ys))
                graw = E.crps_ensemble(g, np.nan_to_num(ygs))
                for i, st in enumerate(stations):
                    if not np.isfinite(ys[i]):
                        continue
                    cs = clim[i].sample_cached(V)
                    R["run"].append(fn[:10])
                    R["lead"].append(L)
                    R["st"].append(i)
                    R["valid_day"].append(V.strftime("%Y%m%d"))
                    R["m"].append(float(np.mean(spd[:, i])))
                    R["s2"].append(float(np.var(spd[:, i])))
                    R["raw_crps"].append(float(raw[i]))
                    R["y"].append(float(ys[i]))
                    R["gm"].append(float(np.mean(g[:, i])))
                    R["gs2"].append(float(np.var(g[:, i])))
                    R["graw_crps"].append(float(graw[i]) if np.isfinite(ygs[i]) else np.nan)
                    R["yg"].append(float(ygs[i]))
                    R["clim_crps"].append(float(E.crps_ensemble(cs[:, None], np.array([ys[i]]))[0]) if cs is not None else np.nan)
                    R["net"].append(st["kind"])
                    R["region"].append(region_of(st))
    return {k: np.array(v) for k, v in R.items()}


def gaps_over(missing, days=2):
    """Runs of consecutive missing 00Z days longer than `days`, as [first, last, length] (the commitment's '> 2 days')."""
    out, cur = [], []
    for r in sorted(missing):
        d = _run_dt(r)
        if cur and (d - _run_dt(cur[-1])).days == 1:
            cur.append(r)
        else:
            if len(cur) > days:
                out.append([cur[0], cur[-1], len(cur)])
            cur = [r]
    if len(cur) > days:
        out.append([cur[0], cur[-1], len(cur)])
    return out


def coverage(R, stations, run_dir) -> dict:
    """runs_missing counts every expected 00Z run with no stored file: a day a backfill shard failed or dropped is never
    stored, so it is missing here (advisor limit (1) on #1229). The daily era after PERIOD (2026-11-01 up to the newest
    stored run) is counted separately, so a lost daily run (2026-11-16 ECMWF 503, 11-19 storage 401) is reported too."""
    runs = sorted({r for r in R["run"]}) if len(R["run"]) else []
    present = sorted(f[:10] for f in os.listdir(run_dir) if f.endswith(".npz"))
    expected = [r.strftime("%Y%m%d%H") for r in C.runs_between(C.PERIOD[0], C.PERIOD[1])]
    newest = max((_run_dt(r) for r in present), default=None)
    daily = ([r.strftime("%Y%m%d%H") for r in C.runs_between(C.PERIOD[1] + timedelta(days=1), newest)]
             if newest and newest > C.PERIOD[1] else [])
    missing = sorted(set(expected) - set(present))
    missing_daily = sorted(set(daily) - set(present))
    return {"runs_expected": len(expected), "runs_present": len(present),
            "runs_missing": missing,
            "runs_missing_daily": missing_daily,
            "gaps_over_2_days": gaps_over(missing + missing_daily),
            "runs_with_truth": len(runs), "stations": len(stations),
            "stations_by_region": {g: int(sum(region_of(s) == g for s in stations)) for g in REGIONS + ("other",)},
            "leads": list(C.LEADS), "rows_with_truth": int(len(R["y"])),
            "rows_by_net": {n: int(np.sum(R["net"] == n)) for n in ("ndbc", "asos")},
            "rows_test": int(np.sum(np.array([_run_dt(r) >= TEST[0] for r in R["run"]], dtype=bool))) if len(R["run"]) else 0}


def _run_dt(r):
    return datetime.strptime(r, "%Y%m%d%H").replace(tzinfo=timezone.utc)


def _cells(R):
    b = np.array([bin_of(L) for L in R["lead"]], dtype=object)
    return b


def _cell_index(R, bins, run_ts):
    """{(bin, net, region): (row indices sorted by run time, their run times)} and the same per (bin, net)."""
    cells, pooled = {}, {}
    order = np.argsort(run_ts, kind="stable")
    for i in order:
        cells.setdefault((bins[i], R["net"][i], R["region"][i]), []).append(i)
        pooled.setdefault((bins[i], R["net"][i]), []).append(i)

    def finish(d):
        return {k: (np.array(v), run_ts[np.array(v)]) for k, v in d.items()}
    return finish(cells), finish(pooled)


def _window(idx_ts, t0, t1):
    idx, ts = idx_ts
    return idx[np.searchsorted(ts, t0, side="left"):np.searchsorted(ts, t1, side="right")]


def rolling_predict(R, feat=("m", "s2"), target="y"):
    """mu, sigma for every TEST row from its cell's fit on runs issued [T-59 d, T-14 d]; network-pooled fallback below
    MIN_ROWS. Returns (mu, sigma, b_by_cell, fallbacks)."""
    n = len(R[target])
    mu, sig = np.full(n, np.nan), np.full(n, np.nan)
    bins = _cells(R)
    run_ts = np.array([_run_dt(r).timestamp() for r in R["run"]])
    cells, pooled = _cell_index(R, bins, run_ts)
    finite = np.isfinite(R[target])
    b_by_cell, fallbacks, fallback_by_cell = {}, 0, {}
    test_ts = sorted({t for t in run_ts if TEST[0].timestamp() <= t <= TEST[1].timestamp()})
    day = 86400.0
    for T in test_ts:
        for key, idx_ts in cells.items():
            rows = _window(idx_ts, T, T)
            if rows.size == 0 or key[2] not in REGIONS:
                continue
            tr = _window(idx_ts, T - TRAIN_FROM_D * day, T - TRAIN_TO_D * day)
            tr = tr[finite[tr]]
            if tr.size < MIN_ROWS:
                tr = _window(pooled[key[:2]], T - TRAIN_FROM_D * day, T - TRAIN_TO_D * day)
                tr = tr[finite[tr]]
                fallbacks += 1
                fallback_by_cell["|".join(key)] = fallback_by_cell.get("|".join(key), 0) + 1
            if tr.size < MIN_ROWS:
                continue
            theta, _ = E.fit_emos(R[feat[0]][tr], R[feat[1]][tr], R[target][tr])
            m_, s_ = E.params_to_mu_sigma(theta, R[feat[0]][rows], R[feat[1]][rows])
            mu[rows], sig[rows] = m_, s_
            b_by_cell.setdefault("|".join(key), []).append(float(theta[1]))
    rolling_predict.last_fallbacks = fallback_by_cell     # reported per cell (amendment 3 b)
    return mu, sig, b_by_cell, fallbacks


def fixed_predict(R, feat=("m", "s2"), target="y", y_shift=0.0, fit_mask=None):
    n = len(R[target])
    mu, sig = np.full(n, np.nan), np.full(n, np.nan)
    bins = _cells(R)
    run_dt = np.array([_run_dt(r) for r in R["run"]])
    fit_rows = fit_mask if fit_mask is not None else (run_dt >= FIXED_FIT[0]) & (run_dt <= FIXED_FIT[1])
    test_rows = (run_dt >= TEST[0]) & (run_dt <= TEST[1])
    thetas = {}
    for b in BINS:
        for net in ("ndbc", "asos"):
            for g in REGIONS:
                cell = (bins == b) & (R["net"] == net) & (R["region"] == g)
                tr = fit_rows & cell & np.isfinite(R[target])
                if tr.sum() < MIN_ROWS:
                    continue
                theta, _ = E.fit_emos(R[feat[0]][tr], R[feat[1]][tr], R[target][tr] + y_shift)
                thetas[f"{b}|{net}|{g}"] = [float(x) for x in theta]
                rows = test_rows & cell
                m_, s_ = E.params_to_mu_sigma(theta, R[feat[0]][rows], R[feat[1]][rows])
                mu[rows], sig[rows] = m_, s_
    return mu, sig, thetas


def _boot_abs_bias_diff(e1, e0, days, reps=2000, seed=20261116):
    """CI of |mean(e1)| - |mean(e0)| with whole valid days resampled (G3)."""
    ok = np.isfinite(e1) & np.isfinite(e0)
    e1, e0, days = e1[ok], e0[ok], days[ok]
    if e1.size == 0:
        return (float("nan"),) * 3
    u, inv = np.unique(days, return_inverse=True)
    s1 = np.bincount(inv, weights=e1, minlength=len(u))
    s0 = np.bincount(inv, weights=e0, minlength=len(u))
    c = np.bincount(inv, minlength=len(u)).astype(float)
    pick = np.random.default_rng(seed).integers(0, len(u), size=(reps, len(u)))
    st = np.abs(s1[pick].sum(1) / c[pick].sum(1)) - np.abs(s0[pick].sum(1) / c[pick].sum(1))
    return float(abs(e1.mean()) - abs(e0.mean())), float(np.percentile(st, 2.5)), float(np.percentile(st, 97.5))


def _ci2(d, days):
    m, lo, hi = day_block_ci(d, days)
    _m, lo5, hi5 = day_block_ci(d, days, block_days=5)
    return {"diff": m, "ci": [lo, hi], "ci_5day": [lo5, hi5], "n": int(np.isfinite(d).sum())}


def score(R) -> dict:
    run_dt = np.array([_run_dt(r) for r in R["run"]])
    test = (run_dt >= TEST[0]) & (run_dt <= TEST[1])
    days, bins = R["valid_day"], _cells(R)
    mu, sig, b_by_cell, fallbacks = rolling_predict(R)
    emos_crps = E.crps_tn0(mu, sig, R["y"])
    med = E.median_tn0(mu, sig)
    out = {"lines": {}, "fallback_cells": fallbacks,
           "fallback_runs_by_cell": dict(getattr(rolling_predict, "last_fallbacks", {})),
           # amendment 3 (a): ECMWF IFS cycle implementation dates inside the period, filled from ECMWF's published
           # change log at read time and shown beside the fixed-split line (an UNSTABLE label may be a cycle change)
           "ifs_cycle_dates": IFS_CYCLE_DATES}
    ok_all = True
    for b in BINS:
        m = test & (bins == b) & np.isfinite(emos_crps)
        g1 = _ci2(np.where(m, emos_crps - R["raw_crps"], np.nan), days)
        g1["pass"] = bool(g1["ci"][1] < 0)
        g1["fragile"] = bool(g1["pass"] and not g1["ci_5day"][1] < 0)
        out["lines"][f"G1_crps_vs_raw_{b}"] = g1
        g2 = _ci2(np.where(m, np.abs(med - R["y"]) - np.abs(R["m"] - R["y"]), np.nan), days)
        g2["pass"] = bool(not g2["ci"][0] > 0)                  # NOT significantly worse
        out["lines"][f"G2_median_mae_vs_mean_{b}"] = g2
        g5 = _ci2(np.where(m, emos_crps - R["clim_crps"], np.nan), days)
        g5["label"] = "beats climatology" if g5["ci"][1] < 0 else "climatology-equivalent or worse"
        out["lines"][f"G5_crps_vs_clim_{b}"] = g5
        hm = m & (R["region"] == "hawaii")
        g4 = _ci2(np.where(hm, emos_crps - R["raw_crps"], np.nan), days)
        g4["hawaii_blocked"] = bool(g4["ci"][0] > 0)
        out["lines"][f"G4_hawaii_{b}"] = g4
        ok_all &= g1["pass"] and g2["pass"]
        # coverage of the central 80% interval (reported)
        lo, hi = E.quantile_tn0(mu[m], sig[m], 0.1), E.quantile_tn0(mu[m], sig[m], 0.9)
        out["lines"][f"R_cover80_{b}"] = {"coverage": float(np.mean((R["y"][m] >= lo) & (R["y"][m] <= hi))) if m.any() else float("nan"),
                                          "target": "0.80 +- 0.05"}
    tm = test & np.isfinite(emos_crps)
    top = tm & (R["y"] >= np.nanpercentile(R["y"][tm], 90)) if tm.any() else tm
    d3, lo3, hi3 = _boot_abs_bias_diff(np.where(top, med - R["y"], np.nan), np.where(top, R["m"] - R["y"], np.nan), days)
    out["lines"]["G3_top_decile_abs_bias"] = {"diff_abs_bias": d3, "ci": [lo3, hi3], "pass": bool(hi3 < 0)}
    ok_all &= hi3 < 0
    out["slope_b_by_cell"] = {k: {"median": float(np.median(v)), "p2_5": float(np.percentile(v, 2.5)),
                                  "p97_5": float(np.percentile(v, 97.5)), "n_fits": len(v),
                                  "climatology_equivalent": bool(np.percentile(v, 2.5) <= 0.0 <= np.percentile(v, 97.5))}
                              for k, v in b_by_cell.items()}
    # fixed split (reported; UNSTABLE when the sign disagrees with the rolling one)
    fmu, fsig, _th = fixed_predict(R)
    fcrps = E.crps_tn0(fmu, fsig, R["y"])
    for b in BINS:
        m = test & (bins == b) & np.isfinite(fcrps) & np.isfinite(emos_crps)
        fd = float(np.nanmean(fcrps[m] - R["raw_crps"][m])) if m.any() else float("nan")
        rd = out["lines"][f"G1_crps_vs_raw_{b}"]["diff"]
        out["lines"][f"R_fixed_split_{b}"] = {"diff_crps_vs_raw": fd, "unstable": bool(np.sign(fd) != np.sign(rd))}
    # controls (VOID)
    perm = np.arange(len(R["y"]))
    rng = np.random.default_rng(20261117)
    for key in set(zip(R["run"], R["lead"])):
        idx = np.where((R["run"] == key[0]) & (R["lead"] == key[1]))[0]
        perm[idx] = idx[rng.permutation(len(idx))]
    c1 = _ci2(np.where(tm, E.crps_tn0(mu, sig, R["y"][perm]) - emos_crps, np.nan), days)
    c1["pass"] = bool(c1["ci"][0] > 0)
    out["lines"]["C1_station_shuffle"] = c1
    _m0, _s0, th0 = fixed_predict(R)
    _m1, _s1, th1 = fixed_predict(R, y_shift=1.0)
    shifts = {k: th1[k][0] - th0[k][0] for k in th0 if k in th1}       # the intercept a moves by the seeded +1
    c2_ok = bool(shifts) and all(0.8 <= v <= 1.2 for v in shifts.values())
    out["lines"]["C2_seeded_bias"] = {"intercept_shift_by_cell": shifts, "pass": c2_ok}
    lmu, lsig, _ = fixed_predict(R, fit_mask=test)            # leak: fit on the test rows themselves
    lcrps = E.crps_tn0(lmu, lsig, R["y"])
    both = tm & np.isfinite(lcrps)
    c3 = float(np.nanmean(lcrps[both]) - np.nanmean(emos_crps[both])) if both.any() else float("nan")
    out["lines"]["C3_leak_plumbing"] = {"diff_crps_leaked_minus_clean": c3, "pass": bool(c3 < 0)}
    controls = all(out["lines"][k]["pass"] for k in ("C1_station_shuffle", "C2_seeded_bias", "C3_leak_plumbing"))
    out["controls_ok"] = controls
    out["verdict"] = "VOID" if not controls else ("PASS" if ok_all else "FAIL")
    if out["verdict"] == "PASS" and any(v.get("fragile") for v in out["lines"].values() if isinstance(v, dict)):
        out["verdict_label"] = "PASS (FRAGILE)"
    # amendment 5: CRPS(EMOS) - CRPS(raw) for TEST runs before vs after the control left the ef files (reported)
    switch = datetime(2026, 5, 13, tzinfo=timezone.utc)
    for b in BINS:
        for name, sel in (("before", run_dt < switch), ("after", run_dt >= switch)):
            m = test & sel & (bins == b) & np.isfinite(emos_crps)
            d = _ci2(np.where(m, emos_crps - R["raw_crps"], np.nan), days)
            out["lines"][f"R_members_{name}_2026-05-13_{b}"] = dict(d, reported_only=True)
    out["test_rows"] = int(tm.sum())
    return out


def main(argv=None) -> int:
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["coverage", "score"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--runs", required=True)
    ap.add_argument("--out", default=None)
    a = ap.parse_args(argv)
    s = requests.Session()        # no credential: runs and stations were fetched by the storage-only step
    stations = C.load_stations(a.cache)
    st_obs, clim = load_truth(s, a.cache, stations)
    R = build_rows(a.runs, stations, st_obs, clim)
    rep = {"coverage": coverage(R, stations, a.runs)}
    if a.cmd == "score":
        rep.update(score(R))
    out = a.out or os.path.join(a.cache, f"emos_{a.cmd}.json")
    json.dump(rep, open(out, "w"), indent=1, default=float)
    print(json.dumps({k: rep[k] for k in rep if k in ("coverage", "verdict", "verdict_label", "controls_ok")}, default=float)[:4000])
    return 0


if __name__ == "__main__":
    sys.exit(main())
