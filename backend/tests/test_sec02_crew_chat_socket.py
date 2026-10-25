"""LA-SEC-02: the crew chat socket is bound to the token's user, then to the booking's membership.

The URL names the user (`/ws/crew-chat/{booking}/{user}`), and the handler used to trust it, so anyone who knew a
member's id could read the booking's live messages and presence and type as that member. Real JWT + a real
websocket handshake through Starlette's test client + an ephemeral SQLite file; nothing leaves the process.
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
from routes.crew import crew_chat_reactions

POLICY_VIOLATION = 1008  # the token is missing, invalid, expired or for someone else
ACCESS_DENIED = 4003     # a valid token for a user who is not in this booking


def token_for(subject, **kwargs):
    return create_access_token({'sub': subject}, **kwargs)


@pytest.fixture
def client(tmp_path, monkeypatch):
    path = tmp_path / 'sec02.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    when = datetime.now(timezone.utc) + timedelta(days=3)
    with sessionmaker(sync_engine)() as db:
        for pid, role in (('captain', RoleEnum.SURFER), ('crew', RoleEnum.SURFER), ('pro', RoleEnum.PHOTOGRAPHER),
                          ('stranger', RoleEnum.SURFER)):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid, role=role,
                           full_name=pid.title(), credit_balance=0.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0))
        db.add(Booking(id='bk', photographer_id='pro', creator_id='captain', location='Fixture Beach',
                       session_date=when, duration=60, total_price=90.0, status='Confirmed'))
        db.add(BookingParticipant(booking_id='bk', participant_id='captain', is_captain=True, paid_amount=0.0,
                                  payment_status='Paid', status='confirmed'))
        db.add(BookingParticipant(booking_id='bk', participant_id='crew', paid_amount=0.0,
                                  payment_status='Paid', status='confirmed'))
        db.commit()
    sync_engine.dispose()

    def session_maker():
        # A fresh engine per call: the handler runs on the test client's own event loop.
        return async_sessionmaker(create_async_engine(f'sqlite+aiosqlite:///{path}'), expire_on_commit=False)()

    monkeypatch.setattr(database, 'async_session_maker', session_maker)
    app = FastAPI()
    app.include_router(crew_chat_reactions.router, prefix='/api')
    with TestClient(app) as test_client:
        yield test_client


def url(user, token=None):
    base = f'/api/ws/crew-chat/bk/{user}'
    return f'{base}?token={token}' if token else base


def assert_refused(client, path, code):
    """Refusal is a positive close with a code. Ping first: a socket that stayed open answers 'pong' and the
    expected disconnect never arrives, so a regression FAILS here instead of hanging."""
    with pytest.raises(WebSocketDisconnect) as excinfo:
        with client.websocket_connect(path) as socket:
            socket.send_text('ping')
            socket.receive_text()
    assert excinfo.value.code == code, f'{path.split("?")[0]} closed with {excinfo.value.code}, expected {code}'


@pytest.mark.parametrize('user', ['captain', 'crew', 'pro'])
def test_no_token_is_refused(client, user):
    assert_refused(client, url(user), POLICY_VIOLATION)


def test_an_invalid_token_is_refused(client):
    assert_refused(client, url('captain', 'invalid-token-value'), POLICY_VIOLATION)


def test_an_expired_token_is_refused(client):
    assert_refused(client, url('captain', token_for('captain', expires_delta=timedelta(minutes=-1))),
                   POLICY_VIOLATION)


@pytest.mark.parametrize('victim', ['captain', 'crew', 'pro'])
def test_another_users_token_cannot_use_a_members_name(client, victim):
    assert_refused(client, url(victim, token_for('stranger')), POLICY_VIOLATION)


def test_a_member_cannot_connect_as_another_member(client):
    assert_refused(client, url('captain', token_for('crew')), POLICY_VIOLATION)


def test_a_valid_user_who_is_not_in_the_booking_is_denied(client):
    assert_refused(client, url('stranger', token_for('stranger')), ACCESS_DENIED)


@pytest.mark.parametrize('user', ['captain', 'crew', 'pro'])
def test_each_member_connects_with_their_own_token(client, user):
    with client.websocket_connect(url(user, token_for(user))) as socket:
        socket.send_text('ping')
        assert socket.receive_text() == 'pong'
