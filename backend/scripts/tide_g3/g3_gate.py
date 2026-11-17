"""G3 gate: seasonal + non-tidal water level vs OBSERVED water (registered in docs/weather-program/log/
2026-11-15-claude-tide-m1.md, G3 FINAL + addenda through c0a2a95a4). OFFLINE ONLY, measurement only: no bucket write,
nothing served, no live backend. PyFES is GPL (offline here, never in the served backend).

Order (registered): S1 PREFLIGHT -> sources (FES, STOFS as issued, altimetry, CMEMS analysis, Open-Meteo previous runs)
-> truth -> score. The log carries stage names and memory only; scores reach only the step summary and the artifact.
"""
import argparse
import json
from concurrent.futures import ThreadPoolExecutor
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "tide_fes"))
import g3_metrics as G                                          # noqa: E402
import g3_sources as GS                                         # noqa: E402
import arms                                                     # noqa: E402  (tide_fes: FES evaluator, NOAA control)
import metrics as M2                                            # noqa: E402  (tide_fes: extrema, MLLW)
import sources as S                                             # noqa: E402  (tide_fes: CO-OPS, AVISO)
from fes_gate import FES_CONSTITUENTS, IDS, NTDE_STEP_MIN, ntde_dates, rss_mb   # noqa: E402

REGISTRATION = "G3"
LEAD_NOTE = ("Leads are counted from the forecast's CYCLE time, not its publication time: STOFS appears some hours after "
             "its cycle, so the '0-24 h' bin includes forecasts 0-6 h old that a live product could not yet have had.")
W0, W1 = datetime(2026, 8, 25, tzinfo=timezone.utc), datetime(2026, 9, 7, 23, tzinfo=timezone.utc)
PRE0 = datetime(2026, 7, 26, tzinfo=timezone.utc)                 # the 30 days BEFORE the window
YEAR0 = W0 - timedelta(days=365)
STOFS_FORMAT_SWITCH = datetime(2026, 8, 16, tzinfo=timezone.utc)
LEADS = (0, 24, 48)
SEEN = ("The window's OBSERVED water and CO-OPS predictions were read for a truth-only count before the run (no arm "
        "scored); item 3's surge-hour definition was changed after that look and the window was kept because the counts "
        "met the minimums; that truth was fetched before the S1 preflight (P1 / P1' chosen mechanically by availability).")
log = S.log
_get_json_once = S.get_json


def _get_json_retry(url):
    """CO-OPS and Open-Meteo throttle bursts: retry an empty answer with a short backoff (the truth-only count lost
    whole gauges without it)."""
    import time
    d = {}
    for k in range(5):
        d = _get_json_once(url)
        if d and any(key in d for key in ("data", "predictions", "hourly", "stations", "datums", "HarmonicConstituents")):
            time.sleep(0.2)
            return d
        time.sleep(2 + 3 * k)
    return d


S.get_json = _get_json_retry


def stage(name):
    log(f"stage {name} | peak RSS {rss_mb()} MB")


def regions(sid):
    return M2.stratum(sid)


def obs_pred(sid, a, b):
    """Hourly observed (on the hour) and predicted water, MSL, over [a, b] in 5-day requests."""
    o, p = {}, {}
    t = a
    while t <= b:
        u = min(t + timedelta(days=5) - timedelta(hours=1), b)
        p.update(S.coops_series(sid, "predictions", t, u, "h"))
        o.update({k: v for k, v in S.coops_series(sid, "water_level", t, u, key="data").items() if k.minute == 0})
        t = u + timedelta(hours=1)
    return o, p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fes-cache", default="fes_cache")
    ap.add_argument("--work", default="g3_work")
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

    # 1. PREFLIGHT, before any truth fetch.
    s1_ok, s1_why = GS.s1_preflight(work / "cm")
    primary = "P1" if s1_ok else "P1prime"
    stage(f"s1 preflight {'ok' if s1_ok else 'FAILED'} -> primary {primary}")

    hours = G.window_hours(W0, W1)
    H = len(hours)
    ext = G.window_hours(PRE0 - timedelta(days=1), W1 + timedelta(days=1))           # truth with filter padding
    meta = {sid: S.station_meta(sid) for sid in IDS}
    pts = {sid: (m[0], m[1]) for sid, m in meta.items() if m[0] is not None}

    # 2. FES2022b tide (arm A).
    files = S.download_fes(FES_CONSTITUENTS, Path(args.fes_cache))
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    for name, path in files.items():
        S.subset_fes(path, name, pts, boxes, scratch)
    stage("fes subset")
    fine = [W0 - timedelta(hours=3) + timedelta(minutes=6 * k) for k in range(int((H + 6) * 10))]
    A, A_fine, A_ntde = {}, {}, {}
    for sid, (la, lo) in pts.items():
        v = arms.fes_eval(boxes / sid, la, lo, np.concatenate([arms.to_np(hours), arms.to_np(fine), ntde_dates()]))
        if v is not None:
            A[sid] = np.tile(v[:H], (len(LEADS), 1))
            A_fine[sid], A_ntde[sid] = v[H:H + len(fine)], v[H + len(fine):]
    stage("arm A")

    # 3. STOFS-2D-Global as issued (swl, cwl, htp) + pre-window 00Z nowcasts.
    win_cycles = GS.stofs2d_cycles(W0 - timedelta(hours=72 + 24 + 6), W1)
    pre_cycles = [PRE0 + timedelta(days=k) for k in range((W0 - PRE0).days)]
    stofs = {}
    for kind in ("swl", "cwl", "htp"):
        stofs[kind] = GS.fetch_stofs_cycles(sorted(set(win_cycles + pre_cycles)), kind, list(pts), work / "stofs")
        stage(f"stofs2d {kind}: {len(stofs[kind])} cycles")
    hours_x = G.window_hours(W0 - timedelta(hours=24), W1)                     # +24 h for the shift control
    N2, N2x, N2p, N3, swl_switch = {}, {}, {}, {}, {}
    for sid in pts:
        swl_x = GS.as_issued(stofs["swl"], sid, hours_x, LEADS)
        m = GS.nowcast_mean(stofs["swl"], sid, PRE0, W0)
        # REPORTED: STOFS-2D point files changed format (HDF5 -> netCDF-3) on 2026-08-16, inside the registered pre-window;
        # the swl reference before and after the switch is printed so a model change there is visible. The registered
        # reference (the full 30 days) is unchanged.
        swl_switch[sid] = [GS.nowcast_mean(stofs["swl"], sid, PRE0, STOFS_FORMAT_SWITCH),
                           GS.nowcast_mean(stofs["swl"], sid, STOFS_FORMAT_SWITCH, W0)]
        if math.isfinite(m):
            N2x[sid] = swl_x - m
            N2[sid] = N2x[sid][:, 24:]
        cwl = GS.as_issued(stofs["cwl"], sid, hours, LEADS)
        htp = GS.as_issued(stofs["htp"], sid, hours, LEADS)
        mc = GS.nowcast_mean(stofs["cwl"], sid, PRE0, W0)
        if math.isfinite(mc):
            N3[sid] = cwl - mc
            mh = GS.nowcast_mean(stofs["htp"], sid, PRE0, W0)
            if math.isfinite(mh):
                N2p[sid] = (cwl - htp) - (mc - mh)
    stofs.clear()
    stage("stofs2d as issued")

    # 4. STOFS-3D-Atlantic as issued (REPORTED arm N4; total water, own pre-window mean of its first 24 h).
    N4 = {}
    try:
        atl = [s for s in pts if M2.stratum(s) in ("Atlantic", "Gulf", "PR")]
        cyc3 = [d.replace(hour=12) for d in G.window_hours(PRE0, W1)[::24]]
        d3 = GS.fetch_stofs_cycles(cyc3, "3d", atl, work / "stofs3d", url=GS.STOFS3D, latlon=pts, workers=4)
        for sid in atl:
            v = GS.as_issued(d3, sid, hours, LEADS, cycle_step_h=24)
            pre = [x for c, d in d3.items() if c < W0 and sid in d
                   for t, x in zip(*d[sid]) if c <= t < c + timedelta(hours=24) and math.isfinite(x)]
            if len(pre) >= 24 * 20:
                N4[sid] = v - float(np.mean(pre))
        stage(f"stofs3d: {len(N4)} gauges")
    except Exception as e:                                                       # noqa: BLE001 - reported arm
        log(f"stofs3d unavailable: {str(e)[:160]}")

    # 5. S1 altimetry seasonal (if the preflight passed).
    S1, s1_cells = {}, {}
    if s1_ok:
        def s1_one(item):
            sid, (la, lo) = item
            try:
                return sid, GS.s1_climatology(la, lo, work / "cm" / sid)
            except Exception as e:                                               # noqa: BLE001 - recorded per gauge
                return sid, (None, str(e)[:160])
        with ThreadPoolExecutor(max_workers=4) as ex:
            for sid, (clim, info) in ex.map(s1_one, pts.items()):
                if clim:
                    S1[sid] = np.tile(np.array([clim.get(t.timetuple().tm_yday, np.nan) for t in hours]), (len(LEADS), 1))
                    s1_cells[sid] = info
                else:
                    s1_cells[sid] = {"unavailable": info}
                stage(f"s1 {sid}")

    # 6. N1 CMEMS GLO12 ANALYSIS (upper bound only): zos + inverse barometer, own 365-day pre-window mean.
    N1 = {}

    def n1_one(item):
        sid, (la, lo) = item
        try:
            return sid, GS.n1_series(la, lo, YEAR0, W1, work / "cm1" / sid), None
        except Exception as e:                                                   # noqa: BLE001 - reported arm
            return sid, None, str(e)[:120]
    with ThreadPoolExecutor(max_workers=4) as ex:
        for sid, ser, err in ex.map(n1_one, pts.items()):
            if err:
                log(f"N1 {sid} unavailable: {err}")
            if ser:
                pre = [v for t, v in ser.items() if t < W0]
                if len(pre) >= 24 * 330:
                    mean = float(np.mean(pre))
                    N1[sid] = np.tile(np.array([ser.get(t, np.nan) - mean for t in hours]), (len(LEADS), 1))
    stage(f"n1 analysis: {len(N1)} gauges")

    # 7. TEST-ONLY references C and D from Open-Meteo previous runs, same leads.
    C, D = {}, {}
    for sid, (la, lo) in pts.items():
        runs = GS.om_runs(la, lo, (W0 - timedelta(days=3)).date(), (W1 + timedelta(days=3)).date(), S.get_json)
        year = GS.om_runs(la, lo, YEAR0.date(), (W0 - timedelta(days=1)).date(), S.get_json)[0]
        mean365 = float(np.mean(list(year.values()))) if len(year) >= 330 * 24 else float("nan")
        c, d = np.full((len(LEADS), H), np.nan), np.full((len(LEADS), H), np.nan)
        for b in range(len(LEADS)):
            r = runs.get(b, {})
            for i, t in enumerate(hours):
                if t in r:
                    w0 = t.replace(hour=0)
                    win = [r[u] for u in r if w0 <= u < w0 + timedelta(hours=72)]
                    if len(win) >= 60:
                        c[b, i] = r[t] - float(np.mean(win))
                    if math.isfinite(mean365):
                        d[b, i] = r[t] - mean365
        C[sid], D[sid] = c, d
    stage("references C D")

    # 8. TRUTH (observed + predictions), datums, High/Low, positive control.
    obs, pred, resid, pre_mean, datum, events_hilo, P = {}, {}, {}, {}, {}, {}, {}
    for sid in pts:
        o, p = obs_pred(sid, ext[0], ext[-1])
        oe = np.array([o.get(t, np.nan) for t in ext])
        pe = np.array([p.get(t, np.nan) for t in ext])
        n_pre = G.hour_index(ext, W0)
        r, m = G.demeaned_residual(oe, pe, n_pre)
        r = r[:H]
        obs[sid], pred[sid], resid[sid], pre_mean[sid] = oe[n_pre:n_pre + H], pe[n_pre:n_pre + H], r, m
        datum[sid] = S.coops_msl_minus_mllw(sid)
        events_hilo[sid] = [e for e in S.coops_hilo(sid, W0, W1) if W0 <= e[0] <= W1]
        hc = S.coops_harcon(sid)
        try:
            P[sid] = arms.harcon_eval(hc, arms.to_np(hours)) if hc else None
        except Exception as e:                                                   # noqa: BLE001
            log(f"{sid} positive control: {str(e)[:120]}")
            P[sid] = None
        stage(f"truth {sid}")

    report = score(locals_for_score(A, S1, N2, N2x, N2p, N3, N4, N1, C, D, obs, pred, resid, pre_mean, datum,
                                    events_hilo, P, A_fine, A_ntde, fine, hours, primary, s1_ok, s1_why, s1_cells,
                                    swl_switch))
    stage("scored")
    print(json.dumps(report, indent=1, default=str))
    if args.summary:
        with open(args.summary, "a", encoding="utf-8") as fh:
            fh.write(markdown(report))
    stage("done")


def locals_for_score(*a):
    keys = ("A", "S1", "N2", "N2x", "N2p", "N3", "N4", "N1", "C", "D", "obs", "pred", "resid", "pre_mean", "datum",
            "hilo", "P", "A_fine", "A_ntde", "fine", "hours", "primary", "s1_ok", "s1_why", "s1_cells", "swl_switch")
    return dict(zip(keys, a))


def build_arms(x):
    """Arm series per gauge, (3, H). The primary is P1 = A + S1 + N2 (or P1' = A + N2 by S1 availability)."""
    A, S1, N2, N2p, N3, N4, N1 = x["A"], x["S1"], x["N2"], x["N2p"], x["N3"], x["N4"], x["N1"]
    arms_ = {"A": dict(A)}
    arms_["A+S1"] = {g: A[g] + S1[g] for g in A if g in S1}
    arms_["P1"] = {g: A[g] + S1[g] + N2[g] for g in A if g in S1 and g in N2}
    arms_["P1prime"] = {g: A[g] + N2[g] for g in A if g in N2}
    arms_["A+S1+N2prime"] = {g: A[g] + S1[g] + N2p[g] for g in A if g in S1 and g in N2p}
    arms_["N3_stofs_total"] = dict(N3)
    arms_["N4_stofs3d_total_reported"] = dict(N4)
    arms_["A+N1_ANALYSIS_upper_bound"] = {g: A[g] + N1[g] for g in A if g in N1}
    arms_["C_reference"], arms_["D_reference"] = dict(x["C"]), dict(x["D"])
    return arms_


def score(x):
    arms_, obs, resid, hours = build_arms(x), x["obs"], x["resid"], x["hours"]
    H, prim = len(hours), x["primary"]
    P1 = arms_[prim]
    gauges = sorted(g for g in P1 if g in arms_["D_reference"] and g in arms_["C_reference"])
    # surge / calm hours on the pre-window-demeaned residual; storms
    surge_mask = {g: np.abs(resid[g]) > G.SURGE_M for g in gauges}
    calm = [(g, h) for g in gauges for h in range(H) if math.isfinite(resid[g][h]) and abs(resid[g][h]) < G.CALM_M]
    gev = {g: G.events(surge_mask[g], hours) for g in gauges}
    storm_list = G.storms({g: e for g, e in gev.items() if e}, hours, regions)
    surge_h = {g: int(surge_mask[g].sum()) for g in gauges}
    item3_ok = G.item3_runnable(storm_list, surge_h)
    storm_units = [[(g, h) for g, s, n in st["members"] for h in range(s, s + n)] for st in storm_list]
    storm_pairs = [p for u in storm_units for p in u]
    # items
    i1d = G.paired_median_diff(P1, arms_["D_reference"], obs, gauges)
    i1c = G.paired_median_diff(P1, arms_["C_reference"], obs, gauges)
    a_dm, o_dm = G.demean_arm(P1, obs)
    d_dm, _ = G.demean_arm(arms_["D_reference"], obs)
    c_dm, _ = G.demean_arm(arms_["C_reference"], obs)
    i1d_dm = G.paired_median_diff(a_dm, d_dm, o_dm, gauges)
    i1c_dm = G.paired_median_diff(a_dm, c_dm, o_dm, gauges)
    item1 = i1d[2] <= G.ITEM1_D_MARGIN and i1c[2] < 0
    item1_dm = i1d_dm[2] <= G.ITEM1_D_MARGIN and i1c_dm[2] < 0
    item2_g = {g: v for g, v in i1d[3].items() if v > G.ITEM2_GAUGE_MAX}
    for g in arms_["D_reference"]:                            # a gauge D scores but P1 cannot counts against P1
        if g not in P1 and np.isfinite(arms_["D_reference"][g]).any():
            item2_g[g] = "P1 undefined"
    i3 = G.pooled_diff(P1, arms_["A"], obs, storm_pairs, storm_units) if item3_ok else (None, None, None)
    i4 = G.pooled_diff(P1, arms_["A"], obs, calm, G.calm_units(calm, H))
    hilo_meds, mllw = [], []
    for g in gauges:
        if g in x["A_fine"] and x["hilo"].get(g):
            e = M2.hilo_errors(x["hilo"][g], M2.extrema(x["fine"], list(x["A_fine"][g])))
            hilo_meds.append(float(np.median(e)))
        if g in x["A_ntde"] and x["datum"].get(g) is not None:
            off = M2.mllw_offset(list(x["A_ntde"][g]), NTDE_STEP_MIN / 60.0)
            if off is not None:
                mllw.append(abs(off - x["datum"][g]))
    item5 = bool(hilo_meds and np.median(hilo_meds) <= G.TIMING_MAX_MIN and mllw and np.median(mllw) <= G.MLLW_MAX_M)
    items = {"1_level_vs_D_and_C": bool(item1), "2_no_gauge_worse_than_D_by_0.05": not item2_g,
             "3_surge_hours_vs_A": bool(item3_ok and i3[2] is not None and i3[2] < 0),
             "4_calm_hours_vs_A": bool(math.isfinite(i4[2]) and i4[2] <= G.ITEM4_CALM_MAX), "5_tide_shape": item5}
    # controls
    pos = [float(np.sqrt(np.nanmean((x["P"][g] - x["pred"][g]) ** 2))) for g in gauges if x["P"].get(g) is not None]
    pos_med = float(np.median(pos)) if pos else float("nan")
    swap = G.label_swap(P1, obs, gauges)
    nt = x["N2"]
    # The non-tidal term replaced by its own pre-window mean: N2 is referenced to that mean, so the constant is 0 and
    # the constant arm is P1 - N2.
    const = {g: P1[g] - nt[g] for g in gauges if g in nt}
    # AMENDMENT A (owner 21:37 EST; log 30f2baea2): the constant control reads POOLED squared error over all gauge-hours
    # (units gauge x 2-day blocks), which the surge gauges can move, not the median gauge.
    all_pairs = [(g, h) for g in gauges for h in range(H)]
    c_vs_r = G.pooled_diff(const, P1, obs, all_pairs, G.calm_units(all_pairs, H))
    shifted = {g: P1[g] - nt[g] + G.shift_hours(x["N2x"][g], 24)[:, 24:] for g in gauges if g in x["N2x"]}
    sh = G.pooled_diff(shifted, P1, obs, storm_pairs, storm_units) if item3_ok else (None, None, None)
    shift_ok = bool(item3_ok and sh[1] is not None and math.isfinite(sh[1]) and sh[1] > 0)
    controls = {"positive_noaa_constants": bool(math.isfinite(pos_med) and pos_med <= G.POSITIVE_MAX_M),
                "negative_label_swap": bool(math.isfinite(swap) and swap > G.SWAP_MIN_M),
                "negative_constant_nontidal_loses_item1_pooled": bool(math.isfinite(c_vs_r[1]) and c_vs_r[1] > 0)}
    # AMENDMENT A: a failed +24 h shift check makes ITEM 3 inconclusive (exactly as "not runnable"), never the run VOID.
    item3_effective = bool(item3_ok and shift_ok)
    item3_status = "runnable" if item3_effective else ("inconclusive: shift check failed" if item3_ok else "not runnable")
    verdict = G.verdict(items, controls, item3_effective)
    # reported
    oracle = {g: np.tile(x["pred"][g] + G.shift_hours(resid[g] + x["pre_mean"][g], 24), (3, 1)) for g in gauges}
    open20 = [g for g in gauges if g not in G.ESTUARY]
    per_arm = {}
    for name, arm in {**arms_, "ORACLE_yardstick": oracle}.items():
        gs = [g for g in gauges if g in arm]
        r = G.per_gauge_rmse(arm, obs, gs)
        per_arm[name] = {"n_gauges": len(gs), "median_rmse_raw": _med(r.values()),
                         "median_rmse_open20": _med([r[g] for g in gs if g in open20]),
                         "by_lead": {f"{L}-{L + 24}h": _med(G.per_gauge_rmse({g: arm[g][[b]] for g in gs}, obs, gs).values())
                                     for b, L in enumerate(LEADS)},
                         "by_region": {reg: _med([r[g] for g in gs if regions(g) == reg]) for reg in sorted({regions(g) for g in gs})},
                         "bias_sd_median": [_med([G.bias_sd(arm[g], obs[g])[0] for g in gs]), _med([G.bias_sd(arm[g], obs[g])[1] for g in gs])]}
    open_i1 = G.paired_median_diff(P1, arms_["D_reference"], obs, open20)
    return {"registration": REGISTRATION, "window": [W0.isoformat(), W1.isoformat()], "primary": prim,
            "s1_preflight": {"ok": x["s1_ok"], "why": x["s1_why"]}, "s1_cells": x["s1_cells"], "seen": SEEN,
            "verdict": verdict, "datum_label": G.datum_label(item1, item1_dm), "items": items,
            "lead_note": LEAD_NOTE,
            "stofs_swl_reference_before_after_2026_08_16": {g: [round(v, 4) if v == v else None for v in x["swl_switch"].get(g, [])]
                                                            for g in gauges},
            "s1_unavailable_gauges": sorted(g for g, v in x["s1_cells"].items() if "unavailable" in v),
            "item2_p1_undefined_count": sum(1 for v in item2_g.values() if v == "P1 undefined"),
            "item1": {"P1_minus_D": i1d[:3], "P1_minus_C": i1c[:3], "demeaned_P1_minus_D": i1d_dm[:3],
                      "demeaned_P1_minus_C": i1c_dm[:3], "per_gauge_P1_minus_D": i1d[3]},
            "item2_gauges_worse": item2_g,
            "item3": {"runnable": item3_ok, "status": item3_status, "shift_check_passed": shift_ok, "label": G.LOW_POWER, "storms": [{"region": s["region"], "gauges": sorted({m[0] for m in s["members"]}),
                      "start": hours[s["members"][0][1]].isoformat()} for s in storm_list], "surge_hours": surge_h,
                      "P1_minus_A": i3},
            "item4_calm": {"P1_minus_A": i4, "n_pairs": len(calm)},
            "item5": {"median_hilo_min": _med(hilo_meds), "median_abs_mllw_err_m": _med(mllw)},
            "controls": controls, "control_values": {"positive_median_m": pos_med, "label_swap_m": swap,
                                                     "constant_minus_real_pooled": c_vs_r[:3], "shift_minus_real_item3": sh},
            "reported": {"open20_P1_minus_D": open_i1[:3], "arms": per_arm}}


def _med(v):
    v = [float(a) for a in v if a is not None and math.isfinite(float(a))]
    return round(float(np.median(v)), 4) if v else None


def markdown(r):
    lines = [f"## Tide M1 gate {r['registration']}: **{r['verdict']}** (primary {r['primary']})", "",
             f"Item 1 (P1 - D, P1 - C; point, 95% CI): {r['item1']['P1_minus_D']}, {r['item1']['P1_minus_C']}. "
             f"Items: {r['items']}. Controls: {r['controls']}. Item 3 ({r['item3']['label']}): runnable "
             f"{r['item3']['runnable']} / {r['item3']['status']}, {r['item3']['P1_minus_A']}. Datum label: {r['datum_label']}.", "",
             f"S1 unavailable at: {r['s1_unavailable_gauges']} (each counts against P1 in item 2: {r['item2_p1_undefined_count']}).", "",
             "| arm | gauges | median RMSE raw | open-20 | by lead | bias / sd |", "|---|---|---|---|---|---|"]
    for k, v in r["reported"]["arms"].items():
        lines.append(f"| {k} | {v['n_gauges']} | {v['median_rmse_raw']} | {v['median_rmse_open20']} | {v['by_lead']} | {v['bias_sd_median']} |")
    lines += ["", r["lead_note"], "", f"Seen before the run: {r['seen']}", "",
              "Credits: FES2022 - \"The FES2022 Tide product was funded by CNES, produced by LEGOS, NOVELTIS and CLS and made "
              "freely available by AVISO\" (DOI 10.24400/527896/A01-2024.004). NOAA STOFS-2D-Global, STOFS-3D-Atlantic and "
              "CO-OPS. E.U. Copernicus Marine Service (altimetry SLA, GLO12). Open-Meteo (test-only references)."]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
