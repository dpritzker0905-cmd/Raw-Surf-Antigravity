import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from datetime import datetime, timezone, timedelta

from server import app
from database import get_db
from models import SurfSpot
from services.weather_pipeline.point_resolution import PointResolutionService

# Create FastAPI TestClient
client = TestClient(app)

# Test SurfSpot mock data
MOCK_SPOT = SurfSpot(
    id="test-spot-123",
    name="Test Surf Spot",
    region="Florida East Coast",
    difficulty="Intermediate",
    latitude=26.35,
    longitude=-80.08,
    is_active=True
)

@pytest.mark.asyncio
async def test_point_resolution_service_resolve_spot_conditions(monkeypatch):
    """Verify PointResolutionService.resolve_spot_conditions yields correct current and forecast dictionaries."""
    mock_provider = AsyncMock()
    
    service = PointResolutionService(
        sampler=MagicMock(),
        provider=mock_provider
    )
    
    # Monkeypatch find_cached_grid_product to always return None (async def is required)
    async def mock_find_cached(*args, **kwargs):
        return None
    monkeypatch.setattr(service, "find_cached_grid_product", mock_find_cached)
    
    # Mock provider fetch
    async def mock_fetch_point(*args, **kwargs):
        now = datetime.now(timezone.utc)
        times = []
        for d in range(12):
            times.append((now + timedelta(days=d)).strftime("%Y-%m-%dT%H:00:00Z"))
        return {
            "hourly": {
                "time": times,
                "wave_height": [1.5] * len(times),
                "wave_direction": [90.0] * len(times),
                "wave_period": [8.0] * len(times),
                "swell_wave_height": [1.2] * len(times),
                "swell_wave_direction": [95.0] * len(times)
            }
        }
    
    monkeypatch.setattr(service.provider, "fetch_point", mock_fetch_point)
    
    res = await service.resolve_spot_conditions(
        model="GFS", lat=26.35, lng=-80.08, forecast_days=11
    )
    
    assert "current_conditions" in res
    assert "forecast" in res
    assert res["current_conditions"]["wave_height_ft"] == round(1.5 * 3.28084, 1)
    assert len(res["forecast"]) == 10

def test_endpoints_accept_model_param(monkeypatch):
    """Verify explore and details endpoints accept the model query parameter and default to GFS."""
    # Mock db dependency
    mock_db = MagicMock()
    
    async def mock_get_db():
        yield mock_db
        
    app.dependency_overrides[get_db] = mock_get_db
    
    from routes.explore_discover import explore
    
    # Mock fetch_marine_conditions
    mock_conditions = {
        "current_conditions": {
            "wave_height_ft": 4.9,
            "wave_direction": 90.0,
            "wave_period": 8.0,
            "swell_height_ft": 3.9,
            "swell_direction": 95.0,
            "label": "Waist High",
            "updated_at": "2026-06-08T20:00:00Z"
        },
        "forecast": []
    }
    
    async def mock_fetch_marine(*args, **kwargs):
        return mock_conditions
        
    monkeypatch.setattr(explore, "fetch_marine_conditions", mock_fetch_marine)
    
    # Mock db.execute with a query-based mock router
    async def mock_execute(query):
        q_str = str(query).lower()
        mock_res = MagicMock()
        if "surf_spot" in q_str or "surfspot" in q_str:
            mock_res.scalars.return_value.all.return_value = [MOCK_SPOT]
            mock_res.scalar_one_or_none.return_value = MOCK_SPOT
        else:
            mock_res.scalars.return_value.all.return_value = []
            mock_res.scalar_one_or_none.return_value = None
        return mock_res
        
    mock_db.execute = AsyncMock(side_effect=mock_execute)
    
    # Test /api/explore/surf-spots?model=ICON
    response = client.get("/api/explore/surf-spots?model=ICON")
    assert response.status_code == 200
    
    # Test /api/explore/spot-details/{spot_id}?model=EURO
    from routes.explore_discover import spot_details
    async def mock_resolve_spot_conds(*args, **kwargs):
        return mock_conditions
        
    monkeypatch.setattr(spot_details.point_resolution_service, "resolve_spot_conditions", mock_resolve_spot_conds)
    
    response_details = client.get(f"/api/explore/spot-details/{MOCK_SPOT.id}?model=EURO")
    assert response_details.status_code == 200
    data = response_details.json()
    assert data["id"] == MOCK_SPOT.id
    
    # Clean up overrides
    app.dependency_overrides.clear()
