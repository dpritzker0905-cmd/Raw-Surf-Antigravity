"""tide_datum_vs_coops.py - the TIDE_LOCAL_DATUM evidence (2026-11-15). Run: python scripts/tide_datum_vs_coops.py > out.json.
Open-Meteo modeled sea_level_height_msl (the infobox/overlay source, at the
backend's 0.1-degree cell) vs NOAA CO-OPS harmonic predictions on the station MSL datum, hourly GMT, 14 days
(7 past + 7 ahead). Scores three display candidates against CO-OPS MSL:
  raw      : the model value as shown today
  demean72 : model minus its own mean over the 72 h payload window it sits in (what /point-tide could do alone)
  offsetB  : model minus a per-station constant fitted on days 1-7, scored on days 8-14 (out of sample)
Also: stability of the daily bias (std over 14 days), correlation, range ratio. Public read-only GETs only."""
import json, math, subprocess, statistics as st, sys
from datetime import datetime, timedelta, timezone

IDS = ["1612340", "1615680", "1617760", "1611400", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380",
       "9443090", "8443970", "8452660", "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670",
       "8723214", "8726724", "8729840", "8771510", "9755371", "9751639"]

def get(url):
    out = subprocess.run(["curl", "-s", "--max-time", "60", url], capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {}

now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
start = (now - timedelta(days=7)).replace(hour=0)
end = start + timedelta(days=14)
rows = []
for sid in IDS:
    meta = (get(f"https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{sid}.json").get("stations") or [{}])[0]
    lat, lng, name = meta.get("lat"), meta.get("lng"), meta.get("name", sid)
    if lat is None:
        rows.append({"id": sid, "error": "no metadata"}); continue
    co = get("https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=rawsurf_tide_check"
             f"&station={sid}&begin_date={start:%Y%m%d}&end_date={end:%Y%m%d}&datum=MSL&interval=h&units=metric&time_zone=gmt&format=json")
    cmap = {datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc): float(p["v"]) for p in co.get("predictions", [])}
    klat, klng = round(lat, 1), round(lng, 1)
    om = get(f"https://marine-api.open-meteo.com/v1/marine?latitude={klat}&longitude={klng}"
             "&hourly=sea_level_height_msl&past_days=7&forecast_days=7&timezone=GMT")
    h = om.get("hourly") or {}
    omap = {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])) if v is not None}
    ts = sorted(t for t in cmap if t in omap and start <= t < end)
    if len(ts) < 240:
        rows.append({"id": sid, "name": name, "error": f"overlap {len(ts)} h", "cell": f"{klat},{klng}"}); continue
    a = [omap[t] for t in ts]; b = [cmap[t] for t in ts]
    rmse = lambda x, y: math.sqrt(sum((p - q) ** 2 for p, q in zip(x, y)) / len(x))
    days = {}
    for t, x, y in zip(ts, a, b):
        days.setdefault(t.date(), []).append(x - y)
    daily = [st.mean(v) for v in days.values() if len(v) >= 20]
    # demean72: each sample minus the mean of the 72 h window starting at 00Z of its day (the payload's window)
    dm = []
    for i, t in enumerate(ts):
        w0 = t.replace(hour=0)
        win = [a[j] for j, u in enumerate(ts) if w0 <= u < w0 + timedelta(hours=72)]
        dm.append(a[i] - st.mean(win))
    dm7 = []
    for i, t in enumerate(ts):
        w0 = t.replace(hour=0)
        win = [a[j] for j, u in enumerate(ts) if w0 - timedelta(days=4) <= u < w0 + timedelta(hours=72)]
        dm7.append(a[i] - st.mean(win) if len(win) >= 150 else None)
    keep = [i for i, v in enumerate(dm7) if v is not None]
    half = len(ts) // 2
    off = st.mean([a[i] - b[i] for i in range(half)])
    ob = [a[i] - off for i in range(half, len(ts))]
    ma, mb = st.mean(a), st.mean(b)
    r = sum((x - ma) * (y - mb) for x, y in zip(a, b)) / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    rows.append({"id": sid, "name": name, "cell": f"{klat},{klng}", "hours": len(ts), "r": round(r, 3),
                 "bias": round(st.mean(daily), 3), "bias_daily_sd": round(st.pstdev(daily), 3),
                 "rmse_raw": round(rmse(a, b), 3), "rmse_demean72": round(rmse(dm, b), 3),
                 "rmse_demean7d": round(rmse([dm7[i] for i in keep], [b[i] for i in keep]), 3), "rmse_demean72_same": round(rmse([dm[i] for i in keep], [b[i] for i in keep]), 3),
                 "rmse_offsetB_oos": round(rmse(ob, b[half:]), 3), "range_ratio": round((max(a) - min(a)) / (max(b) - min(b)), 2)})
    print(sid, name, rows[-1].get("bias"), file=sys.stderr)
print(json.dumps({"start": start.isoformat(), "end": end.isoformat(), "rows": rows}, indent=1))
