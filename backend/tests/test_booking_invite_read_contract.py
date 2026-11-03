"""Offline contract for the production invite read, SQL query and canonical identity dependency.

Load only the named production AST nodes into an isolated FastAPI router: importing
server or invite_lifecycle would start unrelated service dependencies. JWT validation
is synthetic; the real canonical dependency still parses headers and resolves subject.
A real SQLite ORM executes the production select against synthetic relationship models.
No application server, real database, scheduler, provider or payment module is imported.
"""
import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import pytest
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import Column, DateTime, ForeignKey, String, create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import declarative_base, relationship, selectinload, Session
from sqlalchemy.pool import StaticPool

Base = declarative_base()


class Person(Base):
    __tablename__ = 'synthetic_people'
    id = Column(String, primary_key=True)
    full_name = Column(String)
    avatar_url = Column(String)


class Booking(Base):
    __tablename__ = 'synthetic_bookings'
    id = Column(String, primary_key=True)
    location = Column(String)
    session_date = Column(DateTime(timezone=True))
    photographer_id = Column(String, ForeignKey('synthetic_people.id'))
    photographer = relationship(Person)


class BookingInvite(Base):
    __tablename__ = 'synthetic_invites'
    id = Column(String, primary_key=True)
    booking_id = Column(String, ForeignKey('synthetic_bookings.id'))
    inviter_id = Column(String, ForeignKey('synthetic_people.id'))
    invitee_id = Column(String)
    status = Column(String)
    message = Column(String)
    created_at = Column(DateTime(timezone=True))
    expires_at = Column(DateTime(timezone=True))
    booking = relationship(Booking)
    inviter = relationship(Person)


class ReadSession:
    def __init__(self, session):
        self.session = session
        self.statements = []

    async def execute(self, statement):
        self.statements.append(statement)
        return self.session.execute(statement)

    def __getattr__(self, name):
        if name in ('add', 'add_all', 'commit', 'flush', 'delete', 'rollback'):
            raise AssertionError(f'Invite GET must not mutate: {name}')
        raise AttributeError(name)


def _load_node(path, name, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'), filename=str(path))
    node = next((n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == name), None)
    if node is not None:
        exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), 'exec'), namespace)


@pytest.fixture
def client_state():
    backend = Path(__file__).resolve().parents[1]
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    session = Session(engine)
    inviter = Person(id='synthetic-inviter', full_name='Synthetic Inviter', avatar_url='/synthetic-avatar')
    photographer = Person(id='synthetic-photographer', full_name='Synthetic Photographer')
    session.add_all([inviter, photographer, Booking(id='synthetic-booking', location='Synthetic location',
        session_date=datetime(2030, 2, 1, 12), photographer=photographer)])
    for id_, owner, status, day, expiry in [
        ('a-new', 'synthetic-a', 'pending', 3, None),
        ('a-expiry-past-still-pending', 'synthetic-a', 'pending', 2, datetime(2000, 1, 1)),
        ('a-old', 'synthetic-a', 'pending', 1, datetime(2099, 1, 1)),
        ('b-foreign', 'synthetic-b', 'pending', 4, None),
        ('a-accepted', 'synthetic-a', 'accepted', 5, None),
        ('a-declined', 'synthetic-a', 'declined', 6, None),
        ('a-expired-status', 'synthetic-a', 'expired', 7, None),
    ]:
        session.add(BookingInvite(id=id_, booking_id='synthetic-booking', inviter=inviter,
            invitee_id=owner, status=status, message='Synthetic note', created_at=datetime(2030, 1, day), expires_at=expiry))
    session.commit()
    db = ReadSession(session)

    async def get_db():
        yield db

    def verify_token(token):
        if token not in ('synthetic-a', 'synthetic-b', 'synthetic-empty'):
            raise HTTPException(status_code=401, detail='Synthetic invalid token')
        return {'sub': token}

    namespace = dict(Optional=Optional, Header=Header, HTTPException=HTTPException,
        verify_token=verify_token, dev_identity_allowed=lambda: False,
        Depends=Depends, AsyncSession=AsyncSession, get_db=get_db,
        select=select, selectinload=selectinload, BookingInvite=BookingInvite, Booking=Booking)
    _load_node(backend / 'core/security.py', 'get_current_user_id', namespace)
    router = APIRouter()
    namespace['router'] = router
    _load_node(backend / 'routes/bookings/invite_lifecycle.py', 'get_user_invites', namespace)
    app = FastAPI()
    app.include_router(router, prefix='/api')
    try:
        with TestClient(app) as client:
            yield client, db, session
    finally:
        session.close()
        engine.dispose()


def _get(client, user='synthetic-a', token='synthetic-a', query=''):
    headers = {} if token is None else {'Authorization': f'Bearer {token}'}
    return client.get(f'/api/bookings/invites/{user}{query}', headers=headers)


def test_registered_plain_array_filters_recipient_and_pending_status_and_orders_newest(client_state):
    client, db, session = client_state
    before = [(r.id, r.status) for r in session.scalars(select(BookingInvite)).all()]
    response = _get(client)
    assert response.status_code == 200
    data = response.json()
    assert [r['id'] for r in data] == ['a-new', 'a-expiry-past-still-pending', 'a-old']
    assert len(db.statements) == 1
    assert [(r.id, r.status) for r in session.scalars(select(BookingInvite)).all()] == before


def test_nine_field_historical_shape_and_related_data(client_state):
    response = _get(client_state[0])
    assert response.status_code == 200
    row = response.json()[0]
    assert set(row) == {'id', 'booking_id', 'inviter_name', 'inviter_avatar', 'location',
        'session_date', 'photographer_name', 'message', 'created_at'}
    assert row['booking_id'] == 'synthetic-booking'
    assert row['inviter_name'] == 'Synthetic Inviter'
    assert row['inviter_avatar'] == '/synthetic-avatar'
    assert row['location'] == 'Synthetic location'
    assert row['photographer_name'] == 'Synthetic Photographer'
    assert row['message'] == 'Synthetic note'
    assert row['session_date'].startswith('2030-02-01T12:00:00')
    assert row['created_at'].startswith('2030-01-03T00:00:00')


def test_no_rows_is_200_empty_array_not_a_profile_lookup(client_state):
    response = _get(client_state[0], user='synthetic-empty', token='synthetic-empty')
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.parametrize('token', [None, 'synthetic-invalid'])
def test_missing_or_invalid_identity_cannot_query(client_state, token):
    client, db, _ = client_state
    assert _get(client, token=token).status_code == 401
    assert db.statements == []


@pytest.mark.parametrize('path_user,token,query', [
    ('synthetic-a', 'synthetic-b', ''),
    ('synthetic-b', 'synthetic-a', '?user_id=synthetic-a'),
])
def test_foreign_recipient_refused_before_database_access(client_state, path_user, token, query):
    client, db, _ = client_state
    assert _get(client, path_user, token, query).status_code == 403
    assert db.statements == []


def test_query_identity_does_not_replace_verified_subject(client_state):
    response = _get(client_state[0], query='?user_id=synthetic-b')
    assert response.status_code == 200
    assert all(row['id'].startswith('a-') for row in response.json())


def test_other_recipient_can_only_read_own_invites(client_state):
    response = _get(client_state[0], user='synthetic-b', token='synthetic-b')
    assert response.status_code == 200
    assert [row['id'] for row in response.json()] == ['b-foreign']


def test_nullable_related_values_are_serialized_without_side_effects(client_state):
    client, db, session = client_state
    session.add(BookingInvite(id='a-null-related', booking_id='synthetic-missing-related-booking',
        invitee_id='synthetic-a', status='pending', created_at=datetime(2031, 1, 1)))
    session.commit()
    response = _get(client)
    assert response.status_code == 200
    row = response.json()[0]
    assert row['id'] == 'a-null-related'
    assert row['inviter_name'] is None and row['inviter_avatar'] is None
    assert row['location'] is None and row['session_date'] is None and row['photographer_name'] is None
    assert row['message'] is None
    assert len(db.statements) == 1
