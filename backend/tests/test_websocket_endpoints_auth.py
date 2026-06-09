import pytest
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect

from server import app
from core.security import create_access_token

client = TestClient(app)

PRIVATE_ENDPOINTS = [
    ("/api/ws/earnings/user-123", "user-123", "connected"),
    ("/api/ws/user/user-123", "user-123", "connected"),
    ("/api/ws/photographer/photographer-123/activity", "photographer-123", "connected"),
    ("/api/ws/call/user-123", "user-123", "connected"),
    ("/api/ws/presence/user-123", "user-123", "presence_connected"),
]

@pytest.mark.parametrize("path, user_id, expected_type", PRIVATE_ENDPOINTS)
def test_private_websocket_endpoint_unauthorized(path, user_id, expected_type):
    """
    Test that connecting without a token, or with a missing token parameter,
    is rejected and connection fails/closes.
    """
    # 1. No token query param
    with pytest.raises((WebSocketDisconnect, Exception)):
        with client.websocket_connect(path) as websocket:
            # If it accepts, it shouldn't, but let's read to see if it sends anything or fails
            websocket.receive_json()

    # 2. Invalid token
    with pytest.raises((WebSocketDisconnect, Exception)):
        with client.websocket_connect(f"{path}?token=invalid-token-value") as websocket:
            websocket.receive_json()

    # 3. Token for a different user
    mismatched_token = create_access_token({"sub": "wrong-user-999"})
    with pytest.raises((WebSocketDisconnect, Exception)):
        with client.websocket_connect(f"{path}?token={mismatched_token}") as websocket:
            websocket.receive_json()


@pytest.mark.parametrize("path, user_id, expected_type", PRIVATE_ENDPOINTS)
def test_private_websocket_endpoint_authorized(path, user_id, expected_type):
    """
    Test that connecting with a valid token corresponding to the user_id
    succeeds and receives the initial connection message.
    """
    valid_token = create_access_token({"sub": user_id})
    with client.websocket_connect(f"{path}?token={valid_token}") as websocket:
        data = websocket.receive_json()
        assert data.get("type") == expected_type
