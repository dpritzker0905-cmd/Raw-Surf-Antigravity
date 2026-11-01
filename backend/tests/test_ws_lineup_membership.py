"""The lineup socket is for the lineup's crew (audit 2026-10-18; the open follow-up named when #384 merged).

/ws/lineup/{lineup_id} used to accept any client that knew a lineup id. The room reports who joined or left and
when a crew member paid, so it now needs a valid token whose subject is on that lineup: its creator, its
photographer or one of its participants. A lineup that does not exist is refused exactly like one the caller is
not on. Real JWT + real websocket handshakes through Starlette's test client + an ephemeral SQLite file.
"""
from datetime import datetime, timedelta, timezone

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
from models import Booking, BookingParticipant, Profile, RoleEnum
from routes.live import websocket as live_ws

POLICY_VIOLATION = 1008


def token_for(subject, **kwargs):
    return create_access_token({"sub": subject}, **kwargs)


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / "lineup.sqlite"
    sync_engine = create_engine(f"sqlite:///{path}")
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    when = datetime.now(timezone.utc) + timedelta(days=3)
    with sessionmaker(sync_engine)() as db:
        for pid, role in (("captain", RoleEnum.SURFER), ("crew", RoleEnum.SURFER), ("pro", RoleEnum.PHOTOGRAPHER),
                          ("owner", RoleEnum.SURFER), ("stranger", RoleEnum.SURFER)):
            db.add(Profile(id=pid, user_id=pid, email=f"{pid}@example.com", username=pid, role=role,
                           full_name=pid.title(), credit_balance=0.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0))
        # "bk": captain + crew are participants, pro is the photographer
        db.add(Booking(id="bk", photographer_id="pro", creator_id="captain", location="Fixture Beach",
                       session_date=when, duration=60, total_price=90.0, status="Confirmed"))
        db.add(BookingParticipant(booking_id="bk", participant_id="captain", is_captain=True, paid_amount=0.0,
                                  payment_status="Paid", status="confirmed"))
        db.add(BookingParticipant(booking_id="bk", participant_id="crew", paid_amount=0.0,
                                  payment_status="Paid", status="confirmed"))
        # "solo": its creator has no participant row at all
        db.add(Booking(id="solo", photographer_id="pro", creator_id="owner", location="Fixture Beach",
                       session_date=when, duration=60, total_price=90.0, status="Confirmed"))
        db.commit()
    sync_engine.dispose()

    def session_maker():
        return async_sessionmaker(create_async_engine(f"sqlite+aiosqlite:///{path}"), expire_on_commit=False)()

    monkeypatch.setattr(database, "async_session_maker", session_maker)
    monkeypatch.delenv("BYPASS_WS_AUTH", raising=False)
    app = FastAPI()
    app.include_router(live_ws.router, prefix="/api")
    with TestClient(app) as test_client:
        yield test_client


def url(lineup, token=None):
    return f"/api/ws/lineup/{lineup}" + (f"?token={token}" if token else "")


def assert_refused(client, path):
    """Ping first: a socket that stayed open answers, so a regression fails here instead of hanging."""
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(path) as socket:
            socket.send_text("ping")
            socket.receive_text()
    assert excinfo.value.code == POLICY_VIOLATION, f"closed with {excinfo.value.code}"


def test_no_token_is_refused(client):
    assert_refused(client, url("bk"))


def test_an_invalid_token_is_refused(client):
    assert_refused(client, url("bk", "not-a-jwt"))


def test_an_expired_member_token_is_refused(client):
    assert_refused(client, url("bk", token_for("crew", expires_delta=timedelta(minutes=-1))))


def test_a_signed_in_user_who_is_not_on_the_lineup_is_refused(client):
    assert_refused(client, url("bk", token_for("stranger")))


def test_the_creator_of_another_lineup_cannot_use_this_one(client):
    assert_refused(client, url("bk", token_for("owner")))


@pytest.mark.parametrize("user", ["captain", "crew", "pro", "stranger"])
def test_a_lineup_that_does_not_exist_is_refused_like_one_you_are_not_on(client, user):
    assert_refused(client, url("no-such-lineup", token_for(user)))


def test_the_development_bypass_does_not_open_the_room(client, monkeypatch):
    monkeypatch.setenv("BYPASS_WS_AUTH", "true")
    assert_refused(client, url("bk"))
    assert_refused(client, url("bk", token_for("stranger")))


def test_a_lookup_failure_fails_closed(client, monkeypatch):
    def broken():
        raise RuntimeError("database down")

    monkeypatch.setattr(database, "async_session_maker", broken)
    assert_refused(client, url("bk", token_for("captain")))


@pytest.mark.parametrize("lineup,user", [("bk", "captain"), ("bk", "crew"), ("bk", "pro"), ("solo", "owner"),
                                         ("solo", "pro")])
def test_each_kind_of_member_connects_and_the_room_works(client, lineup, user):
    with client.websocket_connect(url(lineup, token_for(user))) as socket:
        hello = socket.receive_json()
        assert hello["type"] == "connected" and hello["lineup_id"] == lineup
        socket.send_text("ping")
        assert socket.receive_json() == {"type": "pong"}


def test_a_member_receives_what_is_broadcast_to_their_room_only(client, monkeypatch):
    """End to end: the room name is per lineup, so a message for 'solo' never reaches the 'bk' crew."""
    monkeypatch.setenv("INTERNAL_BROADCAST_TOKEN", "test-only-secret-not-a-real-credential")
    with client.websocket_connect(url("bk", token_for("crew"))) as bk_socket:
        bk_socket.receive_json()
        with client.websocket_connect(url("solo", token_for("owner"))) as solo_socket:
            solo_socket.receive_json()
            sent = client.post("/api/internal/events/broadcast",
                               json={"room": "lineup_solo", "message": {"type": "lineup_update", "n": 1}},
                               headers={"X-Internal-Token": "test-only-secret-not-a-real-credential"})
            assert sent.status_code == 200
            assert solo_socket.receive_json() == {"type": "lineup_update", "n": 1}
            bk_socket.send_text("ping")
            assert bk_socket.receive_json() == {"type": "pong"}  # the next frame is the pong, not the broadcast
