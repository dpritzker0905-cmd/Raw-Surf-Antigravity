"""tide_datum_observed.py - the advisor's #926 checks, pre-registered in docs/weather-program/log/2026-11-15-claude-tide-local-datum.md.

Per CO-OPS station (the 25 of the first check + Anchorage + Eastport), against OBSERVED water level (`water_level`, MSL,
preliminary 6-min, on the hour), on the 7 past days:
  raw        Open-Meteo sea_level_height_msl at the backend's 0.1-degree cell, as fetched
  demean72   minus the mean of the 72 h window from 00Z of the day (production, TIDE_LOCAL_DATUM)
  demean74.5 the same with a 74.5 h window (3 lunar days = 6.00 M2 cycles; needs a 4-day fetch)
  offset     minus median(model - observed) over the 14 days before (a US-only yardstick, not shippable worldwide)
P2: does the model carry surge - r of the 25 h low-passed (model - prediction) vs (observed - prediction), 21 days.
P3: the day-roll step - |offset(window from 00Z of day d+1) - offset(day d)| for every station-day, both windows.
Public read-only GETs (NOAA, Open-Meteo). Run: python scripts/tide_datum_observed.py > out.json
"""
import json
import math
import statistics as st
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

IDS = ["1612340", "1615680", "1617760", "1611400", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380",
       "9443090", "8452660", "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670", "8723214",
       "8726724", "8729840", "8771510", "9755371", "9751639", "9455920", "8410140"]
COOPS = "https://api.tidesandcurrents.noaa.gov"
WINDOWS = {"demean72": 72.0, "demean74.5": 74.5}


def get(url):
    for _ in range(3):
        out = subprocess.run(["curl", "-s", "--max-time", "90", url], capture_output=True, text=True).stdout
        try:
            return json.loads(out)
        except Exception:
            time.sleep(2)
    return {}


def coops(sid, product, b, e, interval=None):
    q = (f"{COOPS}/api/prod/datagetter?product={product}&application=rawsurf_tide_check&station={sid}&datum=MSL"
         f"&units=metric&time_zone=gmt&format=json&begin_date={b:%Y%m%d}&end_date={e:%Y%m%d}")
    if interval:
        q += f"&interval={interval}"
    d = get(q)
    out = {}
    for r in d.get("predictions") or d.get("data") or []:
        try:
            t = datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            if t.minute == 0 and r.get("v") not in (None, ""):
                out[t] = float(r["v"])
        except (KeyError, ValueError):
            continue
    return out


def lowpass(series, keys):
    out = {}
    for t in keys:
        win = [series[u] for u in keys if abs((u - t).total_seconds()) <= 12 * 3600 and u in series]
        if len(win) >= 13:
            out[t] = sum(win) / len(win)
    return out


def window_mean(raw, day0, hours):
    vals = [v for t, v in raw.items() if day0 <= t < day0 + timedelta(hours=hours)]
    return sum(vals) / len(vals) if len(vals) >= 0.66 * hours else None


def rmse(xs):
    return math.sqrt(sum(x * x for x in xs) / len(xs)) if xs else None


def pearson(a, b):
    if len(a) < 48:
        return None
    ma, mb = st.mean(a), st.mean(b)
    den = math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))
    return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / den if den else None


today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
s0, w0 = today - timedelta(days=21), today - timedelta(days=7)
rows, steps = [], {k: [] for k in WINDOWS}
for sid in IDS:
    meta = (get(f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json").get("stations") or [{}])[0]
    if meta.get("lat") is None:
        rows.append({"id": sid, "error": "no metadata"}); continue
    lat, lng, name = float(meta["lat"]), float(meta["lng"]), meta.get("name", sid)
    obs = {}
    for b in (s0, s0 + timedelta(days=10), s0 + timedelta(days=20)):     # 6-min data: keep requests short
        obs.update(coops(sid, "water_level", b, min(b + timedelta(days=10), today)))
    pred = coops(sid, "predictions", s0, today + timedelta(days=4), "h")
    om = get(f"https://marine-api.open-meteo.com/v1/marine?latitude={round(lat, 1)}&longitude={round(lng, 1)}"
             "&hourly=sea_level_height_msl&past_days=21&forecast_days=4&timezone=GMT")
    h = om.get("hourly") or {}
    raw = {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v
           for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])) if v is not None}
    scored = sorted(t for t in obs if w0 <= t < today and t in raw)
    prior = [raw[t] - obs[t] for t in obs if s0 <= t < w0 and t in raw]
    if len(scored) < 24 * 4 or len(prior) < 24 * 7:
        rows.append({"id": sid, "name": name, "error": f"scored {len(scored)} h, prior {len(prior)} h"}); continue
    off = st.median(prior)
    arm = {"raw": [raw[t] - obs[t] for t in scored], "offset": [raw[t] - off - obs[t] for t in scored]}
    for k, hrs in WINDOWS.items():
        errs = []
        for t in scored:
            m = window_mean(raw, t.replace(hour=0), hrs)
            if m is not None:
                errs.append(raw[t] - m - obs[t])
        arm[k] = errs
        offs = [window_mean(raw, today - timedelta(days=d), hrs) for d in range(14, -1, -1)]
        steps[k] += [abs(b - a) for a, b in zip(offs, offs[1:]) if a is not None and b is not None]
    keys = sorted(t for t in raw if t in pred and t in obs and s0 <= t < today)
    lm = lowpass({t: raw[t] - pred[t] for t in keys}, keys)
    lo = lowpass({t: obs[t] - pred[t] for t in keys}, keys)
    both = [t for t in keys if t in lm and t in lo]
    r = pearson([lm[t] for t in both], [lo[t] for t in both])
    sd_obs = st.pstdev([lo[t] for t in both]) if both else None
    row = {"id": sid, "name": name, "scored_h": len(scored), "fitted_offset_m": round(off, 3),
           "surge_r": None if r is None else round(r, 3), "obs_nontidal_sd_m": None if sd_obs is None else round(sd_obs, 3)}
    row.update({f"rmse_{k}": round(rmse(v), 3) for k, v in arm.items() if v})
    rows.append(row)
    print(sid, name, row, file=sys.stderr)
ok = [r for r in rows if "error" not in r]
summ = {"stations": len(ok), "errors": [(r["id"], r["error"]) for r in rows if "error" in r]}
for k in ("raw", "demean72", "demean74.5", "offset"):
    v = [r[f"rmse_{k}"] for r in ok if f"rmse_{k}" in r]
    summ[f"rmse_{k}"] = {"median": round(st.median(v), 3), "p90": round(sorted(v)[int(0.9 * (len(v) - 1))], 3), "max": max(v)}
rs = [r["surge_r"] for r in ok if r["surge_r"] is not None]
summ["surge_r_median"] = round(st.median(rs), 3) if rs else None
for k, v in steps.items():
    v = sorted(v)
    summ[f"step_{k}"] = {"n": len(v), "median": round(st.median(v), 3), "p90": round(v[int(0.9 * (len(v) - 1))], 3),
                         "max": round(v[-1], 3)}
print(json.dumps({"window_scored": [w0.isoformat(), today.isoformat()], "summary": summ, "rows": rows}, indent=1))
