"""Actual booking/live entitlement and claim-context boundaries, offline SQL capture."""
import asyncio
from types import SimpleNamespace as NS
import pytest
from fastapi import HTTPException
from routes.surfer_gallery_review_pkg import entitlements as E, claims as C
from routes.surfer_gallery_review_pkg.schemas import ClaimMatchRequest, ClaimBatchRequest


class Result:
    def __init__(self, row=None, rows=()): self.row = row; self.rows = rows
    def scalar_one_or_none(self): return self.row
    def scalar(self): return 0
    def scalars(self): return self
    def all(self): return self.rows


class DB:
    def __init__(self, booking=None, live=None, member=None, queue=None, queues=()):
        self.booking=booking; self.live=live; self.member=member; self.queue=queue; self.queues=queues; self.queries=[]
    async def execute(self, statement):
        self.queries.append(statement); sql = str(statement)
        if 'FROM surfer_gallery_claim_queue' in sql: return Result(self.queue, self.queues)
        if 'FROM booking_participants' in sql or 'FROM live_session_participants' in sql: return Result(self.member)
        if 'FROM bookings' in sql: return Result(self.booking)
        if 'FROM live_sessions' in sql: return Result(self.live)
        return Result()


def test_unknown_session_refuses_instead_of_granting_default_price():
    with pytest.raises(HTTPException) as e: asyncio.run(E.get_session_entitlements('invented', 'owner', DB()))
    assert e.value.status_code == 404


@pytest.mark.parametrize('member', [None, NS(payment_status='Pending', status='confirmed'), NS(payment_status='Paid', status='cancelled')])
def test_booking_requires_paid_active_membership(member):
    with pytest.raises(HTTPException) as e: asyncio.run(E.get_session_entitlements('booking', 'owner', DB(booking=NS(), member=member)))
    assert e.value.status_code == 403


@pytest.mark.parametrize('price', [0.0, 10.0])
def test_actual_booking_field_and_price_are_used(price):
    db = DB(booking=NS(booking_photos_included=3, booking_full_gallery=False, booking_price_standard=price, booking_type='scheduled'), member=NS(payment_status='Paid', status='confirmed'))
    result = asyncio.run(E.get_session_entitlements('booking', 'owner', db))
    assert result['credits_remaining'] == 3 and result['price_per_clip'] == price
    assert 'booking_participants.participant_id' in str(db.queries[1])


@pytest.mark.parametrize('price', [None, -1, float('nan'), float('inf'), True])
def test_missing_or_invalid_locked_price_refuses(price):
    with pytest.raises(HTTPException) as e: E._valid_price(price)
    assert e.value.status_code == 409


def test_live_uses_actual_photographer_field_and_member_locked_price():
    db = DB(live=NS(photographer_id='photographer'), member=NS(locked_price_standard=0, photos_credit_remaining=2))
    result = asyncio.run(E.get_session_entitlements('live', 'owner', db))
    assert result['price_per_clip'] == 0 and result['credits_remaining'] == 2
    assert db.queries[2].compile().params['id_1'] == 'photographer'


def test_live_requires_membership():
    with pytest.raises(HTTPException) as e: asyncio.run(E.get_session_entitlements('live', 'owner', DB(live=NS(photographer_id='photographer'))))
    assert e.value.status_code == 403


@pytest.mark.parametrize('stored', [None, 'actual-session'])
def test_single_claim_cannot_select_another_session(stored):
    db = DB(queue=NS(booking_id=stored, live_session_id=None))
    with pytest.raises(HTTPException) as e: asyncio.run(C.claim_single_match(ClaimMatchRequest(match_id='queue', session_id='invented'), 'owner', db))
    assert e.value.status_code == 409 and len(db.queries) == 1


@pytest.mark.parametrize('queues,ids,status', [([NS(booking_id='other', live_session_id=None)], ['a'], 409),
    ([], ['missing'], 404), ([], ['a','a'], 400)])
def test_batch_validates_every_context_before_any_entitlement_or_payment(queues, ids, status):
    db = DB(queues=queues)
    with pytest.raises(HTTPException) as e: asyncio.run(C.claim_matches_batch(ClaimBatchRequest(match_ids=ids, session_id='session'), 'owner', db))
    assert e.value.status_code == status and len(db.queries) <= 1


@pytest.mark.parametrize('scope', ['owner', 'foreign', 'other-session', 'cancelled', 'spent'])
def test_live_credit_reservation_updates_only_available_owned_membership(scope):
    from sqlalchemy import create_engine, select
    from sqlalchemy.orm import Session
    from models import LiveSessionParticipant as Participant
    engine = create_engine('sqlite://')
    Participant.__table__.create(engine)
    with Session(engine) as session:
        member = Participant(id='member', photographer_id='photographer', surfer_id='owner',
            live_session_id='live', status='cancelled' if scope == 'cancelled' else 'active',
            photos_credit_remaining=0 if scope == 'spent' else 1)
        session.add(member); session.commit()

        class Facade:
            async def execute(self, statement): return session.execute(statement)

        async def reserve():
            return await E.consume_live_photo_credit('other' if scope == 'other-session' else 'live',
                'foreign' if scope == 'foreign' else 'owner', Facade())

        if scope == 'owner':
            asyncio.run(reserve())
            assert session.scalar(select(Participant.photos_credit_remaining)) == 0
            with pytest.raises(HTTPException) as exhausted: asyncio.run(reserve())
            assert exhausted.value.status_code == 409
            session.rollback()
            assert session.scalar(select(Participant.photos_credit_remaining)) == 1
        else:
            with pytest.raises(HTTPException) as denied: asyncio.run(reserve())
            assert denied.value.status_code == 409
            assert session.scalar(select(Participant.photos_credit_remaining)) == (0 if scope == 'spent' else 1)
    engine.dispose()
