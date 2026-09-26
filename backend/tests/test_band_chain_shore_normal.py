"""The rating band's shore normal is the chain's (Queue E#1 isolated, 2026-09-26).

The owner reported band and glyph colours disagreeing (2026-08-09, measured at 2.3-2.7x), and Queue E#1
forbade tuning either lane until the binding sub-term was isolated. The attribution
(scripts/band_glyph_attribution.py, 60 spots x 12 sea states, data held identical) isolated it among the COMPOSITION terms: the band read `bathymetry.shore_normal_at` (a 7x7
window 194.6 km across) while the glyph read the chain's precedence (coarse -> ETOPO asset -> hand
override). |gap| was p50 4.7 / p90 40.3 points (39% of cases over 10). Swapping the chain's normal in
closed it to 0 at p50 and p90; swapping the height transform or the break depth changed nothing.
Pipeline is the extreme: the coarse raster reads 0.0 (north) on a reef that faces 325.
"""
import os
import random
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.bathymetry import shore_normal_at as coarse_normal  # noqa: E402
from services.weather_pipeline.surf_point import (  # noqa: E402
    _shore_normal_precedence, chain_shore_normal_at, resolve_surf_geometry)

BREAKS = [("Pipeline", 21.6650, -158.0533), ("Sunset", 21.6782, -158.0417),
          ("Sebastian Inlet", 27.8608, -80.4464), ("Mavericks", 37.4956, -122.5011),
          ("Supertubos", 39.3446, -9.3637)]


@pytest.mark.parametrize("name,lat,lng", BREAKS)
def test_the_band_normal_is_exactly_the_geometry_normal(name, lat, lng):
    assert chain_shore_normal_at(lat, lng) == resolve_surf_geometry(lat, lng).shore_normal_deg


def test_identity_holds_across_random_coastal_cells():
    rng = random.Random(26)
    cells = [(round(rng.uniform(20, 45), 3), round(rng.uniform(-125, -70), 3)) for _ in range(150)]
    for lat, lng in cells:
        assert chain_shore_normal_at(lat, lng) == resolve_surf_geometry(lat, lng).shore_normal_deg


def test_pipeline_gets_the_reef_bearing_not_the_coarse_north():
    """The documented extreme: the 0.25 deg window reads 0.0 at Pipeline and Sunset."""
    assert coarse_normal(21.6650, -158.0533) == pytest.approx(0.0)
    normal, src, _ = _shore_normal_precedence(21.6650, -158.0533)
    assert normal == pytest.approx(325.0) and src.startswith("override:")


def test_the_etopo_asset_outranks_the_coarse_raster():
    normal, src, _ = _shore_normal_precedence(27.8608, -80.4464)          # Sebastian Inlet
    assert src == "etopo" and abs(normal - coarse_normal(27.8608, -80.4464)) > 5.0


async def test_the_band_route_hands_the_chain_normal_to_the_transform(monkeypatch):
    """Wiring, not just the helper: grid_resolver_surf must pass THIS function as shore_normal_fn."""
    from services.weather_pipeline import grid_resolver_surf as GRS
    from services.weather_pipeline.schemas import (CoverageBounds, GridVector, NormalizedGrid,
                                                  NormalizedProduct)
    import services.weather_pipeline.surf_rating as SR
    seen = {}

    def fake_transform(vectors, depth_fn, coastal_fn=None, width_fn=None, wind_fn=None,
                       shore_normal_fn=None, **kw):
        seen["fn"] = shore_normal_fn
        return len(vectors), 0

    monkeypatch.setattr(SR, "rating_transform_grid", fake_transform)
    monkeypatch.setenv("SURF_RATING", "1")
    now = datetime.now(timezone.utc)
    bounds = CoverageBounds(west=-160, south=20, east=-150, north=25)
    product = NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves", run_time=now, valid_time=now,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds,
        grid=NormalizedGrid(bounds=bounds, cols=1, rows=1, diagnostics={},
                            vectors=[GridVector(lat=21.66, lng=-158.05, speed=2.0, direction=325.0)]),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=3600)

    class _Manifest:
        products = []

    await GRS.apply_surf_overlay(product, store=None, manifest=_Manifest(), model="GFS", domain="marine",
                                 layer="waves", surf=True, target_dt=None)
    assert seen["fn"] is chain_shore_normal_at, "the band is not using the chain's shore normal"
