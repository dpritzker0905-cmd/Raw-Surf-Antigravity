"""
Tests for services/weather_pipeline/bathymetry.py — the bundled ETOPO1 depth sampler.

Exercises the real 0.25° asset (data/etopo_depth_0p25.npy), so it also guards that the bundled grid is
present and sane (deep ocean is deep, the shelf is shallow, inland is None).
"""
from services.weather_pipeline import bathymetry as b


def test_asset_present():
    assert b.is_available()


def test_deep_ocean_is_deep():
    d = b.depth_at(30.0, -150.0)            # mid North Pacific
    assert d is not None and d > 3000
    sd = b.shelf_depth_at(30.0, -150.0)
    assert sd is not None and sd > 3000


def test_shelf_is_shallow_relative_to_open_ocean():
    fl = b.shelf_depth_at(28.4, -80.55)     # Florida east-coast shelf
    deep = b.shelf_depth_at(30.0, -150.0)
    assert fl is not None and fl < 200      # a genuine continental shelf
    assert deep > fl


def test_inland_returns_none():
    assert b.depth_at(38.5, -98.0) is None   # central Kansas — no ocean nearby
    assert b.shelf_depth_at(38.5, -98.0) is None


def test_longitude_wrap():
    # a Pacific point expressed with lng > 180 must wrap and still resolve to deep ocean
    assert b.depth_at(0.0, 200.0) == b.depth_at(0.0, -160.0)
