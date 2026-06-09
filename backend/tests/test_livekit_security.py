import pytest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi.testclient import TestClient
from fastapi import HTTPException

from server import app
from database import get_db
from core.security import get_current_user_id
from models import Profile, SocialLiveStream

client = TestClient(app)

@pytest.fixture
def clean_dependency_overrides():
    app.dependency_overrides.clear()
    yield
    app.dependency_overrides.clear()

@pytest.fixture
def mock_livekit_configured():
    with patch("routes.live.livekit._is_configured", return_value=True), \
         patch("routes.live.livekit._get_credentials", return_value=("ws://localhost", "key", "secret")):
        yield

@pytest.fixture
def mock_livekit_sdk():
    mock_token = MagicMock()
    mock_token.to_jwt.return_value = "mocked.jwt.token"
    
    mock_api = MagicMock()
    mock_api.AccessToken.return_value = mock_token
    
    # Mock LiveKitAPI class and its create_room method
    mock_lk_api = MagicMock()
    mock_lk_api.room.create_room = AsyncMock()
    mock_lk_api.aclose = AsyncMock()
    
    with patch("routes.live.livekit.api", mock_api), \
         patch("routes.live.livekit.api.LiveKitAPI", return_value=mock_lk_api):
        yield mock_api, mock_lk_api

def test_livekit_endpoints_prevent_impersonation(clean_dependency_overrides, mock_livekit_configured, mock_livekit_sdk):
    mock_api, mock_lk_api = mock_livekit_sdk
    
    # Setup database mocks
    mock_db = MagicMock()
    mock_db.flush = AsyncMock()
    mock_db.commit = AsyncMock()
    mock_db.refresh = AsyncMock()
    
    # Add side effect to assign ids to instantiated models
    def mock_add(obj):
        if hasattr(obj, "id") and getattr(obj, "id") is None:
            obj.id = "mock-stream-id-123"
    mock_db.add = MagicMock(side_effect=mock_add)
    
    async def mock_execute(query):
        mock_res = MagicMock()
        mock_res.scalars.return_value.all.return_value = []
        
        # Profile mock
        profile = Profile(
            id="user123",
            full_name="Test User",
            is_live=False
        )
        # Stream mock
        stream = SocialLiveStream(
            id="stream123",
            broadcaster_id="user123",
            status="live",
            stream_url="live-room-123",
            started_at=None,
            viewer_count=0,
            peak_viewers=0
        )
        
        query_str = str(query).lower()
        print(f"QUERY: {query_str}")
        if "profile" in query_str:
            print("RETURNING PROFILE")
            mock_res.scalar_one_or_none.return_value = profile
        elif "social_live_streams.id =" in query_str or "stream_url =" in query_str:
            print("RETURNING STREAM")
            mock_res.scalar_one_or_none.return_value = stream
        else:
            print("RETURNING NONE")
            mock_res.scalar_one_or_none.return_value = None
            
        return mock_res
        
    mock_db.execute = AsyncMock(side_effect=mock_execute)
    
    app.dependency_overrides[get_db] = lambda: mock_db
    app.dependency_overrides[get_current_user_id] = lambda: "user123"
    
    # 1. Test get_livekit_token matching user -> Should return 200
    response = client.post(
        "/api/livekit/token",
        json={
            "room_name": "test-room",
            "participant_identity": "user123",
            "is_broadcaster": True
        }
    )
    assert response.status_code == 200
    assert response.json()["token"] == "mocked.jwt.token"
    
    # 2. Test get_livekit_token mismatching user -> Should return 403
    response = client.post(
        "/api/livekit/token",
        json={
            "room_name": "test-room",
            "participant_identity": "other_user",
            "is_broadcaster": True
        }
    )
    assert response.status_code == 403
    
    # 3. Test start_livekit_stream matching user -> Should return 200
    response = client.post(
        "/api/livekit/start-stream",
        json={
            "broadcaster_id": "user123",
            "title": "Test Stream"
        }
    )
    assert response.status_code == 200, f"Failed start_livekit_stream: {response.text}"
    
    # 4. Test start_livekit_stream mismatching user -> Should return 403
    response = client.post(
        "/api/livekit/start-stream",
        json={
            "broadcaster_id": "other_user",
            "title": "Test Stream"
        }
    )
    assert response.status_code == 403

    # 5. Test start_social_live matching user -> Should return 200
    response = client.post(
        "/api/livekit/start-social-live",
        json={
            "broadcaster_id": "user123",
            "broadcaster_name": "Test User"
        }
    )
    assert response.status_code == 200, f"Failed start_social_live: {response.text}"
    
    # 6. Test start_social_live mismatching user -> Should return 403
    response = client.post(
        "/api/livekit/start-social-live",
        json={
            "broadcaster_id": "other_user",
            "broadcaster_name": "Test User"
        }
    )
    assert response.status_code == 403

    # 7. Test end_livekit_stream matching user -> Should return 200
    response = client.post(
        "/api/livekit/end-stream/stream123?broadcaster_id=user123"
    )
    assert response.status_code == 200
    
    # 8. Test end_livekit_stream mismatching user -> Should return 403
    response = client.post(
        "/api/livekit/end-stream/stream123?broadcaster_id=other_user"
    )
    assert response.status_code == 403

    # 9. Test get_viewer_token matching user -> Should return 200
    response = client.get(
        "/api/livekit/viewer-token/live-room-123?viewer_id=user123"
    )
    assert response.status_code == 200
    
    # 10. Test get_viewer_token mismatching user -> Should return 403
    response = client.get(
        "/api/livekit/viewer-token/live-room-123?viewer_id=other_user"
    )
    assert response.status_code == 403
