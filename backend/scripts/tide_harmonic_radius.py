"""tide_harmonic_radius.py - gate G3 of the harmonic tide plan (docs/weather-program/log/2026-11-15-claude-tide-harmonic-plan.md).

Leave-one-out: for harmonic CO-OPS stations that have another harmonic station nearby, serve each one's tide from its
nearest OTHER harmonic station and from our model (Open-Meteo sea_level_height_msl on the local datum, the
TIDE_LOCAL_DATUM rule: minus the mean of each 72 h window), and score both against the held-out station's own
predictions (MSL, hourly, 14 days). D = the largest distance bucket where the neighbour's median RMSE beats the model's.
Public read-only GETs (NOAA, Open-Meteo); nothing touches the app's servers.
Run: python scripts/tide_harmonic_radius.py [per_bucket] > radius.json
"""
import json
import math
import statistics as st
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone

BUCKETS = [5, 10, 25, 50, 100]
PER_BUCKET = int(sys.argv[1]) if len(sys.argv) > 1 else 30
COOPS = "https://api.tidesandcurrents.noaa.gov"


def get(url):
    out = subprocess.run(["curl", "-s", "--max-time", "60", url], capture_output=True, text=True).stdout
    try:
        return json.loads(out)
    except Exception:
        return {}


def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(h))


start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=7)
end = start + timedelta(days=14)
_pred_cache = {}


def preds(sid):
    if sid in _pred_cache:
        return _pred_cache[sid]
    d = get(f"{COOPS}/api/prod/datagetter?product=predictions&application=rawsurf_tide_check&station={sid}"
            f"&begin_date={start:%Y%m%d}&end_date={end:%Y%m%d}&datum=MSL&interval=h&units=metric&time_zone=gmt&format=json")
    out = {datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc): float(p["v"])
           for p in d.get("predictions", [])}
    _pred_cache[sid] = out
    time.sleep(0.2)
    return out


def model_local(lat, lng):
    d = get(f"https://marine-api.open-meteo.com/v1/marine?latitude={round(lat, 1)}&longitude={round(lng, 1)}"
            "&hourly=sea_level_height_msl&past_days=7&forecast_days=7&timezone=GMT")
    h = d.get("hourly") or {}
    raw = {datetime.fromisoformat(t).replace(tzinfo=timezone.utc): v
           for t, v in zip(h.get("time", []), h.get("sea_level_height_msl", [])) if v is not None}
    out = {}
    for t, v in raw.items():   # the served rule: minus the mean of the 72 h window from 00Z of the day
        d0 = t.replace(hour=0)
        win = [x for u, x in raw.items() if d0 <= u < d0 + timedelta(hours=72)]
        if len(win) >= 48:
            out[t] = v - sum(win) / len(win)
    return out


def rmse(a, b):
    ts = [t for t in b if t in a and start <= t < end]
    if len(ts) < 200:
        return None
    return math.sqrt(sum((a[t] - b[t]) ** 2 for t in ts) / len(ts))


stations = [s for s in get(f"{COOPS}/mdapi/prod/webapi/stations.json?type=tidepredictions").get("stations", [])
            if s.get("type") == "R" and s.get("lat") is not None]
pts = [(s["id"], s["name"], float(s["lat"]), float(s["lng"])) for s in stations]
pairs = []
for sid, name, la, lo in pts:
    best = min(((km((la, lo), (b[2], b[3])), b) for b in pts if b[0] != sid), key=lambda x: x[0])
    pairs.append((best[0], (sid, name, la, lo), best[1]))
by_bucket = {b: [] for b in BUCKETS}
for dist, tgt, nb in sorted(pairs, key=lambda p: p[1][0]):
    for i, b in enumerate(BUCKETS):
        lo_b = BUCKETS[i - 1] if i else 0
        if lo_b <= dist < b and len(by_bucket[b]) < PER_BUCKET:
            by_bucket[b].append((dist, tgt, nb))
            break
rows = []
for b, items in by_bucket.items():
    for dist, tgt, nb in items:
        t_pred, n_pred = preds(tgt[0]), preds(nb[0])
        if not t_pred or not n_pred:
            continue
        m = model_local(tgt[2], tgt[3])
        rn, rm = rmse(n_pred, t_pred), rmse(m, t_pred)
        rows.append({"bucket_km": b, "dist_km": round(dist, 1), "target": tgt[0], "target_name": tgt[1],
                     "neighbour": nb[0], "rmse_neighbour": None if rn is None else round(rn, 3),
                     "rmse_model": None if rm is None else round(rm, 3)})
        print(b, tgt[1], rows[-1]["rmse_neighbour"], rows[-1]["rmse_model"], file=sys.stderr)
summary = {}
for b in BUCKETS:
    ok = [r for r in rows if r["bucket_km"] == b and r["rmse_neighbour"] is not None and r["rmse_model"] is not None]
    if ok:
        summary[b] = {"n": len(ok), "median_neighbour": round(st.median(r["rmse_neighbour"] for r in ok), 3),
                      "median_model": round(st.median(r["rmse_model"] for r in ok), 3),
                      "neighbour_wins": sum(r["rmse_neighbour"] < r["rmse_model"] for r in ok)}
won = [b for b in BUCKETS if b in summary and summary[b]["median_neighbour"] < summary[b]["median_model"]]
print(json.dumps({"window": [start.isoformat(), end.isoformat()], "harmonic_stations": len(pts), "summary": summary,
                  "D_km": max(won) if won else 0, "rows": rows}, indent=1))
