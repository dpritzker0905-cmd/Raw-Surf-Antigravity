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
from services import buoy_holdout  # noqa: E402 - the locked-holdout fence

import wind_lr_obs as obs  # noqa: E402

SPAN = (datetime(2026, 10, 10, tzinfo=timezone.utc), datetime(2026, 11, 21, tzinfo=timezone.utc))   # station cover
RUNS = [datetime(2026, 10, 10, tzinfo=timezone.utc) + timedelta(days=k) for k in range(42)]       # 10-10 .. 11-20 00Z
BINS = {"B1": (12, 24, 36, 48, 60, 72, 84), "B2": (96, 108, 120, 132, 144), "B3": (168, 192, 216, 240),
        "B4": (264, 288, 312, 336, 360)}
LEADS = [L for b in BINS.values() for L in b]
HRES_MAX = 240
ENS_BASE = os.environ.get("GER_ENS_BASE") or ef.AWS_BASE
SEED, NULL_SEED, REPS = 20261122, 20261123, 10000          # amendment 1 A1: 10,000 reps for every CI
ROWS_MIN = 1000                                              # amendment 1 A3: fewer rows in a cell -> UNDERPOWERED
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
    sha, n_files = truth_hash(cache)
    end = None
    for c in st["ndbc"]:
        recs = obs.parse_ndbc_stdmet(open(os.path.join(cache, "ndbc", f"{c['id']}_realtime2.txt"), encoding="utf-8").read())
        if recs:
            end = max(end or max(recs), max(recs))
    doc = {"sha256": sha, "files": n_files, "taken_at": datetime.now(timezone.utc).isoformat(),
           "truth_end": end.isoformat() if end else None}
    json.dump(doc, open(os.path.join(cache, "truth.json"), "w"), indent=1)
    print(json.dumps(doc))
    return 0


def truth_hash(cache):
    """(sha256, files) over every file under <cache>/ndbc and <cache>/metar, path-ordered, path then bytes (amendment 1
    A5: a score re-hashes first; a mismatch voids the run)."""
    h = hashlib.sha256()
    files = sorted(os.path.join(d, f) for sub in ("ndbc", "metar") for d, _, fs in os.walk(os.path.join(cache, sub))
                   for f in fs)
    for p in files:
        h.update(os.path.relpath(p, cache).replace("\\", "/").encode())
        h.update(open(p, "rb").read())
    return h.hexdigest(), len(files)


def station_ids(st):
    return [c["id"] for c in st["ndbc"]] + [c["id"] for c in st["asos"]]


def station_truth(cache, st, skip=frozenset(), ndbc_file="{id}_realtime2.txt", ndbc_dir="ndbc"):
    """[dict | None] per station in the frozen order: gust times/values and the record times that count for coverage.
    A station in `skip` (amendment 1 A4: #1199's LOCKED buoys) is None, and its file is never opened."""
    out = []
    for c in st["ndbc"]:
        if c["id"] in skip or buoy_holdout.is_locked(c["id"]):
            out.append(None)
            continue
        p = os.path.join(cache, ndbc_dir, ndbc_file.format(id=c["id"]))
        if not os.path.exists(p):
            out.append(None)
            continue
        recs = obs.parse_ndbc_stdmet(open(p, encoding="utf-8").read())
        tm, gv = [], []
        for t, (_w, g, _d) in sorted(recs.items()):
            if g == g:
                tm.append(_ep(t))
                gv.append(float(obs.to_10m(g, c["anemometer_m"])))
        out.append({"kind": "ndbc", "t": np.array(tm, np.int64), "g": np.array(gv), "cov": np.array(tm, np.int64)})
    for c in st["asos"]:
        if c["id"] in skip:
            out.append(None)
            continue
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
def read_id_list(path, key):
    """A frozen station-id list: a JSON list, or an object holding it under `key` (#1199's frozen list: `locked`,
    `fit_used`), or under `ids`. Missing path -> empty set."""
    if not path:
        return frozenset()
    doc = json.load(open(path))
    if isinstance(doc, dict):
        doc = doc.get(key, doc.get("ids", []))
    return frozenset(str(x.get("id") if isinstance(x, dict) else x).upper() for x in doc)


def _iter_slots(cache, truths, count_only=False):
    """(run label, lead, valid, station index, member column, hres) for every slot whose truth window is covered and whose
    50 member values are finite. count_only reads nothing but coverage and finiteness (amendment 1 A3)."""
    run_dir = os.path.join(cache, "runs")
    for fn in sorted(f for f in os.listdir(run_dir) if f.endswith(".npz")):
        z = np.load(os.path.join(run_dir, fn))
        run = datetime.strptime(fn[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        for L in LEADS:
            if f"ens_{L}" not in z:
                continue
            m = z[f"ens_{L}"]
            fin = np.all(np.isfinite(m), axis=0)
            hres = z[f"hres_{L}"] if f"hres_{L}" in z else np.full(m.shape[1], np.nan)
            V = run + timedelta(hours=L)
            end, w = _ep(V), gr.gust_window_h(L)
            for i, tr in enumerate(truths):
                if tr is None or not fin[i] or not covered(tr["cov"], end, w):
                    continue
                yield int(fn[:10]), L, V, end, w, i, (None if count_only else m[:, i]), (None if count_only else hres[i])


def build_rows(cache, locked=frozenset(), fit_used=frozenset(), truths=None):
    """One row per (run, lead, station) with every arm's value and the truth window max. LOCKED stations are never read;
    fit-used rows are flagged (they never decide, amendment 1 A4)."""
    st = json.load(open(os.path.join(cache, "stations.json")))
    stations = st["ndbc"] + st["asos"]
    ids = station_ids(st)
    truths = truths if truths is not None else station_truth(cache, st, skip=locked)
    R = {k: [] for k in ("run", "lead", "sta", "day", "obs", "obs_shift", "obs_w6", "hres", "net", "fit_used")}
    ens = []
    run_dir = os.path.join(cache, "runs")
    dropped = sorted({f.split(".")[0] for f in os.listdir(run_dir) if f.endswith(".failed.json")})
    for run, L, V, end, w, i, col, hv in _iter_slots(cache, truths):
        tr = truths[i]
        o = truth_row(tr, end, w)
        if o != o:
            continue
        R["run"].append(run)
        R["lead"].append(L)
        R["sta"].append(i)
        R["day"].append(V.toordinal())
        R["obs"].append(o)
        R["obs_shift"].append(truth_row(tr, end + 24 * 60, w))
        R["obs_w6"].append(truth_row(tr, end, 6) if w == 1 else float("nan"))
        R["hres"].append(float(hv))
        R["net"].append(tr["kind"])
        R["fit_used"].append(ids[i].upper() in fit_used)
        ens.append(col)
    out = {k: np.array(v) for k, v in R.items()}
    out["ens"] = np.array(ens, dtype=np.float32).reshape(-1, gr.MEMBERS)
    return out, stations, dropped


def n_table(cache, locked=frozenset(), fit_used=frozenset()):
    """Amendment 1 A3: rows / stations / days per lead bin (deciding rows = not fit-used), from coverage and member
    finiteness only. No observed value, event or probability is read."""
    st = json.load(open(os.path.join(cache, "stations.json")))
    ids = station_ids(st)
    truths = station_truth(cache, st, skip=locked)
    acc = {b: {"rows": 0, "stations": set(), "days": set(), "rows_fit_used": 0, "clusters": set(), "rows_ndbc": 0} for b in BINS}
    for _run, L, V, _end, _w, i, _c, _h in _iter_slots(cache, truths, count_only=True):
        a = acc[bin_of(L)]
        if ids[i].upper() in fit_used:
            a["rows_fit_used"] += 1
            continue
        a["rows"] += 1
        a["stations"].add(i)
        a["days"].add(V.toordinal())
        a["clusters"].add((i, V.toordinal() // 3))           # amendment 2 B7: station x 3-day blocks
        a["rows_ndbc"] += i < len(st["ndbc"])
    return {b: {"rows": a["rows"], "rows_ndbc": a["rows_ndbc"], "stations": len(a["stations"]), "days": len(a["days"]),
                "clusters": len(a["clusters"]), "rows_fit_used": a["rows_fit_used"]}
            for b, a in acc.items()}


def score_cell(rows, sel, t_ms, rng_seed=SEED, reps=None):
    """One threshold x bin cell (gate section 4 + amendments 1-2): fair Brier for ENS (B1), CLIM, the crossed bootstrap
    p-value that decides (B2), the calibration fit (B4), and every reported line."""
    reps = reps or REPS
    o = (rows["obs"][sel] >= t_ms).astype(float)
    k = (rows["ens"][sel] >= t_ms).sum(axis=1)
    p = k / gr.MEMBERS
    days, sta = rows["day"][sel], rows["sta"][sel]
    clim = gr.loo_day_climatology(sta, days, o)
    fair = gr.fair_brier_rows(p, o)
    hres_ok = np.isfinite(rows["hres"][sel])
    out = {"n": int(sel.sum()), "n_events": int(o.sum()), "event_days": int(len(np.unique(days[o > 0]))),
           "n_stations": int(len(np.unique(sta))), "event_freq": float(o.mean()) if o.size else float("nan"),
           "event_clusters": int(len({(s, d // 3) for s, d, e in zip(sta, days, o) if e > 0}))}
    out["bs"] = {"ens": float(fair.mean()) if o.size else float("nan"), "ens_raw": gr.brier(p, o), "clim": gr.brier(clim, o)}
    d_clim = fair - (clim - o) ** 2
    out["p1_crossed"] = gr.crossed_boot(d_clim, sta, days, reps, rng_seed, 3)         # decides (with Holm)
    out["ens_minus_clim"] = {b: gr.block_ci_mean(d_clim, days, reps, rng_seed, b) for b in (1, 5)}   # reported
    out["ens_minus_clim_station"] = gr.block_ci_mean(d_clim, sta, reps, rng_seed, 1)                # reported
    out["bss_clim"] = 1 - out["bs"]["ens"] / out["bs"]["clim"] if out["bs"]["clim"] > 0 else float("nan")
    if hres_ok.any():
        h = (rows["hres"][sel] >= t_ms).astype(float)
        d_h = np.where(hres_ok, fair - (h - o) ** 2, np.nan)
        out["bs"]["hres_same_rows"] = gr.brier(h[hres_ok], o[hres_ok])
        out["bs"]["ens_same_rows_as_hres"] = float(fair[hres_ok].mean())
        out["ens_minus_hres"] = {b: gr.block_ci_mean(d_h, days, reps, rng_seed, b) for b in (1, 5)}
        out["n_hres"] = int(hres_ok.sum())
    med = np.median(rows["ens"][sel], axis=1) >= t_ms
    p90 = np.percentile(rows["ens"][sel], 90, axis=1) >= t_ms
    out["bs"]["ens_med_01"], out["bs"]["ens_p90_01"] = gr.brier(med, o), gr.brier(p90, o)
    out["murphy"] = gr.murphy(p, o)
    out["calibration"] = dict(zip(("intercept", "slope"), gr.calibration_fit(p, o)))
    out["reliability_51"] = reliability_classes(k, o, rng_seed)
    out["auc"] = gr.block_ci_auc(p, o, days, reps, rng_seed, 1)
    return out, p, o, days


def reliability_classes(k, o, seed, min_rows=50, draws=2000):
    """Amendment 2 B4 (reported): the diagram over the 51 member-count classes, adjacent classes pooled to >= `min_rows`,
    with 95% consistency bars from binomial resampling at each point's mean p."""
    rng = np.random.default_rng(seed)
    pts, acc_k, acc_o = [], [], []
    for c in range(gr.MEMBERS + 1):
        m = k == c
        acc_k += list(k[m])
        acc_o += list(o[m])
        if len(acc_k) >= min_rows or (c == gr.MEMBERS and acc_k):
            n, pbar, obs_f = len(acc_k), float(np.mean(acc_k)) / gr.MEMBERS, float(np.mean(acc_o))
            sim = rng.binomial(n, pbar, size=draws) / n
            pts.append({"to_class": c, "n": n, "mean_p": round(pbar, 4), "obs_freq": round(obs_f, 4),
                        "consistency_95": [round(float(np.percentile(sim, 2.5)), 4), round(float(np.percentile(sim, 97.5)), 4)]})
            acc_k, acc_o = [], []
    return pts


def calib_ok(c):
    """Amendment 2 B4: logistic slope in [0.5, 1.5] and mean(p) / event frequency in [0.5, 2.0]."""
    mu = c["murphy"]
    ratio = mu["mean_p"] / mu["obar"] if mu["obar"] > 0 else float("inf")
    b = c["calibration"]["slope"]
    return bool(b == b and 0.5 <= b <= 1.5 and 0.5 <= ratio <= 2.0), ratio


def powered(c):
    return not (c["n"] < ROWS_MIN or c["n_events"] < 30 or c["event_days"] < 10)


def decide(rows, rng_seed=SEED, reps=None):
    """Every P1 cell with its verdict after Holm over the powered cells (amendment 2 B2-B4). ASOS rows are out of P1 at
    25 kn (B3); they get their own reported table."""
    cells, asos25 = {}, {}
    for tk, tm in gr.iter_cells():
        for b, leads in BINS.items():
            sel = np.isin(rows["lead"], leads)
            if tk == gr.THRESHOLDS_KN[0]:
                s_asos = sel & (rows["net"] == "asos")
                if s_asos.any():
                    ca, *_ = score_cell(rows, s_asos, tm, rng_seed, reps)
                    asos25[f"{tk}kn_{b}_asos"] = {k: ca[k] for k in ("n", "n_events", "bss_clim", "p1_crossed", "auc")}
                sel = sel & (rows["net"] != "asos")
            if not sel.any():
                continue
            c, *_ = score_cell(rows, sel, tm, rng_seed, reps)
            ok, ratio = calib_ok(c)
            hres_line = (c["ens_minus_hres"][1][2] < 0) if ("ens_minus_hres" in c and b != "B4") else None
            c["lines"] = {"calibration_ok": ok, "calib_ratio": ratio, "powered": powered(c),
                          "reported": {"G2_vs_hres": hres_line, "G4_auc": bool(c["auc"][1] > 0.70),
                                       "day_1d": bool(c["ens_minus_clim"][1][2] < 0),
                                       "station_only": bool(c["ens_minus_clim_station"][2] < 0),
                                       "fragile_5d": bool(c["ens_minus_clim"][1][2] < 0 and not c["ens_minus_clim"][5][2] < 0)}}
            cells[f"{tk}kn_{b}"] = c
    adj = gr.holm({k: c["p1_crossed"][3] for k, c in cells.items() if c["lines"]["powered"]})
    for k, c in cells.items():
        ln = c["lines"]
        ln["holm_p"] = adj.get(k)
        if not ln["powered"]:
            ln["verdict"] = "UNDERPOWERED"
        else:
            ln["verdict"] = "PASS" if (adj[k] < 0.05 and ln["calibration_ok"]) else "FAIL"
    return cells, asos25


def shift_truths(truths, days, span):
    """C6 (amendment 2 B6): each station's records circularly shifted by `days` within [span[0], span[1]) (epoch minutes)."""
    a, n = span[0], span[1] - span[0]
    out = []
    for tr in truths:
        if tr is None:
            out.append(None)
            continue
        t = a + (tr["t"] - a + days * 1440) % n
        o = np.argsort(t, kind="stable")
        cov = np.sort(a + (tr["cov"] - a + days * 1440) % n)
        out.append({"kind": tr["kind"], "t": t[o], "g": tr["g"][o], "cov": cov})
    return out


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


def _subset(rows, keep):
    return {k: v[keep] for k, v in rows.items()}


def cmd_count(cache, out_path, locked, fit_used):
    doc = {"gate": "gust-ens-risk-v1 amendment 1 A3", "made_at": datetime.now(timezone.utc).isoformat(),
           "locked_stations": len(locked), "fit_used_stations": len(fit_used), "by_bin": n_table(cache, locked, fit_used)}
    json.dump(doc, open(out_path, "w"), indent=1)
    print(json.dumps(doc, indent=1))
    return 0


def cmd_score(cache, out_dir, locked, fit_used, n_table_path, october=False):
    os.makedirs(out_dir, exist_ok=True)
    void = []
    truth = json.load(open(os.path.join(cache, "truth.json")))
    sha, _n = truth_hash(cache)
    if sha != truth["sha256"]:
        void.append(f"truth re-hash {sha[:12]} != frozen {truth['sha256'][:12]}")
    st = json.load(open(os.path.join(cache, "stations.json")))
    truths = station_truth(cache, st, skip=locked)
    rows_all, stations, dropped = build_rows(cache, locked, fit_used, truths=truths)
    rows = _subset(rows_all, ~rows_all["fit_used"])
    if n_table_path:                                     # amendment 1 A3: the score uses exactly the committed rows
        want = json.load(open(n_table_path))["by_bin"]
        got = {b: int(np.isin(rows["lead"], leads).sum()) for b, leads in BINS.items()}
        if any(got[b] != want[b]["rows"] for b in BINS):
            void.append(f"rows {got} != committed n table {({b: want[b]['rows'] for b in BINS})}")
    else:
        void.append("no committed n table")
    rep = {"gate": "gust-ens-risk-v1 (+ amendments 1, 2)", "label": "recorded, not a claim (amendment 1 A7)",
           "n_rows": int(rows["obs"].size), "n_rows_fit_used": int(rows_all["fit_used"].sum()), "dropped_runs": dropped,
           "runs_scored": int(len(np.unique(rows["run"]))), "truth": truth, "truth_rehash": sha,
           "locked_dropped": len(locked & {s["id"].upper() for s in stations}),
           "stations": {"ndbc": sum(1 for s in stations if s["kind"] == "ndbc" and s["id"].upper() not in locked),
                        "asos": sum(1 for s in stations if s["kind"] == "asos" and s["id"].upper() not in locked)},
           "reps": REPS, "controls": controls(rows), "by_network": {}, "fit_used_cells": {}}
    rep["cells"], rep["asos_25kn_reported"] = decide(rows)
    # C6: the whole decision rule under a dependent null (circular per-station shifts); any PASS voids the run
    span = (_ep(datetime(2026, 10, 9, tzinfo=timezone.utc)), _ep(datetime.fromisoformat(truth["truth_end"])))
    c6 = {}
    for dd in (7, 14, 21):
        rs, _s, _d = build_rows(cache, locked, fit_used, truths=shift_truths(truths, dd, span))
        cells_sh, _a = decide(_subset(rs, ~rs["fit_used"]))
        raw_p = [c["p1_crossed"][3] for c in cells_sh.values() if c["lines"]["powered"]]
        c6[f"shift_{dd}d"] = {"passes": [k for k, c in cells_sh.items() if c["lines"]["verdict"] == "PASS"],
                              "powered_cells": len(raw_p), "raw_p_below_0.05": int(sum(p < 0.05 for p in raw_p))}
    n_raw = sum(v["powered_cells"] for v in c6.values())
    rep["controls"]["C6"] = {"by_shift": c6, "pass": not any(v["passes"] for v in c6.values()),
                             "calibration_warning": bool(n_raw and sum(v["raw_p_below_0.05"] for v in c6.values()) > 0.05 * n_raw)}
    void += [k for k in ("C1", "C2", "C3", "C4", "C6") if not rep["controls"][k]["pass"]]
    if len(dropped) > DROP_MAX * len(RUNS):
        void.append(f"dropped runs {len(dropped)} > 10%")
    rep["void"] = void
    for tk, tm in gr.iter_cells():
        for b, leads in BINS.items():
            sel = np.isin(rows["lead"], leads)
            for net in ("ndbc", "asos"):          # reported only
                s2 = sel & (rows["net"] == net)
                if s2.sum() > 0:
                    c2, *_ = score_cell(rows, s2, tm)
                    rep["by_network"][f"{tk}kn_{b}_{net}"] = {k: c2[k] for k in ("n", "n_events", "bss_clim", "auc")}
            fu = np.isin(rows_all["lead"], leads) & rows_all["fit_used"]
            if fu.sum() > 0:                      # fit-used stations: reported only, never decide (A4)
                c3, *_ = score_cell(rows_all, fu, tm)
                rep["fit_used_cells"][f"{tk}kn_{b}"] = {k: c3[k] for k in ("n", "n_events", "bss_clim", "auc")}
    if october:                                   # A6: QC'd October monthly NDBC truth, reported sensitivity only
        tr_oct = station_truth(cache, st, skip=locked, ndbc_file="{id}.txt", ndbc_dir="ndbc_oct2026")
        tr_oct = [t if (t is not None and t["kind"] == "ndbc") else None for t in tr_oct]
        ro, _s, _d = build_rows(cache, locked, fit_used, truths=tr_oct)
        ro = _subset(ro, ~ro["fit_used"] & np.array([datetime.fromordinal(int(d)).month == 10 for d in ro["day"]], bool))
        cells_oct, _a = decide(ro)
        rep["october_monthly_sensitivity"] = {k: {"n": c["n"], "n_events": c["n_events"], "bss_clim": c["bss_clim"],
                                                  "p1_crossed": c["p1_crossed"], "verdict_if_primary": c["lines"]["verdict"]}
                                              for k, c in cells_oct.items()}
    json.dump(rep, open(os.path.join(out_dir, "gust_ens_risk_report.json"), "w"), indent=1, default=float)
    print(markdown(rep))
    open(os.path.join(out_dir, "gust_ens_risk_report.md"), "w", encoding="utf-8").write(markdown(rep))
    return 0


def _f(x, nd=3):
    return "-" if x is None or x != x else f"{x:.{nd}f}"


def markdown(rep):
    L = [f"rows {rep['n_rows']}, runs {rep['runs_scored']}, stations NDBC {rep['stations']['ndbc']} / ASOS "
         f"{rep['stations']['asos']}, dropped {len(rep['dropped_runs'])}, VOID: {rep['void'] or 'no'}", "",
         "| cell | n | events | ev days | freq | BS ens (fair) | BS clim | BSS clim | P1 crossed [lo, hi] | p | Holm p "
         "| day CI hi | station hi | 5d hi "
         "| BS hres | ens-hres CI (1d) | 5d hi | REL | RES | slope | p/freq | AUC [lo, hi] | BS med | BS p90 | verdict |", "|" + "---|" * 26]
    for k, c in rep["cells"].items():
        ln = c["lines"]
        h = c.get("ens_minus_hres")
        L.append(f"| {k} | {c['n']} | {c['n_events']} | {c['event_days']} | {_f(c['event_freq'], 4)} | {_f(c['bs']['ens'], 4)} "
                 f"| {_f(c['bs']['clim'], 4)} | {_f(c['bss_clim'])} | {_f(c['p1_crossed'][0], 4)} "
                 f"[{_f(c['p1_crossed'][1], 4)}, {_f(c['p1_crossed'][2], 4)}] | {_f(c['p1_crossed'][3], 4)} | {_f(ln.get('holm_p'), 4)} "
                 f"| {_f(c['ens_minus_clim'][1][2], 4)} "
                 f"| {_f(c['ens_minus_clim_station'][2], 4)} | {_f(c['ens_minus_clim'][5][2], 4)} "
                 f"| {_f(c['bs'].get('hres_same_rows'), 4)} | "
                 + (f"{_f(h[1][0], 4)} [{_f(h[1][1], 4)}, {_f(h[1][2], 4)}] | {_f(h[5][2], 4)}" if h else "- | -")
                 + f" | {_f(c['murphy']['rel'], 4)} | {_f(c['murphy']['res'], 4)} | {_f(c['calibration']['slope'], 2)} | {_f(ln['calib_ratio'], 2)} "
                 f"| {_f(c['auc'][0])} [{_f(c['auc'][1])}, {_f(c['auc'][2])}] | {_f(c['bs']['ens_med_01'], 4)} "
                 f"| {_f(c['bs']['ens_p90_01'], 4)} | {ln['verdict']} |")
    L += ["", "controls: " + json.dumps(rep["controls"], default=float)]
    return "\n".join(L)


def message_bytes(index_text, param, step, typ):
    """(sum of `_length`, count) of the messages a collection read from one index: the 50 `pf` (ENS) or the one `fc`."""
    tot = n = 0
    for e in ec.parse_ecmwf_index(index_text):
        if e.get("param") == param and int(e.get("step", -1)) == step and e.get("type") == typ:
            tot += int(e["_length"])
            n += 1
    return tot, n


def cmd_egress(s, cache, out_path):
    """Amendment 1 A8: the bytes the collection read, measured from the indices of the collected runs: every member and
    HRES message (`_length`) plus every index file (its size). This pass itself re-reads the indices (also counted)."""
    run_dir = os.path.join(cache, "runs")
    doc = {"ens_message_bytes": 0, "ens_messages": 0, "hres_message_bytes": 0, "hres_messages": 0, "index_bytes": 0,
           "indices": 0, "run_steps": 0}
    for fn in sorted(f for f in os.listdir(run_dir) if f.endswith(".npz")):
        z = np.load(os.path.join(run_dir, fn))
        run = datetime.strptime(fn[:10], "%Y%m%d%H").replace(tzinfo=timezone.utc)
        for L in LEADS:
            p = gr.gust_param(L)
            if f"ens_{L}" in z:
                r = ef._get(s, ef.ef_url(ENS_BASE, run, L, "index"))
                b, n = message_bytes(r.text, p, L, "pf")
                doc["ens_message_bytes"] += b
                doc["ens_messages"] += n
                doc["index_bytes"] += len(r.content)
                doc["indices"] += 1
                doc["run_steps"] += 1
            if f"hres_{L}" in z:
                r = ef._get(s, ef.ef_url(ENS_BASE, run, L, "index", stream="oper", typ="fc"))
                b, n = message_bytes(r.text, p, L, "fc")
                doc["hres_message_bytes"] += b
                doc["hres_messages"] += n
                doc["index_bytes"] += len(r.content)
                doc["indices"] += 1
    doc["collection_bytes"] = doc["ens_message_bytes"] + doc["hres_message_bytes"] + doc["index_bytes"]
    doc["this_pass_bytes"] = doc["index_bytes"]
    json.dump(doc, open(out_path, "w"), indent=1)
    print(json.dumps(doc, indent=1))
    return 0


def cmd_october(s, cache):
    """Amendment 1 A6: NDBC's QC'd October 2026 monthly stdmet for the frozen NDBC stations minus LOCKED, into
    <cache>/ndbc_oct2026 (outside the hashed truth), with its own hash. A sensitivity only."""
    st = json.load(open(os.path.join(cache, "stations.json")))
    d = os.path.join(cache, "ndbc_oct2026")
    os.makedirs(d, exist_ok=True)
    h, got = hashlib.sha256(), 0
    for c in st["ndbc"]:
        p = os.path.join(d, f"{c['id']}.txt")
        if not os.path.exists(p):
            r = obs._get(s, f"{obs.NDBC}/data/stdmet/Oct/{c['id'].upper()}.txt", tries=3)
            open(p, "w", encoding="utf-8").write(r.text if r.status_code == 200 else "")
        body = open(p, "rb").read()
        got += bool(body)
        h.update(c["id"].encode())
        h.update(body)
    doc = {"sha256": h.hexdigest(), "stations_with_file": got, "taken_at": datetime.now(timezone.utc).isoformat()}
    json.dump(doc, open(os.path.join(cache, "october.json"), "w"), indent=1)
    print(json.dumps(doc))
    return 0


def main(argv=None):
    import requests
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["stations", "truth", "collect", "count", "egress", "october", "score"])
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", default=None)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--locked", default=None, help="#1199's frozen LOCKED list (never read; amendment 1 A4)")
    ap.add_argument("--fit-used", default=None, help="a frozen fit-used station list (reported only, never decides)")
    ap.add_argument("--fit-used-key", default="fit_used")
    ap.add_argument("--n-table", default=None, help="the committed n table (amendment 1 A3)")
    ap.add_argument("--with-october", action="store_true", help="add the October monthly sensitivity (A6)")
    a = ap.parse_args(argv)
    os.makedirs(a.cache, exist_ok=True)
    s = requests.Session()
    if a.cmd == "stations":
        return cmd_stations(s, a.cache)
    if a.cmd == "truth":
        return cmd_truth(s, a.cache)
    if a.cmd == "collect":
        return cmd_collect(s, a.cache, a.workers)
    if a.cmd == "egress":
        return cmd_egress(s, a.cache, a.out or os.path.join(a.cache, "egress.json"))
    if a.cmd == "october":
        return cmd_october(s, a.cache)
    locked = read_id_list(a.locked, "locked") | buoy_holdout.locked()     # the recorded fence, too (empty until frozen)
    fit_used = read_id_list(a.fit_used, a.fit_used_key)
    if not a.locked:
        print(f"{a.cmd} refused: #1199's frozen LOCKED list is required (amendment 1 A4)", file=sys.stderr)
        return 2
    if a.cmd == "count":
        return cmd_count(a.cache, a.out or os.path.join(a.cache, "n_table.json"), locked, fit_used)
    return cmd_score(a.cache, a.out or os.path.join(a.cache, "report"), locked, fit_used, a.n_table, a.with_october)


if __name__ == "__main__":
    sys.exit(main())
