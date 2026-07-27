"""
Parity gate for the 2026-07-27 extraction of the surf geometry chain into `surf_point`.

`point_resolution.resolve_point` used to inline the whole chain (shelf depth / coastal gate / shelf
width / shore-normal precedence / magnet / break depth) and was the ONLY copy — which is why the
weather-sim MCP had grown a divergent re-implementation. The chain now lives in
`surf_point.resolve_surf_geometry` and both callers use it.

This file re-implements the PRE-extraction chain literally and asserts the module reproduces it
exactly, on real coordinates that exercise every branch (asset hit, asset miss, hand override,
magnet, capped break depth). If someone edits `surf_point` in a way that changes the marine point
lane, this fails.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at  # noqa: E402
from services.weather_pipeline.surf_transform import estimate_surf  # noqa: E402


# (name, lat, lng) — chosen to hit different branches of the precedence chain.
COORDS = [
    ("Mavericks",        37.4952, -122.5028),
    ("Montara",          37.5458, -122.5150),
    ("Pacifica",         37.5956, -122.5034),
    ("Pipeline",         21.6650, -158.0500),   # hand-audited shore-normal override
    ("Steamer Lane",     36.9514, -122.0256),
    ("Cocoa Beach",      28.3200,  -80.6076),   # wide shallow shelf -> heavy friction
    ("Hossegor",         43.6640,   -1.4400),
    ("open Pacific",     30.0000, -140.0000),   # not coastal
]


def _legacy_chain(lat, lng):
    """The chain EXACTLY as point_resolution.py inlined it before the extraction."""
    from services.weather_pipeline.bathymetry import (
        shelf_depth_at, is_coastal, shelf_width_km, shore_normal_at)
    depth = shelf_depth_at(lat, lng)
    try:
        normal = shore_normal_at(lat, lng)
    except Exception:
        normal = None
    try:
        from services.weather_pipeline.shore_normal_asset import shore_normal_at as _asset_normal_at
        _fine, _spread = _asset_normal_at(lat, lng)
        if _fine is not None:
            normal = _fine
    except Exception:
        pass
    if os.environ.get("SURF_V3_NORMAL_OVERRIDES", "1") != "0":
        try:
            from services.weather_pipeline.surf_magnets import shore_normal_override_at
            _ov, _ov_name = shore_normal_override_at(lat, lng)
            if _ov is not None:
                normal = _ov
        except Exception:
            pass
    try:
        from services.weather_pipeline.surf_magnets import magnet_factor_at
        magnet, magnet_name = magnet_factor_at(lat, lng)
    except Exception:
        magnet, magnet_name = 1.0, None
    try:
        from services.weather_pipeline.shore_normal_asset import break_depth_at
        break_depth = break_depth_at(lat, lng)
    except Exception:
        break_depth = None
    return dict(depth=depth, coastal=bool(is_coastal(lat, lng)),
                width=shelf_width_km(lat, lng) or 0.0, normal=normal,
                magnet=magnet, magnet_name=magnet_name, break_depth=break_depth)


@pytest.mark.parametrize("name,lat,lng", COORDS)
def test_geometry_matches_the_pre_extraction_chain(name, lat, lng):
    legacy = _legacy_chain(lat, lng)
    g = resolve_surf_geometry(lat, lng)
    assert g.depth_m == legacy["depth"], name
    assert g.coastal == legacy["coastal"], name
    assert g.shelf_width_km == legacy["width"], name
    assert g.shore_normal_deg == legacy["normal"], name
    assert g.magnet_factor == legacy["magnet"], name
    assert g.magnet_name == legacy["magnet_name"], name
    assert g.break_depth_m == legacy["break_depth"], name


@pytest.mark.parametrize("name,lat,lng", COORDS)
def test_height_matches_the_pre_extraction_call(name, lat, lng):
    """The composed height must equal the literal estimate_surf call point_resolution used to make."""
    legacy = _legacy_chain(lat, lng)
    for Hs, Tp, sdir in ((1.0, 10.0, 270.0), (2.5, 14.0, 290.0), (6.0, 18.0, 300.0)):
        expected = estimate_surf(Hs, Tp, legacy["depth"], coastal=legacy["coastal"],
                                 shelf_width_km=legacy["width"], swell_from_deg=sdir,
                                 shore_normal_deg=legacy["normal"], magnet_factor=legacy["magnet"],
                                 break_depth_m=legacy["break_depth"])
        got = estimate_surf_at(lat, lng, Hs, Tp, swell_from_deg=sdir)
        assert got == expected, f"{name} @ {Hs}m/{Tp}s/{sdir}deg: {got} != {expected}"


def test_precomputed_geometry_is_equivalent_to_resolving_inline():
    """Passing a cached geometry must not change the answer — the sim reuses one per spot."""
    lat, lng = 37.4952, -122.5028
    g = resolve_surf_geometry(lat, lng)
    assert estimate_surf_at(lat, lng, 3.5, 16.0, 290.0, geometry=g) == \
        estimate_surf_at(lat, lng, 3.5, 16.0, 290.0)


def test_shore_normal_source_is_reported_truthfully():
    """`shore_normal_src` is diagnostic — it must name where the bearing actually came from."""
    g = resolve_surf_geometry(37.4952, -122.5028)      # in the ETOPO asset
    assert g.shore_normal_src == "etopo", g
    assert g.shore_normal_deg is not None

    pipe = resolve_surf_geometry(21.6650, -158.0500)   # hand-audited override territory
    assert pipe.shore_normal_src.startswith("override:") or pipe.shore_normal_src == "etopo", pipe


def test_asset_kill_switch_degrades_to_the_coarse_bearing(monkeypatch):
    """SHORE_NORMAL_ASSET=0 must fall back, not raise and not return the asset value."""
    from services.weather_pipeline import shore_normal_asset
    lat, lng = 37.4952, -122.5028
    live = resolve_surf_geometry(lat, lng)
    monkeypatch.setenv("SHORE_NORMAL_ASSET", "0")
    monkeypatch.setenv("SURF_V3_NORMAL_OVERRIDES", "0")
    shore_normal_asset._reset_for_tests()
    try:
        killed = resolve_surf_geometry(lat, lng)
        assert killed.shore_normal_src in ("coarse", "none"), killed
        assert killed.break_depth_m is None, killed
        assert killed.shore_normal_deg != live.shore_normal_deg
    finally:
        monkeypatch.undo()
        shore_normal_asset._reset_for_tests()


def test_open_ocean_point_is_not_surf():
    """The coastal gate must survive the extraction — swell with no shore is not surf."""
    g = resolve_surf_geometry(30.0, -140.0)
    assert g.coastal is False
    _, regime = estimate_surf_at(30.0, -140.0, 3.0, 14.0, 270.0, geometry=g)
    assert regime == "open_ocean"
