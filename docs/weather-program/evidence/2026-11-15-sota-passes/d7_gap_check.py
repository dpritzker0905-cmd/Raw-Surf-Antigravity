"""Pass 5d forensics: is the 2024 'land' share (46.5% of model hours at EVERY station) a land mask or an archive gap?

1. Monthly kept-row coverage of 2024 per station, read from d6_rows.json (no network).
2. Live check: one Open-Meteo request per station for 2024 (46086 offshore Southern California, 41043 offshore
   Puerto Rico, 51003 offshore Hawaii) and a 2025 control for 46086. Counts null vs zero vs positive wave_height and
   wave_period by month. A real land cell returns zeros; a missing archive returns nulls.
Writes d7_gap_check.json.
"""
import json, os, sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from d1_direction import STATIONS, http_get


def coverage_2024():
    d = json.load(open(os.path.join(HERE, "d6_rows.json")))
    out = defaultdict(Counter)
    for stn, region, yr, t, ohs, mhs in d["rows"]:
        if yr == 2024:
            out[stn][int(t[5:7])] += 1
    return {s: [out[s].get(m, 0) for m in range(1, 13)] for s in sorted(out)}


def om_null_zero(stn, year):
    lat, lon = STATIONS[stn][1], STATIONS[stn][2]
    url = ("https://marine-api.open-meteo.com/v1/marine?latitude=%s&longitude=%s"
           "&hourly=wave_height,wave_period&start_date=%d-01-01&end_date=%d-12-31"
           "&models=ncep_gfswave025&timezone=GMT") % (lat, lon, year, year)
    h = json.loads(http_get(url))["hourly"]
    res = {m: Counter() for m in range(1, 13)}
    for i, ts in enumerate(h["time"]):
        m = int(ts[5:7])
        hv, pv = h["wave_height"][i], h["wave_period"][i]
        res[m]["h_null" if hv is None else ("h_zero" if hv == 0 else "h_pos")] += 1
        res[m]["p_null" if pv is None else ("p_zero" if pv == 0 else "p_pos")] += 1
    return {m: dict(res[m]) for m in res}


def main():
    cov = coverage_2024()
    live = {
        "46086_2024": om_null_zero("46086", 2024),
        "41043_2024": om_null_zero("41043", 2024),
        "51003_2024": om_null_zero("51003", 2024),
        "46086_2025_control": om_null_zero("46086", 2025),
    }
    summary = {"kept_rows_2024_by_month": cov, "live_null_zero_pos_by_month": live}
    out = os.path.join(HERE, "d7_gap_check.json")
    with open(out, "w") as f:
        json.dump(summary, f, indent=1)
    print("wrote", out)
    for s, months in cov.items():
        print(s, "2024 kept rows by month:", months)
    for k, v in live.items():
        print(k, {m: v[m] for m in sorted(v)})


if __name__ == "__main__":
    main()
