import pytest
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect

from server import app
from core.security import create_access_token

client = TestClient(app)

WS_POLICY_VIOLATION = 1008

PRIVATE_ENDPOINTS = [
    ("/api/ws/earnings/user-123", "user-123", "connected"),
    ("/api/ws/user/user-123", "user-123", "connected"),
    ("/api/ws/photographer/photographer-123/activity", "photographer-123", "connected"),
    ("/api/ws/call/user-123", "user-123", "connected"),
    ("/api/ws/presence/user-123", "user-123", "presence_connected"),
]


def assert_handshake_refused(path: str) -> None:
    """
    ⚠️ THE OLD ASSERTION WAS `pytest.raises((WebSocketDisconnect, Exception))`, which is just
    `Exception` — it would have passed on a TypeError in the test itself, and it could never tell
    "the server refused the connection" apart from "the client blew up". What it actually did on a
    Linux runner was neither: it HUNG. The server answered the handshake with nothing at all, so no
    exception ever arrived and all 5 params burned the 120 s pytest-timeout — 600 s of that job's
    624.8 s (CI run 31065337094). The file had never run in CI before that day.
    ★ Asserting the specific close code is what makes a silent handshake FAIL instead of hang:
      the timeout is still possible, but it now has a named expectation to violate.
    """
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(path) as websocket:
            websocket.receive_json()
    assert excinfo.value.code == WS_POLICY_VIOLATION, (
        f"{path} closed with {excinfo.value.code}, expected {WS_POLICY_VIOLATION}"
    )


@pytest.mark.parametrize("path, user_id, expected_type", PRIVATE_ENDPOINTS)
def test_private_websocket_endpoint_unauthorized(path, user_id, expected_type):
    """
    An unauthorised handshake must be REFUSED — answered with a 1008 close — on all three
    rejection routes. Refusal is a positive act: the endpoint must never simply return.
    """
    # 1. No token query param
    assert_handshake_refused(path)

    # 2. Invalid token
    assert_handshake_refused(f"{path}?token=invalid-token-value")

    # 3. Token for a different user
    mismatched_token = create_access_token({"sub": "wrong-user-999"})
    assert_handshake_refused(f"{path}?token={mismatched_token}")


@pytest.mark.parametrize("path, user_id, expected_type", PRIVATE_ENDPOINTS)
def test_private_websocket_endpoint_authorized(path, user_id, expected_type):
    """
    Test that connecting with a valid token corresponding to the user_id
    succeeds and receives the initial connection message.

    ★ This is the CONTROL for the test above, and it is the measurement that resolved the
      quarantine: on the runner these 5 passed while the 5 unauthorised params timed out, which is
      what proved the defect was the rejection path and not app startup (CI run 31070627589).
    """
    valid_token = create_access_token({"sub": user_id})
    with client.websocket_connect(f"{path}?token={valid_token}") as websocket:
        data = websocket.receive_json()
        assert data.get("type") == expected_type
