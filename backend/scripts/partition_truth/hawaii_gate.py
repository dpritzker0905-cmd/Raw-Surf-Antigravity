"""Hawaii direction gate: is 'persistence beats every model at the Hawaii buoys' an artefact or real?  (OFFLINE)

Runs the S8 bulk key (GFS/EURO/ICON direction against buoy MWD, persistence = MWD 24 h earlier; Open-Meteo previous
runs, as in backend/scripts/s8_direction_period_offline.py) and this instrument's partition key (GFS-Wave swell slot 1
against the observed primary swell train, from the AWS GRIB) on the SAME (buoy, valid hour) keys, class by class, with
the controls the pre-registration names (docs/weather-program/log/2026-11-12-claude-hawaii-direction-gate.md, section 0).

  python -m scripts.partition_truth.hawaii_gate --out result.json            # from backend/
  env: RAW_SURF_PARTITION_TRUTH_CACHE (NDBC + GRIB samples), PPV_CACHE_DIR (Open-Meteo responses; set BEFORE import)

Network: www.ndbc.noaa.gov, marine-api.open-meteo.com (one request per model, public previous-runs archive) and
noaa-gfs-bdp-pds.s3.amazonaws.com (byte ranges), all sequential. Reads no Raw Surf service; writes nothing to the repo.
"""
import argparse
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

import numpy as np

# The classes are fixed in the pre-registration BEFORE any error was computed; do not edit them to fit a result.
CLASSES = {"51201": "exposed", "51202": "exposed", "51206": "exposed", "51211": "sheltered", "51212": "sheltered",
           "51214": "not_hawaii"}
SECTORS = (("N-NW (285-20)", 285.0, 20.0), ("E-NE-SE (20-170)", 20.0, 170.0), ("S-SW-W (170-285)", 170.0, 285.0))
LEAD_H = 24
WINDOW = ("2026-10-19", "2026-11-09")           # target days, as S8's graded window
OBS_HS_MIN = 0.3                                # the bulk lane's own gate
TRAIN_HS_MIN = 0.5                              # this instrument's primary-train gate


def ad(a, b):
    """Signed circular difference a - b in (-180, 180]."""
    return (np.asarray(a, float) - np.asarray(b, float) + 180.0) % 360.0 - 180.0


def cmean(deg):
    r = np.radians(np.asarray(deg, float))
    return float(np.degrees(np.arctan2(np.sin(r).mean(), np.cos(r).mean())) % 360.0)


def in_sector(d, lo, hi):
    d = np.asarray(d, float) % 360.0
    return (d >= lo) & (d < hi) if lo < hi else (d >= lo) | (d < hi)


def mae(x):
    x = np.asarray(x, float)
    return float(np.mean(np.abs(x))) if x.size else float("nan")


def model_wind(ppv, b, t0, t1):
    """{time: (dir_from_deg, speed_ms)} hourly 10 m wind at the buoy from Open-Meteo (the buoy files carry none)."""
    import urllib.parse
    q = {"latitude": f"{b['lat']:.4f}", "longitude": f"{b['lon']:.4f}", "hourly": "wind_speed_10m,wind_direction_10m",
         "wind_speed_unit": "ms", "timezone": "UTC", "start_date": (t0 - timedelta(days=2)).strftime("%Y-%m-%d"),
         "end_date": t1.strftime("%Y-%m-%d")}
    body = json.loads(ppv.get("https://historical-forecast-api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q), timeout=120))
    h = body.get("hourly") or {}
    out = {}
    for t, sp, di in zip(h.get("time", []), h.get("wind_speed_10m", []), h.get("wind_direction_10m", [])):
        if sp is not None and di is not None:
            out[datetime.fromisoformat(t).replace(tzinfo=timezone.utc)] = (float(di), float(sp))
    return out


def swell_trains(rpt, st, i, mode):
    """Observed swell trains ranked by Hs: 'age' = wave-age wind-sea label (modelled wind), 'tp10' = partitions with Tp >= 10 s."""
    trs, res = rpt.observed_trains(st, i)
    if mode == "age":
        return trs["swell"]
    return [p for p in res["partitions"] if p.get("tp_s") and p["tp_s"] >= 10.0 and p.get("dir_deg") is not None]


def build(args, s8o, ppv, nd, gw, rpt, mode="age"):
    """One row per (buoy, valid hour): bulk columns for every key, partition columns where the 00/12Z cycle exists."""
    t0 = datetime.fromisoformat(WINDOW[0]).replace(tzinfo=timezone.utc)
    t1 = datetime.fromisoformat(WINDOW[1]).replace(tzinfo=timezone.utc) + timedelta(hours=23)
    pos = nd.station_positions(set(CLASSES))
    buoys = [{"id": b, "lat": pos[b][0], "lon": pos[b][1]} for b in CLASSES if b in pos]
    obs = {b["id"]: s8o.ndbc_hourly(b["id"]) for b in buoys}
    fc = {m: s8o.om_previous_runs(buoys, m, t0 - timedelta(days=7), t1) for m in s8o.MODELS.values()}
    stations = {s: nd.load_station(s, max_age_h=1e6) for s in CLASSES}
    stations = {s: v for s, v in stations.items() if v}
    for b in buoys:
        if b["id"] in stations and not stations[b["id"]]["wind"]:
            stations[b["id"]]["wind"] = model_wind(ppv, b, t0, t1)
    grids = {m: {b: fc[m][b].get("_grid") for b in fc[m]} for m in fc}
    clim = {b["id"]: cmean([o["mwd"] for t, o in obs[b["id"]].items() if t < t0 and o["mwd"] is not None and o["hs"] >= OBS_HS_MIN] or [0.0]) for b in buoys}
    rows = {}
    for b in buoys:
        bid = b["id"]
        tidx = {}
        for m in s8o.MODELS.values():
            h = fc[m].get(bid) or {}
            tidx[m] = (h, {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): i for i, t in enumerate(h.get("time", []))})
        t = t0
        while t <= t1:
            o, p = obs[bid].get(t), obs[bid].get(t - timedelta(hours=LEAD_H))
            if o and p and o["mwd"] is not None and p["mwd"] is not None and o["hs"] >= OBS_HS_MIN:
                r = {"buoy": bid, "cls": CLASSES[bid], "T": t, "obs_mwd": o["mwd"], "obs_hs": o["hs"], "pers_mwd": p["mwd"], "clim": clim[bid]}
                ok = True
                for name, m in (("gfs", "ncep_gfswave025"), ("euro", "ecmwf_wam025"), ("icon", "dwd_gwam")):
                    h, ti = tidx[m]
                    i = ti.get(t)
                    v = None if i is None else h.get("wave_direction_previous_day1", [None] * (i + 1))[i]
                    r[name] = v
                    ok = ok and v is not None
                if ok:
                    r["cons"] = cmean([r["gfs"], r["euro"], r["icon"]])
                    rows[(bid, t)] = r
            t += timedelta(hours=3)
    # partition lane on the 00/12Z keys: cycle = T - 24 h
    for c in gw.cycles(t0 - timedelta(hours=LEAD_H), t1 - timedelta(hours=LEAD_H)):
        T = c + timedelta(hours=LEAD_H)
        try:
            samp = gw.sample(c, LEAD_H, {s: pos[s] for s in stations})
        except Exception as e:                                  # a missing cycle is counted, not hidden
            print(f"  [skip cycle {c:%Y%m%d%H}: {type(e).__name__}]", file=sys.stderr)
            continue
        for bid, st in stations.items():
            r = rows.get((bid, T))
            it, ic = rpt.nearest(st["times"], T), rpt.nearest(st["times"], c)
            v1 = (samp.get(bid) or {}).get("swell1")
            if r is None or it is None or ic is None or not v1 or v1[0] < 0.1:
                continue
            sw = swell_trains(rpt, st, it, mode)
            if not sw or sw[0]["hs_m"] < TRAIN_HS_MIN:
                continue
            tc = swell_trains(rpt, st, ic, mode)
            r.update(sl1=v1[2], sl1_hs=v1[0], tr=sw[0]["dir_deg"], tr_hs=sw[0]["hs_m"], ntr=len(sw),
                     tr_any=min((float(abs(ad(v1[2], q["dir_deg"]))), q["dir_deg"]) for q in sw)[1], trs=[q["dir_deg"] for q in sw],
                     tr_pers=tc[0]["dir_deg"] if tc else None)
    return sorted(rows.values(), key=lambda r: (r["buoy"], r["T"])), grids


def lanes(rows):
    """Per-row signed errors for every lane; None where the lane has no value for this key."""
    out = []
    for r in rows:
        d = {"buoy": r["buoy"], "cls": r["cls"], "T": r["T"], "obs": r["obs_mwd"],
             "e_gfs": float(ad(r["gfs"], r["obs_mwd"])), "e_euro": float(ad(r["euro"], r["obs_mwd"])),
             "e_icon": float(ad(r["icon"], r["obs_mwd"])), "e_cons": float(ad(r["cons"], r["obs_mwd"])),
             "e_pers": float(ad(r["pers_mwd"], r["obs_mwd"])), "e_clim": float(ad(r["clim"], r["obs_mwd"])), "has_part": "sl1" in r, "sl1": r.get("sl1"), "trs": r.get("trs"), "tr": r.get("tr")}
        if "sl1" in r:
            d.update(p_sl1=float(ad(r["sl1"], r["tr"])), p_any=float(ad(r["sl1"], r["tr_any"])),
                     p_pers=None if r["tr_pers"] is None else float(ad(r["tr_pers"], r["tr"])),
                     p_pers_any=None if r["tr_pers"] is None else min(abs(float(ad(r["tr_pers"], q))) for q in r["trs"]),
                     p_gfs_bulk=d["e_gfs"], p_tr_vs_mwd=float(ad(r["tr"], r["obs_mwd"])))
        out.append(d)
    return out


def table(L, cols):
    return {c: (mae([x[c] for x in L if x.get(c) is not None]), int(sum(x.get(c) is not None for x in L))) for c in cols}


def cluster_boot(L, a, b, reps=2000, seed=11):
    """Buoy-cluster bootstrap of mean(|a|) - mean(|b|): whole buoys resampled, so hourly autocorrelation is not n."""
    by = {}
    for x in L:
        if x.get(a) is not None and x.get(b) is not None:
            by.setdefault(x["buoy"], []).append(abs(x[a]) - abs(x[b]))
    if len(by) < 2:
        return None
    means = [float(np.mean(v)) for v in by.values()]
    rng, draws = random.Random(seed), []
    for _ in range(reps):
        draws.append(float(np.mean([means[rng.randrange(len(means))] for _ in means])))
    draws.sort()
    return {"n_buoys": len(by), "diff_mean": float(np.mean(means)), "lo": draws[int(0.025 * reps)],
            "hi": draws[int(0.975 * reps) - 1], "per_buoy": {k: float(np.mean(v)) for k, v in by.items()}}


def day_boot(L, a, b, reps=2000, seed=13, block=3):
    """Pooled 3-day block bootstrap over UTC days (keys inside a buoy-day are strongly dependent)."""
    xs = [(x["T"], abs(x[a]) - abs(x[b])) for x in L if x.get(a) is not None and x.get(b) is not None]
    if len(xs) < 10:
        return None
    days = sorted({t.date() for t, _ in xs})
    blocks = [days[i:i + block] for i in range(0, len(days), block)]
    byd = {}
    for t, v in xs:
        byd.setdefault(t.date(), []).append(v)
    rng, draws = random.Random(seed), []
    for _ in range(reps):
        vals = []
        for _ in blocks:
            for d in blocks[rng.randrange(len(blocks))]:
                vals += byd.get(d, [])
        draws.append(float(np.mean(vals)))
    draws.sort()
    return {"n_days": len(days), "diff_mean": float(np.mean([v for _, v in xs])), "lo": draws[int(0.025 * reps)],
            "hi": draws[int(0.975 * reps) - 1]}


def sector_table(L, model="e_gfs"):
    res = []
    for name, lo, hi in SECTORS:
        S = [x for x in L if in_sector(x["obs"], lo, hi)]
        if S:
            res.append({"sector": name, "n": len(S), "buoys": len({x["buoy"] for x in S}),
                        "mae_gfs": mae([x["e_gfs"] for x in S]), "mae_pers": mae([x["e_pers"] for x in S]),
                        "mae_cons": mae([x["e_cons"] for x in S]),
                        "bias_gfs_deg": float(np.mean([x["e_gfs"] for x in S])),
                        "bias_euro_deg": float(np.mean([x["e_euro"] for x in S]))})
    return res


def controls(L, seed=5):
    """Positive: a seeded +30 deg rotation of the model column is recovered by the bias estimator. Null: shuffling the
    model column among days of the same buoy removes its skill (MAE rises toward the shuffled level). 180 flip."""
    e = np.array([x["e_gfs"] for x in L])
    rot = e + 30.0
    rng, shuf = random.Random(seed), []
    byb = {}
    for x in L:
        byb.setdefault(x["buoy"], []).append(x)
    for v in byb.values():
        g = [y["e_gfs"] + y["obs"] for y in v]               # GFS direction = error + obs (mod 360)
        rng.shuffle(g)
        shuf += [float(ad(gv, y["obs"])) for gv, y in zip(g, v)]
    return {"n": len(L), "mae_gfs": mae(e), "bias_gfs": float(np.mean(e)), "circ_bias_gfs": float(ad(cmean(e), 0.0)),
            "positive_control_recovered_rotation_deg": float(ad(cmean(rot), cmean(e))), "positive_control_seeded_deg": 30.0,
            "null_shuffled_mae": mae(shuf), "flip180_mae": mae(ad(e + 180.0, 0.0))}


def report(L):
    out = {"n": len(L), "buoys": sorted({x["buoy"] for x in L})}
    out["bulk"] = table(L, ("e_gfs", "e_euro", "e_icon", "e_cons", "e_pers", "e_clim"))
    out["boot_buoy_gfs_minus_clim"] = cluster_boot(L, "e_gfs", "e_clim")
    out["boot_buoy_pers_minus_clim"] = cluster_boot(L, "e_pers", "e_clim")
    out["boot_buoy_gfs_minus_pers"] = cluster_boot(L, "e_gfs", "e_pers")
    out["boot_buoy_cons_minus_pers"] = cluster_boot(L, "e_cons", "e_pers")
    out["boot_day_gfs_minus_pers"] = day_boot(L, "e_gfs", "e_pers")
    out["boot_day_cons_minus_pers"] = day_boot(L, "e_cons", "e_pers")
    P = [x for x in L if x["has_part"]]
    out["partition_keys"] = {"n": len(P), "bulk_on_same_keys": table(P, ("e_gfs", "e_cons", "e_pers")),
                             "slot1_vs_primary_train": table(P, ("p_sl1",)), "slot1_vs_any_train": table(P, ("p_any",)),
                             "persistence_train": table(P, ("p_pers",)), "persistence_any_train": table(P, ("p_pers_any",)),
                             "boot_buoy_any_minus_pers_any": cluster_boot(P, "p_any", "p_pers_any"), "train_vs_mwd": table(P, ("p_tr_vs_mwd",)),
                             "boot_buoy_slot1_minus_pers_train": cluster_boot(P, "p_sl1", "p_pers"),
                             "boot_buoy_any_minus_pers_train": cluster_boot(P, "p_any", "p_pers")}
    rng, nul = random.Random(9), []
    for b in {x["buoy"] for x in P}:
        B = [x for x in P if x["buoy"] == b]
        sh = [x["sl1"] for x in B]
        rng.shuffle(sh)
        nul += [min(abs(float(ad(m, d))) for d in x["trs"]) for m, x in zip(sh, B)]
    out["partition_keys"]["any_train_null_shuffled_slot1_mae"] = mae(nul)
    psec = []
    for name, lo, hi in SECTORS:
        S = [x for x in P if x.get("tr") is not None and in_sector(x["tr"], lo, hi)]
        if S:
            psec.append({"train_sector": name, "n": len(S), "slot1": mae([x["p_sl1"] for x in S]), "any": mae([x["p_any"] for x in S]),
                         "pers_train": mae([x["p_pers"] for x in S if x["p_pers"] is not None])})
    out["partition_keys"]["by_train_sector"] = psec
    out["sectors"] = sector_table(L)
    out["controls"] = controls(L) if L else None
    return out


def per_buoy(L):
    rows = []
    for b in sorted({x["buoy"] for x in L}):
        B = [x for x in L if x["buoy"] == b]
        P = [x for x in B if x["has_part"]]
        rows.append({"buoy": b, "cls": CLASSES[b], "n": len(B), "gfs": mae([x["e_gfs"] for x in B]),
                     "euro": mae([x["e_euro"] for x in B]), "icon": mae([x["e_icon"] for x in B]),
                     "cons": mae([x["e_cons"] for x in B]), "pers": mae([x["e_pers"] for x in B]),
                     "bias_gfs": float(np.mean([x["e_gfs"] for x in B])), "n_part": len(P),
                     "sl1_train": mae([x["p_sl1"] for x in P]), "any_train": mae([x["p_any"] for x in P]),
                     "pers_train": mae([x["p_pers"] for x in P if x["p_pers"] is not None])})
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=None)
    ap.add_argument("--ppv-cache", default=os.path.join(os.environ.get("TEMP", "."), "rs_hg_om_cache"))
    a = ap.parse_args(argv)
    os.environ.setdefault("PPV_CACHE_DIR", a.ppv_cache)
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, os.path.dirname(os.path.dirname(here)))
    sys.path.insert(0, os.path.dirname(here))
    from scripts import s8_direction_period_offline as s8o
    import peak_period_validation as ppv
    from scripts.partition_truth import gfswave_partitions as gw
    from scripts.partition_truth import ndbc_spectra as nd
    from scripts.partition_truth import run_partition_truth as rpt
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "window_targets": WINDOW,
           "lead_h": LEAD_H, "classes": CLASSES, "labels": {}}
    for mode in ("age", "tp10"):
        rows, grids = build(a, s8o, ppv, nd, gw, rpt, mode)
        L = lanes(rows)
        sets = {"all_six_as_S8": L, "hawaii_five": [x for x in L if x["cls"] != "not_hawaii"],
                "exposed": [x for x in L if x["cls"] == "exposed"], "sheltered": [x for x in L if x["cls"] == "sheltered"],
                "samoa_51214": [x for x in L if x["cls"] == "not_hawaii"]}
        five = sets["hawaii_five"]
        loo = {}
        for b in sorted({x["buoy"] for x in five}):
            rest = [x for x in five if x["buoy"] != b]
            loo[f"without_{b}"] = {"n": len(rest), "bulk": table(rest, ("e_gfs", "e_cons", "e_pers")),
                                   "boot_buoy_gfs_minus_pers": cluster_boot(rest, "e_gfs", "e_pers")}
        out["labels"][mode] = {"sets": {k: report(v) for k, v in sets.items() if v}, "per_buoy": per_buoy(L),
                               "leave_one_buoy_out": loo}
        out["open_meteo_grid_cells"] = grids.get("ncep_gfswave025")
    text = json.dumps(out, indent=1, default=str)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(text)
    print(text)


if __name__ == "__main__":
    main()
