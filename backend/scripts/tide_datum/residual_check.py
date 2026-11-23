"""Frame check for the US MLLW display: does our stored M reproduce the water's offset above NOAA's predictions?

Read-only CO-OPS calls only (datagetter: water_level, predictions, monthly_mean; datums). No live backend, no bucket.

For each station and day: residual = observed water level - NOAA prediction (both MLLW, metric, 6-min, preliminary
observations). NOAA's prediction is A + D on the epoch's MSL, so the residual is what the water carries above the
table: the rise since the epoch plus seasonal and weather anomalies. Our A + M + D differs from A + D by M only, so the
frame question is: |M - residual| per station.

M is the committed per-gauge value own_rules.G3T_M (our 2016-2025 altimetry mean, measured by G3t), at the station
itself or its nearest G3t gauge. The station's own decadal offset (2016-2025 monthly-mean MSL minus epoch MSL) and the
offset over the 12 months before the week are reported beside it, so the residual splits into the decadal part M
models and the seasonal/weather part it does not.

    python scripts/tide_datum/residual_check.py --week 2026-11-15 --week 2026-07-12 --json out.json
"""
import argparse
import datetime as dt
import json
import statistics as st
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tide_own"))
from own_rules import G3T_M  # noqa: E402

API = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
DATUMS = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{}/datums.json"
UA = {"User-Agent": "raw-surf-research/1.0"}

# station -> (name, G3t gauge whose M stands in, km between them)
STATIONS = {
    "9410170": ("San Diego", "9410230", 20),
    "9414290": ("San Francisco", "9415020", 45),
    "9447130": ("Seattle", "9443090", 190),
    "8723214": ("Virginia Key", "8723214", 0),
    "8518750": ("The Battery", "8531680", 25),
    "1612340": ("Honolulu", "1612340", 0),
}
GATE = {"9410170", "9414290", "9447130"}
PASS_M = 0.10


def _get(url, params=None):
    if params:
        url = url + "?" + urllib.parse.urlencode(params)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2 + 3 * attempt)


def series(station, product, begin, end):
    p = {"product": product, "station": station, "begin_date": begin, "end_date": end, "datum": "MLLW",
         "units": "metric", "time_zone": "gmt", "format": "json", "application": "raw-surf-research"}
    if product == "predictions":
        p["interval"] = "6"
    d = _get(API, p)
    rows = d.get("predictions") if product == "predictions" else d.get("data")
    out = {}
    for r in rows or []:
        try:
            out[r["t"]] = float(r["v"])
        except (KeyError, ValueError, TypeError):
            pass
    return out


def monthly_msl(station, y0, y1):
    """{(year, month): MSL above MLLW} from CO-OPS monthly means."""
    d = _get(API, {"product": "monthly_mean", "station": station, "begin_date": f"{y0}0101",
                   "end_date": f"{y1}1231", "datum": "MLLW", "units": "metric", "time_zone": "gmt",
                   "format": "json", "application": "raw-surf-research"})
    out = {}
    for r in d.get("data") or []:
        try:
            out[(int(r["year"]), int(r["month"]))] = float(r["MSL"])
        except (KeyError, ValueError, TypeError):
            pass
    return out


def epoch_msl(station):
    d = _get(DATUMS.format(station), {"units": "metric"})
    v = {x["name"]: x["value"] for x in d.get("datums", [])}
    return v["MSL"] - v["MLLW"]


def week(station, start):
    s = dt.date.fromisoformat(start)
    e = s + dt.timedelta(days=6)
    obs = series(station, "water_level", s.strftime("%Y%m%d"), e.strftime("%Y%m%d 23:54"))
    pre = series(station, "predictions", s.strftime("%Y%m%d"), e.strftime("%Y%m%d 23:54"))
    t = sorted(set(obs) & set(pre))
    res = [obs[k] - pre[k] for k in t]
    days = {}
    for k in t:
        days.setdefault(k[:10], []).append(obs[k] - pre[k])
    return {"n": len(res), "mean": st.fmean(res) if res else None, "sd": st.pstdev(res) if len(res) > 1 else None,
            "daily": {d: round(st.fmean(v), 4) for d, v in sorted(days.items())}}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--week", action="append", required=True, help="YYYY-MM-DD, first day of a 7-day window")
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    out = {"schema": "raw-surf/tide-residual-check/1", "built_at": dt.datetime.now(dt.timezone.utc).isoformat(),
           "source": "NOAA CO-OPS datagetter (water_level preliminary 6-min, predictions 6-min, monthly_mean), "
                     "MLLW, metric; M = own_rules.G3T_M", "pass_bar_m": PASS_M, "stations": {}}
    for sid, (name, g, km) in STATIONS.items():
        ep = epoch_msl(sid)
        mm = monthly_msl(sid, 2016, 2026)
        dec = [v for (y, _), v in mm.items() if 2016 <= y <= 2025]
        row = {"name": name, "m_gauge": g, "m_gauge_km": km, "M": G3T_M[g], "epoch_msl_above_mllw": round(ep, 4),
               "decadal_2016_2025": round(st.fmean(dec) - ep, 4) if dec else None, "months_2016_2025": len(dec),
               "weeks": {}}
        for w in a.week:
            r = week(sid, w)
            s = dt.date.fromisoformat(w)
            prior = [v for (y, mo), v in mm.items()
                     if 0 < (s.year * 12 + s.month) - (y * 12 + mo) <= 12]
            r["prior_12mo"] = round(st.fmean(prior) - ep, 4) if len(prior) >= 9 else None
            if r["mean"] is not None:
                r["M_minus_residual"] = round(G3T_M[g] - r["mean"], 4)
                r["pass"] = abs(G3T_M[g] - r["mean"]) <= PASS_M
                r["mean"], r["sd"] = round(r["mean"], 4), round(r["sd"], 4)
            row["weeks"][w] = r
        out["stations"][sid] = row
        print(f"{sid} {name:14s} M={row['M']:.3f} decadal={row['decadal_2016_2025']} "
              + " ".join(f"[{w}: n={r['n']} res={r['mean']} sd={r['sd']} M-res={r.get('M_minus_residual')} "
                         f"prior12={r['prior_12mo']}]" for w, r in row["weeks"].items()))
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")
    return out


if __name__ == "__main__":
    main()
