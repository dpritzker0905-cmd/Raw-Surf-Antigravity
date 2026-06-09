import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from fastapi import HTTPException

from server import app
from database import get_db
from core.security import get_current_user_id
from deps.admin_auth import get_current_admin
from models import Profile, SurfSpot, RoleEnum

client = TestClient(app)

@pytest.fixture
def clean_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()

def test_live_endpoints_prevent_impersonation(clean_dependency_overrides):
    # Setup mocks
    mock_db = MagicMock()
    mock_db.flush = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()
    
    # Mock database responses for Profile
    async def mock_execute(query):
        mock_res = MagicMock()
        mock_res.scalars.return_value.all.return_value = []
        
        # We need a profile for the check inside endpoints to proceed if auth passes
        profile = Profile(
            id="user123",
            role=RoleEnum.PHOTOGRAPHER,
            is_shooting=False,
            is_streaming=False,
            current_spot_id=None
        )
        mock_res.scalar_one_or_none.return_value = profile
        return mock_res
        
    mock_db.execute = AsyncMock(side_effect=mock_execute)
    
    # Set overrides
    app.dependency_overrides[get_db] = lambda: mock_db
    # Authenticated user is "user123"
    app.dependency_overrides[get_current_user_id] = lambda: "user123"
    
    # 1. Test go-live with matching user ID -> Should pass the impersonation check
    response = client.post(
        "/api/photographers/user123/go-live",
        json={"location": "Test Spot", "price_per_join": 10.0}
    )
    # With matching user ID, it passes our impersonation check.
    # It might fail subsequent checks (like if it's not a pro and needs check)
    # but the point is we get 200 or another non-403 error.
    assert response.status_code != 403, f"Expected non-403 for matching user ID, got {response.status_code} {response.text}"
    
    # 2. Test go-live with mismatching user ID -> Should fail with 403
    response = client.post(
        "/api/photographers/other_user/go-live",
        json={"location": "Test Spot", "price_per_join": 10.0}
    )
    assert response.status_code == 403
    assert "profile_id does not match the authenticated user" in response.json()["detail"]

    # 3. Test stop-live with matching user ID -> Should pass impersonation check
    response = client.post(
        "/api/photographers/user123/stop-live",
        json={}
    )
    assert response.status_code != 403, f"Expected non-403, got {response.status_code} {response.text}"

    # 4. Test stop-live with mismatching user ID -> Should fail with 403
    response = client.post(
        "/api/photographers/other_user/stop-live",
        json={}
    )
    assert response.status_code == 403
    assert "profile_id does not match the authenticated user" in response.json()["detail"]

    # 5. Test toggle-streaming with matching user ID -> Should pass impersonation check
    response = client.post("/api/photographers/user123/toggle-streaming")
    # toggle-streaming returns 400 if is_shooting is False, which is fine (means check passed)
    assert response.status_code != 403, f"Expected non-403, got {response.status_code} {response.text}"

    # 6. Test toggle-streaming with mismatching user ID -> Should fail with 403
    response = client.post("/api/photographers/other_user/toggle-streaming")
    assert response.status_code == 403
    assert "profile_id does not match the authenticated user" in response.json()["detail"]

def test_update_spot_image_enforces_admin(clean_dependency_overrides):
    # Setup mocks
    mock_db = MagicMock()
    mock_db.commit = AsyncMock()
    
    async def mock_execute(query):
        mock_res = MagicMock()
        spot = SurfSpot(id="spot123", name="Test Spot", image_url=None)
        mock_res.scalar_one_or_none.return_value = spot
        return mock_res
        
    mock_db.execute = AsyncMock(side_effect=mock_execute)
    app.dependency_overrides[get_db] = lambda: mock_db

    # 1. Without admin privileges -> should fail with 403
    async def mock_get_current_admin():
        raise HTTPException(status_code=403, detail="Admin privileges required")
    app.dependency_overrides[get_current_admin] = mock_get_current_admin
    
    response = client.patch(
        "/api/surf-spots/spot123/image",
        json={"image_url": "https://example.com/image.jpg"}
    )
    assert response.status_code == 403
    assert "Admin privileges required" in response.json()["detail"]
    
    # 2. With admin privileges -> should succeed (200)
    async def mock_get_current_admin_success():
        return Profile(id="admin123", is_admin=True)
    app.dependency_overrides[get_current_admin] = mock_get_current_admin_success
    
    response = client.patch(
        "/api/surf-spots/spot123/image",
        json={"image_url": "https://example.com/image.jpg"}
    )
    assert response.status_code == 200
    assert response.json()["message"] == "Spot image updated"
