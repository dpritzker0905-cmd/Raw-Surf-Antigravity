import pytest
from fastapi import HTTPException
from unittest.mock import patch

from routes.live.websocket import verify_websocket_auth
from core.security import create_access_token

WS_POLICY_VIOLATION = 1008


class MockWebSocket:
    """
    ⚠️ THIS MOCK HAD NO close() UNTIL 2026-08-06, AND THAT IS WHY THESE TESTS COULD NOT SEE THE
    DEFECT THEY WERE WRITTEN TO COVER. They asserted that verify_websocket_auth RAISES
    HTTPException — which it faithfully did — while the thing that actually mattered was what
    reached the client. A mock that cannot be closed cannot observe a close, so these stayed green
    for months over a rejection path that sent the client nothing at all.
    ★ The lesson is the mock, not the assertion: an instrument that cannot express the failure
      mode will never report it. accept() is recorded too, so "accepted then closed" is visible
      rather than indistinguishable from "never accepted".
    """

    def __init__(self, query_params: dict):
        self.query_params = query_params
        self.closed_with = None   # (code, reason) once close() is called
        self.accepted = False

    async def accept(self, *args, **kwargs):
        self.accepted = True

    async def close(self, code: int = 1000, reason: str = ""):
        self.closed_with = (code, reason)


def assert_rejected(ws: MockWebSocket, result) -> None:
    """The whole rejection contract in one place, so no case can assert only half of it."""
    assert result is False, "verify_websocket_auth must return False for an unauthorised handshake"
    assert ws.closed_with is not None, (
        "the handshake was never answered — no close was sent. This is the exact defect measured "
        "on a Linux runner in CI run 31065337094: raising HTTPException from a websocket route "
        "sends no ASGI message at all."
    )
    assert ws.closed_with[0] == WS_POLICY_VIOLATION, (
        f"closed with {ws.closed_with[0]}, expected {WS_POLICY_VIOLATION} (policy violation)"
    )
    assert not ws.accepted, "an unauthenticated socket must never reach an accepted state"


@pytest.mark.asyncio
async def test_verify_websocket_auth_missing_token():
    ws = MockWebSocket(query_params={})
    assert_rejected(ws, await verify_websocket_auth(ws, "user-123"))


@pytest.mark.asyncio
@patch("routes.live.websocket.verify_token")
async def test_verify_websocket_auth_invalid_token(mock_verify):
    mock_verify.side_effect = HTTPException(status_code=401, detail="Invalid token")
    ws = MockWebSocket(query_params={"token": "invalid-token-123"})
    assert_rejected(ws, await verify_websocket_auth(ws, "user-123"))


@pytest.mark.asyncio
@patch("routes.live.websocket.verify_token")
async def test_verify_websocket_auth_unexpected_error_is_still_a_close(mock_verify):
    """A non-HTTPException out of verify_token must not escape either — same silent-handshake risk."""
    mock_verify.side_effect = RuntimeError("jwt library exploded")
    ws = MockWebSocket(query_params={"token": "whatever"})
    assert_rejected(ws, await verify_websocket_auth(ws, "user-123"))


@pytest.mark.asyncio
@patch("routes.live.websocket.verify_token")
async def test_verify_websocket_auth_mismatched_user(mock_verify):
    mock_verify.return_value = {"sub": "other-user-999"}
    ws = MockWebSocket(query_params={"token": "valid-token-for-other"})
    assert_rejected(ws, await verify_websocket_auth(ws, "user-123"))


@pytest.mark.asyncio
@patch("routes.live.websocket.verify_token")
async def test_verify_websocket_auth_success(mock_verify):
    mock_verify.return_value = {"sub": "user-123"}
    ws = MockWebSocket(query_params={"token": "valid-token-for-user"})
    assert await verify_websocket_auth(ws, "user-123") is True
    assert ws.closed_with is None, "an authorised handshake must not be closed"


@pytest.mark.asyncio
async def test_verify_websocket_auth_actual_jwt_success():
    token = create_access_token({"sub": "user-123"})
    ws = MockWebSocket(query_params={"token": token})
    assert await verify_websocket_auth(ws, "user-123") is True
    assert ws.closed_with is None


@pytest.mark.asyncio
async def test_verify_websocket_auth_actual_jwt_mismatch():
    token = create_access_token({"sub": "user-123"})
    ws = MockWebSocket(query_params={"token": token})
    assert_rejected(ws, await verify_websocket_auth(ws, "other-user-456"))
