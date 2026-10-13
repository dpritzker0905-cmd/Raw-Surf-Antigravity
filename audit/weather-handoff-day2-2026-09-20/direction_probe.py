"""Offline direction-contract probe: production functions, synthetic providers/geometry.

Run from backend: python -B ../audit/weather-handoff-day2-2026-09-20/direction_probe.py
Writes only its adjacent JSON. No scientific flags or coefficients are changed.
"""
import asyncio
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from services.weather_pipeline import estimator, surf_rating, surf_transform
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.schemas import (
    CoverageBounds, GridVector, NormalizedGrid, NormalizedPointResponse, NormalizedProduct,
)
from services.weather_pipeline.surf_point import SurfGeometry
from services.weather_pipeline.spot_ratings import rate_one_spot
from services.weather_pipeline.lattice_fill import interpolate_between

NOW = datetime(2026, 9, 20, tzinfo=timezone.utc)
GEOMETRY = SurfGeometry(30.0, 10.0, True, 0.0, "probe_fixed", 1.0, None, 5.0, True)


class Clock(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW


def safe(value):
    if isinstance(value, float) and not math.isfinite(value):
        return {"nonfinite": str(value)}
    if isinstance(value, dict):
        return {str(k): safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [safe(v) for v in value]
    return value


def attempted(fn, *args, **kwargs):
    try:
        return {"result": safe(fn(*args, **kwargs))}
    except Exception as exc:
        return {"exception": type(exc).__name__, "message": str(exc)}


def payload(times, heights, directions):
    return {"hourly": {"time": [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times], "wave_height": heights,
                       "wave_direction": directions, "wave_period": [12.0] * len(times)}}


def network_forbidden(*args, **kwargs):
    raise AssertionError("Offline direction probe attempted HTTP I/O")


def point_summary(response):
    if not isinstance(response, NormalizedPointResponse):
        return {"status": response.status_code, "body": json.loads(response.body)}
    out = {"status": 200, "point": response.point.model_dump(),
           "surf_height_m": response.surf_height_m, "surf_regime": response.surf_regime,
           "estimate_basis": response.estimate_basis,
           "is_forecast_authoritative": response.is_forecast_authoritative,
           "wire_point": json.loads(response.model_dump_json())["point"]}
    try:
        NormalizedPointResponse.model_validate_json(response.model_dump_json())
        out["wire_roundtrip"] = "valid"
    except Exception as exc:
        out["wire_roundtrip"] = type(exc).__name__
    return safe(out)


async def served_case(euro_dir, gfs_dir, *, euro_h=3.0, gfs_h=2.0, target_hour=264,
                      icon_dir=90.0, truncate_gfs_direction=False):
    anchor = NOW + timedelta(hours=240 if target_hour > 168 else 48)
    target = NOW + timedelta(hours=target_hour)
    native = payload([NOW, anchor], [euro_h, euro_h], [euro_dir, euro_dir])

    async def fetch(**kwargs):
        if kwargs["model"] == "GFS":
            directions = [90.0] if truncate_gfs_direction else [90.0, gfs_dir]
            return payload([anchor, target], [euro_h, gfs_h], directions)
        if kwargs["model"] == "ICON":
            return payload([anchor, target], [euro_h, euro_h], [90.0, icon_dir])
        raise AssertionError(f"Unexpected synthetic provider {kwargs}")

    provider = SimpleNamespace(fetch_point=AsyncMock(side_effect=fetch))
    store = SimpleNamespace(get_manifest=Mock(return_value=SimpleNamespace(products=[])))
    index = SimpleNamespace(find_product_containing=Mock(return_value=None))
    resolver = PointResolutionService(store=store, dynamic_index=index, provider=provider)
    with patch("services.copernicus_marine_service.fetch_euro_marine", AsyncMock(return_value=[native])):
        response = await resolver.resolve_point("EURO", "marine", "waves", 0.0, 0.0, target.isoformat())
    result = point_summary(response)
    result["fetched_models"] = [c.kwargs["model"] for c in provider.fetch_point.await_args_list]

    # Actual served rating consumer; its marine value is the actual public point-resolver output.
    # Wind is intentionally absent (the established neutral unknown-wind policy), held fixed.
    async def resolved_input(**kwargs):
        return response if kwargs["domain"] == "marine" else None

    try:
        rating = await rate_one_spot(SimpleNamespace(resolve_point=resolved_input),
                                    {"id": "offline-direction-probe", "name": "synthetic",
                                     "latitude": 0.0, "longitude": 0.0}, "EURO", target.isoformat())
        result["served_rating"] = {k: safe(rating.get(k)) for k in
                                    ("score", "level", "surf_height_m", "swell_from_deg", "limiter")}
    except Exception as exc:
        result["served_rating"] = {"exception": type(exc).__name__, "message": str(exc)}
    return result


def product(height, direction, when, *, zero_vector=False):
    u = 0.0 if zero_vector else -height * math.sin(math.radians(direction))
    v = 0.0 if zero_vector else -height * math.cos(math.radians(direction))
    bounds = CoverageBounds(west=0, east=1, south=0, north=1)
    grid = NormalizedGrid(bounds=bounds, rows=2, cols=2,
                          vectors=[GridVector(lat=y, lng=x, speed=height, direction=direction,
                                              u=u, v=v, period=12.0)
                                   for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))])
    return NormalizedProduct(model="EURO", provider="probe", domain="marine", layer="waves",
                             run_time=NOW, valid_time=when, is_forecast_authoritative=True,
                             is_estimated=False, coverage=bounds, grid=grid, value_kind="wave_height",
                             value_unit="m", display_unit_hint="ft", source_variables=["wave_height"],
                             freshness_sec=1800)


def grid_cases():
    anchor, target = NOW + timedelta(hours=240), NOW + timedelta(hours=264)
    out = {}
    for name, zero in (("opposing", False), ("positive_height_zero_vectors", True)):
        euro = product(3.0, 0.0, anchor, zero_vector=zero)
        ga = product(3.0, 180.0, anchor, zero_vector=zero)
        gt = product(2.0, 180.0, target, zero_vector=zero)
        p = estimator.estimate_euro_grid(264, 240, "waves", euro, gt, ga)
        out[name] = p.grid.vectors[0].model_dump() if p else None
    a, b = product(2.0, 0.0, NOW), product(2.0, 180.0, NOW + timedelta(hours=6))
    p = interpolate_between(a, b, NOW + timedelta(hours=3))
    out["lattice_opposing"] = p.grid.vectors[0].model_dump() if p else None
    return safe(out)


async def main():
    relevant_flags = ("SURF_TRANSFORM", "SURF_PARTITIONS", "SURF_TIDE_DEPTH", "SURF_V3_EXPOSURE",
                      "SURF_EXPOSURE_RECONCILED", "SURF_V3_KOMAR", "SURF_V3_SHELF_RECAL",
                      "SURF_SHELF_CF_SCALE", "SURF_V3_JACK_MAX", "SURF_SHELF_KF_FLOOR",
                      "RATING_TIDE", "RATING_BREAKER_TYPE", "RATING_LOCAL_SIZE",
                      "POINT_SKIP_NATIVE_COPERNICUS", "POINT_BATCH_DEGRADED")
    scientific_env = {k: os.environ[k] for k in relevant_flags if k in os.environ}
    # Do not alter flags to obtain a result. Abort if ambient settings would add external inputs.
    for key in ("SURF_TIDE_DEPTH", "RATING_TIDE", "RATING_BREAKER_TYPE", "RATING_LOCAL_SIZE"):
        if os.environ.get(key, "0") not in ("0", ""):
            raise RuntimeError(f"Probe requires default offline input policy, found {key}")
    helper = {}
    for name, hs, ds, ws in [
        ("north_control", [2, 2], [0, 0], [.5, .5]),
        ("wrapped_control", [2, 2], [359, 1], [.5, .5]),
        ("opposing", [2, 2], [0, 180], [.5, .5]),
        ("opposing_plus", [2, 2 + 1e-8], [0, 180], [.5, .5]),
        ("opposing_minus", [2, 2 - 1e-8], [0, 180], [.5, .5]),
        ("missing", [2, 2], [None, None], [.5, .5]),
        ("all_nan", [2, 2], [math.nan, math.nan], [.5, .5]),
        ("one_infinite", [2, 2], [90, math.inf], [.5, .5]),
        ("zero_weight_infinite", [2, 2], [90, math.inf], [1, 0]),
        ("calm_control", [0, 0], [90, 180], [.5, .5]),
    ]:
        helper[name] = attempted(estimator.blend_direction, hs, ds, ws)
    transforms = {}
    for name, direction in (("north", 0), ("cross", 90), ("opposed", 180),
                             ("missing", None), ("nan", math.nan), ("infinite", math.inf)):
        transforms[name] = {
            "height_factor": attempted(surf_transform._height_exposure_factor, direction, 0),
            "rating_factor": attempted(surf_rating.swell_exposure, direction, 0),
        }
    cases = {
        "north_control": (0, 0, {}), "wrapped_control": (359, 1, {}),
        "opposing": (0, 180, {}), "opposing_plus": (0, 180, {"gfs_h": 2 + 1e-8}),
        "opposing_minus": (0, 180, {"gfs_h": 2 - 1e-8}),
        "both_missing": (None, None, {}), "gfs_missing": (90, None, {}),
        "gfs_truncated": (90, 90, {"truncate_gfs_direction": True}),
        "gfs_nan": (90, math.nan, {}), "both_nan": (math.nan, math.nan, {}),
        "gfs_infinite": (90, math.inf, {}),
        "icon_infinite": (90, 90, {"target_hour": 96, "icon_dir": math.inf}),
        "calm_control": (90, 180, {"euro_h": 0.0, "gfs_h": 0.0}),
    }
    results = {}
    with ExitStack() as stack:
        stack.enter_context(patch.object(estimator, "datetime", Clock))
        stack.enter_context(patch("services.weather_pipeline.surf_point.resolve_surf_geometry", return_value=GEOMETRY))
        stack.enter_context(patch("services.weather_pipeline.spot_conditions.cached_primary_swell", AsyncMock(return_value=None)))
        stack.enter_context(patch("services.weather_pipeline.shore_normal_asset.break_depth_at", return_value=5.0))
        requests_mock = stack.enter_context(patch("requests.sessions.Session.request", side_effect=network_forbidden))
        httpx_mock = stack.enter_context(patch("httpx.AsyncClient.request", side_effect=network_forbidden))
        for name, (euro_dir, gfs_dir, kwargs) in cases.items():
            results[name] = await served_case(euro_dir, gfs_dir, **kwargs)
        assert requests_mock.call_count == httpx_mock.call_count == 0, "unexpected HTTP attempt"
    assert results["north_control"]["status"] == 200, "positive control must reach the estimate"
    assert results["north_control"]["surf_height_m"] is not None, "actual augmentation must run"
    assert results["calm_control"]["point"]["speed"] == 0.0, "valid calm control must survive"
    out = {"source_sha": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
           "source_modified": subprocess.run(["git", "diff", "--quiet", "--",
                                               "backend/services/weather_pipeline/estimator.py",
                                               "backend/services/weather_pipeline/lattice_fill.py"], cwd=ROOT).returncode != 0,
           "python": sys.version, "scientific_environment": scientific_env,
           "fixed_geometry": GEOMETRY._asdict(), "external_http_attempts": 0,
           "scope": "synthetic offline public point resolver, canonical surf transform and actual spot rating; no empirical skill claim",
           "blend_helper": helper, "exposure_consumers": transforms,
           "served_cases": results, "grid_and_lattice": grid_cases()}
    destination = Path(__file__).with_name(sys.argv[1] if len(sys.argv) > 1 else "direction-results.json")
    destination.write_text(json.dumps(safe(out), indent=2, allow_nan=False) + "\n", encoding="utf-8")
    print(destination)
    for name, r in results.items():
        print(name, r["status"], r.get("point", {}).get("direction"), r.get("surf_height_m"), r["served_rating"])


if __name__ == "__main__":
    asyncio.run(main())
