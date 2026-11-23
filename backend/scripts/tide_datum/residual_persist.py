"""How well does the trailing observed residual predict the residual ahead? (motivation for gates/tide-twl-v1.md)

Read-only CO-OPS calls only (datagetter: water_level preliminary 6-min, predictions hourly; MLLW, metric, GMT).
No live backend, no bucket.

Residual r(t) = observed - NOAA prediction at each top of the hour. Persistence forecast from origin t at lead L:
r24(t) = mean of r over (t - 24 h, t]. Error = r(t + L) - r24(t). Every origin whose 24 h history and target both
exist inside the fetched span is scored; nothing is fitted, so the score is out of sample by construction.

    python scripts/tide_datum/residual_persist.py --start 2026-10-23 --end 2026-11-21 --json out.json
"""
import argparse
import datetime as dt
import json
import math
import statistics as st
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
UA = {"User-Agent": "raw-surf-research/1.0"}
STATIONS = {"9410170": "San Diego", "9414290": "San Francisco", "9447130": "Seattle", "8723214": "Virginia Key",
            "8518750": "The Battery", "1612340": "Honolulu"}
LEADS_H = (6, 24, 72, 168)


def _get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 + 3 * attempt)


def _series(station, product, begin, end):
    p = {"product": product, "station": station, "begin_date": begin.strftime("%Y%m%d %H:%M"),
         "end_date": end.strftime("%Y%m%d %H:%M"), "datum": "MLLW", "units": "metric", "time_zone": "gmt",
         "format": "json", "application": "raw-surf-research"}
    if product == "predictions":
        p["interval"] = "h"
    d = _get(p)
    rows = d.get("predictions") if product == "predictions" else d.get("data")
    out = {}
    for r in rows or []:
        try:
            t = dt.datetime.strptime(r["t"], "%Y-%m-%d %H:%M")
            if t.minute == 0:
                out[t] = float(r["v"])
        except (KeyError, ValueError, TypeError):
            pass
    return out


def hourly_residual(station, start, end):
    """{hour: observed - predicted}, top-of-hour samples, fetched in <= 30-day chunks."""
    obs, pre = {}, {}
    a = start
    while a < end:
        b = min(a + dt.timedelta(days=30), end)
        obs.update(_series(station, "water_level", a, b))
        pre.update(_series(station, "predictions", a, b))
        a = b
    return {t: obs[t] - pre[t] for t in sorted(set(obs) & set(pre)) if start <= t < end}


def persistence(res, window_start, leads=LEADS_H):
    """RMSE of r24 at each lead, origins at or after window_start (history may precede it)."""
    hours = sorted(res)
    out = {}
    for L in leads:
        errs = []
        for t in hours:
            if t < window_start:
                continue
            hist = [res[t - dt.timedelta(hours=k)] for k in range(24) if (t - dt.timedelta(hours=k)) in res]
            tgt = res.get(t + dt.timedelta(hours=L))
            if len(hist) >= 18 and tgt is not None:
                errs.append(tgt - st.fmean(hist))
        out[str(L)] = {"n": len(errs), "rmse": round(math.sqrt(st.fmean([e * e for e in errs])), 4) if errs else None}
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True, help="YYYY-MM-DD, first day scored")
    ap.add_argument("--end", required=True, help="YYYY-MM-DD, last day scored (inclusive)")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    s = dt.datetime.fromisoformat(a.start)
    e = dt.datetime.fromisoformat(a.end) + dt.timedelta(days=1)
    out = {"schema": "raw-surf/tide-residual-persist/1", "built_at": dt.datetime.now(dt.timezone.utc).isoformat(),
           "window": [a.start, a.end], "method": "top-of-hour preliminary observed - hourly prediction (MLLW); "
           "forecast r24 = trailing 24 h mean; error r(t+L) - r24(t)", "stations": {}}
    for sid, name in STATIONS.items():
        res = hourly_residual(sid, s - dt.timedelta(days=1), e)
        inwin = [v for t, v in res.items() if t >= s]
        row = {"name": name, "n": len(inwin), "mean": round(st.fmean(inwin), 4), "sd": round(st.pstdev(inwin), 4),
               "persist24": persistence(res, s)}
        out["stations"][sid] = row
        print(f"{sid} {name:14s} n={row['n']} mean={row['mean']:+.3f} sd={row['sd']:.3f} rmse "
              + "/".join(f"{row['persist24'][str(L)]['rmse']}" for L in LEADS_H))
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
