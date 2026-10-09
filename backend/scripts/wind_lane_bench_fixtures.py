#!/usr/bin/env python3
"""Build the wind bench's LANE fixtures with the production lane (weather_pipeline/wind_lane.apply_wind_lane).

Each fixture is one GFS wind tier as /grid would serve it at 2026-10-09 15Z, after the lane: the 2-deg world tier, a
0.25-deg regional tile, Open-Meteo gfs_global dynamic boxes (the dynamic lane with WIND_GRID_GFS_GLOBAL=1, the flag the
owner turned on) and NOAA-GFS native-recovery boxes, at several pan offsets; the taper's hand-off steps; and the Florida
coastal tile with and without the lane. frontend/scripts/wind-bench/lane-run.js draws them through the real engine.

Inputs (offline after one download each; see log 2026-10-09-hrrr-wind-lane.md):
  --lane   a lane object from services/noaa_hrrr_wind_fetcher.py (payload {"cycle": "2026-10-09T12:00:00Z", "max_f": 5})
  --gfs    NOAA GFS 0.25 12Z f003 UGRD/VGRD 10 m (byte-range of gfs.t12z.pgrb2.0p25.f003; decoded with pygrib or gribberish)
  --om     Open-Meteo gfs_global 15Z on boxes A and B, {"A": {"bbox", "cols", "rows", "speed", "dir"}, ...}
  --out    frontend/scripts/wind-bench/fixtures

    python scripts/wind_lane_bench_fixtures.py --lane L.json --gfs gfs_f003.grib2 --om om.json --out <dir>
"""
import argparse
import copy
import json
import math
import os
import sys
from datetime import datetime, timezone

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
os.environ.setdefault("TESTING", "1")                     # no L2 refresh thread; the lane is installed by hand

from services import noaa_hrrr_wind_fetcher as F                       # noqa: E402
from services.weather_pipeline import wind_lane as WL                  # noqa: E402
from services.weather_pipeline.schemas import (CoverageBounds, GridVector, NormalizedGrid,  # noqa: E402
                                               NormalizedProduct)

VALID = datetime(2026, 10, 9, 15, tzinfo=timezone.utc)
from services.weather_pipeline import surf_rating as SR                # noqa: E402 - the one knots constant


def gfs_field(path):
    """(u, v) in knots on the 0.25-deg GFS grid, row 0 = 90N, column 0 = 0E (the file holds UGRD then VGRD)."""
    try:
        import pygrib
        g = pygrib.open(path).read()
        return np.ma.filled(g[0].values, np.nan) * SR.MS_TO_KT, np.ma.filled(g[1].values, np.nan) * SR.MS_TO_KT
    except ImportError:                                    # no pygrib wheel on Windows: the Rust decoder
        import gribberish
        data = open(path, "rb").read()
        m = gribberish.parse_grib_mapping(data)
        offs = {k.split(":")[0]: v[1] for k, v in m.items()}
        u = np.asarray(gribberish.parse_grib_message(data, offs["UGRD"]).data()).reshape(721, 1440)
        v = np.asarray(gribberish.parse_grib_message(data, offs["VGRD"]).data()).reshape(721, 1440)
        return u * SR.MS_TO_KT, v * SR.MS_TO_KT


def lattice(w, s, e, n, res):
    return ([round(s + res * j, 4) for j in range(int(round((n - s) / res)) + 1)],
            [round(w + res * i, 4) for i in range(int(round((e - w) / res)) + 1)])


def vec(lat, lng, u, v):
    s = math.hypot(u, v)
    d = (math.degrees(math.atan2(-u, -v)) + 360.0) % 360.0 if s > 0 else 0.0
    return GridVector(lat=lat, lng=lng, speed=round(s, 4), direction=round(d, 2), u=round(u, 4), v=round(v, 4), period=0.0)


def product(vectors, lats, lons):
    b = CoverageBounds(west=lons[0], south=lats[0], east=lons[-1], north=lats[-1])
    return NormalizedProduct(model="GFS", provider="open-meteo", domain="wind", layer="wind", run_time=VALID,
                             valid_time=VALID, is_forecast_authoritative=True, is_estimated=False, coverage=b,
                             grid=NormalizedGrid(bounds=b, cols=len(lons), rows=len(lats), vectors=vectors),
                             value_kind="vector", value_unit="kn", display_unit_hint="kn",
                             source_variables=["wind_speed_10m"], freshness_sec=0)


def noaa_tier(GU, GV, box, res):
    lats, lons = lattice(*box, res)
    vs = []
    for la in lats:
        r = int(round((90.0 - la) / 0.25))
        for lo in lons:
            c = int(round((lo % 360.0) / 0.25)) % 1440
            vs.append(vec(la, lo, float(GU[r, c]), float(GV[r, c])))
    return product(vs, lats, lons)


def om_tier(box):
    lats, lons = lattice(*box["bbox"], 0.5)
    vs = []
    for k, (la, lo) in enumerate((a, b) for a in lats for b in lons):
        s, d = box["speed"][k], box["dir"][k]
        r = math.radians(d)
        vs.append(vec(la, lo, -s * math.sin(r), -s * math.cos(r)))
    return product(vs, lats, lons)


def fixture(p, pid, provenance):
    g = p.grid
    return {"product_id": pid, "provenance": provenance, "valid_time": "2026-10-09T15:00:00Z",
            "bounds": {"west": g.bounds.west, "south": g.bounds.south, "east": g.bounds.east, "north": g.bounds.north},
            "cols": g.cols, "rows": g.rows,
            "u": [round(v.u, 2) for v in g.vectors], "v": [round(v.v, 2) for v in g.vectors],
            "wind_lane": getattr(p, "wind_lane", None)}


def lane_with_horizon(obj, horizon_hour):
    """The same cycle cut so its last hour is `horizon_hour` (UTC hour of 2026-10-09): puts 15Z on the taper."""
    keep = [k for k, h in enumerate(obj["hours"]) if int(h[11:13]) <= horizon_hour]
    la = obj["lattice"]
    shape = (len(obj["hours"]), la["nlat"], la["nlon"])
    out = copy.deepcopy(obj)
    out["hours"] = [obj["hours"][k] for k in keep]
    out["horizon"] = out["hours"][-1]
    out["u"] = F.encode(F.decode(obj["u"], shape)[keep])
    out["v"] = F.encode(F.decode(obj["v"], shape)[keep])
    return WL.Lane(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--lane", required=True)
    ap.add_argument("--gfs", required=True)
    ap.add_argument("--om", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    obj = json.load(open(a.lane))
    lane = WL.Lane(obj, key="bench")
    GU, GV = gfs_field(a.gfs)
    om = json.load(open(a.om))
    cyc = obj["cycle"]
    src_l = f"after: + the HRRR lane (NOAA HRRR {cyc} f03, 0.25-deg area mean, rotated), apply_wind_lane"
    tiers = {
        "lane-world2": (noaa_tier(GU, GV, (-120, 10, -60, 50), 2.0), "2-deg world tier: NOAA GFS 12Z f003 NN"),
        "lane-tile025": (noaa_tier(GU, GV, (-92, 25, -79, 32), 0.25), "0.25-deg regional tile: NOAA GFS 12Z f003 NN"),
        "lane-dynA-om": (om_tier(om["A"]), "dynamic box A -90..-78/25..32, 0.5 deg: Open-Meteo gfs_global"),
        "lane-dynB-om": (om_tier(om["B"]), "dynamic box B -92..-79/25..32, 0.5 deg: Open-Meteo gfs_global"),
        "lane-recA-noaa": (noaa_tier(GU, GV, (-90, 25, -78, 32), 0.5), "native recovery box A, 0.5 deg: NOAA GFS NN"),
        "lane-recC-noaa": (noaa_tier(GU, GV, (-94, 24, -81, 31), 0.5), "native recovery box C -94..-81/24..31: NOAA GFS"),
        "lane-recD-noaa": (noaa_tier(GU, GV, (-89, 26, -76, 33), 0.5), "native recovery box D -89..-76/26..33: NOAA GFS"),
        "lane-florida-tile": (noaa_tier(GU, GV, (-85, 24, -79, 31), 0.25),
                              "florida_east_coast regional tile, 0.25 deg: NOAA GFS 12Z f003 NN"),
    }
    os.makedirs(a.out, exist_ok=True)
    for pid, (p, prov) in tiers.items():
        after = WL.apply_wind_lane(p, "GFS", "wind", "wind", lane=lane)
        json.dump(fixture(after, pid, f"{prov}; {src_l}"), open(os.path.join(a.out, f"{pid}.json"), "w"))
        print(pid, after.grid.cols, "x", after.grid.rows, (after.wind_lane or {}).get("hrrr_cells"))
    # before twins: the same tiers WITHOUT the lane (what the map drew with WIND_GRID_GFS_GLOBAL=1)
    for pid in ("lane-florida-tile", "lane-dynB-om"):
        p, prov = tiers[pid]
        json.dump(fixture(p, pid.replace("lane-", "gfs-"), f"{prov}; before: no lane"),
                  open(os.path.join(a.out, f"{pid.replace('lane-', 'gfs-')}.json"), "w"))
    # the time seam: 15Z on the taper (HRRR's last hour at 17Z, 16Z, 15Z -> weights 0.75, 0.5, 0.25)
    for hz, tag in ((17, "w075"), (16, "w050"), (15, "w025")):
        p, prov = tiers["lane-dynB-om"]
        after = WL.apply_wind_lane(p, "GFS", "wind", "wind", lane=lane_with_horizon(obj, hz))
        json.dump(fixture(after, f"lane-dynB-om-{tag}", f"{prov}; the taper at weight {after.wind_lane['time_weight']}"),
                  open(os.path.join(a.out, f"lane-dynB-om-{tag}.json"), "w"))
        print(tag, after.wind_lane["time_weight"])


if __name__ == "__main__":
    main()
