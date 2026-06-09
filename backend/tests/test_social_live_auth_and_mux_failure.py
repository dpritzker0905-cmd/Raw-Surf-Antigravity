import pytest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient

from server import app
from database import get_db
from core.security import get_current_user_id
from models import Profile, SocialLiveStream
import routes.live.social_live as social_live

client = TestClient(app)

# We use global variables to dynamically mock the active user
TEST_CURRENT_USER_ID = "test-user-id"

def mock_get_current_user_id():
    return TEST_CURRENT_USER_ID

mock_db = MagicMock()

async def mock_get_db():
    yield mock_db

@pytest.fixture(autouse=True)
def setup_dependencies():
    app.dependency_overrides[get_current_user_id] = mock_get_current_user_id
    app.dependency_overrides[get_db] = mock_get_db
    yield
    app.dependency_overrides.clear()

def setup_mock_db(broadcaster_exists=True, is_hobbyist=False, existing_stream=None):
    mock_db.execute = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.flush = AsyncMock()
    mock_db.add = MagicMock()
    
    async def mock_refresh(instance):
        instance.id = "mock-stream-id"
        if not instance.stream_url:
            instance.stream_url = "https://stream.mux.com/mock.m3u8"
    mock_db.refresh = AsyncMock(side_effect=mock_refresh)
    
    async def execute_side_effect(query):
        q_str = str(query).lower()
        mock_result = MagicMock()
        
        if "profile" in q_str:
            if broadcaster_exists:
                profile = Profile(
                    id="test-user-id",
                    full_name="Test User",
                    role="HOBBYIST" if is_hobbyist else "SURFER",
                    is_live=False
                )
                mock_result.scalar_one_or_none.return_value = profile
            else:
                mock_result.scalar_one_or_none.return_value = None
        elif "social_live" in q_str:
            mock_result.scalar_one_or_none.return_value = existing_stream
        elif "surfspot" in q_str:
            mock_result.scalar_one_or_none.return_value = None
        
        return mock_result

    mock_db.execute.side_effect = execute_side_effect

def test_start_social_live_forbidden():
    global TEST_CURRENT_USER_ID
    TEST_CURRENT_USER_ID = "other-user-id"
    
    payload = {
        "broadcaster_id": "test-user-id",
        "title": "My Stream"
    }
    
    response = client.post("/api/social-live/start", json=payload)
    assert response.status_code == 403
    assert "Forbidden" in response.json()["detail"]

def test_start_social_live_unconfigured_mux(monkeypatch):
    global TEST_CURRENT_USER_ID
    TEST_CURRENT_USER_ID = "test-user-id"
    
    setup_mock_db(broadcaster_exists=True)
    
    # Force MUX unavailable
    monkeypatch.setattr(social_live, "MUX_AVAILABLE", False)
    monkeypatch.setattr(social_live, "mux_service", None)
    
    payload = {
        "broadcaster_id": "test-user-id",
        "title": "My Stream"
    }
    
    response = client.post("/api/social-live/start", json=payload)
    assert response.status_code == 400
    assert "Mux live streaming is unconfigured" in response.json()["detail"]

def test_start_social_live_failed_mux_creation(monkeypatch):
    global TEST_CURRENT_USER_ID
    TEST_CURRENT_USER_ID = "test-user-id"
    
    setup_mock_db(broadcaster_exists=True)
    
    # Mock mux service with failing stream creation
    mock_mux = MagicMock()
    mock_mux.create_live_stream.return_value = {
        "success": False,
        "error": "API Key Expired"
    }
    monkeypatch.setattr(social_live, "MUX_AVAILABLE", True)
    monkeypatch.setattr(social_live, "mux_service", mock_mux)
    
    payload = {
        "broadcaster_id": "test-user-id",
        "title": "My Stream"
    }
    
    response = client.post("/api/social-live/start", json=payload)
    assert response.status_code == 400
    assert "Mux live stream creation failed: API Key Expired" in response.json()["detail"]

def test_start_social_live_success(monkeypatch):
    global TEST_CURRENT_USER_ID
    TEST_CURRENT_USER_ID = "test-user-id"
    
    setup_mock_db(broadcaster_exists=True)
    
    # Mock mux service with successful stream creation
    mock_mux = MagicMock()
    mock_mux.create_live_stream.return_value = {
        "success": True,
        "playback_url": "https://stream.mux.com/mock.m3u8",
        "rtmp_url": "rtmp://global-live.mux.com/app",
        "stream_key": "mock-stream-key",
        "live_stream_id": "mock-live-stream-id",
        "playback_id": "mock-playback-id"
    }
    monkeypatch.setattr(social_live, "MUX_AVAILABLE", True)
    monkeypatch.setattr(social_live, "mux_service", mock_mux)
    
    payload = {
        "broadcaster_id": "test-user-id",
        "title": "My Stream"
    }
    
    response = client.post("/api/social-live/start", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["stream_id"] == "mock-stream-id"
    assert data["playback_url"] == "https://stream.mux.com/mock.m3u8"
    assert data["rtmp_url"] == "rtmp://global-live.mux.com/app"
    assert data["stream_key"] == "mock-stream-key"

def test_end_social_live_forbidden():
    global TEST_CURRENT_USER_ID
    TEST_CURRENT_USER_ID = "other-user-id"
    
    response = client.post(
        "/api/social-live/mock-stream-id/end",
        params={"broadcaster_id": "test-user-id"}
    )
    assert response.status_code == 403
    assert "Forbidden" in response.json()["detail"]

def test_end_social_live_success(monkeypatch):
    global TEST_CURRENT_USER_ID
    TEST_CURRENT_USER_ID = "test-user-id"
    
    # Mock stream record
    mock_stream = SocialLiveStream(
        id="mock-stream-id",
        broadcaster_id="test-user-id",
        started_at=social_live.datetime.now(social_live.timezone.utc),
        status="live",
        peak_viewers=5
    )
    setup_mock_db(broadcaster_exists=True, existing_stream=mock_stream)
    
    # Mock mux service
    mock_mux = MagicMock()
    monkeypatch.setattr(social_live, "MUX_AVAILABLE", True)
    monkeypatch.setattr(social_live, "mux_service", mock_mux)
    
    response = client.post(
        "/api/social-live/mock-stream-id/end",
        params={"broadcaster_id": "test-user-id"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["stream_id"] == "mock-stream-id"
    assert mock_stream.status == "ended"

def test_force_clear_stale_stream_forbidden():
    global TEST_CURRENT_USER_ID
    TEST_CURRENT_USER_ID = "other-user-id"
    
    response = client.post("/api/social-live/force-clear/test-user-id")
    assert response.status_code == 403
    assert "Forbidden" in response.json()["detail"]

def test_force_clear_stale_stream_success():
    global TEST_CURRENT_USER_ID
    TEST_CURRENT_USER_ID = "test-user-id"
    
    mock_stream = SocialLiveStream(
        id="mock-stream-id",
        broadcaster_id="test-user-id",
        started_at=social_live.datetime.now(social_live.timezone.utc),
        status="live"
    )
    setup_mock_db(broadcaster_exists=True, existing_stream=mock_stream)
    
    response = client.post("/api/social-live/force-clear/test-user-id")
    assert response.status_code == 200
    data = response.json()
    assert data["success"] is True
    assert data["cleared"] is True
    assert data["stream_id"] == "mock-stream-id"
    assert mock_stream.status == "ended"

# Dependencies setup and cleanup are handled automatically via the setup_dependencies fixture.
