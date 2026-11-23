"""gust_ens_risk_hindcast.py - offline hindcast for the ensemble gust-risk product (gate gust-ens-risk-v1).

Serves nothing; never calls the Raw Surf backend; public data only (ECMWF open data on AWS, NDBC, IEM ASOS/METAR).
Pre-registered: docs/weather-program/gates/gust-ens-risk-v1.md (read it; this file implements it and must not drift).

  python scripts/gust_ens_risk_hindcast.py stations --cache C   # freeze stations by #946's rule (fresh span)
  python scripts/gust_ens_risk_hindcast.py truth    --cache C   # METAR gust + PK WND snapshot; hash of all truth files
  python scripts/gust_ens_risk_hindcast.py collect  --cache C [--workers 4]   # ENS members + HRES at the stations
  python scripts/gust_ens_risk_hindcast.py score    --cache C --out O

Blinding (gate section 0): nothing from the #946 hindcast runs (run files, truth snapshot, station freeze, report) is
read. The code is reused: ens_wind_fetch (fetch/decode), wind_lr_obs (station rule, NDBC parser, log law),
wind_lr_hindcast.sample_points (the sea-node move).
"""
import argparse
import csv
import hashlib
import io
import json
import os
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import ens_gust_risk_core as gr  # noqa: E402
from services.weather_pipeline import ens_wind_core as ec  # noqa: E402
from services.weather_pipeline import ens_wind_fetch as ef  # noqa: E402

import wind_lr_obs as obs  # noqa: E402

SPAN = (datetime(2026, 10, 10, tzinfo=timezone.utc), datetime(2026, 11, 21, tzinfo=timezone.utc))   # station cover
RUNS = [datetime(2026, 10, 10, tzinfo=timezone.utc) + timedelta(days=k) for k in range(42)]       # 10-10 .. 11-20 00Z
BINS = {"B1": (12, 24, 36, 48, 60, 72, 84), "B2": (96, 108, 120, 132, 144), "B3": (168, 192, 216, 240),
        "B4": (264, 288, 312, 336, 360)}
LEADS = [L for b in BINS.values() for L in b]
HRES_MAX = 240
ENS_BASE = os.environ.get("GER_ENS_BASE") or ef.AWS_BASE
SEED, NULL_SEED, REPS = 20261122, 20261123, 2000
DROP_MAX = 0.10
KT = 1852.0 / 3600.0
DECODE_LOCK = threading.Lock()      # ecCodes is not thread-safe; runs are collected on a small pool


def bin_of(lead):
    for k, v in BINS.items():
        if lead in v:
            return k
    return None


def _ep(t: datetime) -> int:
    return int(t.timestamp() // 60)


# ---------------------------------------------------------------------------------------------------- stations
def cmd_stations(s, cache):
    path = os.path.join(cache, "stations.json")
    if os.path.exists(path):
        print(f"stations already frozen: {path}")
        return 0
    doc = obs.select_stations(s, cache, SPAN[0], SPAN[1], path, cover=SPAN, ndbc_months=(), asos_cover=SPAN)
    doc["gate"] = "gust-ens-risk-v1"
    json.dump(doc, open(path, "w"), indent=1)
    print(f"stations frozen: {len(doc['ndbc'])} NDBC/C-MAN, {len(doc['asos'])} ASOS")
    return 0


# ---------------------------------------------------------------------------------------------------- truth
def _metar_csv(s, cache, sid, report_type):
    path = os.path.join(cache, "metar", f"{sid}_rt{report_type}.csv")
    if not os.path.exists(path):
        a, b = SPAN[0], datetime.now(timezone.utc) + timedelta(days=1)
        q = (f"{obs.IEM}/cgi-bin/request/asos.py?station={sid}&data=sknt&data=gust&data=peak_wind_gust"
             f"&data=peak_wind_time&tz=Etc/UTC&format=onlycomma&latlon=no&missing=M&trace=T&report_type={report_type}"
             f"&year1={a.year}&month1={a.month}&day1={a.day}&year2={b.year}&month2={b.month}&day2={b.day}")
        r = obs._get(s, q, tries=4, timeout=300)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(r.text if r.status_code == 200 else "")
        time.sleep(1.0)
    return open(path, encoding="utf-8").read()


def parse_metar(text):
    """[(epoch_min report, sknt m/s, gust m/s, pk m/s, epoch_min pk)] (NaN / None where absent)."""
    out = []
    for rec in csv.DictReader(io.StringIO("\n".join(ln for ln in text.splitlines() if ln and not ln.startswith("#")))):
        try:
            t = datetime.strptime(rec["valid"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
        except (KeyError, ValueError, TypeError):
            continue

        def f(k):
            try:
                return float(rec.get(k)) * KT
            except (TypeError, ValueError):
                return float("nan")
        pkt = None
        try:
            pkt = _ep(datetime.strptime(rec.get("peak_wind_time") or "", "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc))
        except ValueError:
            pass
        out.append((_ep(t), f("sknt"), f("gust"), f("peak_wind_gust"), pkt))
    return out


def cmd_truth(s, cache):
    st = json.load(open(os.path.join(cache, "stations.json")))
    for c in st["ndbc"]:
        obs.ndbc_window(s, cache, c["id"], months=())       # the freeze already cached realtime2; never re-read
    for c in st["asos"]:
        for rt in (3, 4):
            _metar_csv(s, cache, c["id"], rt)
    h = hashlib.sha256()
    files = sorted(os.path.join(d, f) for sub in ("ndbc", "metar") for d, _, fs in os.walk(os.path.join(cache, sub))
                   for f in fs)
    for p in files:
        h.update(os.path.relpath(p, cache).replace("\\", "/").encode())
        h.update(open(p, "rb").read())
    end = None
    for c in st["ndbc"]:
        recs = obs.parse_ndbc_stdmet(open(os.path.join(cache, "ndbc", f"{c['id']}_realtime2.txt"), encoding="utf-8").read())
        if recs:
            end = max(end or max(recs), max(recs))
    doc = {"sha256": h.hexdigest(), "files": len(files), "taken_at": datetime.now(timezone.utc).isoformat(),
           "truth_end": end.isoformat() if end else None}
    json.dump(doc, open(os.path.join(cache, "truth.json"), "w"), indent=1)
    print(json.dumps(doc))
    return 0


def station_truth(cache, st):
    """{i: dict} per station: event times/values and the record times that count for coverage."""
    out = []
    for c in st["ndbc"]:
        recs = obs.parse_ndbc_stdmet(open(os.path.join(cache, "ndbc", f"{c['id']}_realtime2.txt"), encoding="utf-8").read())
        tm, gv = [], []
        for t, (_w, g, _d) in sorted(recs.items()):
            if g == g:
                tm.append(_ep(t))
                gv.append(float(obs.to_10m(g, c["anemometer_m"])))
        out.append({"kind": "ndbc", "t": np.array(tm, np.int64), "g": np.array(gv), "cov": np.array(tm, np.int64)})
    for c in st["asos"]:
        tm, gv, cov = [], [], []
        for rt in (3, 4):
            for (t, sk, gu, pk, pkt) in parse_metar(_metar_csv(None, cache, c["id"], rt)):
                if rt == 3 and (sk == sk or gu == gu):
                    cov.append(t)
                v = gu if gu == gu else sk                  # no gust group -> the sustained speed (as #946)
                if v == v:
                    tm.append(t)
                    gv.append(v)
                if pk == pk and pkt is not None:
                    tm.append(pkt)
                    gv.append(pk)
        o = np.argsort(tm)
        out.append({"kind": "asos", "t": np.array(tm, np.int64)[o], "g": np.array(gv)[o], "cov": np.array(sorted(cov), np.int64)})
    return out


def covered(cov_t, end_min, w):
    """Gate section 3: every hour of the window holds >= 1 counting record."""
    for k in range(w):
        a, b = end_min - 60 * (w - k), end_min - 60 * (w - k - 1)
        i = np.searchsorted(cov_t, a, side="right")
        if i >= cov_t.size or cov_t[i] > b:
            return False
    return True


def truth_row(tr, end_min, w):
    if not covered(tr["cov"], end_min, w):
        return float("nan")
    return gr.window_max(tr["t"], tr["g"], end_min, w)


# ---------------------------------------------------------------------------------------------------- collect
def collect_run(session, run, lats, lons, out_dir, truth_end):
    path = os.path.join(out_dir, f"{run:%Y%m%d%H}.npz")
    if os.path.exists(path):
        return "cached"
    arrays, notes = {}, {"run": run.isoformat(), "errors": [], "skipped_no_truth": []}

    def at_stations_for(step):
        want = f"{step - gr.gust_window_h(step)}-{step}"

        def red(arr, meta):
            if meta.get("step_range") != want:
                raise ValueError(f"window {meta.get('step_range')} != {want} at step {step}")
            return ec.bilinear(arr, meta, lats, lons)
        return red
    any_step = False
    for L in LEADS:
        if run + timedelta(hours=L) > truth_end:
            notes["skipped_no_truth"].append(L)
            continue
        p = gr.gust_param(L)
        f, fmeta = ef.fetch_step(session, run, L, at_stations_for(L), params=(p,), base=ENS_BASE, prefer="eccodes",
                                 decode_lock=DECODE_LOCK)
        if f[p].shape[0] != gr.MEMBERS + (1 if fmeta.get("has_cf") else 0):
            raise ValueError(f"members {f[p].shape}")
        arrays[f"ens_{L}"] = (f[p][1:] if fmeta.get("has_cf") else f[p]).astype(np.float32)   # the 50 pf only
        any_step = True
        if L <= HRES_MAX:
            try:
                arrays[f"hres_{L}"] = _hres(session, run, L, p, at_stations_for(L)).astype(np.float32)
            except Exception as e:  # noqa: BLE001 - a missing deterministic value is recorded, never filled
                notes["errors"].append(f"hres +{L}: {e}")
    if not any_step:
        return "no-truth"
    np.savez_compressed(path, **arrays)
    json.dump(notes, open(path + ".json", "w"))
    return "ok"


def _hres(session, run, step, param, red):
    from services.weather_pipeline import eval_grib2 as g2
    url = ef.ef_url(ENS_BASE, run, step, "index", stream="oper", typ="fc")
    idx = ef._get(session, url)
    if idx.status_code != 200:
        raise FileNotFoundError(url)
    e = [x for x in ec.parse_ecmwf_index(idx.text) if x.get("param") == param and int(x.get("step", -1)) == step]
    if len(e) != 1:
        raise ValueError(f"{len(e)} {param} messages in {url}")
    a, n = int(e[0]["_offset"]), int(e[0]["_length"])
    r = ef._get(session, ef.ef_url(ENS_BASE, run, step, "grib2", stream="oper", typ="fc"),
                headers={"Range": f"bytes={a}-{a + n - 1}"})
    with DECODE_LOCK:
        arr, meta = g2.decode_span(r.content, ["m"], ["m"], prefer="eccodes")["m"]
    return red(arr, meta)


def cmd_collect(s, cache, workers):
    import requests
    import wind_lr_hindcast as wlh
    st = json.load(open(os.path.join(cache, "stations.json")))
    stations = st["ndbc"] + st["asos"]
    land, meta = obs.gfs_land(s, cache)
    lats, lons = wlh.sample_points(stations, land, meta)
    truth_end = datetime.fromisoformat(json.load(open(os.path.join(cache, "truth.json")))["truth_end"])
    out_dir = os.path.join(cache, "runs")
    os.makedirs(out_dir, exist_ok=True)

    def one(run):
        sess = requests.Session()
        for attempt in (1, 2):
            try:
                return run, collect_run(sess, run, lats, lons, out_dir, truth_end)
            except Exception as e:  # noqa: BLE001 - retried once, then recorded; never filled
                if attempt == 2:
                    json.dump({"run": run.isoformat(), "failed": str(e)[:500]},
                              open(os.path.join(out_dir, f"{run:%Y%m%d%H}.npz.failed.json"), "w"))
                    return run, f"FAILED {e}"
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for run, res in ex.map(one, RUNS):
            print(run.isoformat(), res, flush=True)
    json.dump({"retries": dict(ef.RETRY_STATS)}, open(os.path.join(out_dir, "retries.json"), "w"))
    return 0


# ---------------------------------------------------------------------------------------------------- score
def build_rows(cache):
    """One row per (run, lead, station) with every arm's value and the truth window max (NaN rows kept out)."""
    st = json.load(open(os.path.join(cache, "stations.json")))
    stations = st["ndbc"] + st["asos"]
    truths = station_truth(cache, st)
    run_dir = os.path.join(cache, "runs")
    R = {k: [] for k in ("run", "lead", "sta", "day", "obs", "obs_shift", "obs_w6", "hres", "net")}
    ens = []
    dropped = sorted({f.split(".")[0] for f in os.listdir(run_dir) if f.endswith(".failed.json")})
    for fn in sorted(f for f in os.listdir(run_dir) if f.endswith(".npz")):
        z = np.load(os.path.join(run_dir, fn))
        run = datetime.strptime(fn[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        for L in LEADS:
            if f"ens_{L}" not in z:
                continue
            m = z[f"ens_{L}"]
            hres = z[f"hres_{L}"] if f"hres_{L}" in z else np.full(len(stations), np.nan)
            V = run + timedelta(hours=L)
            end, w = _ep(V), gr.gust_window_h(L)
            for i, tr in enumerate(truths):
                o = truth_row(tr, end, w)
                if o != o or not np.all(np.isfinite(m[:, i])):
                    continue
                R["run"].append(int(fn[:10]))
                R["lead"].append(L)
                R["sta"].append(i)
                R["day"].append(V.toordinal())
                R["obs"].append(o)
                R["obs_shift"].append(truth_row(tr, end + 24 * 60, w))
                R["obs_w6"].append(truth_row(tr, end, 6) if w == 1 else float("nan"))
                R["hres"].append(float(hres[i]))
                R["net"].append(tr["kind"])
                ens.append(m[:, i])
    out = {k: np.array(v) for k, v in R.items()}
    out["ens"] = np.array(ens, dtype=np.float32).reshape(-1, gr.MEMBERS)
    return out, stations, dropped


def score_cell(rows, sel, t_ms, rng_seed=SEED):
    o = (rows["obs"][sel] >= t_ms).astype(float)
    k = (rows["ens"][sel] >= t_ms).sum(axis=1)
    p = k / gr.MEMBERS
    days, sta = rows["day"][sel], rows["sta"][sel]
    clim = gr.loo_day_climatology(sta, days, o)
    hres_ok = np.isfinite(rows["hres"][sel])
    out = {"n": int(sel.sum()), "n_events": int(o.sum()), "event_days": int(len(np.unique(days[o > 0]))),
           "n_stations": int(len(np.unique(sta))), "event_freq": float(o.mean()) if o.size else float("nan")}
    out["bs"] = {"ens": gr.brier(p, o), "clim": gr.brier(clim, o)}
    d_clim = (p - o) ** 2 - (clim - o) ** 2
    out["ens_minus_clim"] = {b: gr.block_ci_mean(d_clim, days, REPS, rng_seed, b) for b in (1, 5)}
    out["bss_clim"] = 1 - out["bs"]["ens"] / out["bs"]["clim"] if out["bs"]["clim"] > 0 else float("nan")
    if hres_ok.any():
        h = (rows["hres"][sel] >= t_ms).astype(float)
        d_h = np.where(hres_ok, (p - o) ** 2 - (h - o) ** 2, np.nan)
        out["bs"]["hres_same_rows"] = gr.brier(h[hres_ok], o[hres_ok])
        out["bs"]["ens_same_rows_as_hres"] = gr.brier(p[hres_ok], o[hres_ok])
        out["ens_minus_hres"] = {b: gr.block_ci_mean(d_h, days, REPS, rng_seed, b) for b in (1, 5)}
        out["n_hres"] = int(hres_ok.sum())
    med = np.median(rows["ens"][sel], axis=1) >= t_ms
    p90 = np.percentile(rows["ens"][sel], 90, axis=1) >= t_ms
    out["bs"]["ens_med_01"], out["bs"]["ens_p90_01"] = gr.brier(med, o), gr.brier(p90, o)
    out["murphy"] = gr.murphy(p, o)
    out["auc"] = gr.block_ci_auc(p, o, days, REPS, rng_seed, 1)
    return out, p, o, days


def lines(c, has_hres):
    g1 = c["ens_minus_clim"][1][2] < 0
    g1_5 = c["ens_minus_clim"][5][2] < 0
    g2 = (c["ens_minus_hres"][1][2] < 0) if has_hres else None
    g2_5 = (c["ens_minus_hres"][5][2] < 0) if has_hres else None
    mu = c["murphy"]
    ratio = mu["mean_p"] / mu["obar"] if mu["obar"] > 0 else float("inf")
    g3 = bool(mu["rel"] < mu["res"] and 0.5 <= ratio <= 2.0)
    g4 = bool(c["auc"][1] > 0.70)
    v = gr.cell_verdict(c["n_events"], c["event_days"], g1, g1_5, g2, g2_5, g3, g4)
    return {"G1": bool(g1), "G1_5d": bool(g1_5), "G2": g2, "G2_5d": g2_5, "G3": g3, "calib_ratio": ratio, "G4": g4,
            "verdict": v}


def controls(rows):
    t = gr.THRESHOLDS_MS[0]
    sel = np.isin(rows["lead"], BINS["B1"])
    c = {}
    # C1 station shuffle within valid time
    o = (rows["obs"][sel] >= t).astype(float)
    p = (rows["ens"][sel] >= t).sum(axis=1) / gr.MEMBERS
    key = rows["run"][sel] * 1000 + rows["lead"][sel]
    rng = np.random.default_rng(NULL_SEED)
    osh = o.copy()
    for kk in np.unique(key):
        idx = np.where(key == kk)[0]
        osh[idx] = o[rng.permutation(idx)]
    bs, bss = gr.brier(p, o), gr.brier(p, osh)
    c["C1"] = {"bs_true": bs, "bs_shuffled": bss, "ratio": bss / bs if bs > 0 else float("nan"),
               "pass": bool(bs > 0 and bss >= 1.10 * bs)}
    # C2 plant
    days, sta = rows["day"][sel], rows["sta"][sel]
    plant = 0.05 + 0.9 * o
    clim = gr.loo_day_climatology(sta, days, o)
    bss_p = 1 - gr.brier(plant, o) / gr.brier(clim, o)
    mu = gr.murphy(plant, o)
    auc = gr.roc_auc(plant, o)
    c["C2"] = {"bss": bss_p, "auc": auc, "rel": mu["rel"], "pass": bool(bss_p > 0.5 and auc > 0.95 and mu["rel"] < 0.02)}
    # C3 climatology self + constant forecast
    d0 = gr.block_ci_mean((clim - o) ** 2 - (clim - o) ** 2, days, 200, SEED, 1)
    const = np.full(o.size, o.mean())
    c["C3"] = {"self": d0, "const_rel": gr.murphy(const, o)["rel"],
               "pass": bool(d0[0] == 0 and d0[1] == 0 and d0[2] == 0 and gr.murphy(const, o)["rel"] < 1e-6)}
    # C4 +24 h shift
    sh = rows["obs_shift"][sel]
    ok = np.isfinite(sh)
    osf = (sh[ok] >= t).astype(float)
    d = (p[ok] - o[ok]) ** 2 - (p[ok] - osf) ** 2
    ci = gr.block_ci_mean(d, days[ok], REPS, SEED, 1)
    c["C4"] = {"aligned_minus_shifted": ci, "n": int(ok.sum()), "pass": bool(ci[2] < 0)}
    # C5 window mismatch (reported)
    w6 = rows["obs_w6"][sel]
    okw = np.isfinite(w6)
    c["C5"] = {"freq_1h": float(o[okw].mean()) if okw.any() else None,
               "freq_6h_window": float((w6[okw] >= t).mean()) if okw.any() else None, "n": int(okw.sum())}
    return c


def cmd_score(cache, out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rows, stations, dropped = build_rows(cache)
    rep = {"gate": "gust-ens-risk-v1", "n_rows": int(rows["obs"].size), "dropped_runs": dropped,
           "runs_scored": int(len(np.unique(rows["run"]))), "truth": json.load(open(os.path.join(cache, "truth.json"))),
           "stations": {"ndbc": sum(1 for s in stations if s["kind"] == "ndbc"),
                        "asos": sum(1 for s in stations if s["kind"] == "asos")},
           "controls": controls(rows), "cells": {}, "by_network": {}}
    void = [k for k in ("C1", "C2", "C3", "C4") if not rep["controls"][k]["pass"]]
    if len(dropped) > DROP_MAX * len(RUNS):
        void.append(f"dropped runs {len(dropped)} > 10%")
    rep["void"] = void
    for tk, tm in gr.iter_cells():
        for b, leads in BINS.items():
            sel = np.isin(rows["lead"], leads)
            if not sel.any():
                continue
            c, *_ = score_cell(rows, sel, tm)
            c["lines"] = lines(c, b != "B4" and "ens_minus_hres" in c)
            rep["cells"][f"{tk}kn_{b}"] = c
            for net in ("ndbc", "asos"):          # reported only
                s2 = sel & (rows["net"] == net)
                if s2.sum() > 0:
                    c2, *_ = score_cell(rows, s2, tm)
                    rep["by_network"][f"{tk}kn_{b}_{net}"] = {k: c2[k] for k in ("n", "n_events", "bss_clim", "auc")}
    json.dump(rep, open(os.path.join(out_dir, "gust_ens_risk_report.json"), "w"), indent=1, default=float)
    print(markdown(rep))
    open(os.path.join(out_dir, "gust_ens_risk_report.md"), "w", encoding="utf-8").write(markdown(rep))
    return 0


def _f(x, nd=3):
    return "-" if x is None or x != x else f"{x:.{nd}f}"


def markdown(rep):
    L = [f"rows {rep['n_rows']}, runs {rep['runs_scored']}, stations NDBC {rep['stations']['ndbc']} / ASOS "
         f"{rep['stations']['asos']}, dropped {len(rep['dropped_runs'])}, VOID: {rep['void'] or 'no'}", "",
         "| cell | n | events | ev days | freq | BS ens | BS clim | BSS clim | ens-clim CI (1d) | 5d hi | BS hres | ens-hres CI (1d) "
         "| 5d hi | REL | RES | p/freq | AUC [lo, hi] | BS med | BS p90 | verdict |", "|" + "---|" * 21]
    for k, c in rep["cells"].items():
        ln = c["lines"]
        h = c.get("ens_minus_hres")
        L.append(f"| {k} | {c['n']} | {c['n_events']} | {c['event_days']} | {_f(c['event_freq'], 4)} | {_f(c['bs']['ens'], 4)} "
                 f"| {_f(c['bs']['clim'], 4)} | {_f(c['bss_clim'])} | {_f(c['ens_minus_clim'][1][0], 4)} "
                 f"[{_f(c['ens_minus_clim'][1][1], 4)}, {_f(c['ens_minus_clim'][1][2], 4)}] | {_f(c['ens_minus_clim'][5][2], 4)} "
                 f"| {_f(c['bs'].get('hres_same_rows'), 4)} | "
                 + (f"{_f(h[1][0], 4)} [{_f(h[1][1], 4)}, {_f(h[1][2], 4)}] | {_f(h[5][2], 4)}" if h else "- | -")
                 + f" | {_f(c['murphy']['rel'], 4)} | {_f(c['murphy']['res'], 4)} | {_f(ln['calib_ratio'], 2)} "
                 f"| {_f(c['auc'][0])} [{_f(c['auc'][1])}, {_f(c['auc'][2])}] | {_f(c['bs']['ens_med_01'], 4)} "
                 f"| {_f(c['bs']['ens_p90_01'], 4)} | {ln['verdict']} |")
    L += ["", "controls: " + json.dumps(rep["controls"], default=float)]
    return "\n".join(L)


def main(argv=None):
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["stations", "truth", "collect", "score"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args(argv)
    os.makedirs(a.cache, exist_ok=True)
    s = requests.Session()
    if a.cmd == "stations":
        return cmd_stations(s, a.cache)
    if a.cmd == "truth":
        return cmd_truth(s, a.cache)
    if a.cmd == "collect":
        return cmd_collect(s, a.cache, a.workers)
    return cmd_score(a.cache, a.out or os.path.join(a.cache, "report"))


if __name__ == "__main__":
    sys.exit(main())
