"""Open-Meteo past forecasts (public, no key) for the 7 anemometer spots of L6: gfs_global + gfs_hrrr wind and
ncep_gfswave025 marine, past_days=46 (covers the fresh window 2026-09-19..10-18). One request at a time."""
import json, os, sys, time, urllib.request, urllib.parse
OUT = sys.argv[1]
SPOTS = [("duck", 36.18, -75.75), ("cocoa", 28.40, -80.59), ("obsf", 37.755, -122.511), ("torrey", 32.867, -117.257),
         ("galveston", 29.28, -94.79), ("wrightsville", 34.21, -77.79), ("mavericks", 37.49, -122.50)]
UA = {"User-Agent": "raw-surf-research/0.1 (offline verification study)"}
def get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=90) as r:
        return json.loads(r.read().decode())
for sid, lat, lng in SPOTS:
    out = os.path.join(OUT, f"om_{sid}.json")
    if os.path.exists(out):
        continue
    q = dict(latitude=lat, longitude=lng, hourly="wind_speed_10m,wind_direction_10m", models="gfs_global,gfs_hrrr",
             past_days=46, forecast_days=1, wind_speed_unit="ms", timezone="UTC")
    w = get("https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(q)); time.sleep(2)
    q2 = dict(latitude=lat, longitude=lng, hourly="wave_height,wave_direction,wave_period,wave_peak_period",
              models="ncep_gfswave025", past_days=46, forecast_days=1, timezone="UTC")
    try:
        m = get("https://marine-api.open-meteo.com/v1/marine?" + urllib.parse.urlencode(q2))
    except Exception as e:
        m = {"error": repr(e)}
    time.sleep(2)
    json.dump({"id": sid, "lat": lat, "lng": lng, "wind": w, "marine": m}, open(out, "w"))
    print(sid, w["hourly"]["time"][0], w["hourly"]["time"][-1], "marine" if "hourly" in m else m, flush=True)
