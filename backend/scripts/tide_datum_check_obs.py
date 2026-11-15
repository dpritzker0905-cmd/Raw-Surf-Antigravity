"""tide_datum_check_obs.py - does CO-OPS preliminary `water_level` honour datum=MSL? (advisor check 4, 2026-11-15)

Per station: the same 7 days of observed water level on MSL and on MLLW; their mean difference must equal the station's
published MSL - MLLW (datums product). Also the mean of (observed - predicted), both on MSL: the real departure of the
water from the station datum this week. Public read-only GETs. Run: python scripts/tide_datum_check_obs.py
"""
import json
import statistics as st
import subprocess
from datetime import datetime, timedelta, timezone

IDS = ["9410230", "9413450", "9419750", "1612340", "8531680", "8665530", "8722670", "9455920"]
COOPS = "https://api.tidesandcurrents.noaa.gov"


def get(url):
    out = subprocess.run(["curl", "-s", "--max-time", "90", url], capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {}


def series(sid, product, datum, b, e, interval=None):
    q = (f"{COOPS}/api/prod/datagetter?product={product}&application=rawsurf_tide_check&station={sid}&datum={datum}"
         f"&units=metric&time_zone=gmt&format=json&begin_date={b:%Y%m%d}&end_date={e:%Y%m%d}")
    if interval:
        q += f"&interval={interval}"
    d = get(q)
    out = {}
    for r in d.get("data") or d.get("predictions") or []:
        try:
            t = datetime.strptime(r["t"], "%Y-%m-%d %H:%M")
            if t.minute == 0 and r.get("v") not in (None, ""):
                out[t] = float(r["v"])
        except (KeyError, ValueError):
            pass
    return out


today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0, tzinfo=None)
b = today - timedelta(days=7)
rows = []
for sid in IDS:
    msl, mllw = series(sid, "water_level", "MSL", b, today), series(sid, "water_level", "MLLW", b, today)
    pred = series(sid, "predictions", "MSL", b, today, "h")
    dat = {x["name"]: x.get("value") for x in (get(f"{COOPS}/mdapi/prod/webapi/stations/{sid}/datums.json?units=metric")
                                                  .get("datums") or [])}
    both = [t for t in msl if t in mllw]
    op = [msl[t] - pred[t] for t in msl if t in pred]
    published = None
    if dat.get("MSL") is not None and dat.get("MLLW") is not None:
        published = round(float(dat["MSL"]) - float(dat["MLLW"]), 3)
    rows.append({"id": sid, "hours": len(both),
                 "observed_msl_minus_mllw": round(st.mean(mllw[t] - msl[t] for t in both), 3) if both else None,
                 "published_msl_minus_mllw": published,
                 "mean_observed_minus_predicted_m": round(st.mean(op), 3) if op else None})
print(json.dumps(rows, indent=1))
