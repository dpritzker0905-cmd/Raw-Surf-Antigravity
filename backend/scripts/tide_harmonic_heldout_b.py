"""tide_harmonic_heldout_b.py - PRE-REGISTERED held-out test of eta option B with the 1-year offset (TIDE_SURGE_RESIDUAL).

Registration (lines written before the run): docs/weather-program/log/2026-11-15-claude-tide-harmonic.md, section
"PRE-REGISTERED (before the run): held-out test of option B with the 1-year offset".
26 CO-OPS stations x 4 held-out weeks vs OBSERVED water (MSL, on the hour). Arms: harmonic alone; model minus its 1-year
mean (#926); B = harmonic + lowpass25(model minus its 1-year mean, minus harmonic) via tide_harmonic.lowpass_residual,
the production function. Public read-only GETs. Run: python scripts/tide_harmonic_heldout_b.py > heldout_b.json
"""
import json
import math
import os
import statistics as st
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import subprocess  # noqa: E402
import time  # noqa: E402

# Copied (not imported) from tide_datum_heldout.py: importing that script runs its whole test at module level.
IDS = ["1612340", "1615680", "1617760", "1611400", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380",
       "9443090", "8452660", "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670", "8723214",
       "8726724", "8729840", "9755371", "9751639", "9455920", "8410140"]
WEST = {"9410230", "9410660", "9413450", "9415020", "9419750", "9435380", "9443090"}
WEEKS = [datetime(2025, 12, 15, tzinfo=timezone.utc), datetime(2026, 3, 15, tzinfo=timezone.utc),
         datetime(2026, 6, 15, tzinfo=timezone.utc), datetime(2026, 9, 15, tzinfo=timezone.utc)]
ARCHIVE0 = datetime(2022, 12, 1, tzinfo=timezone.utc)
COOPS = "https://api.tidesandcurrents.noaa.gov"
OM = "https://marine-api.open-meteo.com/v1/marine"


def get(url):
    for _ in range(3):
        out = subprocess.run(["curl", "-s", "--max-time", "180", url], capture_output=True, text=True).stdout
        try:
            return json.loads(out)
        except Exception:
            time.sleep(3)
    return {}


def coops(sid, product, b, e, interval=None):
    q = (f"{COOPS}/api/prod/datagetter?product={product}&application=rawsurf_tide_check&station={sid}&datum=MSL"
         f"&units=metric&time_zone=gmt&format=json&begin_date={b:%Y%m%d}&end_date={e:%Y%m%d}")
    if interval:
        q += f"&interval={interval}"
    out = {}
    d = get(q)
    for r in d.get("data") or d.get("predictions") or []:
        try:
            t = datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            if t.minute == 0 and r.get("v") not in (None, ""):
                out[t] = float(r["v"])
        except (KeyError, ValueError):
            pass
    return out


def model(la, lo, b, e):
    h = get(f"{OM}?latitude={la}&longitude={lo}&hourly=sea_level_height_msl&start_date={b:%Y-%m-%d}"
            f"&end_date={e:%Y-%m-%d}&timezone=GMT").get("hourly") or {}
    return {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v
            for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])) if v is not None}


def lowpass(d, keys):
    out = {}
    for t in keys:
        w = [d[u] for u in keys if abs((u - t).total_seconds()) <= 12 * 3600 and u in d]
        if len(w) >= 13:
            out[t] = sum(w) / len(w)
    return out


def rmse(e):
    return math.sqrt(sum(x * x for x in e) / len(e)) if e else None


from services.weather_pipeline.tide_harmonic import lowpass_residual  # noqa: E402

SOUTHEAST = {"8658163", "8665530", "8720030", "8722670", "8723214", "8726724", "8729840"}
rows = []
for sid in IDS:
    meta = (get(f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json").get("stations") or [{}])[0]
    if meta.get("lat") is None:
        continue
    la, lo, name = round(float(meta["lat"]), 1), round(float(meta["lng"]), 1), meta.get("name", sid)
    for w0 in WEEKS:
        w1 = w0 + timedelta(days=7)
        allm = model(la, lo, w0 - timedelta(days=366), w1 + timedelta(days=2))
        y1 = [v for t, v in allm.items() if w0 - timedelta(days=365) <= t < w0]
        obs = {t: v for t, v in coops(sid, "water_level", w0, w1).items()}
        pred = coops(sid, "predictions", w0 - timedelta(days=2), w1 + timedelta(days=2), "h")
        scored = sorted(t for t in obs if w0 <= t < w1 and t in allm and t in pred)
        if len(scored) < 96 or len(y1) < 24 * 300:
            rows.append({"id": sid, "week": w0.date().isoformat(), "error": f"scored {len(scored)}, y1 {len(y1)}"})
            continue
        clim = sum(y1) / len(y1)
        keys = sorted(t for t in allm if t in pred and w0 - timedelta(days=1) <= t < w1 + timedelta(days=1))
        resid = lowpass_residual(keys, allm, pred, clim)
        ts = [t for t in scored if t in resid]
        if len(ts) < 96:
            rows.append({"id": sid, "week": w0.date().isoformat(), "error": f"residual {len(ts)}"})
            continue
        row = {"id": sid, "name": name, "week": w0.date().isoformat(), "southeast": sid in SOUTHEAST, "hours": len(ts),
               "rmse_harmonic": round(rmse([pred[t] - obs[t] for t in ts]), 3),
               "rmse_model_clim1y": round(rmse([allm[t] - clim - obs[t] for t in ts]), 3),
               "rmse_B": round(rmse([pred[t] + resid[t] - obs[t] for t in ts]), 3)}
        lo_obs = {t: v for t, v in lowpass_residual(keys, obs, pred, 0.0).items()}
        surge = [t for t in ts if t in lo_obs and abs(lo_obs[t]) > 0.15]
        if surge:
            row["surge_hours"] = len(surge)
            row["surge_rmse_harmonic"] = round(rmse([pred[t] - obs[t] for t in surge]), 3)
            row["surge_rmse_B"] = round(rmse([pred[t] + resid[t] - obs[t] for t in surge]), 3)
        rows.append(row)
        print(sid, name, w0.date(), {k: v for k, v in row.items() if k.startswith("rmse")}, file=sys.stderr)

ok = [r for r in rows if "error" not in r]
med = lambda k, rs: round(st.median(r[k] for r in rs), 3)   # noqa: E731
summ = {"station_weeks": len(ok), "errors": [(r["id"], r["week"], r["error"]) for r in rows if "error" in r]}
for k in ("rmse_harmonic", "rmse_model_clim1y", "rmse_B"):
    summ[f"median_{k}"] = med(k, ok)
b1 = summ["median_rmse_B"] < summ["median_rmse_harmonic"] and summ["median_rmse_B"] < summ["median_rmse_model_clim1y"]
se = {}
for sid in SOUTHEAST:
    rs = [r for r in ok if r["id"] == sid]
    if rs:
        se[sid] = round(med("rmse_B", rs) - med("rmse_harmonic", rs), 3)
b2 = bool(se) and all(v <= 0.05 for v in se.values())
sg = [r for r in ok if r.get("surge_hours")]
b3 = bool(sg) and med("surge_rmse_B", sg) < med("surge_rmse_harmonic", sg)
summ.update({"B1": b1, "B2": b2, "B2_southeast_B_minus_harmonic": se, "B3": b3, "surge_station_weeks": len(sg),
             "surge_median_harmonic": med("surge_rmse_harmonic", sg) if sg else None,
             "surge_median_B": med("surge_rmse_B", sg) if sg else None, "PASS": b1 and b2 and b3})
print(json.dumps({"summary": summ, "rows": rows}, indent=1))
