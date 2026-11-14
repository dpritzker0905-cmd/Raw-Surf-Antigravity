"""Can a 0.05 degree regional run represent the Hawaii buoys' MWD at all?  (OFFLINE, informational)

PacIOOS ww3_hawaii "best" is an analysis-style splice (not a 24 h-lead forecast), so it is compared at the SAME valid hours
with GFS-Wave's own best estimate (Open-Meteo marine `wave_direction`, no previous-run suffix) against the buoy MWD. This
bounds what a regional run could add; it is NOT a skill claim for a forecast lead. Licence note: the dataset's own
attribute allows free use and redistribution, not legal use (docs/weather-program/log/2026-11-12-researcher-hawaii-island-shadowing.md s6).
  python -m scripts.partition_truth.hawaii_regional_check [--out result.json]    # from backend/
Network: pae-paha.pacioos.hawaii.edu (5 griddap point requests), marine-api.open-meteo.com (1), ndbc.noaa.gov (cache).
"""
import argparse
import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import numpy as np

from scripts.partition_truth.hawaii_gate import CLASSES, OBS_HS_MIN, WINDOW, ad, mae

ERDDAP = "https://pae-paha.pacioos.hawaii.edu/erddap/griddap/ww3_hawaii.csv"
UA = "RawSurf-research/1.0 (offline instrument; contact via repository)"


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return r.read()


def regional(lat, lon, t0, t1):
    lon360 = lon % 360.0
    q = f"Tdir[({t0:%Y-%m-%dT%H:%M:%SZ}):1:({t1:%Y-%m-%dT%H:%M:%SZ})][(0.0)][({lat})][({lon360})]"
    rows = list(csv.reader(io.StringIO(get(ERDDAP + "?" + urllib.parse.quote(q, safe="()[]:,=")).decode())))[2:]
    time.sleep(1.0)
    return {datetime.strptime(r[0], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc): float(r[4]) for r in rows
            if len(r) > 4 and r[4] not in ("", "NaN")}


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
    from scripts.partition_truth import ndbc_spectra as nd
    import peak_period_validation as ppv
    t0 = datetime.fromisoformat(WINDOW[0]).replace(tzinfo=timezone.utc)
    t1 = datetime.fromisoformat(WINDOW[1]).replace(tzinfo=timezone.utc) + timedelta(hours=23)
    pos = nd.station_positions({b for b, c in CLASSES.items() if c != "not_hawaii"})
    ids = sorted(pos)
    q = {"latitude": ",".join(f"{pos[b][0]:.4f}" for b in ids), "longitude": ",".join(f"{pos[b][1]:.4f}" for b in ids),
         "hourly": "wave_direction", "models": "ncep_gfswave025", "timezone": "UTC", "cell_selection": "sea",
         "start_date": t0.strftime("%Y-%m-%d"), "end_date": t1.strftime("%Y-%m-%d")}
    body = json.loads(ppv.get(s8o.OM_MARINE + "?" + urllib.parse.urlencode(q), timeout=180))
    res = {}
    for b, loc in zip(ids, body if isinstance(body, list) else [body]):
        h = loc.get("hourly") or {}
        gfs = {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v for t, v in zip(h.get("time", []), h.get("wave_direction", [])) if v is not None}
        reg = regional(pos[b][0], pos[b][1], t0, t1)
        obs = s8o.ndbc_hourly(b)
        e_g, e_r = [], []
        for t, o in obs.items():
            if t0 <= t <= t1 and o["mwd"] is not None and o["hs"] >= OBS_HS_MIN and t in gfs and t in reg:
                e_g.append(float(ad(gfs[t], o["mwd"])))
                e_r.append(float(ad(reg[t], o["mwd"])))
        res[b] = {"class": CLASSES[b], "n": len(e_g), "gfs_best_mae": mae(e_g), "regional_best_mae": mae(e_r),
                  "gfs_bias": float(np.mean(e_g)) if e_g else None, "regional_bias": float(np.mean(e_r)) if e_r else None}
    for cls in ("exposed", "sheltered"):
        sel = [v for k, v in res.items() if k in ids and v["class"] == cls]
        res[f"mean_{cls}"] = {"gfs_best_mae": float(np.mean([v["gfs_best_mae"] for v in sel])),
                              "regional_best_mae": float(np.mean([v["regional_best_mae"] for v in sel]))}
    text = json.dumps(res, indent=1)
    if a.out:
        open(a.out, "w", encoding="utf-8").write(text)
    print(text)


if __name__ == "__main__":
    main()
