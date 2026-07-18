"""_coarse_axis fencepost goldens (2026-07-18): the exclusive `< hi` form dropped the east column
+ north row of every NOAA-direct product vs the normalizer's bbox-declared inclusive grid — the
live "hard vertical no-anim line" (FL tile -79.0 column 21/21 invalid; upstream HAS data there).
Locks: endpoints INCLUSIVE for regional axes; full-wrap 360-degree lon axis stays exclusive."""
from services.noaa_gfs_wave_fetcher import _coarse_axis


def test_fl_region_lon_axis_includes_east_endpoint():
    lons = _coarse_axis(-85.0, -79.0, 0.25)
    assert lons[0] == -85.0
    assert lons[-1] == -79.0          # THE fencepost: was -79.25
    assert len(lons) == 25


def test_fl_region_lat_axis_includes_north_endpoint():
    lats = _coarse_axis(24.0, 31.0, 0.25)
    assert lats[-1] == 31.0           # same fencepost on the north row
    assert len(lats) == 29


def test_full_wrap_global_lon_axis_stays_endpoint_exclusive():
    lons = _coarse_axis(-180.0, 180.0, 0.5)
    assert lons[0] == -180.0
    assert lons[-1] == 179.5          # +180 would duplicate -180 across the wrap
    assert len(lons) == 720


def test_global_lat_axis_is_inclusive_not_wrap():
    lats = _coarse_axis(-80.0, 85.0, 0.5)
    assert lats[-1] == 85.0
    assert len(lats) == 331
