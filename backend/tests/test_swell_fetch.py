"""
Guards the basin-scale swell-fetch filter (2026-07-27).

WHY IT EXISTS: government beach data is an excellent source of exactly-located, correctly-named
coastal sites — the EU Bathing Water Directive publishes 15,091 of them under CC-BY 4.0 — but it
makes no distinction between a beach that receives Atlantic groundswell and one on the Adriatic.
Italy alone contributes 4,785 sites. Importing unfiltered would bury the catalogue.

WHY BASIN SCALE: a geometric exposure test was tried at ±9 km and again at ±50 km and could not
separate open coast from enclosed water — the distributions overlapped both times. Whether ocean
swell reaches a coast is a property of the BASIN, hundreds of kilometres out. Measuring at the
wrong scale was the error, twice.

Uses the bundled global 0.25° ETOPO grid — no network.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.bathymetry import is_available, shore_normal_at  # noqa: E402
from services.weather_pipeline.swell_fetch import MAX_FETCH_KM, open_fetch_km  # noqa: E402

pytestmark = pytest.mark.skipif(not is_available(), reason="bundled ETOPO grid not present")

# Measured 2026-07-27 on the bundled grid. Atlantic entries are real spots from our own catalogue.
ATLANTIC = [("Hossegor", 43.664, -1.44), ("Ericeira", 38.999, -9.418),
            ("Mundaka", 43.407, -2.698), ("Bundoran", 54.478, -8.283),
            ("Newquay", 50.415, -5.100), ("Nazare", 39.605, -9.085)]
SHELTERED = [("Copenhagen (Baltic)", 55.660, 12.620), ("Thessaloniki", 40.585, 22.950),
             ("Venice Lido", 45.404, 12.365), ("Rimini (Adriatic)", 44.061, 12.578)]


def _fetch(lat, lng):
    return open_fetch_km(lat, lng, shore_normal_at(lat, lng))


@pytest.mark.parametrize("name,lat,lng", ATLANTIC)
def test_open_atlantic_coasts_have_long_fetch(name, lat, lng):
    f = _fetch(lat, lng)
    assert f is not None, name
    assert f >= 200.0, f"{name} fetch {f:.0f} km — below the import gate"


@pytest.mark.parametrize("name,lat,lng", SHELTERED)
def test_enclosed_seas_are_rejected(name, lat, lng):
    f = _fetch(lat, lng)
    assert f is not None, name
    assert f < 250.0, f"{name} fetch {f:.0f} km — an enclosed sea should not reach this"


def test_the_measured_separation_still_holds():
    """The gate sits between the worst Atlantic spot and the best enclosed one. If a change
    inverts that ordering the filter is no longer doing its job, whatever the threshold says."""
    atl = [_fetch(la, lo) for _, la, lo in ATLANTIC]
    shel = [_fetch(la, lo) for _, la, lo in SHELTERED]
    assert all(f is not None for f in atl + shel)
    assert min(atl) > max(shel), (
        f"worst Atlantic {min(atl):.0f} km is not above best sheltered {max(shel):.0f} km")


def test_unknown_shore_normal_fails_open():
    """No bearing means no seaward arc to measure — the caller decides, we do not guess."""
    assert open_fetch_km(43.664, -1.44, None) is None


def test_fetch_is_bounded_by_the_search_radius():
    f = _fetch(38.999, -9.418)
    assert 0.0 <= f <= MAX_FETCH_KM + 1.0


@pytest.mark.parametrize("name,lat,lng", [
    ("Kansas", 38.5, -98.0), ("Toledo, Spain", 39.86, -4.03), ("Mongolia", 47.0, 103.0)])
def test_deep_inland_has_no_fetch(name, lat, lng):
    """A landlocked point has no seaward arc: every ray blocks in the first cell.

    ⚠️ Verified by measurement, not by picking a coordinate I believed was inland — my first
    attempt used (40.0 N, 2.0 E) as "central Spain", which is open Mediterranean in 1,489 m of
    water and duly returned 319 km. `depth_at` is None for all three of these."""
    for bearing in (0.0, 90.0, 180.0, 270.0):
        f = open_fetch_km(lat, lng, bearing)
        assert f is None or f < 100.0, f"{name} bearing {bearing}: {f}"
