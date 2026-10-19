"""The admin event feed is admins-only, and the internal broadcast endpoint has no default secret.

Audit 2026-10-18 (LA-SEC-04): /ws/admin/events accepted any anonymous client into the room that carries the
platform's internal event stream, and /internal/events/broadcast fell back to a token written in this PUBLIC
repository when INTERNAL_BROADCAST_TOKEN was unset, so anyone could post an event into any room.

Real JWT + real websocket handshakes through Starlette's test client + an ephemeral SQLite file; nothing leaves
the process. Refusal is a positive close code, asserted by pinging first so a regression fails instead of hanging.
"""
import pathlib
from datetime import timedelta

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from fastapi.websockets import WebSocketDisconnect
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

import database
from core.security import create_access_token
from database import Base
from models import Profile, RoleEnum
from routes.live import websocket as live_ws

POLICY_VIOLATION = 1008
BACKEND = pathlib.Path(__file__).resolve().parent.parent
OLD_LITERAL = "super_secret_internal_token"  # the value that used to be the default; it is public history
SECRET = "test-only-internal-secret-not-a-real-credential"


def token_for(subject, **kwargs):
    return create_access_token({"sub": subject}, **kwargs)


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / "wsadmin.sqlite"
    sync_engine = create_engine(f"sqlite:///{path}")
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    with sessionmaker(sync_engine)() as db:
        for pid, is_admin in (("boss", True), ("surfer", False)):
            db.add(Profile(id=pid, user_id=pid, email=f"{pid}@example.invalid", username=pid, role=RoleEnum.SURFER,
                           full_name=pid.title(), credit_balance=0.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0, is_admin=is_admin))
        db.commit()
    sync_engine.dispose()

    def session_maker():
        return async_sessionmaker(create_async_engine(f"sqlite+aiosqlite:///{path}"), expire_on_commit=False)()

    monkeypatch.setattr(database, "async_session_maker", session_maker)
    monkeypatch.delenv("INTERNAL_BROADCAST_TOKEN", raising=False)
    monkeypatch.delenv("BYPASS_WS_AUTH", raising=False)
    app = FastAPI()
    app.include_router(live_ws.router, prefix="/api")
    with TestClient(app) as test_client:
        yield test_client


def admin_url(token=None):
    return "/api/ws/admin/events" + (f"?token={token}" if token else "")


def assert_refused(client, path, code=POLICY_VIOLATION):
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(path) as socket:
            socket.send_text("ping")
            socket.receive_text()
    assert excinfo.value.code == code, f"closed with {excinfo.value.code}, expected {code}"


# --- /ws/admin/events ---------------------------------------------------------------------------------------

def test_no_token_is_refused(client):
    assert_refused(client, admin_url())


def test_an_invalid_token_is_refused(client):
    assert_refused(client, admin_url("not-a-jwt"))


def test_an_expired_admin_token_is_refused(client):
    assert_refused(client, admin_url(token_for("boss", expires_delta=timedelta(minutes=-1))))


def test_a_signed_in_non_admin_is_refused(client):
    assert_refused(client, admin_url(token_for("surfer")))


def test_a_valid_token_for_an_unknown_profile_is_refused(client):
    assert_refused(client, admin_url(token_for("ghost")))


def test_the_development_bypass_does_not_open_the_admin_feed(client, monkeypatch):
    monkeypatch.setenv("BYPASS_WS_AUTH", "true")
    assert_refused(client, admin_url())
    assert_refused(client, admin_url(token_for("surfer")))


def test_a_lookup_failure_fails_closed(client, monkeypatch):
    def broken():
        raise RuntimeError("database down")

    monkeypatch.setattr(database, "async_session_maker", broken)
    assert_refused(client, admin_url(token_for("boss")))


def test_an_admin_connects_and_the_feed_works(client):
    with client.websocket_connect(admin_url(token_for("boss"))) as socket:
        assert socket.receive_json()["room"] == "admin_events"
        socket.send_text("ping")
        assert socket.receive_json() == {"type": "pong"}


# --- /internal/events/broadcast -----------------------------------------------------------------------------

def post(client, token=None):
    headers = {"X-Internal-Token": token} if token is not None else {}
    return client.post("/api/internal/events/broadcast", json={"room": "admin_events", "message": {"k": "v"}},
                       headers=headers)


def test_the_old_public_default_no_longer_opens_the_endpoint(client):
    assert post(client, OLD_LITERAL + "_123").status_code == 401


def test_with_no_secret_configured_every_request_is_refused(client):
    assert post(client).status_code == 401
    assert post(client, "").status_code == 401


def test_a_wrong_secret_is_refused(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_BROADCAST_TOKEN", SECRET)
    assert post(client, SECRET + "x").status_code == 401
    assert post(client).status_code == 401


def test_the_configured_secret_delivers_to_the_room(client, monkeypatch):
    monkeypatch.setenv("INTERNAL_BROADCAST_TOKEN", SECRET)
    with client.websocket_connect(admin_url(token_for("boss"))) as socket:
        socket.receive_json()  # the connect confirmation
        assert post(client, SECRET).status_code == 200
        assert socket.receive_json() == {"k": "v"}


def test_an_empty_secret_variable_counts_as_unset(monkeypatch):
    monkeypatch.setenv("INTERNAL_BROADCAST_TOKEN", "")
    assert live_ws.internal_broadcast_token() is None


@pytest.mark.parametrize("source", ["routes/live/websocket.py", "event_bus_core.py"])
def test_no_source_file_carries_the_old_literal(source):
    assert OLD_LITERAL not in (BACKEND / source).read_text(encoding="utf-8")
