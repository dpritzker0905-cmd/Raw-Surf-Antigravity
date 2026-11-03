"""Offline production-AST/SQLite consent contracts; SQLite does NOT prove row locking.

Canonical header identity runs with a synthetic verifier. Credit/broadcast collaborators
are synthetic spies; no wallet, provider or full app is imported. PostgreSQL SQL compilation
checks lock declarations only, not concurrent database behavior.
"""
import ast
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from typing import Optional

import pytest
from fastapi import APIRouter, Depends, FastAPI, Header, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import Column, Float, Integer, String, create_engine, select, update
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session, declarative_base
from sqlalchemy.pool import StaticPool

Base = declarative_base()


class Booking(Base):
    __tablename__ = 'consent_booking'
    id = Column(String, primary_key=True)
    photographer_id = Column(String)
    price_per_person = Column(Float)
    total_price = Column(Float)
    max_participants = Column(Integer)
    location = Column(String)


class BookingInvite(Base):
    __tablename__ = 'consent_invite'
    id = Column(String, primary_key=True)
    booking_id = Column(String)
    inviter_id = Column(String)
    invitee_id = Column(String)
    status = Column(String)
    responded_at = Column(String)


class Profile(Base):
    __tablename__ = 'consent_profile'
    id = Column(String, primary_key=True)
    full_name = Column(String)


def load(path, names, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


@pytest.fixture
def state():
    backend = Path(__file__).resolve().parents[1]
    engine = create_engine('sqlite://', connect_args={'check_same_thread': False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    sql = Session(engine, expire_on_commit=False)
    booking = Booking(id='booking-a', photographer_id='photographer-a', price_per_person=25.125,
                      total_price=100, max_participants=4, location='Synthetic location')
    invite = BookingInvite(id='invite-a', booking_id='booking-a', inviter_id='inviter-a', invitee_id='user-a', status='pending')
    sql.add_all([booking, invite, Profile(id='user-a', full_name='Synthetic buyer')]); sql.commit()
    events = []

    class DB:
        async def execute(self, statement):
            entity = statement.column_descriptions[0]['entity']
            events.append(('read', entity.__name__, statement._for_update_arg is not None,
                           statement.get_execution_options().get('populate_existing'),
                           str(statement.compile(dialect=postgresql.dialect()))))
            return sql.execute(statement)

        def add(self, item):
            events.append(('add', item))

        async def commit(self):
            events.append(('commit',))
            # Spy only: do not persist datetime into this simplified String test column.

    db = DB()

    async def get_db():
        yield db

    def verify_token(token):
        if token not in ('user-a', 'user-b'):
            raise HTTPException(401, 'Synthetic invalid identity')
        return {'sub': token}

    def clean_amount(amount):
        return namespace['production_clean_amount'](amount)

    async def debit(**kwargs):
        events.append(('debit', kwargs))
        return True, 74.88, ''

    async def credit(**kwargs):
        events.append(('credit', kwargs))
        return True, 20.1, ''

    async def broadcast(**kwargs):
        events.append(('broadcast', kwargs))

    namespace = dict(Optional=Optional, Header=Header, HTTPException=HTTPException, verify_token=verify_token,
                     dev_identity_allowed=lambda: False, Depends=Depends, AsyncSession=AsyncSession, get_db=get_db,
                     select=select, Booking=Booking, BookingInvite=BookingInvite, Profile=Profile,
                     BookingParticipant=lambda **kw: SimpleNamespace(**kw), Notification=lambda **kw: SimpleNamespace(**kw),
                     datetime=datetime, timezone=timezone, json=json, hashlib=hashlib,
                     deduct_credits=debit, add_credits=credit, broadcast_earnings_update=broadcast, clean_amount=clean_amount)
    import math
    credit_namespace = {'math': math}
    load(backend / 'utils/credits.py', {'clean_amount'}, credit_namespace)
    namespace['production_clean_amount'] = credit_namespace['clean_amount']
    load(backend / 'core/security.py', {'get_current_user_id'}, namespace)
    namespace['get_user_id_from_jwt_or_query'] = namespace['get_current_user_id']
    namespace['router'] = APIRouter()
    load(backend / 'routes/bookings/invite_lifecycle.py',
         {'_invite_consent_terms', 'get_invite_accept_quote', 'respond_to_invite'}, namespace)
    app = FastAPI(); app.include_router(namespace['router'], prefix='/api')
    try:
        with TestClient(app) as client:
            yield SimpleNamespace(client=client, db=db, sql=sql, booking=booking, invite=invite, events=events, namespace=namespace)
    finally:
        sql.close(); engine.dispose()


def quote(s, token='user-a'):
    return s.client.get('/api/bookings/invites/invite-a/accept-quote', headers={'Authorization': f'Bearer {token}'})


def respond(s, consent=None, accept=True, token='user-a'):
    params = {'accept': str(accept).lower()}
    if consent is not None:
        params['consent_quote'] = consent
    return s.client.post('/api/bookings/invites/invite-a/respond', params=params, headers={'Authorization': f'Bearer {token}'})


def test_quote_is_registered_read_only_and_matches_existing_credit_normalization(state):
    r = quote(state)
    assert r.status_code == 200
    assert r.json()['amount_credits'] == '25.12'  # Existing Python round(25.125, 2).
    assert r.json()['unit'] == 'credits'
    assert r.json()['invite_id'] == 'invite-a' and r.json()['booking_id'] == 'booking-a'
    assert len(r.json()['quote']) == 64
    assert all(e[0] == 'read' and not e[2] for e in state.events)
    assert state.invite.status == 'pending'


@pytest.mark.parametrize('consent', [None, '', 'bad', '0' * 64])
def test_accept_without_current_quote_refuses_before_any_side_effect(state, consent):
    assert respond(state, consent).status_code == 409
    assert all(e[0] == 'read' for e in state.events)
    assert state.invite.status == 'pending'


@pytest.mark.parametrize('token,status', [('user-b', 403), ('invalid', 401)])
def test_foreign_or_invalid_identity_cannot_quote_or_accept(state, token, status):
    assert quote(state, token).status_code == status
    assert respond(state, '0' * 64, token=token).status_code == status
    assert all(e[0] == 'read' for e in state.events)


@pytest.mark.parametrize('field,value', [('price_per_person', 30), ('total_price', 120), ('max_participants', 6), ('photographer_id', 'other')])
def test_changed_terms_refuse_and_require_new_quote_before_mutation(state, field, value):
    old = quote(state).json()['quote']
    setattr(state.booking, field, value); state.sql.commit(); state.events.clear()
    assert respond(state, old).status_code == 409
    assert state.invite.status == 'pending'
    assert all(e[0] == 'read' for e in state.events)
    assert quote(state).json()['quote'] != old


def test_accept_refreshes_locked_terms_before_credit_calls_and_reports_actual_debit(state):
    consent = quote(state).json()['quote']; state.events.clear()
    response = respond(state, consent)
    assert response.status_code == 200
    assert response.json()['amount_paid_credits'] == '25.12'
    reads = state.events[:2]
    assert [e[1] for e in reads] == ['BookingInvite', 'Booking']
    assert all(e[2] and e[3] and 'FOR UPDATE' in e[4] for e in reads)
    debit = next(e[1] for e in state.events if e[0] == 'debit')
    credit = next(e[1] for e in state.events if e[0] == 'credit')
    assert debit['amount'] == 25.125 and credit['amount'] == 25.125 * .80
    assert state.events[-1] == ('commit',)
    assert state.invite.status == 'accepted'
    assert respond(state, consent).status_code == 400  # Serial replay, not concurrent PostgreSQL proof.


def test_decline_requires_no_quote_and_never_charges(state):
    assert respond(state, accept=False).status_code == 200
    assert state.invite.status == 'declined'
    assert not any(e[0] in ('debit', 'credit', 'broadcast') for e in state.events)
    assert state.events[0][1:4] == ('BookingInvite', True, True)


def test_fallback_price_and_zero_truthiness_match_existing_formula(state):
    state.booking.price_per_person = 0; state.booking.total_price = 100; state.booking.max_participants = 3
    state.sql.commit()
    assert quote(state).json()['amount_credits'] == '33.33'


def test_credit_refusal_never_reports_success_or_commits(state):
    consent = quote(state).json()['quote']; state.events.clear()
    async def refusal(**kwargs):
        return False, 0, 'Synthetic insufficient credits'
    state.namespace['deduct_credits'] = refusal
    r = respond(state, consent)
    assert r.status_code == 400 and r.json()['detail'] == 'Synthetic insufficient credits'
    assert not any(e[0] in ('credit', 'add', 'broadcast', 'commit') for e in state.events)


def test_missing_authorization_never_reads_or_mutates(state):
    assert state.client.get('/api/bookings/invites/invite-a/accept-quote').status_code == 401
    assert state.client.post('/api/bookings/invites/invite-a/respond?accept=true').status_code == 401
    assert state.events == []


def test_a_quote_for_another_invite_cannot_be_used_even_with_identical_price(state):
    old = quote(state).json()['quote']
    state.sql.add(BookingInvite(id='invite-b', booking_id='booking-a', inviter_id='inviter-a', invitee_id='user-a', status='pending'))
    state.sql.commit(); state.events.clear()
    r = state.client.post('/api/bookings/invites/invite-b/respond', params={'accept':'true', 'consent_quote':old},
                          headers={'Authorization':'Bearer user-a'})
    assert r.status_code == 409
    assert all(e[0] == 'read' for e in state.events)


def test_locked_query_refreshes_stale_identity_map_before_comparing_consent(state):
    old = quote(state).json()['quote']
    state.sql.execute(update(Booking).values(price_per_person=99).execution_options(synchronize_session=False))
    state.sql.commit()
    assert state.booking.price_per_person == 25.125  # Intentionally stale identity-map copy.
    state.events.clear()
    assert respond(state, old).status_code == 409
    assert state.booking.price_per_person == 99
    assert all(e[0] == 'read' for e in state.events)


@pytest.mark.parametrize('amount', [float('nan'), float('inf'), -1])
def test_unusable_stored_charge_cannot_produce_a_payable_quote(state, amount):
    state.booking.price_per_person = amount
    # The pure production helper sees malformed values before any SQL serialization.
    with pytest.raises(HTTPException) as error:
        state.namespace['_invite_consent_terms'](state.invite, state.booking, 'user-a')
    assert error.value.status_code == 400
    assert not state.events
