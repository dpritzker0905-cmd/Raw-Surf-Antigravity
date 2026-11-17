"""G3t gate: tide + mean level + seasonal anomaly vs OBSERVED water (registered: docs/weather-program/log/
2026-11-15-claude-tide-m1.md, G3t FINAL b6eb66fa6). OFFLINE ONLY, measurement only: no bucket write, nothing served, no
live backend. PyFES is GPL (offline here, never in the served backend).

Order (registered): S1 PREFLIGHT (a failure is NO VERDICT, decided before any truth) -> FES -> S1 = M + S at every
point -> Open-Meteo references C / D (test only) -> TRUTH LAST (CO-OPS, UHSLC, any open-coast IOOS gauge) -> score.
The log carries stage names and memory only; scores reach only the step summary and the artifact.
"""
import argparse
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "tide_g3"))
sys.path.insert(0, str(HERE.parent / "tide_fes"))
import g3t_rules as R                                            # noqa: E402
import g3_metrics as G                                           # noqa: E402  (bootstrap, label swap, RMSE helpers)
import g3_sources as GS                                          # noqa: E402  (S1 altimetry, Open-Meteo runs)
import arms                                                      # noqa: E402  (tide_fes: FES evaluator, NOAA control)
import metrics as M2                                             # noqa: E402  (tide_fes: extrema, MLLW, strata)
import sources as S                                              # noqa: E402  (tide_fes: CO-OPS, AVISO)
from fes_gate import FES_CONSTITUENTS, IDS, NTDE_STEP_MIN, ntde_dates, rss_mb   # noqa: E402

STATIONS = json.loads((HERE / "g3t_stations.json").read_text(encoding="utf-8"))
UHSLC_ERDDAP = "https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_fast.json"
IOOS_ERDDAP = "https://erddap.sensors.ioos.us/erddap/tabledap/{did}.json"
YEAR0 = R.W0 - timedelta(days=365)
SEEN = ("Before the run: IOOS/Hohonu and UHSLC station METADATA and maps only (lists fixed in g3t_stations.json); "
        "Duck's actual_range attribute (whole record) was seen. No water value in the window was read.")
log = S.log
_get_json_once = S.get_json


def _get_json_retry(url):
    """CO-OPS, UHSLC and Open-Meteo throttle bursts: retry an empty answer with a short backoff."""
    import time
    d = {}
    for k in range(5):
        d = _get_json_once(url)
        if d and any(key in d for key in ("data", "predictions", "hourly", "stations", "datums", "HarmonicConstituents",
                                          "table")):
            time.sleep(0.2)
            return d
        time.sleep(2 + 3 * k)
    return d


S.get_json = _get_json_retry


def stage(name):
    log(f"stage {name} | peak RSS {rss_mb()} MB")


def coops_obs_pred(sid, a, b):
    """Hourly observed (on the hour) and predicted water, station MSL, over [a, b] in 30-day requests."""
    o, p = {}, {}
    t = a
    while t <= b:
        u = min(t + timedelta(days=30) - timedelta(hours=1), b)
        p.update(S.coops_series(sid, "predictions", t, u, "h"))
        o.update({k: v for k, v in S.coops_series(sid, "water_level", t, u, key="data").items() if k.minute == 0})
        t = u + timedelta(hours=1)
    return o, p


def coops_hilo_window(sid):
    ev = []
    for a, b in R.segments():                                # held-out weeks are never requested
        t = a
        while t <= b:
            u = min(t + timedelta(days=30), b)
            ev += S.coops_hilo(sid, t, u)
            t = u + timedelta(minutes=1)
    return [e for e in ev if R.W0 <= e[0] <= R.W1 and not any(a <= e[0] < b for a, b in R.HELD_OUT)]


def uhslc_hourly(uid, a, b):
    """UHSLC fast-delivery hourly sea level (m, station zero) {aware hour: m}, over [a, b] inclusive (hourly data: b is
    the segment's last hour, so no held-out hour is requested)."""
    url = (f"{UHSLC_ERDDAP}?time,sea_level&uhslc_id={uid}&time%3E={a:%Y-%m-%dT%H:%M:%SZ}"
           f"&time%3C={b:%Y-%m-%dT%H:%M:%SZ}")
    rows = (S.get_json(url).get("table") or {}).get("rows") or []
    out = {}
    for t, v in rows:
        if v is not None and abs(v) < 30000:
            out[datetime.fromisoformat(t.replace("Z", "+00:00"))] = float(v) / 1000.0
    return out


def ioos_hourly(did, a, b):
    """IOOS (Hohonu) water level above NAVD88, provider QC pass only (qc_agg == 1), hourly means {aware hour: m}.
    Sub-hourly data: requested over [a, b) with a STRICT upper bound (b = the segment end + 30 min, never a held-out
    hour); each value is labelled with its NEAREST hour, so the mean of h-30 .. h+30 min sits on hour h."""
    url = (IOOS_ERDDAP.format(did=did) + "?time,water_surface_above_navd88,water_surface_above_navd88_qc_agg"
           f"&time%3E={a:%Y-%m-%dT%H:%M:%SZ}&time%3C{b:%Y-%m-%dT%H:%M:%SZ}")
    rows = (S.get_json(url).get("table") or {}).get("rows") or []
    acc = {}
    for t, v, q in rows:
        if v is None or q != 1:
            continue
        h = (datetime.fromisoformat(t.replace("Z", "+00:00")) + timedelta(minutes=30)).replace(minute=0, second=0,
                                                                                                microsecond=0)
        acc.setdefault(h, []).append(float(v))
    return {h: float(np.mean(v)) for h, v in acc.items()}


def references(pts, hours):
    """TEST-ONLY C (72 h de-mean) and D (365-day pre-window mean) from Open-Meteo previous runs; gate bins and latest."""
    C, D, CL, DL = {}, {}, {}, {}
    for sid, (la, lo) in pts.items():
        runs = GS.om_runs(la, lo, (R.W0 - timedelta(days=3)).date(), (R.W1 + timedelta(days=3)).date(), S.get_json)
        year = GS.om_runs(la, lo, YEAR0.date(), (R.W0 - timedelta(days=1)).date(), S.get_json)[0]
        mean365 = float(np.mean(list(year.values()))) if len(year) >= 330 * 24 else float("nan")
        rows_c, rows_d = [], []
        for b in (R.LATEST_BIN, *R.GATE_BINS):
            r = runs.get(b, {})
            c, d = np.full(len(hours), np.nan), np.full(len(hours), np.nan)
            by_day = {}
            for u, v in r.items():
                by_day.setdefault(u.date(), []).append(v)
            day72 = {}                                       # the 72 h mean from each day's 00Z, computed once per day
            for t in hours:
                day = t.date()
                if day not in day72:
                    win = [v for k in range(3) for v in by_day.get(day + timedelta(days=k), [])]
                    day72[day] = float(np.mean(win)) if len(win) >= 60 else float("nan")
            for i, t in enumerate(hours):
                if t in r:
                    if math.isfinite(day72[t.date()]):
                        c[i] = r[t] - day72[t.date()]
                    if math.isfinite(mean365):
                        d[i] = r[t] - mean365
            rows_c.append(c)
            rows_d.append(d)
        CL[sid], DL[sid] = rows_c[0][None, :], rows_d[0][None, :]
        C[sid], D[sid] = np.vstack(rows_c[1:]), np.vstack(rows_d[1:])
    return C, D, CL, DL


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fes-cache", default="fes_cache")
    ap.add_argument("--work", default="g3t_work")
    ap.add_argument("--download-fes-only", action="store_true")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    args = ap.parse_args()
    if args.download_fes_only:
        files = S.download_fes(FES_CONSTITUENTS, Path(args.fes_cache))
        missing = sorted(set(FES_CONSTITUENTS) - set(files))
        if missing:
            raise SystemExit(f"FES constituents still missing: {missing}")
        return
    work = Path(args.work)
    work.mkdir(parents=True, exist_ok=True)
    stage("start")

    # 1. S1 PREFLIGHT, before any truth. S1 is the hypothesis: a failure is NO VERDICT (A alone already failed G2).
    s1_ok, s1_why = GS.s1_preflight(work / "cm")
    stage(f"s1 preflight {'ok' if s1_ok else 'FAILED'}")
    if not s1_ok:
        report = {"registration": R.REGISTRATION, "verdict": "NO VERDICT", "why": f"S1 preflight failed: {s1_why}",
                  "truth_fetched": False}
        print(json.dumps(report, indent=1))
        if args.summary:
            with open(args.summary, "a", encoding="utf-8") as fh:
                fh.write(f"## Tide M1 gate G3t: **NO VERDICT** (S1 preflight failed before any truth)\n")
        return

    hours = R.window_hours()
    H = len(hours)
    meta = {sid: S.station_meta(sid) for sid in IDS}
    pts = {sid: (m[0], m[1]) for sid, m in meta.items() if m[0] is not None}
    uh = {f"uhslc{x['uhslc_id']}": (x["lat"], x["lon"]) for x in STATIONS["uhslc_non_us"]}
    beach = {x["dataset_id"]: (x["lat"], x["lon"]) for x in STATIONS["ioos_hohonu"] if x["exposure"] == "open"}
    allpts = {**pts, **uh, **beach}

    # 2. FES2022b tide (arm A) at every point; fine + 19-year series at the 26 gauges for item 4.
    files = S.download_fes(FES_CONSTITUENTS, Path(args.fes_cache))
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    for name, path in files.items():
        S.subset_fes(path, name, allpts, boxes, scratch)
    stage("fes subset")
    fine = [R.W0 + timedelta(minutes=6 * k) for k in range(int((R.W1 - R.W0).total_seconds() // 360) + 1)]
    A, A_fine, A_ntde = {}, {}, {}
    for sid, (la, lo) in allpts.items():
        extra = [] if sid not in pts else [arms.to_np(fine), ntde_dates()]
        v = arms.fes_eval(boxes / sid, la, lo, np.concatenate([arms.to_np(hours), *extra]))
        if v is not None:
            A[sid] = np.tile(v[:H], (len(R.GATE_BINS), 1))
            if sid in pts:
                A_fine[sid], A_ntde[sid] = v[H:H + len(fine)], v[H + len(fine):]
    stage("arm A")

    # 3. S1 = M + S at every point (serial: netCDF4/HDF5 is not thread-safe, G3 run 44011150843).
    Mc, Sd, Mtr, s1_cells = {}, {}, {}, {}
    mid_w = R.W0 + (R.W1 - R.W0) / 2
    for sid, (la, lo) in allpts.items():
        try:
            ser, info = GS.s1_cell_series(la, lo, work / "cm" / sid, R.BASE)
        except Exception as e:                                                   # noqa: BLE001 - recorded per point
            ser, info = None, str(e)[:160]
        if ser is None:
            s1_cells[sid] = {"unavailable": info}
            stage(f"s1 {sid} unavailable")
            continue
        m, s = R.split_s1({int(k): float(v) for k, v in ser.groupby(ser.index.dayofyear).mean().items()})
        x = np.array([(t - ser.index[0]).days for t in ser.index], float)
        slope = float(np.polyfit(x, ser.values.astype(float), 1)[0]) if len(x) > 365 else 0.0
        base_mid = datetime(2021, 1, 1, tzinfo=timezone.utc)
        Mc[sid], Sd[sid] = m, s
        Mtr[sid] = R.trend_carried_m((mid_w - base_mid).days, slope, m)
        s1_cells[sid] = {**info, "M_m": round(m, 4), "trend_m_per_yr": round(slope * 365.25, 5)}
        stage(f"s1 {sid}")

    # 4. TEST-ONLY references C and D (gate bins + latest run, reported).
    C, D, CL, DL = references(allpts, hours)
    stage("references C D")

    # 5. TRUTH, LAST.
    obs, pred, datum, hilo, Pc = {}, {}, {}, {}, {}
    for sid in pts:
        o, p = {}, {}
        for a, b in R.segments():                            # held-out weeks are never requested
            oo, pp = coops_obs_pred(sid, a, b)
            o.update(oo)
            p.update(pp)
        obs[sid] = np.array([o.get(t, np.nan) for t in hours])
        pred[sid] = np.array([p.get(t, np.nan) for t in hours])
        datum[sid] = S.coops_msl_minus_mllw(sid)
        hilo[sid] = coops_hilo_window(sid)
        hc = S.coops_harcon(sid)
        try:
            Pc[sid] = arms.harcon_eval(hc, arms.to_np(hours)) if hc else None
        except Exception as e:                                                   # noqa: BLE001
            log(f"{sid} positive control: {str(e)[:120]}")
            Pc[sid] = None
        stage(f"truth {sid}")
    for sid in uh:
        o = {}
        for a, b in R.segments():
            o.update(uhslc_hourly(int(sid[5:]), a, b))
        obs[sid] = np.array([o.get(t, np.nan) for t in hours])
    for sid in beach:
        o = {}
        for a, b in R.segments():
            o.update(ioos_hourly(sid, a, b + timedelta(minutes=30)))
        obs[sid] = R.qc_series(np.array([o.get(t, np.nan) for t in hours]))
    stage("truth other")

    report = score(dict(A=A, M=Mc, S=Sd, Mtr=Mtr, C=C, D=D, CL=CL, DL=DL, obs=obs, pred=pred, datum=datum, hilo=hilo,
                        Pc=Pc, A_fine=A_fine, A_ntde=A_ntde, fine=fine, hours=hours, s1_cells=s1_cells,
                        pts=list(pts), uh=list(uh), beach=list(beach)))
    stage("scored")
    print(json.dumps(report, indent=1, default=str))
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(markdown(report))
    stage("done")


def build_arms(x):
    """Arm series per point, (2, H) on the gate bins."""
    hours, A, M, Sd, Mtr = x["hours"], x["A"], x["M"], x["S"], x["Mtr"]
    am = {g: A[g] + R.series_on(hours, M[g]) for g in A if g in M}
    p = {g: A[g] + R.series_on(hours, M[g], Sd[g]) for g in A if g in M}
    psh = {g: A[g] + R.series_on(hours, M[g], R.shifted(Sd[g])) for g in A if g in M}
    ptr = {g: A[g] + R.series_on(hours, Mtr[g], Sd[g]) for g in A if g in Mtr}
    return {"A": dict(A), "A+M": am, "P": p, "A+M+S_shifted_reported": psh, "A+Mtrend+S_reported": ptr,
            "C_reference": dict(x["C"]), "D_reference": dict(x["D"])}


def _med(v):
    v = [float(a) for a in v if a is not None and math.isfinite(float(a))]
    return round(float(np.median(v)), 4) if v else None


def score(x):
    arms_, obs, hours = build_arms(x), x["obs"], x["hours"]
    H = len(hours)
    P, D, C = arms_["P"], arms_["D_reference"], arms_["C_reference"]
    gauges0 = [g for g in x["pts"]]
    excluded = R.excluded_gauges(P, D, obs, gauges0)
    cov_void = R.coverage_void(len(excluded), len(gauges0))
    gauges = sorted(g for g in gauges0 if g not in excluded and g in C)

    def pmd(a, b, gs=None, ob=obs):
        return G.paired_median_diff(a, b, ob, gs if gs is not None else gauges, draws=R.DRAWS, seed=R.SEED)

    i1d, i1c = pmd(P, D), pmd(P, C)
    a_dm, o_dm = G.demean_arm(P, obs)
    d_dm, _ = G.demean_arm(D, obs)
    c_dm, _ = G.demean_arm(C, obs)
    i1d_dm, i1c_dm = pmd(a_dm, d_dm, ob=o_dm), pmd(a_dm, c_dm, ob=o_dm)
    it1, it1_dm = R.item1(i1d, i1c), R.item1(i1d_dm, i1c_dm)
    d_scored = [g for g in x["pts"] if g in D and np.isfinite(D[g]).any() and g not in excluded]
    it2 = R.item2(i1d[3], d_scored, set(P))
    it2_dm = R.item2(i1d_dm[3], d_scored, set(P))
    i3a = pmd(arms_["A+M"], arms_["A"])
    i3b = pmd(P, arms_["A+M"])
    sh_pt = pmd(arms_["A+M+S_shifted_reported"], P)[0]
    it3a, it3b = R.item3(i3a, i3b, sh_pt)
    hilo_meds, mllw = [], []
    for g in gauges:
        if g in x["A_fine"] and x["hilo"].get(g):
            e = M2.hilo_errors(x["hilo"][g], M2.extrema(x["fine"], list(x["A_fine"][g])))
            if e:
                hilo_meds.append(float(np.median(e)))
        if g in x["A_ntde"] and x["datum"].get(g) is not None:
            off = M2.mllw_offset(list(x["A_ntde"][g]), NTDE_STEP_MIN / 60.0)
            if off is not None:
                mllw.append(abs(off - x["datum"][g]))
    it4 = R.item4(hilo_meds, mllw)
    # item 5: open-coast independent gauges only (mean-removed, >= 80% coverage after QC)
    q = [g for g in x["beach"] if g in P and g in C and R.coverage(obs.get(g, [])) >= R.ITEM5_COVERAGE_MIN]
    rp = G.per_gauge_rmse({g: R.demeaned(P[g]) for g in q}, {g: R.demeaned(obs[g]) for g in q}, q)
    rc = G.per_gauge_rmse({g: R.demeaned(C[g]) for g in q}, {g: R.demeaned(obs[g]) for g in q}, q)
    it5, it5_val = R.item5(rp, rc)
    items = {"1_level_vs_D_and_C": it1, "2_no_gauge_worse_than_D_by_0.05": not it2,
             "3a_mean_level_helps": it3a, "3b_seasonal_cycle_earns_its_place": it3b, "4_tide_shape": it4,
             "5_beach_no_harm_guard": it5}
    pos = [float(np.sqrt(np.nanmean((x["Pc"][g] - x["pred"][g]) ** 2))) for g in gauges if x["Pc"].get(g) is not None]
    pos_med = float(np.median(pos)) if pos else float("nan")
    swap = G.label_swap(P, obs, gauges)
    controls = R.controls_ok(pos_med, swap)
    verdict = R.verdict(items, controls, cov_void)
    label = R.datum_label(it1 and not it2, it1_dm and not it2_dm)
    # reported
    oracle = {g: np.tile(x["pred"][g] + G.shift_hours(obs[g] - x["pred"][g], 24), (len(R.GATE_BINS), 1)) for g in gauges}
    open20 = [g for g in gauges if g not in G.ESTUARY]
    months = sorted({t.month for t in hours})
    table = {}
    for name, arm in {**arms_, "C_latest_run_reported": x["CL"], "D_latest_run_reported": x["DL"],
                      "ORACLE_yardstick": oracle}.items():
        gs = [g for g in gauges if g in arm]
        r = G.per_gauge_rmse(arm, obs, gs)
        table[name] = {
            "n_gauges": len(gs), "median_rmse_raw": _med(r.values()),
            "median_rmse_open20": _med([r[g] for g in gs if g in open20]),
            "by_region": {reg: _med([r[g] for g in gs if M2.stratum(g) == reg]) for reg in sorted({M2.stratum(g) for g in gs})},
            "by_month": {m: _med(G.per_gauge_rmse(arm, obs, gs, [i for i, t in enumerate(hours) if t.month == m]).values())
                         for m in months},
            "bias_sd_median": [_med([G.bias_sd(arm[g], obs[g])[0] for g in gs]), _med([G.bias_sd(arm[g], obs[g])[1] for g in gs])]}
    uh_rows = {}
    for g in x["uh"]:
        if g in P and g in obs and R.coverage(obs[g]) >= R.ITEM5_COVERAGE_MIN:
            row = {}
            for name in ("A", "P", "C_reference", "D_reference"):
                if g in arms_[name]:
                    row[name + "_rmse_mean_removed"] = round(G.per_gauge_rmse({g: R.demeaned(arms_[name][g])},
                                                                             {g: R.demeaned(obs[g])}, [g])[g], 4)
            row["coverage"] = round(R.coverage(obs[g]), 3)
            uh_rows[g] = row
        else:
            uh_rows[g] = {"coverage": round(R.coverage(obs.get(g, [])), 3), "scored": False}
    return {
        "registration": R.REGISTRATION, "window": [R.W0.isoformat(), R.W1.isoformat()],
        "held_out_removed": [[a.isoformat(), b.isoformat()] for a, b in R.HELD_OUT], "hours": H, "seen": SEEN,
        "verdict": verdict, "datum_label": label, "items": items, "controls": controls,
        "control_values": {"positive_median_m": pos_med, "label_swap_m": swap},
        "coverage": {"excluded": excluded, "void": cov_void, "n_gauges_scored": len(gauges)},
        "item1": {"P_minus_D": i1d[:3], "P_minus_C": i1c[:3], "demeaned_P_minus_D": i1d_dm[:3],
                  "demeaned_P_minus_C": i1c_dm[:3], "per_gauge_P_minus_D": i1d[3]},
        "item2_gauges_worse": it2, "item2_demeaned_gauges_worse": it2_dm,
        "item3": {"A+M_minus_A": i3a[:3], "P_minus_A+M": i3b[:3], "shifted_minus_P_point": sh_pt},
        "item4": {"median_hilo_min": _med(hilo_meds), "median_abs_mllw_err_m": _med(mllw)},
        "item5": {"status": it5, "median_P_minus_C_m": it5_val, "qualifying": q,
                  "open_coast_listed": x["beach"], "back_barrier_or_excluded_listed": len(STATIONS["ioos_hohonu"]) - len(x["beach"])},
        "s1_cells": x["s1_cells"], "scope": [R.SCOPE_LABEL, R.SEASON_SCOPE],
        "reported": {"arms": table, "open20_P_minus_D": pmd(P, D, open20)[:3], "uhslc_non_us_mean_removed": uh_rows}}


def markdown(r):
    lines = [f"## Tide M1 gate {r['registration']}: **{r['verdict']}**", "",
             f"Items: {r['items']}. Controls: {r['controls']} ({r['control_values']}). Coverage: {r['coverage']}.", "",
             f"Item 1: P - D {r['item1']['P_minus_D']}, P - C {r['item1']['P_minus_C']}. Item 3: {r['item3']}. "
             f"Item 4: {r['item4']}. Item 5: {r['item5']['status']}. Datum label: {r['datum_label']}.", "",
             "| arm | gauges | median RMSE raw | open-20 | bias / sd |", "|---|---|---|---|---|"]
    for k, v in r["reported"]["arms"].items():
        lines.append(f"| {k} | {v['n_gauges']} | {v['median_rmse_raw']} | {v['median_rmse_open20']} | {v['bias_sd_median']} |")
    lines += ["", f"Scope: {r['scope']}", "", f"Seen before the run: {r['seen']}", "",
              "Credits: FES2022 - CNES, 2024. FES2022 (Finite Element Solution) Tidal model (Version 2024). CNES. "
              "https://doi.org/10.24400/527896/A01-2024.004 (\"funded by CNES, produced by LEGOS, NOVELTIS and CLS and made "
              "freely available by AVISO\"; AVISO License Issue 20; modified: predictions computed at gauges). Generated "
              "using E.U. Copernicus Marine Service Information (SEALEVEL_GLO_PHY_L4_MY_008_047). NOAA CO-OPS; UHSLC; IOOS. "
              "Open-Meteo (test-only references)."]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
