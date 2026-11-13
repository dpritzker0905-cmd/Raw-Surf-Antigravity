from datetime import datetime
from threading import get_ident

import pytest
from anyio.from_thread import start_blocking_portal
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect

from server import app
from core.security import create_access_token
import database
from models import Profile, RoleEnum
from tests.sqlite_client_fixture import FixtureSessions, dispose_fixture_engine

INITIAL_ACTIVE = datetime(2000, 1, 1)


@pytest.fixture
def client(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{(tmp_path / 'presence.sqlite').as_posix()}")
    maker = async_sessionmaker(engine, expire_on_commit=False)
    sessions = FixtureSessions(maker)
    real_engine = database.engine.sync_engine
    unexpected_io, cleanup_errors = [], []

    def forbid_connect(*_args):
        unexpected_io.append('connect')
        raise AssertionError('Websocket auth attempted unowned database connection')

    def forbid_checkout(*_args):
        unexpected_io.append('checkout')
        raise AssertionError('Websocket auth attempted unowned database checkout')

    async def initialize():
        async with engine.begin() as connection:
            await connection.run_sync(Profile.__table__.create)
        async with maker() as db:
            for user_id, role in [('user-123', RoleEnum.SURFER), ('photographer-123', RoleEnum.PHOTOGRAPHER)]:
                db.add(Profile(id=user_id, user_id=user_id, email=f'{user_id}@example.invalid',
                               username=user_id, role=role, updated_at=INITIAL_ACTIVE))
            await db.commit()

    async def last_active():
        async with maker() as db:
            return await db.scalar(select(Profile.updated_at).where(Profile.id == 'user-123'))

    monkeypatch.setattr(database, 'async_session_maker', sessions)
    monkeypatch.delenv('BYPASS_WS_AUTH', raising=False)
    event.listen(real_engine, 'do_connect', forbid_connect)
    event.listen(real_engine, 'checkout', forbid_checkout)
    try:
        # Do not enter app lifespan. Own the one portal used by sockets and DB cleanup.
        with start_blocking_portal() as portal:
            test_client = TestClient(app)
            test_client.portal = portal
            try:
                # Pin compatibility with Starlette's portal reuse before running any socket.
                with test_client._portal_factory() as used_portal:
                    assert used_portal is portal
                    assert used_portal.call(get_ident) == portal.call(get_ident)
                portal.call(initialize)
                yield test_client, lambda: portal.call(last_active), sessions
            finally:
                for cleanup in (lambda: portal.call(dispose_fixture_engine, engine, sessions), test_client.close):
                    try:
                        cleanup()
                    except Exception as error:
                        cleanup_errors.append(error)
                test_client.portal = None
    except BaseException as error:
        cleanup_errors.append(error)
    finally:
        event.remove(real_engine, 'do_connect', forbid_connect)
        event.remove(real_engine, 'checkout', forbid_checkout)
        # Also catch a late session attempt recorded while the portal was exiting.
        cleanup_errors.extend(sessions.errors)
        if unexpected_io:
            cleanup_errors.append(AssertionError(f'Unowned websocket database I/O: {unexpected_io}'))
        if cleanup_errors:
            raise BaseExceptionGroup('Websocket fixture cleanup or ownership failed', cleanup_errors)


WS_POLICY_VIOLATION = 1008

PRIVATE_ENDPOINTS = [
    ("/api/ws/earnings/user-123", "user-123", "connected"),
    ("/api/ws/user/user-123", "user-123", "connected"),
    ("/api/ws/photographer/photographer-123/activity", "photographer-123", "connected"),
    ("/api/ws/call/user-123", "user-123", "connected"),
    ("/api/ws/presence/user-123", "user-123", "presence_connected"),
]


def assert_handshake_refused(client, path: str) -> None:
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
def test_private_websocket_endpoint_unauthorized(path, user_id, expected_type, client):
    """
    An unauthorised handshake must be REFUSED — answered with a 1008 close — on all three
    rejection routes. Refusal is a positive act: the endpoint must never simply return.
    """
    client, last_active, sessions = client
    # 1. No token query param
    assert_handshake_refused(client, path)

    # 2. Invalid token
    assert_handshake_refused(client, f"{path}?token=invalid-token-value")

    # 3. Token for a different user
    mismatched_token = create_access_token({"sub": "wrong-user-999"})
    assert_handshake_refused(client, f"{path}?token={mismatched_token}")
    assert last_active() == INITIAL_ACTIVE
    assert not sessions.finished, 'Refused handshakes must not open application DB sessions'


@pytest.mark.parametrize("path, user_id, expected_type", PRIVATE_ENDPOINTS)
def test_private_websocket_endpoint_authorized(path, user_id, expected_type, client):
    """
    Test that connecting with a valid token corresponding to the user_id
    succeeds and receives the initial connection message.

    ★ This is the CONTROL for the test above, and it is the measurement that resolved the
      quarantine: on the runner these 5 passed while the 5 unauthorised params timed out, which is
      what proved the defect was the rejection path and not app startup (CI run 31070627589).
    """
    client, last_active, sessions = client
    valid_token = create_access_token({"sub": user_id})
    with client.websocket_connect(f"{path}?token={valid_token}") as websocket:
        data = websocket.receive_json()
        assert data.get("type") == expected_type
    if expected_type == 'presence_connected':
        assert last_active() > INITIAL_ACTIVE
        assert len(sessions.finished) == 1
    else:
        assert last_active() == INITIAL_ACTIVE
        assert not sessions.finished, 'This websocket has no application database work'
