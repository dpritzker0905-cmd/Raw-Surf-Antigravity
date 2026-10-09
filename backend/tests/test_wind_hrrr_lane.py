"""The wind lane: HRRR by PLACE and TIME on every GFS wind tier, never by zoom (weather_pipeline/wind_lane.py, D-017).

THE DEFECT (2026-10-09): two zoom stops over the Gulf hurricane drew two models under one GFS label (Open-Meteo
gfs_seamless = HRRR in one box, NOAA GFS in the next) and the eye moved 38.3 km. The lane fixes the model by place and
time, and these tests pin the rows of the Jacobian lens that can be pinned offline:

  * NULL in the tier: two tiers that share a node (a 2-deg world clip and a 0.25-deg viewport, from two different GFS
    upstreams) serve the SAME value there when HRRR carries it, so neither zoom nor box nor cache order can move it;
  * the feather and the taper are the measured ones (200 km cos^2 past HRRR's 15 km relaxation rows; 3 h linear);
  * every kill (WIND_HRRR_LANE=0, the client's wind_lane=gfs, no lane loaded) returns the product untouched;
  * NO KNOCK-ON: only the /grid route calls the lane; stored products, cached vectors, spot points and the point lane's
    Open-Meteo model are untouched.
"""
import ast
import asyncio
import copy
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
import numpy as np
import pytest
from fastapi import FastAPI

from services import _hrrr_grid as hg
from services import noaa_hrrr_wind_fetcher as fetcher
from services.weather_pipeline import wind_lane as WL
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

CYCLE = datetime(2026, 10, 9, 12, tzinfo=timezone.utc)
HORIZON = CYCLE + timedelta(hours=48)
HRRR_MS = 15.45                      # HRRR: 15.45 m/s (exact at the lane's 0.05 m/s step) from 090 where it has cells
HRRR_KN = HRRR_MS * __import__("services.weather_pipeline.surf_rating", fromlist=["x"]).MS_TO_KT  # ~30.03 kn served
GFS_KN = 10.0                        # the tier's GFS: 10 kn from 180


def lane_obj(hours=None):
    la = dict(fetcher.LATTICE)
    hours = hours or [CYCLE + timedelta(hours=k) for k in range(49)]
    lat = la["lat0"] + la["res"] * np.arange(la["nlat"])
    lon = la["lon0"] + la["res"] * np.arange(la["nlon"])
    LA, LO = np.meshgrid(lat, lon, indexing="ij")
    inside = hg.edge_km_np(LA, LO) > 0.0
    u = np.where(inside, -HRRR_MS, np.nan)                     # from 090 -> toward west, native m/s like the GRIB
    v = np.where(inside, 0.0, np.nan)
    U = np.repeat(u[None], len(hours), 0)
    V = np.repeat(v[None], len(hours), 0)
    return {"format": fetcher.FORMAT, "cycle": CYCLE.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "horizon": hours[-1].strftime("%Y-%m-%dT%H:%M:%SZ"),
            "hours": [h.strftime("%Y-%m-%dT%H:%M:%SZ") for h in hours], "lattice": la,
            "u": fetcher.encode(U), "v": fetcher.encode(V), "steps_ok": len(hours), "steps_failed": 0}


@pytest.fixture
def lane(monkeypatch):
    monkeypatch.delenv("WIND_HRRR_LANE", raising=False)
    monkeypatch.delenv("WIND_HRRR_FEATHER_KM", raising=False)
    monkeypatch.delenv("WIND_HRRR_TAPER_HOURS", raising=False)
    ln = WL.Lane(lane_obj(), key="wind_lane/hrrr-2026100912.json")
    WL.install(ln)
    yield ln
    WL.install(None)


def gvec(lat, lng, speed=GFS_KN, direction=180.0):
    rad = math.radians(direction)
    return GridVector(lat=lat, lng=lng, speed=speed, direction=direction,
                      u=round(-speed * math.sin(rad), 4), v=round(-speed * math.cos(rad), 4), period=0.0)


def product(points, valid=CYCLE + timedelta(hours=3), model="GFS", domain="wind", layer="wind", **kw):
    vecs = [gvec(a, b) for a, b in points]
    lats = [p[0] for p in points]
    lngs = [p[1] for p in points]
    b = CoverageBounds(west=min(lngs), south=min(lats), east=max(lngs), north=max(lats))
    return NormalizedProduct(model=model, provider="open-meteo", domain=domain, layer=layer, run_time=CYCLE,
                             valid_time=valid, is_forecast_authoritative=True, is_estimated=False, coverage=b,
                             grid=NormalizedGrid(bounds=b, cols=len(points), rows=1, vectors=vecs),
                             value_kind="vector", value_unit="kn", display_unit_hint="kn",
                             source_variables=["wind_speed_10m"], freshness_sec=0, **kw)


GULF = (27.75, -87.5)                # the 2026-10-09 eye's neighbourhood, deep inside HRRR
CARIB = (15.0, -75.0)                # outside HRRR's domain


def test_inside_hrrrs_domain_and_horizon_the_wind_is_hrrr(lane):
    out = WL.apply_wind_lane(product([GULF, CARIB]), "GFS", "wind", "wind")
    g, c = out.grid.vectors
    assert g.speed == pytest.approx(HRRR_KN) and g.direction == pytest.approx(90.0)
    assert (g.u, g.v) == (pytest.approx(-HRRR_KN), pytest.approx(0.0, abs=1e-6))
    assert (c.speed, c.direction) == (GFS_KN, 180.0)
    assert out.wind_lane["lane"] == "hrrr+gfs" and out.wind_lane["hrrr_cells"] == 1
    assert out.wind_lane["hrrr_cycle"] == "2026-10-09T12:00:00Z" and out.wind_lane["hrrr_horizon"] == "2026-10-11T12:00:00Z"
    assert out.wind_lane["feather_km"] == 200.0 and out.wind_lane["taper_hours"] == 3


def test_the_input_product_and_its_vectors_are_never_written(lane):
    p = product([GULF, CARIB])
    before = copy.deepcopy(p.model_dump())
    vec_ids = [id(v) for v in p.grid.vectors]
    out = WL.apply_wind_lane(p, "GFS", "wind", "wind")
    assert out is not p and out.grid is not p.grid and out.grid.vectors is not p.grid.vectors
    assert p.model_dump() == before and [id(v) for v in p.grid.vectors] == vec_ids
    assert out.grid.vectors[1] is p.grid.vectors[1]               # an untouched cell is shared, not copied


def test_null_jacobian_across_tiers_the_same_node_serves_the_same_wind(lane):
    """A 2-deg world clip (NOAA GFS) and a 0.25-deg viewport box (Open-Meteo gfs_global) disagree about GFS at the
    node they share; with the lane, at a node HRRR carries fully, they serve the identical wind."""
    world = product([(26.0, -88.0), (28.0, -88.0), (28.0, -86.0)])
    box = product([(28.0, -88.0), (28.0, -87.75), (28.25, -88.0)])
    box.grid.vectors[0] = gvec(28.0, -88.0, speed=17.5, direction=150.0)     # a different GFS upstream
    w = WL.apply_wind_lane(world, "GFS", "wind", "wind").grid.vectors[1]
    b = WL.apply_wind_lane(box, "GFS", "wind", "wind").grid.vectors[0]
    assert (w.lat, w.lng) == (b.lat, b.lng)
    assert (w.speed, w.direction, w.u, w.v) == (b.speed, b.direction, b.u, b.v)


def test_applying_twice_changes_nothing_more(lane):
    once = WL.apply_wind_lane(product([GULF]), "GFS", "wind", "wind")
    twice = WL.apply_wind_lane(once, "GFS", "wind", "wind")
    assert twice.grid.vectors[0].speed == pytest.approx(once.grid.vectors[0].speed)
    assert twice.grid.vectors[0].direction == pytest.approx(once.grid.vectors[0].direction)


def test_the_feather_blends_speed_as_a_scalar_across_hrrrs_edge(lane):
    """North along 97.5W from the south edge (24.37N): pure GFS through HRRR's 15 km relaxation rows, then the cos^2
    ramp over 200 km, then pure HRRR; the served speed is the SCALAR blend (L-S16: never the shrunk vector mean), and
    it never dips below both models even though the two winds are 90 deg apart."""
    lats = [round(24.25 + 0.25 * k, 2) for k in range(14)]
    out = WL.apply_wind_lane(product([(a, -97.5) for a in lats]), "GFS", "wind", "wind")
    speeds, weights = [], []
    for a, v in zip(lats, out.grid.vectors):
        w = hg.space_weight(a, -97.5, 200.0)
        weights.append(w)
        speeds.append(v.speed)
        assert v.speed == pytest.approx(w * HRRR_KN + (1 - w) * GFS_KN, abs=1e-3)
        assert v.speed >= GFS_KN - 1e-9
    assert weights[0] == 0.0 and weights[-1] == 1.0 and 0.0 < weights[5] < 1.0
    assert all(b >= a - 1e-9 for a, b in zip(speeds, speeds[1:]))           # monotone through the band


@pytest.mark.parametrize("hours_before,weight", [(3, 1.0), (2, 0.75), (1, 0.5), (0, 0.25)])
def test_the_time_seam_tapers_over_hrrrs_last_three_hours(lane, hours_before, weight):
    out = WL.apply_wind_lane(product([GULF], valid=HORIZON - timedelta(hours=hours_before)), "GFS", "wind", "wind")
    assert out.wind_lane["time_weight"] == pytest.approx(weight)
    assert out.grid.vectors[0].speed == pytest.approx(weight * HRRR_KN + (1 - weight) * GFS_KN, abs=1e-3)


def test_past_hrrrs_horizon_the_wind_is_gfs_and_says_so(lane):
    p = product([GULF], valid=HORIZON + timedelta(hours=1))
    out = WL.apply_wind_lane(p, "GFS", "wind", "wind")
    assert out.grid.vectors is p.grid.vectors                     # not one cell touched: the scrubber is never capped
    assert out.wind_lane["lane"] == "gfs" and out.wind_lane["reason"] == "beyond_hrrr_horizon"
    assert out.wind_lane["hrrr_horizon"] == "2026-10-11T12:00:00Z"


def test_before_the_cycle_and_at_a_missing_hour_the_wind_is_gfs(monkeypatch):
    hours = [CYCLE + timedelta(hours=k) for k in range(49) if k != 7]
    WL.install(WL.Lane(lane_obj(hours)))
    try:
        assert WL.apply_wind_lane(product([GULF], valid=CYCLE - timedelta(hours=1)), "GFS", "wind", "wind"
                                  ).wind_lane["reason"] == "before_hrrr_cycle"
        assert WL.apply_wind_lane(product([GULF], valid=CYCLE + timedelta(hours=7)), "GFS", "wind", "wind"
                                  ).wind_lane["reason"] == "hrrr_hour_missing"
    finally:
        WL.install(None)


def test_the_lane_follows_the_served_frame_not_the_asked_hour(lane):
    """resolve_grid's valid_time echoes the ASK; served_valid_time is the frame the data is. HRRR must be taken at the
    data's hour or the blend mixes two hours."""
    p = product([GULF], valid=HORIZON + timedelta(hours=2), served_valid_time="2026-10-11T09:00:00Z")
    assert WL.apply_wind_lane(p, "GFS", "wind", "wind").wind_lane["time_weight"] == pytest.approx(1.0)


def test_outside_the_domain_nothing_changes(lane):
    p = product([CARIB, (10.0, -60.0)])
    out = WL.apply_wind_lane(p, "GFS", "wind", "wind")
    assert out.grid.vectors is p.grid.vectors and out.wind_lane["reason"] == "outside_hrrr_domain"


@pytest.mark.parametrize("model,domain,layer", [("ICON", "wind", "wind"), ("EURO", "wind", "wind"),
                                                ("GFS", "marine", "waves"), ("GFS", "weather", "pressure")])
def test_only_gfs_wind_is_touched(lane, model, domain, layer):
    p = product([GULF], model=model, domain=domain, layer=layer)
    assert WL.apply_wind_lane(p, model, domain, layer) is p


def test_the_env_kill_returns_the_gfs_global_map_exactly(lane, monkeypatch):
    monkeypatch.setenv("WIND_HRRR_LANE", "0")
    p = product([GULF])
    assert WL.apply_wind_lane(p, "GFS", "wind", "wind") is p


def test_the_client_kill_returns_the_product_untouched(lane):
    p = product([GULF])
    token = WL.request_mode.set("gfs")
    try:
        assert WL.apply_wind_lane(p, "GFS", "wind", "wind") is p
    finally:
        WL.request_mode.reset(token)


def test_with_no_lane_loaded_the_product_is_byte_identical(monkeypatch):
    WL.install(None)
    monkeypatch.setattr(WL, "current_lane", lambda: None)
    p = product([GULF])
    assert WL.apply_wind_lane(p, "GFS", "wind", "wind") is p


@pytest.mark.parametrize("feather", ["150", "0"])
def test_the_feather_is_tunable(lane, monkeypatch, feather):
    monkeypatch.setenv("WIND_HRRR_FEATHER_KM", feather)
    out = WL.apply_wind_lane(product([(24.75, -97.5)]), "GFS", "wind", "wind")
    w = hg.space_weight(24.75, -97.5, float(feather))
    assert out.grid.vectors[0].speed == pytest.approx(w * HRRR_KN + (1 - w) * GFS_KN, abs=1e-3)


def test_a_malformed_lane_object_is_refused():
    bad = lane_obj()
    bad["format"] = "hrrr-wind-lane/0"
    with pytest.raises(ValueError):
        WL.Lane(bad)
    empty = lane_obj()
    la = empty["lattice"]
    empty["u"] = fetcher.encode(np.full((49, la["nlat"], la["nlon"]), np.nan))
    with pytest.raises(ValueError):
        WL.Lane(empty)


# ───────────────────────────── the route: /grid and /grid_series both pass through it once ─────────────────────────────
def _app():
    from routes import weather
    app = FastAPI()
    app.include_router(weather.router, prefix="/api")
    app.add_middleware(WL.WindLaneRequestMode)
    return app


PARAMS = dict(model="GFS", domain="wind", layer="wind", valid_time="2026-10-09T15:00:00Z", bbox="-92,25,-79,32")


def _patch_resolver(monkeypatch, p):
    from services.weather_pipeline import grid_resolver

    async def resolve(*args, **kwargs):
        return p
    monkeypatch.setattr(grid_resolver, "resolve_grid", resolve)


async def _get(path, params):
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=_app()), base_url="https://offline.invalid") as c:
        return await c.get(path, params=params)


def test_the_grid_route_serves_the_lane_and_the_client_kill_skips_it(lane, monkeypatch):
    _patch_resolver(monkeypatch, product([GULF, CARIB]))
    on = asyncio.run(_get("/api/weather/grid", PARAMS)).json()
    off = asyncio.run(_get("/api/weather/grid", {**PARAMS, "wind_lane": "gfs"})).json()
    assert on["wind_lane"]["lane"] == "hrrr+gfs" and on["grid"]["vectors"][0]["speed"] == pytest.approx(HRRR_KN)
    assert off["wind_lane"] is None and off["grid"]["vectors"][0]["speed"] == GFS_KN


def test_series_frames_carry_the_lane(lane, monkeypatch):
    _patch_resolver(monkeypatch, product([GULF, CARIB]))
    params = dict(model="GFS", domain="wind", layer="wind", bbox="-92,25,-79,32", hours="0,1",
                  base_time="2026-10-09T15:00:00Z")
    body = asyncio.run(_get("/api/weather/grid_series", params)).json()
    assert body["frames"] and all(fr["wind_lane"]["lane"] == "hrrr+gfs" for fr in body["frames"])
    killed = asyncio.run(_get("/api/weather/grid_series", {**params, "wind_lane": "gfs"})).json()
    assert killed["frames"] and all(fr["wind_lane"] is None for fr in killed["frames"])


# ───────────────────────────── no knock-on: the lane changes the map, never a served number ─────────────────────────────
BACKEND = Path(__file__).resolve().parents[1]


def test_only_the_grid_route_calls_the_lane():
    """Spot hubs, ratings, glyphs, alerts, the sim and /point read stored products and fetch_point; if any of them
    ever called apply_wind_lane, the wind behind a served number would change with this flag (D-001)."""
    def imports_the_lane(tree):
        for n in ast.walk(tree):
            if isinstance(n, ast.ImportFrom) and (n.module or "").endswith("weather_pipeline.wind_lane"):
                return True
            if isinstance(n, ast.ImportFrom) and (n.module or "").endswith("weather_pipeline") and any(
                    a.name == "wind_lane" for a in n.names):
                return True
            if isinstance(n, ast.Import) and any(a.name.endswith("weather_pipeline.wind_lane") for a in n.names):
                return True
        return False
    callers = []
    for path in list(BACKEND.glob("routes/**/*.py")) + list(BACKEND.glob("services/**/*.py")) + [BACKEND / "server.py"]:
        if path.name == "wind_lane.py" or ".venv" in path.parts:
            continue
        if imports_the_lane(ast.parse(path.read_text(encoding="utf-8-sig", errors="ignore"))):
            callers.append(path.relative_to(BACKEND).as_posix())
    # the route (apply), server.py (the kill-switch middleware + warm-up) and the ingest (publishes the lane)
    assert sorted(callers) == ["routes/weather.py", "server.py", "services/weather_pipeline/wind_lane_ingest.py"], callers
    tree = ast.parse((BACKEND / "routes/weather.py").read_text(encoding="utf-8"))
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call) and getattr(n.func, "attr", None) == "apply_wind_lane"]
    assert len(calls) == 1, "the lane runs exactly once per /grid (grid_series calls this route per frame)"


def test_the_point_lane_still_asks_open_meteo_for_gfs_seamless(monkeypatch):
    """fetch_point is out of scope (it feeds ratings): the lane must not move its model."""
    from services.weather_pipeline.providers import open_meteo_provider as P
    sent = []

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            pass

        async def get(self, url, params=None, timeout=None):
            sent.append(params.get("models"))
            return httpx.Response(200, request=httpx.Request("GET", url),
                                  json={"hourly": {"time": [], "wind_speed_10m": [], "wind_direction_10m": []}})
    monkeypatch.setattr(P, "is_test_environment", lambda: False)
    monkeypatch.setattr(P.OpenMeteoProvider, "_POINT_CACHE", {})
    monkeypatch.setattr(P.OpenMeteoProvider, "_breaker_open", classmethod(lambda cls: False))
    monkeypatch.setenv("USE_WEATHER_PROXY", "false")
    monkeypatch.setattr(P.httpx, "AsyncClient", Client)
    monkeypatch.delenv("WIND_HRRR_LANE", raising=False)
    asyncio.run(P.OpenMeteoProvider().fetch_point("GFS", "wind", "wind", 27.5, -87.5))
    assert sent == ["gfs_seamless"]


@pytest.mark.parametrize("lane_env,flag_env,expected",
                         [(None, None, True), ("1", "0", True), ("0", "0", False), ("0", "1", True)])
def test_the_lane_puts_a_gfs_base_under_the_feather(monkeypatch, lane_env, flag_env, expected):
    """With the lane on, Open-Meteo's GFS wind GRIDS must be gfs_global: gfs_seamless would put Open-Meteo's HRRR,
    whose directions are grid-relative (11-17 deg off at the coasts), under the 200 km feather."""
    from services.weather_pipeline.providers import open_meteo_provider as P
    for name, val in (("WIND_HRRR_LANE", lane_env), ("WIND_GRID_GFS_GLOBAL", flag_env)):
        if val is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, val)
    assert P.wind_grid_gfs_global() is expected


def test_the_flag_is_declared_on_by_the_owner():
    from routes.admin.surf_forecast import _RATING_FLAGS
    default, controls, where = _RATING_FLAGS["WIND_HRRR_LANE"]
    assert default == "1" and "HRRR" in controls and where == "Render env"
    assert WL.enabled() is True or __import__("os").environ.get("WIND_HRRR_LANE") == "0"


def test_the_middleware_sets_the_mode_only_for_grid_routes():
    seen = []

    async def app(scope, receive, send):
        seen.append(WL.request_mode.get())
    mw = WL.WindLaneRequestMode(app)
    for path, qs in (("/api/weather/grid", b"model=GFS&wind_lane=gfs"), ("/api/weather/grid_series", b"wind_lane=gfs"),
                     ("/api/weather/point", b"wind_lane=gfs"), ("/api/weather/grid", b"model=GFS")):
        asyncio.run(mw({"type": "http", "path": path, "query_string": qs}, None, None))
    assert seen == ["gfs", "gfs", None, None]
    assert WL.request_mode.get() is None
