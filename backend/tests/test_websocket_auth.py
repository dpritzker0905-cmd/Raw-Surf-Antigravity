import pytest
from fastapi import HTTPException
from unittest.mock import patch

from routes.live.websocket import verify_websocket_auth
from core.security import create_access_token

class MockWebSocket:
    def __init__(self, query_params: dict):
        self.query_params = query_params

@pytest.mark.asyncio
async def test_verify_websocket_auth_missing_token():
    ws = MockWebSocket(query_params={})
    with pytest.raises(HTTPException) as excinfo:
        await verify_websocket_auth(ws, "user-123")
    assert excinfo.value.status_code == 401
    assert "token required" in excinfo.value.detail.lower()

@pytest.mark.asyncio
@patch("routes.live.websocket.verify_token")
async def test_verify_websocket_auth_invalid_token(mock_verify):
    mock_verify.side_effect = HTTPException(status_code=401, detail="Invalid token")
    ws = MockWebSocket(query_params={"token": "invalid-token-123"})
    with pytest.raises(HTTPException) as excinfo:
        await verify_websocket_auth(ws, "user-123")
    assert excinfo.value.status_code == 401
    assert excinfo.value.detail == "Invalid token"

@pytest.mark.asyncio
@patch("routes.live.websocket.verify_token")
async def test_verify_websocket_auth_mismatched_user(mock_verify):
    mock_verify.return_value = {"sub": "other-user-999"}
    ws = MockWebSocket(query_params={"token": "valid-token-for-other"})
    with pytest.raises(HTTPException) as excinfo:
        await verify_websocket_auth(ws, "user-123")
    assert excinfo.value.status_code == 403
    assert "forbidden" in excinfo.value.detail.lower()

@pytest.mark.asyncio
@patch("routes.live.websocket.verify_token")
async def test_verify_websocket_auth_success(mock_verify):
    mock_verify.return_value = {"sub": "user-123"}
    ws = MockWebSocket(query_params={"token": "valid-token-for-user"})
    result = await verify_websocket_auth(ws, "user-123")
    assert result is True

@pytest.mark.asyncio
async def test_verify_websocket_auth_actual_jwt_success():
    token = create_access_token({"sub": "user-123"})
    ws = MockWebSocket(query_params={"token": token})
    result = await verify_websocket_auth(ws, "user-123")
    assert result is True

@pytest.mark.asyncio
async def test_verify_websocket_auth_actual_jwt_mismatch():
    token = create_access_token({"sub": "user-123"})
    ws = MockWebSocket(query_params={"token": token})
    with pytest.raises(HTTPException) as excinfo:
        await verify_websocket_auth(ws, "other-user-456")
    assert excinfo.value.status_code == 403
