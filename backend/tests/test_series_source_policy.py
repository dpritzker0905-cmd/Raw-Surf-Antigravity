import asyncio
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as NS

import pytest

from services.weather_pipeline.series_source_policy import has_direct_series_coverage

BASE = datetime(2026, 9, 17, tzinfo=timezone.utc)


def product(hour, **changes):
    fields = dict(model="GFS", domain="marine", layer="waves", upstream_provider="noaa",
                  is_test_fixture=False, is_estimated=False, is_forecast_authoritative=True,
                  resolution=0.25, coverage=NS(west=-82, south=26, east=-78, north=30),
                  valid_time_start=BASE + timedelta(hours=hour))
    fields.update(changes)
    return NS(**fields)


def covered(products, bbox="-81,27,-80,28"):
    vp = NS(store=NS(get_manifest=lambda: NS(products=products)))
    return asyncio.run(has_direct_series_coverage(vp, "GFS", "marine", "waves", bbox, [0, 3], BASE))


def test_direct_products_cover_page():
    assert covered([product(0), product(3)])


@pytest.mark.parametrize("change", [
    {"upstream_provider": "open-meteo"}, {"upstream_provider": None},
    {"resolution": 2}, {"resolution": 0}, {"is_estimated": True},
    {"is_test_fixture": True}, {"is_forecast_authoritative": False},
    {"model": "ICON"}, {"layer": "swell_1"}, {"domain": "wind"},
    {"valid_time_start": BASE + timedelta(hours=4)},
])
def test_one_changed_dimension_retains_live_fallback(change):
    assert not covered([product(0), product(3, **change)])


def test_missing_hour_or_partial_coverage_retains_fallback():
    assert not covered([product(0)])
    assert not covered([product(0), product(3)], "-85,27,-80,28")


def test_dateline_coverage():
    bounds = NS(west=170, south=-20, east=-170, north=20)
    assert covered([product(0, coverage=bounds), product(3, coverage=bounds)], "175,-10,-175,10")
