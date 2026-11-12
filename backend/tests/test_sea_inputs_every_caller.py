"""CMP-2 (Fable audit 2026-11-10): every caller of `estimate_surf_at` gets the hour's tide and MOP sea that `/point` uses.

Only `point_surf_augment` passed `water_level_m` and `nearshore`. The hub's legacy path, `/api/conditions` forecast rows,
`/api/surf-conditions` and the sim called the chain without them, so a capped spot read up to ~8.5% per 0.5 m of tide off
the glyph, and a MOP-covered spot read the parametric chain on every surface but `/point`.

THE PARITY (the handoff's acceptance): 20 spots x 3 hours, each surface's breaking height equals `/point`'s to 1e-6. The
height each surface computes is captured at `estimate_surf_at` itself (the hub and conditions round to 0.1 ft for
display, which would hide a real difference), with tide and MOP stubbed to deterministic, hour-dependent values.
"""
import asyncio
import inspect

import pytest

from services.weather_pipeline import mop_serving
from services.weather_pipeline import sea_inputs
from services.weather_pipeline import sim_rating
from services.weather_pipeline import spot_conditions
from services.weather_pipeline import surf_point
from services.weather_pipeline import tide as tide_mod
from services import surf_conditions

SPOTS = [  # (name, lat, lng, shore-ish swell bearing)
    ("Pipeline", 21.6650, -158.0530, 315.0), ("Waimea", 21.6420, -158.0660, 320.0),
    ("Cocoa Beach", 28.3200, -80.6070, 90.0), ("Sebastian Inlet", 27.8600, -80.4470, 80.0),
    ("Jeffreys Bay", -34.0500, 24.9300, 200.0), ("Steamer Lane", 36.9514, -122.0263, 280.0),
    ("Trestles", 33.3830, -117.5890, 220.0), ("Mavericks", 37.4930, -122.4960, 290.0),
    ("Huntington", 33.6550, -117.9990, 210.0), ("Ocean Beach SF", 37.7600, -122.5110, 280.0),
    ("Hossegor", 43.6650, -1.4440, 290.0), ("Supertubos", 39.3440, -9.3640, 300.0),
    ("Bells Beach", -38.3690, 144.2810, 200.0), ("Snapper Rocks", -28.1630, 153.5500, 100.0),
    ("Teahupoo", -17.8700, -149.2570, 200.0), ("Uluwatu", -8.8150, 115.0880, 220.0),
    ("Puerto Escondido", 15.8590, -97.0730, 200.0), ("Rincon", 34.3740, -119.4770, 260.0),
    ("Nazare", 39.6050, -9.0850, 290.0), ("Byron Bay", -28.6380, 153.6370, 100.0),
]
HOURS = ["2026-09-28T03:00:00Z", "2026-09-28T09:00:00Z", "2026-09-28T15:00:00Z"]
HS, TP = 3.2, 14.0


def _eta(lat, hour):
    return {"03": -0.6, "09": 0.1, "15": 0.9}[hour[11:13]] + (0.05 if lat > 0 else -0.05)


def _near(i, hour):
    return {"hs": 1.1 + 0.1 * HOURS.index(hour), "tp": 13.0, "depth_m": 9.9} if i % 3 == 0 else None


@pytest.fixture
def stubs(monkeypatch):
    for k in ("SURF_TIDE_DEPTH", "SURF_NEARSHORE_MOP", "SURF_SEA_INPUTS_EVERY_CALLER", "SIM_SERVED_TIDE",
              "SIM_PRODUCTION_GEOMETRY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.setenv("SURF_TIDE_DEPTH", "1")
    monkeypatch.setenv("SURF_NEARSHORE_MOP", "1")
    index = {(round(lat, 4), round(lng, 4)): i for i, (_, lat, lng, _) in enumerate(SPOTS)}

    async def tide_at(lat, lng, vt, client=None):
        return {"height_m": _eta(lat, vt), "norm": 0.5, "trend": "rising"}

    async def mop_at(lat, lng, vt):
        return _near(index[(round(lat, 4), round(lng, 4))], vt)

    monkeypatch.setattr(tide_mod, "tide_norm_at", tide_at)
    monkeypatch.setattr(mop_serving, "nearshore_for_point", mop_at)
    calls = []
    real = surf_point.estimate_surf_at

    def spy(lat, lng, *a, **k):
        out = real(lat, lng, *a, **k)
        calls.append(out[0])
        return out
    monkeypatch.setattr(surf_point, "estimate_surf_at", spy)
    monkeypatch.setattr(sim_rating, "estimate_surf_at", spy)
    if surf_point.resolve_surf_geometry(*SPOTS[0][1:3]).shore_normal_deg is None:
        pytest.skip("geometry assets unavailable")
    return calls


def _last(calls, fn):
    n = len(calls)
    fn()
    assert len(calls) == n + 1, "the surface must call estimate_surf_at exactly once"
    return calls[-1]


def _point_height(calls, model, lat, lng, d, hour):
    from services.weather_pipeline.point_surf_augment import augment_with_surf
    from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse
    resp = NormalizedPointResponse(
        model=model, provider="test", domain="marine", layer="waves", run_time="2026-09-28T00:00:00Z",
        valid_time=hour, is_forecast_authoritative=True, is_estimated=False, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=["wave_height"], freshness_sec=0,
        point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat, sampled_lng=lng,
                                    speed=HS, direction=d, period=TP, interpolation_method="nearest"))

    async def no_parts(*a, **k):
        return None
    return _last(calls, lambda: asyncio.run(augment_with_surf(resp, model, "marine", "waves", lat, lng, hour, no_parts)))


def test_every_surface_equals_point_for_20_spots_and_3_hours(stubs):
    calls, checked, moved = stubs, 0, 0
    for name, lat, lng, d in SPOTS:
        geo = surf_point.resolve_surf_geometry(lat, lng)
        for hour in HOURS:
            euro = _point_height(calls, "EURO", lat, lng, d, hour)
            gfs = _point_height(calls, "GFS", lat, lng, d, hour)
            if euro is None:
                continue
            eta, near = asyncio.run(sea_inputs.resolve_for_caller(lat, lng, hour, "EURO"))
            hub = _last(calls, lambda: spot_conditions._breaking_ft(lat, lng, HS, TP, d, geo, water_level_m=eta,
                                                                    nearshore=near))
            assert hub == pytest.approx(euro, abs=1e-6), (name, hour, "hub")
            rows = _last(calls, lambda: spot_conditions.hourly_breaking_forecast(
                lat, lng, {"time": [hour], "wave_height": [HS], "wave_period": [TP], "wave_direction": [d]}, geo,
                sea_by_time={hour: (eta, near)}))
            assert rows == pytest.approx(euro, abs=1e-6), (name, hour, "conditions forecast rows")
            sim = _last(calls, lambda: sim_rating.calculate_surf_rating(
                {"name": name, "latitude": lat, "longitude": lng}, HS, TP, d, 3.0, (d + 180) % 360,
                served_tide={"norm": 0.5, "height_m": _eta(lat, hour), "source": "served_glyph"}))
            # The sim is the GFS-or-any member WITHOUT the MOP sea (not reachable without a fetch; named in the PR).
            assert sim == pytest.approx(gfs, abs=1e-6), (name, hour, "sim")
            g_eta, g_near = asyncio.run(sea_inputs.resolve_for_caller(lat, lng, hour, None))
            sc = _last(calls, lambda: surf_conditions._breaking_ft(lat, lng, HS, TP, d, water_level_m=g_eta,
                                                                   nearshore=g_near))
            assert sc == pytest.approx(gfs, abs=1e-6), (name, hour, "/api/surf-conditions (Open-Meteo sea: no MOP)")
            pre = _last(calls, lambda: spot_conditions._breaking_ft(lat, lng, HS, TP, d, geo))
            moved += abs(pre - euro) > 1e-6
            checked += 1
    assert checked >= 50, f"only {checked} spot-hours resolved a height"
    assert moved > 0, "the stubbed tide/MOP moved no height: the parity above would be vacuous"


def test_kill_switch_gives_every_other_caller_todays_inputs(stubs, monkeypatch):
    monkeypatch.setenv("SURF_SEA_INPUTS_EVERY_CALLER", "0")
    assert asyncio.run(sea_inputs.resolve_for_caller(28.32, -80.607, HOURS[0], "EURO")) == (0.0, None)
    calls = stubs
    name, lat, lng, d = SPOTS[2]
    with_tide = _last(calls, lambda: sim_rating.calculate_surf_rating(
        {"name": name, "latitude": lat, "longitude": lng}, HS, TP, d, 3.0, 270.0,
        served_tide={"norm": 0.5, "height_m": 0.9}))
    geo = sim_rating.spot_geometry({"latitude": lat, "longitude": lng})
    bare = _last(calls, lambda: surf_point.estimate_surf_at(lat, lng, HS, TP, swell_from_deg=d, geometry=geo))
    assert with_tide == bare, "kill switch off: the sim ignores the served tide height, as before"


def test_point_still_resolves_both_inputs_with_the_kill_switch_off(stubs, monkeypatch):
    """`/point` always resolved tide and MOP: the new switch governs only the callers that did not."""
    monkeypatch.setenv("SURF_SEA_INPUTS_EVERY_CALLER", "0")
    eta, near = asyncio.run(sea_inputs.resolve(21.6650, -158.0530, HOURS[1], "EURO"))   # Pipeline: a stubbed MOP spot
    assert eta == pytest.approx(_eta(21.6650, HOURS[1])) and near is not None


def test_mop_is_the_euro_members_only_and_tide_is_gated_as_on_point(stubs, monkeypatch):
    assert asyncio.run(sea_inputs.resolve(36.9514, -122.0263, HOURS[0], "GFS"))[1] is None
    monkeypatch.setenv("SURF_TIDE_DEPTH", "0")
    assert asyncio.run(sea_inputs.resolve(36.9514, -122.0263, HOURS[0], "EURO"))[0] == 0.0


def test_the_sim_rejects_an_unusable_served_tide_height(stubs):
    calls = stubs
    name, lat, lng, d = SPOTS[2]
    spot = {"name": name, "latitude": lat, "longitude": lng}
    bare = _last(calls, lambda: sim_rating.calculate_surf_rating(spot, HS, TP, d, 3.0, 270.0))
    for bad in (float("nan"), float("inf"), 55.0, True, "0.5", None):
        got = _last(calls, lambda: sim_rating.calculate_surf_rating(spot, HS, TP, d, 3.0, 270.0,
                                                                    served_tide={"norm": 0.5, "height_m": bad}))
        assert got == bare, bad


def test_the_hub_resolves_both_frames_through_the_one_helper():
    """The hub's current frame and its daily frames are inside a 300-line async impl with live I/O; pin the wiring."""
    src = inspect.getsource(spot_conditions.resolve_spot_conditions_impl)
    assert src.count("_sea.resolve_for_caller(") == 2
    assert "water_level_m=current_eta, nearshore=current_near" in src
    assert "water_level_m=day_eta, nearshore=day_near" in src


def test_no_caller_of_estimate_surf_at_in_serving_code_omits_the_inputs():
    """A new serving caller that forgets the hour's inputs is the CMP-2 defect again."""
    import pathlib
    import re
    root = pathlib.Path(__file__).resolve().parents[1]
    files = [root / "services" / "surf_conditions.py"] + sorted((root / "services" / "weather_pipeline").glob("*.py"))
    offenders = []
    for f in files:
        text = f.read_text(encoding="utf-8")
        for m in re.finditer(r"estimate_surf_at\(", text):
            line_start = text.rfind("\n", 0, m.start()) + 1
            if text[line_start:m.start()].lstrip().startswith(("#", "def ", "`")) or "`" in text[line_start:m.start()]:
                continue
            depth, j = 0, m.end() - 1
            while j < len(text):
                depth += {"(": 1, ")": -1}.get(text[j], 0)
                if depth == 0:
                    break
                j += 1
            call = text[m.start():j + 1]
            if "water_level_m" not in call:
                offenders.append(f"{f.name}:{text.count(chr(10), 0, m.start()) + 1}")
    assert offenders == [], f"estimate_surf_at called without the hour's water level: {offenders}"
