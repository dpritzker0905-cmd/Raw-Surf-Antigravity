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


def _rate(lat, lng, flag, hs=6.0, tp=16.0):
    """rate_one_spot (score, level, break_depth the rating saw) with the CMP-3 flag '0'/'1' (real augment)."""
    import asyncio
    from datetime import datetime, timezone
    from services.weather_pipeline import spot_ratings as SRT
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
    os.environ["RATING_BREAK_DEPTH_FROM_GEOMETRY"] = flag
    t0 = datetime(2026, 11, 10, 12, tzinfo=timezone.utc)

    def resp(domain, layer, speed, direction, period):
        return NormalizedPointResponse(
            model="GFS", provider="open-meteo", domain=domain, layer=layer, run_time=t0, valid_time=t0,
            is_forecast_authoritative=True, is_estimated=False,
            point=NormalizedPointDetail(requested_lat=0, requested_lng=0, sampled_lat=0, sampled_lng=0,
                                        speed=speed, direction=direction, u=0.0, v=0.0, period=period,
                                        interpolation_method="exact_match"),
            value_kind="wave_height" if domain == "marine" else "wind_speed",
            value_unit="m" if domain == "marine" else "kn", display_unit_hint="ft",
            source_variables=["x"], freshness_sec=0)

    class R:
        async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str, **_k):
            if domain == "marine":
                async def _np(*_a, **_kw):
                    return None
                return await augment_with_surf(resp("marine", layer, hs, 180.0, tp), model, domain, layer,
                                               lat, lng, valid_time_str, _np)
            return resp("wind", "wind", 5.0, 0.0, None)

    seen = {}
    real = SRT.compute_surf_rating

    def spy(*a, **kw):
        seen["bd"] = kw.get("break_depth_m")
        return real(*a, **kw)
    SRT.compute_surf_rating = spy
    try:
        r = asyncio.run(SRT.rate_one_spot(R(), {"id": "x", "name": "x", "latitude": lat, "longitude": lng},
                                          "GFS", "2026-11-10T12:00:00Z"))
    finally:
        SRT.compute_surf_rating = real
    return r["score"], r["level"], seen.get("bd")


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
        off, on = _rate(lat, lng, "0"), _rate(lat, lng, "1")
        print(f"land ({lat},{lng}) height_depth={geo} rating_depth OFF={off[2]} ON={on[2]} | "
              f"6 m/16 s: OFF {off[0]} {off[1]} -> ON {on[0]} {on[1]}")
    print(f"{len(rows)} land-present coords, geometry != old rating read at {differ}")


if __name__ == "__main__":
    main()
