"""Offline probe: CLAUDE.md's Pipeline sweep, and the CMP-3 break-depth agreement at the land-present coords.

Run from backend/:  python scripts/pipeline_sweep_probe.py
No network, no live backend. Prints (1) the sweep (14 s, 315 deg, offshore Hs varied) at the two Pipeline
coordinates the repo uses (they sit in different asset cells: 11.1 m vs 11.8 m break depth) and (2) for every
land_present coordinate: the height's break depth (resolve_surf_geometry) vs the rating's old read (break_depth_at).
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("SURF_TIDE_DEPTH", "0")  # eta = 0, as CLAUDE.md's sweep

from services.weather_pipeline.shore_normal_asset import break_depth_at  # noqa: E402
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry  # noqa: E402

FT = 3.28084
COORDS = {"tests/golden (21.6650,-158.0500)": (21.6650, -158.0500),
          "catalogue  (21.6650,-158.0538)": (21.6650, -158.0538)}


def main():
    for name, (la, ln) in COORDS.items():
        g = resolve_surf_geometry(la, ln)
        print(f"{name}  break_depth_m={g.break_depth_m}")
        for hs in (0.5, 1, 4, 8, 10, 12):
            m, regime = estimate_surf_at(la, ln, hs, 14.0, 315.0, geometry=g)
            print(f"  Hs {hs:>4} m -> {m * FT:5.1f} ft  {regime}")
    path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                        "services", "weather_pipeline", "data", "shore_normals.json")
    rows = json.load(open(path)).get("land_present", [])
    differ = 0
    for lat, lng, _skm, _d in rows:
        geo = resolve_surf_geometry(lat, lng).break_depth_m
        old = break_depth_at(lat, lng)
        differ += geo != old
        print(f"land ({lat},{lng}) geometry={geo} rating_old={old}")
    print(f"{len(rows)} land-present coords, geometry != old rating read at {differ}")


if __name__ == "__main__":
    main()
