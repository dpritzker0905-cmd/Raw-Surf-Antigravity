"""tide_datum_gate_fixed.py - the owner's PRE-REGISTERED gate (a)-(d) for the fixed 365-day tide datum (PR #926).

Registration (written and pushed before this run): docs/weather-program/log/2026-11-15-claude-tide-local-datum.md,
section "PRE-REGISTERED (before the rerun) - the owner's gate (a)-(d)". Same 25 CO-OPS stations as the first check;
window = the 14 UTC days before today 00Z. Arms: A72 (minus the 72 h mean from 00Z of each day), M365 (minus the model's
mean over the 365 days before the window). (a) vs predictions; (b)-(d) vs observed water; day-block bootstrap, 1000
draws, seeded. Public read-only GETs (NOAA, Open-Meteo). Run: python scripts/tide_datum_gate_fixed.py > gate_fixed.json
"""
import json
import math
import random
import statistics as st
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

IDS = ["1612340", "1615680", "1617760", "1611400", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380",
       "9443090", "8443970", "8452660", "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670",
       "8723214", "8726724", "8729840", "8771510", "9755371", "9751639"]   # the first check's list (Boston had no data)
COOPS = "https://api.tidesandcurrents.noaa.gov"
OM = "https://marine-api.open-meteo.com/v1/marine"
DRAWS, SEED = 1000, 20261115


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
    d = get(q)
    out = {}
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


def rmse(xs):
    return math.sqrt(sum(x * x for x in xs) / len(xs)) if xs else float("nan")


def boot_ci(err_a, err_b, days, rng):
    """95% interval of RMSE(a) - RMSE(b), resampling whole days (err_* are {day: [errors]})."""
    vals = []
    for _ in range(DRAWS):
        pick = [rng.choice(days) for _ in days]
        a = [x for d in pick for x in err_a[d]]
        b = [x for d in pick for x in err_b[d]]
        vals.append(rmse(a) - rmse(b))
    vals.sort()
    return vals[int(0.025 * DRAWS)], vals[int(0.975 * DRAWS) - 1]


today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
w0 = today - timedelta(days=14)
rng = random.Random(SEED)
stations = []
for sid in IDS:
    meta = (get(f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json").get("stations") or [{}])[0]
    if meta.get("lat") is None:
        stations.append({"id": sid, "error": "no metadata"}); continue
    la, lo = round(float(meta["lat"]), 1), round(float(meta["lng"]), 1)
    raw = model(la, lo, w0 - timedelta(days=366), today + timedelta(days=3))
    y1 = [v for t, v in raw.items() if w0 - timedelta(days=365) <= t < w0]
    pred = coops(sid, "predictions", w0, today, "h")
    obs = {}
    for b in (w0, w0 + timedelta(days=7)):
        obs.update(coops(sid, "water_level", b, b + timedelta(days=7)))
    if len(y1) < 24 * 300 or len(obs) < 24 * 7:
        stations.append({"id": sid, "name": meta.get("name"), "error": f"y1 {len(y1)} h, observed {len(obs)} h"}); continue
    m365 = sum(y1) / len(y1)

    day_mean = {}
    for k in range(-1, 15):
        d0 = w0 + timedelta(days=k)
        win = [raw[d0 + timedelta(hours=h)] for h in range(72) if d0 + timedelta(hours=h) in raw]
        day_mean[d0] = sum(win) / len(win) if len(win) >= 48 else None

    def a72(t, raw=raw, day_mean=day_mean):
        m = day_mean.get(t.replace(hour=0, minute=0, second=0, microsecond=0))
        return None if m is None or t not in raw else raw[t] - m
    stations.append({"id": sid, "name": meta.get("name"), "raw": raw, "pred": pred, "obs": obs, "m365": m365, "a72": a72})
    print(sid, meta.get("name"), round(m365, 3), file=sys.stderr)

ok = [s for s in stations if "error" not in s]
rows = []
for s in ok:
    hours_obs = sorted(t for t in s["obs"] if w0 <= t < today and t in s["raw"] and s["a72"](t) is not None)
    hours_pred = sorted(t for t in s["pred"] if w0 <= t < today and t in s["raw"] and s["a72"](t) is not None)
    e = lambda f, truth, hrs: [f(t) - truth[t] for t in hrs]   # noqa: E731
    f72 = s["a72"]
    fm = lambda t, s=s: s["raw"][t] - s["m365"]                 # noqa: E731
    fs = lambda t, s=s: s["raw"][t] - s["m365"] - 0.10          # noqa: E731  (shift the DATUM by +0.10 -> level -0.10)
    days = sorted({t.date() for t in hours_obs})
    by_day = lambda f: {d: [f(t) - s["obs"][t] for t in hours_obs if t.date() == d] for d in days}   # noqa: E731
    lo_b, hi_b = boot_ci(by_day(fm), by_day(f72), days, rng)
    lo_d, hi_d = boot_ci(by_day(fs), by_day(fm), days, rng)
    mean_shift = st.mean(e(fs, s["obs"], hours_obs)) - st.mean(e(fm, s["obs"], hours_obs))
    rows.append({"id": s["id"], "name": s["name"], "m365": round(s["m365"], 3), "hours_obs": len(hours_obs),
                 "pred_rmse_a72": round(rmse(e(f72, s["pred"], hours_pred)), 3),
                 "pred_rmse_m365": round(rmse(e(fm, s["pred"], hours_pred)), 3),
                 "obs_rmse_a72": round(rmse(e(f72, s["obs"], hours_obs)), 3),
                 "obs_rmse_m365": round(rmse(e(fm, s["obs"], hours_obs)), 3),
                 "b_ci": [round(lo_b, 3), round(hi_b, 3)], "b_counts": hi_b < 0,
                 "d_ci": [round(lo_d, 3), round(hi_d, 3)], "d_detected": lo_d > 0 or hi_d < 0,
                 "d_mean_shift": round(mean_shift, 4)})
    print(s["id"], rows[-1]["obs_rmse_a72"], rows[-1]["obs_rmse_m365"], rows[-1]["b_ci"], file=sys.stderr)

med = lambda k: round(st.median(r[k] for r in rows), 3)   # noqa: E731
a_ok = med("pred_rmse_m365") - med("pred_rmse_a72") <= 0.01
b_count = sum(r["b_counts"] for r in rows)
b_ok = b_count >= 0.6 * len(rows)
# (c) negative control: derangements of the 365-day datum across stations
m365s = [s["m365"] for s in ok]
c_wins = 0
for _ in range(200):
    while True:
        perm = list(range(len(ok)))
        rng.shuffle(perm)
        if all(i != j for i, j in enumerate(perm)):
            break
    meds = []
    for i, s in enumerate(ok):
        hrs = [t for t in s["obs"] if w0 <= t < today and t in s["raw"]]
        meds.append(rmse([s["raw"][t] - m365s[perm[i]] - s["obs"][t] for t in hrs]))
    if st.median(meds) > max(med("obs_rmse_a72"), med("obs_rmse_m365")):
        c_wins += 1
c_ok = c_wins >= 190
d_count = sum(r["d_detected"] for r in rows)
d_ok = d_count >= 0.8 * len(rows) and all(abs(abs(r["d_mean_shift"]) - 0.10) <= 0.005 for r in rows)
summary = {"window": [w0.isoformat(), today.isoformat()], "stations_scored": len(rows),
           "stations_failed": [(s["id"], s.get("name"), s["error"]) for s in stations if "error" in s],
           "a": {"median_pred_rmse_a72": med("pred_rmse_a72"), "median_pred_rmse_m365": med("pred_rmse_m365"), "PASS": a_ok},
           "b": {"median_obs_rmse_a72": med("obs_rmse_a72"), "median_obs_rmse_m365": med("obs_rmse_m365"),
                 "stations_m365_beats_a72_ci": b_count, "of": len(rows), "PASS": b_ok},
           "c": {"draws": 200, "swapped_loses_to_both": c_wins, "PASS": c_ok},
           "d": {"detected_stations": d_count, "of": len(rows), "PASS": d_ok},
           "ALL_PASS": a_ok and b_ok and c_ok and d_ok}
print(json.dumps({"summary": summary, "rows": rows}, indent=1))
