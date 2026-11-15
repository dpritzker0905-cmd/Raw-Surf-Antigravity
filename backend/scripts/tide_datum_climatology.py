"""tide_datum_climatology.py - candidate datum: the model's OWN long-term mean at the cell (2026-11-15, after the advisor's checks).

The 72 h de-mean (TIDE_LOCAL_DATUM) removes the model's permanent offset AND any real multi-day anomaly (observed: the
US West Coast ran ~0.4 m above datum this season and the raw model had it). A long-term mean removes only the permanent
part. For each station: mean of Open-Meteo sea_level_height_msl at the 0.1-degree cell over the year before the scored
week, then RMSE of (raw - that mean) against OBSERVED water level (CO-OPS water_level, MSL, on the hour) on the 7 past
days, beside raw, demean72 and the fitted-offset yardstick from tide_datum_observed.py.
Public read-only GETs. Run: python scripts/tide_datum_climatology.py obs.json > clim.json
"""
import json
import math
import statistics as st
import subprocess
import sys
from datetime import datetime, timedelta, timezone

COOPS = "https://api.tidesandcurrents.noaa.gov"


def get(url):
    out = subprocess.run(["curl", "-s", "--max-time", "120", url], capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {}


prev = json.load(open(sys.argv[1], encoding="utf-8"))
today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
w0 = today - timedelta(days=7)
y0 = w0 - timedelta(days=365)
rows = []
for r in prev["rows"]:
    if "error" in r:
        continue
    meta = (get(f"{COOPS}/mdapi/prod/webapi/stations/{r['id']}.json").get("stations") or [{}])[0]
    la, lo = round(float(meta["lat"]), 1), round(float(meta["lng"]), 1)
    hist = get(f"https://marine-api.open-meteo.com/v1/marine?latitude={la}&longitude={lo}&hourly=sea_level_height_msl"
               f"&start_date={y0:%Y-%m-%d}&end_date={(w0 - timedelta(days=1)):%Y-%m-%d}&timezone=GMT")
    vals = [v for v in (hist.get("hourly") or {}).get("sea_level_height_msl", []) if v is not None]
    recent = get(f"https://marine-api.open-meteo.com/v1/marine?latitude={la}&longitude={lo}&hourly=sea_level_height_msl"
                 "&past_days=7&forecast_days=1&timezone=GMT")
    h = recent.get("hourly") or {}
    raw = {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", []))
           if v is not None}
    obs = {}
    d = get(f"{COOPS}/api/prod/datagetter?product=water_level&application=rawsurf_tide_check&station={r['id']}&datum=MSL"
            f"&units=metric&time_zone=gmt&format=json&begin_date={w0:%Y%m%d}&end_date={today:%Y%m%d}")
    for p in d.get("data") or []:
        try:
            t = datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            if t.minute == 0 and p.get("v") not in (None, ""):
                obs[t] = float(p["v"])
        except (KeyError, ValueError):
            continue
    ts = [t for t in obs if t in raw and w0 <= t < today]
    if len(vals) < 24 * 200 or len(ts) < 96:
        rows.append({"id": r["id"], "name": r["name"], "error": f"history {len(vals)} h, scored {len(ts)} h"})
        continue
    clim = sum(vals) / len(vals)
    e = [raw[t] - clim - obs[t] for t in ts]
    rows.append({"id": r["id"], "name": r["name"], "clim_mean_m": round(clim, 3), "history_h": len(vals),
                 "rmse_climatology": round(math.sqrt(sum(x * x for x in e) / len(e)), 3), "rmse_raw": r["rmse_raw"],
                 "rmse_demean72": r["rmse_demean72"], "rmse_offset": r["rmse_offset"]})
    print(r["id"], r["name"], rows[-1], file=sys.stderr)
ok = [x for x in rows if "error" not in x]
summ = {"stations": len(ok), "errors": [(x["id"], x["error"]) for x in rows if "error" in x]}
for k in ("rmse_raw", "rmse_demean72", "rmse_climatology", "rmse_offset"):
    v = sorted(x[k] for x in ok)
    summ[k] = {"median": round(st.median(v), 3), "p90": round(v[int(0.9 * (len(v) - 1))], 3), "max": v[-1]}
summ["climatology_beats_demean72"] = sum(x["rmse_climatology"] < x["rmse_demean72"] for x in ok)
summ["climatology_beats_raw"] = sum(x["rmse_climatology"] < x["rmse_raw"] for x in ok)
print(json.dumps({"summary": summ, "rows": rows}, indent=1))
