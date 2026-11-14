"""Do GFS-Wave height error and direction error line up at the Hawaii buoys? (offline, read-only, no served number)

Same keys as hawaii_gate.py's bulk lane (24 h lead, 3-hourly targets 2026-10-19..11-09, observed Hs >= OBS_HS_MIN, GFS-Wave
`ncep_gfswave025` from the Open-Meteo previous-runs API, cell_selection=sea), plus `wave_height_previous_day1` against the
buoy WVHT. The height here is the RAW model Hs at the sea cell, NOT the served chain (the Fable per-buoy split grades the
served chain): this tests whether the raw model's direction and height errors share a cause at the buoy, nothing more.

Run from backend/:  python -m scripts.partition_truth.hawaii_height_vs_direction --out result.json
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
from datetime import datetime, timedelta, timezone

import numpy as np

from scripts.partition_truth.hawaii_gate import CLASSES, WINDOW, ad

BUOYS = ("51201", "51202", "51206", "51211", "51212")


def _fetch_height(ppv, s8o, buoys, t0, t1):
    out = {}
    for b in buoys:
        q = {"latitude": f"{b['lat']:.4f}", "longitude": f"{b['lon']:.4f}",
             "hourly": "wave_height_previous_day1,wave_direction_previous_day1", "models": "ncep_gfswave025",
             "timezone": "UTC", "cell_selection": "sea", "start_date": (t0 - timedelta(days=7)).strftime("%Y-%m-%d"),
             "end_date": t1.strftime("%Y-%m-%d")}
        body = json.loads(ppv.get(s8o.OM_MARINE + "?" + urllib.parse.urlencode(q), timeout=180))
        if isinstance(body, dict) and body.get("error"):
            raise RuntimeError(body.get("reason"))
        h = body.get("hourly") or {}
        out[b["id"]] = {"grid": (body.get("latitude"), body.get("longitude")),
                        "time": {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): i for i, t in enumerate(h.get("time", []))},
                        "hs": h.get("wave_height_previous_day1") or [], "dir": h.get("wave_direction_previous_day1") or []}
        time.sleep(8.0)
    return out


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
    from scripts.partition_truth import ndbc_spectra as nd
    from scripts.partition_truth.hawaii_gate import OBS_HS_MIN
    t0 = datetime.fromisoformat(WINDOW[0]).replace(tzinfo=timezone.utc)
    t1 = datetime.fromisoformat(WINDOW[1]).replace(tzinfo=timezone.utc) + timedelta(hours=23)
    pos = nd.station_positions(set(BUOYS))
    buoys = [{"id": b, "lat": pos[b][0], "lon": pos[b][1]} for b in BUOYS if b in pos]
    print('buoys with position:', [b['id'] for b in buoys], file=sys.stderr)
    obs = {b["id"]: s8o.ndbc_hourly(b["id"]) for b in buoys}
    fc = _fetch_height(ppv, s8o, buoys, t0, t1)
    res = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "window": WINDOW, "lead_h": 24,
           "model": "ncep_gfswave025 (raw, sea cell), NOT the served chain", "buoys": {}}
    for b in buoys:
        bid, f = b["id"], fc[b["id"]]
        rows = []
        t = t0
        while t <= t1:
            o, i = obs[bid].get(t), f["time"].get(t)
            if o and i is not None and o["mwd"] is not None and o["hs"] >= OBS_HS_MIN and i < len(f["hs"]) and i < len(f["dir"]):
                mh, md = f["hs"][i], f["dir"][i]
                if mh is not None and md is not None:
                    rows.append((t, o["hs"], mh, o["mwd"], md))
            t += timedelta(hours=3)
        if not rows:
            res["buoys"][bid] = {"n": 0}
            continue
        hs_err = np.array([r[2] - r[1] for r in rows])                  # model - obs, m
        hs_rel = np.array([(r[2] - r[1]) / r[1] for r in rows])
        d_abs = np.abs(np.array([ad(r[4], r[3]) for r in rows], float))
        d_sgn = np.array([float(ad(r[4], r[3])) for r in rows])
        big = d_abs >= 60.0
        small = d_abs < 30.0

        def corr(x, y):
            return float(np.corrcoef(x, y)[0, 1]) if len(x) > 2 and np.std(x) > 0 and np.std(y) > 0 else None

        def part(mask):
            return {"n": int(mask.sum()), "hs_bias_m": float(hs_err[mask].mean()) if mask.any() else None,
                    "hs_mae_m": float(np.abs(hs_err[mask]).mean()) if mask.any() else None}
        res["buoys"][bid] = {
            "class": CLASSES[bid], "n": len(rows), "grid_cell": f["grid"],
            "obs_hs_mean_m": float(np.mean([r[1] for r in rows])), "mod_hs_mean_m": float(np.mean([r[2] for r in rows])),
            "hs_bias_m": float(hs_err.mean()), "hs_mae_m": float(np.abs(hs_err).mean()), "hs_bias_rel": float(hs_rel.mean()),
            "dir_mae_deg": float(d_abs.mean()), "dir_bias_deg": float(d_sgn.mean()),
            "corr_absdir_vs_hs_err": corr(d_abs, hs_err), "corr_absdir_vs_abs_hs_err": corr(d_abs, np.abs(hs_err)),
            "dir_err_lt30": part(small), "dir_err_ge60": part(big)}
    if a.out:
        with open(a.out, "w") as fh:
            json.dump(res, fh, indent=1, default=str)
    for bid, r in res["buoys"].items():
        if not r.get("n"):
            print(bid, "no rows")
            continue
        print(f"{bid} {r['class']:9s} n={r['n']:3d} obsHs={r['obs_hs_mean_m']:.2f} modHs={r['mod_hs_mean_m']:.2f} "
              f"hsBias={r['hs_bias_m']:+.2f} ({r['hs_bias_rel']*100:+.0f}%) hsMAE={r['hs_mae_m']:.2f} | dirMAE={r['dir_mae_deg']:.1f} "
              f"dirBias={r['dir_bias_deg']:+.1f} | r(|dir|,hsErr)={r['corr_absdir_vs_hs_err']} r(|dir|,|hsErr|)={r['corr_absdir_vs_abs_hs_err']}")
        print(f"      dir<30: n={r['dir_err_lt30']['n']} hsBias={r['dir_err_lt30']['hs_bias_m']} hsMAE={r['dir_err_lt30']['hs_mae_m']} | "
              f"dir>=60: n={r['dir_err_ge60']['n']} hsBias={r['dir_err_ge60']['hs_bias_m']} hsMAE={r['dir_err_ge60']['hs_mae_m']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
