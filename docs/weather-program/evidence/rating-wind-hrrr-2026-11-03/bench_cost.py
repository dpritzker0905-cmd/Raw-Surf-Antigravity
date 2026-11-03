import json, os, sys, time, math
sys.path.insert(0, sys.argv[1]); os.environ["PYTEST_CURRENT_TEST"] = "bench"
import numpy as np
from datetime import timedelta
from services import noaa_hrrr_wind_fetcher as F
from services.weather_pipeline import wind_lane as WL, rating_wind as RW
o = json.load(open(sys.argv[2]))
la = o["lattice"]; sh = (6, la["nlat"], la["nlon"])
U = F.decode(o["u"], sh); V = F.decode(o["v"], sh)
U49 = np.concatenate([U] * 9)[:49]; V49 = np.concatenate([V] * 9)[:49]
cyc = WL._grid().utc(o["cycle"])
obj = dict(o, hours=[(cyc + timedelta(hours=k)).strftime("%Y-%m-%dT%H:%M:%SZ") for k in range(49)], u=F.encode(U49), v=F.encode(V49))
blob = json.dumps(obj).encode()
t = time.perf_counter(); ln = WL.Lane(json.loads(blob), key="k"); t_load = time.perf_counter() - t
os.environ["RATING_WIND_HRRR"] = "1"; WL.install(ln)
vt = cyc + timedelta(hours=5)
N = 2000
t = time.perf_counter()
for _ in range(N):
    RW.lane_wind(28.40, -80.59, vt, 10.0, 180.0, lane=ln)
t_pt = (time.perf_counter() - t) / N
t = time.perf_counter()
for _ in range(200):
    ln.sample(np.array([28.40]), np.array([-80.59]), 5)
t_map = (time.perf_counter() - t) / 200
print(json.dumps({"lane_json_bytes_49h": len(blob), "lane_parse_decode_s": round(t_load, 3),
                  "rating_point_us": round(t_pt * 1e6, 1), "map_sampler_one_point_us": round(t_map * 1e6, 1),
                  "precompute_spot_hours_cpu_s_for_1800x48": round(1800 * 48 * t_pt, 2)}))
