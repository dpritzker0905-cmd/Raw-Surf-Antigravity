import os
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from datetime import datetime, timezone

from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider, is_test_environment
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.scheduler_helpers import get_env_flags
from services.weather_pipeline.schemas import NormalizedProduct, CoverageBounds, NormalizedGrid

def test_production_flags_override_test_fixtures():
    """Verify that is_test_environment returns False in production regardless of LOCAL_TEST_FIXTURE."""
    with patch.dict(os.environ, {"NODE_ENV": "production", "LOCAL_TEST_FIXTURE": "true", "TESTING": "1"}):
        assert is_test_environment() is False
        flags = get_env_flags()
        assert flags["is_test_env"] is False

    with patch.dict(os.environ, {"ENV": "production", "LOCAL_TEST_FIXTURE": "true"}):
        assert is_test_environment() is False
        flags = get_env_flags()
        assert flags["is_test_env"] is False

    with patch.dict(os.environ, {"IS_PROD": "true", "LOCAL_TEST_FIXTURE": "true"}):
        assert is_test_environment() is False
        flags = get_env_flags()
        assert flags["is_test_env"] is False

@pytest.mark.asyncio
async def test_open_meteo_provider_rejects_mocks_in_production():
    """Verify that OpenMeteoProvider does not return mock data in production."""
    provider = OpenMeteoProvider()
    
    # We patch httpx.AsyncClient.get to raise a RuntimeError. If is_test is False,
    # the provider will attempt to make the real HTTP call instead of returning mock immediately.
    with patch.dict(os.environ, {"NODE_ENV": "production", "LOCAL_TEST_FIXTURE": "true"}):
        with patch("httpx.AsyncClient.get", side_effect=RuntimeError("Real HTTP call attempted")) as mock_get:
            with pytest.raises(RuntimeError, match="Real HTTP call attempted"):
                await provider.fetch_grid(
                    model="GFS",
                    domain="marine",
                    layer="waves",
                    bbox={"west": -80.0, "south": 25.0, "east": -79.0, "north": 26.0}
                )

            with pytest.raises(RuntimeError, match="Real HTTP call attempted"):
                await provider.fetch_point(
                    model="GFS",
                    domain="marine",
                    layer="waves",
                    lat=25.0,
                    lng=-80.0
                )

def test_store_rejects_test_fixtures_in_production():
    """Verify that ProductStore rejects saving test-fixture products in production."""
    store = ProductStore()
    
    product = NormalizedProduct(
        model="GFS",
        provider="test-fixture", # Mark as test-fixture
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=False,
        is_estimated=True,
        coverage=CoverageBounds(west=-80.0, south=25.0, east=-79.0, north=26.0),
        grid=NormalizedGrid(
            bounds=CoverageBounds(west=-80.0, south=25.0, east=-79.0, north=26.0),
            cols=1,
            rows=1,
            vectors=[]
        ),
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        units={"speed": "m"},
        source_variables=["wave_height"],
        freshness_sec=1800,
        is_test_fixture=True
    )
    
    with patch.dict(os.environ, {"NODE_ENV": "production", "LOCAL_TEST_FIXTURE": "true"}):
        # When NODE_ENV=production, it should fail
        saved = store.save_product(product)
        assert saved is None
