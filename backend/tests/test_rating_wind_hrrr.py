"""RATING_WIND_HRRR (2026-11-03, default '0', DARK): the surf rating's wind is the HRRR lane inside CONUS.

Pins, in order: the flag off is byte-identical (the point JSON and the rating dict, with a lane in memory); inside HRRR
the rating wind IS HRRR and outside it falls back; the 48 h boundary walks HRRR -> GFS over the lane's 3 h taper with no
step; a missing lane / hour / cell falls back; every surface reads one wind (point, rating, band, and the MAP's own
/grid blend at the same coordinate); the 2x2 sampler equals the map's sampler; registration in every rating lane.
"""
import ast
import json
import math
import os
from datetime import timedelta
from pathlib import Path

import numpy as np
import pytest

from services import _hrrr_grid as hg
from services import noaa_hrrr_wind_fetcher as fetcher
from services.weather_pipeline import rating_wind as RW
from services.weather_pipeline import surf_rating as SR
from services.weather_pipeline import wind_lane as WL
from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse

from tests.test_wind_hrrr_lane import CYCLE, GFS_KN, HRRR_KN, HORIZON, lane_obj, product

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
COCOA = (28.40, -80.59)              # a catalogued-style CONUS beach, deep inside HRRR (space weight 1)
CARIB = (15.0, -75.0)                # outside HRRR's domain
VT = (CYCLE + timedelta(hours=3)).strftime("%Y-%m-%dT%H:00:00Z")


@pytest.fixture
def lane(monkeypatch):
    for k in ("WIND_HRRR_LANE", "WIND_HRRR_FEATHER_KM", "WIND_HRRR_TAPER_HOURS", "RATING_WIND_HRRR"):
        monkeypatch.delenv(k, raising=False)
    ln = WL.Lane(lane_obj(), key="wind_lane/hrrr-2026100912.json")
    WL.install(ln)
    yield ln
    WL.install(None)


def wind_resp(lat, lng, speed=GFS_KN, direction=180.0, model="GFS"):
    rad = math.radians(direction)
    return NormalizedPointResponse(
        model=model, provider="open-meteo", domain="wind", layer="wind", run_time=CYCLE, valid_time=CYCLE,
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat, sampled_lng=lng, speed=speed,
                                    direction=direction, u=round(-speed * math.sin(rad), 4),
                                    v=round(-speed * math.cos(rad), 4), interpolation_method="bilinear"),
        value_kind="wind_speed", value_unit="kn", display_unit_hint="kn", source_variables=["wind_speed_10m"],
        freshness_sec=0)


def marine_resp(lat, lng, hs=1.6, tp=11.0, direction=90.0, model="GFS"):
    return NormalizedPointResponse(
        model=model, provider="open-meteo", domain="marine", layer="waves", run_time=CYCLE, valid_time=CYCLE,
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat, sampled_lng=lng, speed=hs,
                                    direction=direction, period=tp, interpolation_method="bilinear"),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft", source_variables=["wave_height"],
        freshness_sec=0)


def service(monkeypatch, model="GFS"):
    from services.weather_pipeline.point_resolution import PointResolutionService
    svc = PointResolutionService()

    async def internal(**kw):
        if kw["domain"] == "wind":
            return wind_resp(kw["lat"], kw["lng"], model=kw["model"])
        if kw["layer"] == "waves":
            return marine_resp(kw["lat"], kw["lng"], model=kw["model"])
        return None
    monkeypatch.setattr(svc, "_resolve_point_internal", internal)
    return svc


# ───────────────────────────── off is byte-identical ─────────────────────────────
@pytest.mark.asyncio
@pytest.mark.parametrize("value", [None, "0", "", "true"])
async def test_off_is_byte_identical_with_a_lane_in_memory(lane, monkeypatch, value):
    from services.weather_pipeline.spot_ratings import rate_one_spot
    if value is not None:
        monkeypatch.setenv("RATING_WIND_HRRR", value)
    svc = service(monkeypatch)
    got = await svc.resolve_point("GFS", "wind", "wind", *COCOA, VT)
    assert got.model_dump_json() == wind_resp(*COCOA).model_dump_json()
    assert got._rating_wind is None
    spot = {"id": "s1", "name": "Cocoa", "latitude": COCOA[0], "longitude": COCOA[1]}
    item = await rate_one_spot(svc, spot, "GFS", VT)
    WL.install(None)                                     # the same call with no lane at all: today's code path
    base = await rate_one_spot(svc, spot, "GFS", VT)
    assert json.dumps(item, sort_keys=True, default=str) == json.dumps(base, sort_keys=True, default=str)
    assert "wind_src" not in item


def test_the_private_provenance_never_reaches_the_served_json(lane, monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    r = RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, VT)
    assert r._rating_wind["src"] == "hrrr"
    assert "_rating_wind" not in r.model_dump_json() and "rating_wind" not in r.model_dump()


# ───────────────────────────── inside uses HRRR, outside falls back ─────────────────────────────
def test_inside_hrrr_the_rating_wind_is_hrrr_and_outside_it_is_the_model(lane, monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    ins = RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, VT)
    assert ins.point.speed == pytest.approx(HRRR_KN, abs=1e-3) and ins.point.direction == pytest.approx(90.0, abs=0.01)
    assert ins.point.u == pytest.approx(-HRRR_KN, abs=1e-3) and ins.point.v == pytest.approx(0.0, abs=1e-3)
    out = RW.apply_to_wind_point(wind_resp(*CARIB), "GFS", "wind", "wind", *CARIB, VT)
    assert out.model_dump_json() == wind_resp(*CARIB).model_dump_json() and out._rating_wind is None


@pytest.mark.parametrize("model", ["EURO", "ICON", "CONSENSUS"])
def test_other_models_keep_their_own_wind(lane, monkeypatch, model):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    r = RW.apply_to_wind_point(wind_resp(*COCOA, model=model), model, "wind", "wind", *COCOA, VT)
    assert r.point.speed == GFS_KN and r._rating_wind is None


def test_the_maps_kill_switch_kills_the_rating_lane_too(lane, monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    monkeypatch.setenv("WIND_HRRR_LANE", "0")
    r = RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, VT)
    assert r.point.speed == GFS_KN and not RW.enabled()


def test_a_marine_point_is_never_touched(lane, monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    m = RW.apply_to_wind_point(marine_resp(*COCOA), "GFS", "marine", "waves", *COCOA, VT)
    assert m.model_dump_json() == marine_resp(*COCOA).model_dump_json()


# ───────────────────────────── the 48 h boundary ─────────────────────────────
def test_the_horizon_walks_from_hrrr_to_gfs_over_the_taper_without_a_step(lane, monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    speeds, weights = [], []
    for dh in range(-6, 3):
        vt = (HORIZON + timedelta(hours=dh)).strftime("%Y-%m-%dT%H:00:00Z")
        r = RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, vt)
        speeds.append(r.point.speed)
        weights.append((r._rating_wind or {}).get("weight", 0.0))
    assert weights == [1.0, 1.0, 1.0, 1.0, 0.75, 0.5, 0.25, 0.0, 0.0]       # H-6 .. H+2
    for w, s in zip(weights, speeds):
        assert s == pytest.approx(w * HRRR_KN + (1 - w) * GFS_KN, abs=1e-3)  # scalar speed blend
    steps = [abs(a - b) for a, b in zip(speeds, speeds[1:])]
    assert max(steps) <= 0.25 * (HRRR_KN - GFS_KN) + 1e-3                    # never more than one taper step
    r = RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA,
                               (HORIZON - timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z"))
    assert r._rating_wind["src"] == "hrrr+gfs"


def test_an_hour_before_the_cycle_keeps_the_model_wind(lane, monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    vt = (CYCLE - timedelta(hours=1)).strftime("%Y-%m-%dT%H:00:00Z")
    assert RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, vt).point.speed == GFS_KN


# ───────────────────────────── a missing product falls back ─────────────────────────────
def test_no_lane_in_memory_keeps_the_model_wind(monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    WL.install(None)
    monkeypatch.setattr(WL, "current_lane", lambda: None)
    r = RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, VT)
    assert r.model_dump_json() == wind_resp(*COCOA).model_dump_json()


def test_a_missing_hour_or_a_missing_cell_keeps_the_model_wind(monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    hours = [CYCLE + timedelta(hours=k) for k in range(49) if k != 3]          # f03 failed to fetch
    WL.install(WL.Lane(lane_obj(hours), key="k"))
    try:
        assert RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, VT).point.speed == GFS_KN
        obj = lane_obj()
        la = obj["lattice"]
        U = fetcher.decode(obj["u"], (49, la["nlat"], la["nlon"]))
        V = fetcher.decode(obj["v"], (49, la["nlat"], la["nlon"]))
        y, x = int((COCOA[0] - la["lat0"]) / la["res"]), int((COCOA[1] - la["lon0"]) / la["res"])
        U[:, y:y + 2, x:x + 2] = np.nan                                     # no HRRR cell around the spot
        V[:, y:y + 2, x:x + 2] = np.nan
        obj["u"], obj["v"] = fetcher.encode(U), fetcher.encode(V)
        WL.install(WL.Lane(obj, key="k2"))
        assert RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, VT).point.speed == GFS_KN
    finally:
        WL.install(None)


def test_an_error_inside_keeps_the_model_wind(lane, monkeypatch):
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    monkeypatch.setattr(RW, "lane_wind", lambda *a, **k: 1 / 0)
    assert RW.apply_to_wind_point(wind_resp(*COCOA), "GFS", "wind", "wind", *COCOA, VT).point.speed == GFS_KN


# ───────────────────────────── every surface, one wind ─────────────────────────────
@pytest.mark.asyncio
async def test_every_surface_grades_on_one_wind(lane, monkeypatch):
    """resolve_point (the hub, the sim via /point, buoy calibration) -> rate_one_spot (glyphs, precompute, /point-rating)
    -> the band's sampler -> and the MAP's own /grid blend: the same wind at the same coordinate and hour."""
    from services.weather_pipeline.spot_ratings import rate_one_spot
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    svc = service(monkeypatch)
    pt = (await svc.resolve_point("GFS", "wind", "wind", *COCOA, VT)).point
    mp = WL.apply_wind_lane(product([COCOA]), "GFS", "wind", "wind").grid.vectors[0]       # the map at that node
    assert (pt.speed, pt.direction) == pytest.approx((mp.speed, mp.direction), abs=1e-3)
    band = RW.blend_ms(*COCOA, CYCLE + timedelta(hours=3), GFS_KN * SR.KT_TO_MS, 180.0, "GFS")
    assert band == pytest.approx((pt.speed * SR.KT_TO_MS, pt.direction), abs=1e-6)
    item = await rate_one_spot(svc, {"id": "s1", "name": "Cocoa", "latitude": COCOA[0], "longitude": COCOA[1]},
                               "GFS", VT)
    assert item["wind_src"] == "hrrr"
    g = resolve_surf_geometry(*COCOA)
    m = await svc.resolve_point("GFS", "marine", "waves", *COCOA, VT)
    want, _ = SR.compute_surf_rating(m.surf_height_m, m.point.period, pt.speed * SR.KT_TO_MS, wind_from_deg=pt.direction,
                                     shore_normal_deg=g.shore_normal_deg, swell_from_deg=m.point.direction,
                                     reference_size_m=None, partitions=m.partitions, break_depth_m=g.break_depth_m)
    assert item["score"] == want
    monkeypatch.setenv("RATING_WIND_HRRR", "0")
    off = await rate_one_spot(svc, {"id": "s1", "name": "Cocoa", "latitude": COCOA[0], "longitude": COCOA[1]},
                              "GFS", VT)
    assert off["score"] != item["score"]                 # the positive control: HRRR's 30 kn easterly moved it


def test_map_and_rating_agree_inside_the_feather(lane, monkeypatch):
    """At a fractional space weight the shared blend_vector gives the map's node and the rating's point one wind."""
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    lat, lng = 30.0, None
    for x in np.arange(-75.0, -68.0, 0.25):
        if 0.2 < hg.space_weight(lat, float(x), WL.feather_km()) < 0.8:
            lng = float(x)
            break
    assert lng is not None
    mp = WL.apply_wind_lane(product([(lat, lng)]), "GFS", "wind", "wind").grid.vectors[0]
    r = RW.apply_to_wind_point(wind_resp(lat, lng), "GFS", "wind", "wind", lat, lng, VT)
    assert r._rating_wind["src"] == "hrrr+gfs"
    assert (r.point.speed, r.point.direction) == pytest.approx((mp.speed, mp.direction), abs=1e-3)


def test_the_rating_surfaces_read_their_wind_at_the_composition_point():
    """No rating surface may grow a second wind source: the hub asks resolve_point for wind, the sim asks /point, and
    only resolve_point and the band's sampler call this module."""
    hub = (BACKEND / "services/weather_pipeline/spot_conditions.py").read_text(encoding="utf-8")
    assert 'self.resolve_point(model=model, domain="wind", layer="wind"' in hub
    sim = (BACKEND / "services/weather_pipeline/sim_forecast.py").read_text(encoding="utf-8")
    assert 'fetch_point("wind", "wind"' in sim
    users = []
    for path in list(BACKEND.glob("routes/**/*.py")) + list(BACKEND.glob("services/**/*.py")):
        if ".venv" in path.parts or path.name == "rating_wind.py":
            continue
        tree = ast.parse(path.read_text(encoding="utf-8-sig", errors="ignore"))
        for n in ast.walk(tree):
            if isinstance(n, ast.ImportFrom) and (n.module or "").endswith("rating_wind"):
                users.append(path.relative_to(BACKEND).as_posix())
            if isinstance(n, ast.ImportFrom) and any(a.name == "rating_wind" for a in n.names):
                users.append(path.relative_to(BACKEND).as_posix())
    assert sorted(set(users)) == ["services/weather_pipeline/grid_resolver_surf.py",
                                  "services/weather_pipeline/point_resolution.py",
                                  "services/weather_pipeline/spot_ratings_precompute.py"]


def test_the_2x2_sampler_equals_the_maps_sampler():
    rng = np.random.default_rng(7)
    obj = lane_obj()
    la = obj["lattice"]
    shape = (49, la["nlat"], la["nlon"])
    U = rng.normal(0, 8, shape)
    V = rng.normal(0, 8, shape)
    U[:, 40:44, 100:104] = np.nan                                  # a hole: the NaN-aware weights must match too
    obj["u"], obj["v"] = fetcher.encode(U), fetcher.encode(V)
    ln = WL.Lane(obj, key="k")
    lats = rng.uniform(la["lat0"] - 0.3, la["lat0"] + la["res"] * la["nlat"] + 0.3, 300)
    lngs = rng.uniform(la["lon0"] - 0.3, la["lon0"] + la["res"] * la["nlon"] + 0.3, 300)
    lats[:5] = la["lat0"] + 40.5 * la["res"]
    lngs[:5] = la["lon0"] + np.array([99.5, 100.2, 101.0, 103.7, 104.1]) * la["res"]
    for k in (0, 17, 48):
        mu, mv = ln.sample(lats, lngs, k)
        for i in range(len(lats)):
            pu, pv = RW.sample_point(ln, lats[i], lngs[i], k)
            if np.isnan(mu[i]):
                assert math.isnan(pu) and math.isnan(pv)
            else:
                assert (pu, pv) == pytest.approx((mu[i], mv[i]), abs=1e-9)


# ───────────────────────────── the precompute loads the lane once ─────────────────────────────
@pytest.mark.parametrize("flag,calls", [("1", 1), ("0", 0)])
def test_preload_reads_the_lane_once_only_when_on(monkeypatch, flag, calls):
    monkeypatch.setenv("RATING_WIND_HRRR", flag)
    monkeypatch.delenv("WIND_HRRR_LANE", raising=False)
    WL.install(None)
    n = []
    monkeypatch.setattr(WL, "refresh", lambda: (n.append(1), WL.install(WL.Lane(lane_obj(), key="k"))))
    try:
        assert RW.preload() is (calls == 1)
        RW.preload()
        assert len(n) == calls
    finally:
        WL.install(None)


@pytest.mark.asyncio
async def test_the_precompute_preloads_before_it_rates(monkeypatch):
    from services.weather_pipeline import spot_ratings_precompute as P
    order = []
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    monkeypatch.setattr(RW, "preload", lambda: order.append("preload") or True)

    async def fake_rate(resolver, sp, model, vt, reference_size_m=None):
        order.append("rate")
        return {"spot_id": sp["id"]}
    monkeypatch.setattr(P, "rate_one_spot", fake_rate)
    await P.precompute_spot_ratings(None, [{"id": "a", "latitude": 1, "longitude": 2}], ["GFS"], [0])
    assert order == ["preload", "rate"]


# ───────────────────────────── registration ─────────────────────────────
def test_registered_dark_and_declared_at_default_in_every_rating_lane():
    src = (BACKEND / "routes/admin/surf_forecast.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    reg = next(n.value for n in ast.walk(tree) if isinstance(n, ast.Assign)
               and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in n.targets))
    flags = {k.value: v.elts[0].value for k, v in zip(reg.keys, reg.values)}
    assert flags["RATING_WIND_HRRR"] == "0"
    for wf in ("forecast-ingest.yml", "precompute.yml", "sim-parity-monitor.yml"):
        text = (REPO / ".github" / "workflows" / wf).read_text(encoding="utf-8")
        assert "RATING_WIND_HRRR: '0'" in text, wf
    assert os.environ.get("RATING_WIND_HRRR") in (None, "0")


@pytest.mark.asyncio
async def test_the_bands_wind_sampler_carries_the_lane(lane, monkeypatch):
    """The rating band (grid_resolver_surf) samples its own wind product; with the flag on, its sampler hands the
    rating the lane wind at the cell, and with it off the sampler is untouched."""
    from services.weather_pipeline import grid_resolver_surf as G
    from services.weather_pipeline import manifest_point_selection as M

    class P:
        filename = "gfs_wind.json"
    monkeypatch.setattr(M, "point_candidates", lambda *a, **k: ([P()], []))
    monkeypatch.setattr(M, "choose_for_point", lambda cands, lat, lng: P())
    monkeypatch.setattr(G, "_load_nearest_sampler", lambda store, fn: (lambda lat, lng: (GFS_KN * SR.KT_TO_MS, 180.0)))
    s_off = await G._build_wind_sampler(None, None, "GFS", CYCLE + timedelta(hours=3))
    assert s_off(*COCOA) == (GFS_KN * SR.KT_TO_MS, 180.0)
    monkeypatch.setenv("RATING_WIND_HRRR", "1")
    s_on = await G._build_wind_sampler(None, None, "GFS", CYCLE + timedelta(hours=3))
    assert s_on(*COCOA) == pytest.approx((HRRR_KN * SR.KT_TO_MS, 90.0), abs=1e-3)
    assert s_on(*CARIB) == (GFS_KN * SR.KT_TO_MS, 180.0)
    s_euro = await G._build_wind_sampler(None, None, "EURO", CYCLE + timedelta(hours=3))
    assert s_euro(*COCOA) == (GFS_KN * SR.KT_TO_MS, 180.0)
