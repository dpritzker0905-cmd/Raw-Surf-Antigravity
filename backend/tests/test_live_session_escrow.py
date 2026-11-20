"""A live-session buy-in holds the photographer's share until the buyer acts on the delivered media.

Policy (owner, 2026-10-08): leave within 10 minutes for a full refund; the photographer's 80% is held
from the join and released when the buyer acts on their delivered gallery (not merely views it), or
7 days after the join; an early-leave refund cancels the hold, once per surfer per session.
Real JWT + HTTP for join and leave, an ephemeral SQLite ORM, and the real release sweep.
"""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import CreditTransaction, LiveSessionParticipant, PaymentTransaction, Profile, RoleEnum, SurferGalleryItem, SurferPhotoSubscription, SurferSelectionQuota
from routes.bookings import booking_lifecycle
from routes.sessions import join as session_join
from routes.sessions import payments
from routes.sessions.schemas import JoinSessionRequest
from services import live_session_escrow as escrow

BUYIN, SHARE = 25.0, 20.0


def bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


@pytest_asyncio.fixture
async def harness(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'escrow.sqlite'}")

    def create_all(sync_connection):
        for table in Base.metadata.sorted_tables:
            try:
                table.create(sync_connection, checkfirst=True)
            except Exception:  # tables this test never reads may use types sqlite cannot create
                pass

    async with engine.begin() as connection:
        await connection.run_sync(create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(Profile(id='owner', user_id='owner', email='owner@example.invalid', role=RoleEnum.SURFER,
                       full_name='Owner', credit_balance=100.0))
        for pid, role in (('pro', RoleEnum.PHOTOGRAPHER), ('hobby', RoleEnum.HOBBYIST)):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', role=role, full_name=pid.title(),
                           credit_balance=30.0, withdrawable_credits=0.0, gear_only_credits=0.0,
                           is_shooting=True, live_buyin_price=BUYIN))
        await db.commit()

    app = FastAPI()
    app.include_router(session_join.router, prefix='/api')
    app.include_router(booking_lifecycle.router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield SimpleNamespace(client=client, maker=maker)
    await engine.dispose()


@pytest.mark.parametrize("emulate", [False, True])
async def test_card_join_creates_checkout_with_configured_provider(harness, monkeypatch, emulate):
    provider_url = "https://checkout.stripe.com/c/pay/fixture"
    hosted = Mock(return_value=SimpleNamespace(id="cs_test_hosted_fixture", url=provider_url))
    emulated = Mock(return_value={
        "checkout_session_id": "cs_test_emulated_fixture",
        "url": provider_url, "payment_intent_id": "pi_test_fixture",
    })
    monkeypatch.setattr(session_join, "STRIPE_API_KEY", "test-fixture")
    monkeypatch.setattr(payments, "checkout_emulation_allowed", lambda: emulate)
    monkeypatch.setattr(session_join.stripe.checkout.Session, "create", hosted)
    monkeypatch.setattr(session_join.stripe_mcp_server, "stripe_create_checkout_session", emulated)

    response = await harness.client.post(
        "/api/sessions/join?surfer_id=owner", headers=bearer("owner"),
        json={"photographer_id": "pro", "payment_method": "card", "origin_url": "https://dev--rawsurf.netlify.app"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["requires_payment"] is True
    assert response.json()["checkout_url"] == provider_url
    async with harness.maker() as db:
        payment = (await db.scalars(select(PaymentTransaction))).one()
        assert payment.session_id == response.json()["session_id"]
        assert payment.user_id == "owner"
        assert payment.amount == BUYIN and payment.currency == "usd"
        assert payment.payment_status == "Pending"
        saved = json.loads(payment.transaction_metadata)
        assert (await db.scalars(select(LiveSessionParticipant))).all() == []
    if emulate:
        hosted.assert_not_called()
        emulated.assert_called_once()
        assert saved["checkout_provider"] == "emulator"
        assert saved["emulator_payment_intent"] == "pi_test_fixture"
    else:
        emulated.assert_not_called()
        hosted.assert_called_once()
        request = hosted.call_args.kwargs
        assert request["line_items"][0]["price_data"]["unit_amount"] == 2500
        assert request["mode"] == "payment"
        assert request["success_url"].endswith("checkout_session_id={CHECKOUT_SESSION_ID}")
        assert saved["checkout_provider"] == "stripe"
        assert saved["checkout_reference"] == request["client_reference_id"]


async def test_card_join_refuses_an_untrusted_return_origin(harness, monkeypatch):
    hosted = Mock()
    monkeypatch.setattr(session_join, "STRIPE_API_KEY", "test-fixture")
    monkeypatch.setattr(payments, "checkout_emulation_allowed", lambda: False)
    monkeypatch.setattr(session_join.stripe.checkout.Session, "create", hosted)

    response = await harness.client.post(
        "/api/sessions/join?surfer_id=owner", headers=bearer("owner"),
        json={"photographer_id": "pro", "payment_method": "card", "origin_url": "https://example.invalid"},
    )
    assert response.status_code == 400
    hosted.assert_not_called()


@pytest.mark.parametrize("selected_method", ["card", "credits"])
async def test_subscription_coverage_bypasses_selected_payment_method(harness, monkeypatch, selected_method):
    hosted = Mock()
    emulated = Mock()
    monkeypatch.setattr(session_join, "STRIPE_API_KEY", "test-fixture")
    monkeypatch.setattr(session_join.stripe.checkout.Session, "create", hosted)
    monkeypatch.setattr(session_join.stripe_mcp_server, "stripe_create_checkout_session", emulated)
    async with harness.maker() as db:
        db.add(SurferPhotoSubscription(
            id="included-buyin", surfer_id="owner", photographer_id="pro",
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            live_session_buyins_remaining=1, amount_paid=BUYIN, payment_method="credits",
        ))
        await db.commit()

    response = await harness.client.post(
        "/api/sessions/join?surfer_id=owner", headers=bearer("owner"),
        json={"photographer_id": "pro", "payment_method": selected_method},
    )
    assert response.status_code == 200, response.text
    assert response.json()["subscription_covered"] is True
    assert response.json()["amount_paid"] == 0
    assert not response.json().get("requires_payment")
    hosted.assert_not_called()
    emulated.assert_not_called()
    async with harness.maker() as db:
        seat = (await db.scalars(select(LiveSessionParticipant))).one()
        assert seat.payment_method == "subscription"
        assert seat.payment_credit_transaction_id is None
        assert seat.escrow_status is None
        assert (await db.get(SurferPhotoSubscription, "included-buyin")).live_session_buyins_remaining == 0
        assert (await db.get(Profile, "owner")).credit_balance == 100
        assert (await db.scalars(select(CreditTransaction))).all() == []
        assert (await db.scalars(select(PaymentTransaction))).all() == []


async def join(h, photographer='pro'):
    response = await h.client.post('/api/sessions/join?surfer_id=owner', headers=bearer('owner'),
                                   json={'photographer_id': photographer, 'payment_method': 'credits'})
    assert response.status_code == 200, response.text
    async with h.maker() as db:
        return (await db.execute(select(LiveSessionParticipant).where(LiveSessionParticipant.surfer_id == 'owner')
                                 .order_by(LiveSessionParticipant.joined_at.desc()))).scalars().first()


async def leave(h, participant):
    response = await h.client.post(f'/api/sessions/leave/{participant.id}', headers=bearer('owner'))
    assert response.status_code == 200, response.text
    return response.json()


async def sweep(h, now=None):
    async with h.maker() as db:
        counts = await escrow.release_due(db, now=now)
        await db.commit()
    return counts


async def read(h, model, key):
    async with h.maker() as db:
        return (await db.execute(select(model).where(model.id == key))).scalar_one()


async def earnings(h, photographer='pro'):
    async with h.maker() as db:
        return (await db.execute(select(CreditTransaction).where(
            CreditTransaction.user_id == photographer,
            CreditTransaction.transaction_type == 'live_session_earning'))).scalars().all()


async def deliver(h, participant, **signals):
    """One item delivered to the buyer's gallery for this session, with the given buyer signals."""
    async with h.maker() as db:
        item = SurferGalleryItem(surfer_id='owner', gallery_item_id='gi-1', photographer_id=participant.photographer_id,
                                 live_session_id=participant.live_session_id, **signals)
        db.add(item)
        await db.commit()


@pytest.mark.parametrize('photographer', ['pro', 'hobby'])
async def test_join_holds_the_share_and_pays_nothing_yet(harness, photographer):
    participant = await join(harness, photographer)
    profile = await read(harness, Profile, photographer)
    assert (participant.escrow_status, participant.escrow_amount) == ('held', pytest.approx(SHARE))
    assert (profile.credit_balance, profile.withdrawable_credits, profile.gear_only_credits) == (30.0, 0.0, 0.0)
    assert await earnings(harness, photographer) == []



def test_join_schema_refuses_an_unrecognized_payment_method():
    with pytest.raises(ValidationError, match="payment_method"):
        JoinSessionRequest(photographer_id="pro", payment_method="unrecognized")


@pytest.mark.parametrize("available", [False, True])
async def test_subscription_join_requires_available_quota(harness, available):
    if available:
        async with harness.maker() as db:
            db.add(SurferPhotoSubscription(
                id="test-subscription", surfer_id="owner", photographer_id="pro",
                expires_at=datetime.now(timezone.utc) + timedelta(days=1),
                live_session_buyins_remaining=1, amount_paid=BUYIN, payment_method="credits",
            ))
            await db.commit()

    response = await harness.client.post(
        "/api/sessions/join?surfer_id=owner", headers=bearer("owner"),
        json={"photographer_id": "pro", "payment_method": "subscription"},
    )

    async with harness.maker() as db:
        assert (await db.scalars(select(CreditTransaction))).all() == []
        seats = (await db.scalars(select(LiveSessionParticipant))).all()
        if available:
            assert response.status_code == 200, response.text
            assert response.json()["subscription_covered"] is True
            assert len(seats) == 1 and seats[0].amount_paid == 0
            assert seats[0].escrow_status is None
            subscription = await db.get(SurferPhotoSubscription, "test-subscription")
            assert subscription.live_session_buyins_remaining == 0
        else:
            assert response.status_code == 400, response.text
            assert seats == []


@pytest.mark.parametrize("durable", [False, True], ids=["rolled-back", "committed"])
async def test_join_resolves_an_ambiguous_commit_without_refunding(harness, monkeypatch, durable):
    original_commit = AsyncSession.commit

    async def uncertain_commit(session):
        if durable:
            await original_commit(session)
        raise ConnectionError("Fixture could not confirm the commit")

    monkeypatch.setattr(AsyncSession, "commit", uncertain_commit)
    response = await harness.client.post(
        "/api/sessions/join?surfer_id=owner", headers=bearer("owner"),
        json={"photographer_id": "pro", "payment_method": "credits"},
    )

    async with harness.maker() as db:
        seats = (await db.scalars(select(LiveSessionParticipant))).all()
        ledger = (await db.scalars(select(CreditTransaction))).all()
        owner = await db.get(Profile, "owner")

    if durable:
        assert response.status_code == 200, response.text
        assert response.json()["recovered"] is True
        assert len(seats) == 1 and response.json()["session_id"] == seats[0].id
        assert (seats[0].escrow_status, seats[0].escrow_amount) == ("held", SHARE)
        assert len(ledger) == 1 and ledger[0].id == seats[0].payment_credit_transaction_id
        assert ledger[0].amount == -BUYIN
        assert owner.credit_balance == 100.0 - BUYIN
    else:
        assert response.status_code == 503, response.text
        assert response.json() == {
            "detail": "Could not confirm the session join. Check your session before retrying.",
        }
        assert seats == []
        assert ledger == []
        assert owner.credit_balance == 100.0


async def test_early_leave_refunds_the_buyer_and_cancels_the_hold(harness):
    participant = await join(harness)
    body = await leave(harness, participant)
    assert body['refunded'] is True and body['refund_amount'] == pytest.approx(BUYIN)
    assert (await read(harness, Profile, 'owner')).credit_balance == pytest.approx(100.0)
    assert (await read(harness, LiveSessionParticipant, participant.id)).escrow_status == 'cancelled'
    assert (await read(harness, Profile, 'pro')).credit_balance == 30.0
    assert await sweep(harness, now=datetime.now(timezone.utc) + timedelta(days=8)) == {'acted': 0, 'auto_7d': 0}


async def test_a_second_early_leave_in_the_same_session_is_not_refunded(harness):
    await leave(harness, await join(harness))
    second = await join(harness)
    body = await leave(harness, second)
    assert body['refunded'] is False
    assert (await read(harness, Profile, 'owner')).credit_balance == pytest.approx(100.0 - BUYIN)
    assert (await read(harness, LiveSessionParticipant, second.id)).escrow_status == 'held'


@pytest.mark.parametrize('signals', [
    {'is_favorite': True},
    {'downloaded_at': datetime.now(timezone.utc)},
    {'surfer_confirmed': True},
    {'surfer_rejected': True},
    {'visibility_changed_at': datetime.now(timezone.utc)},
])
async def test_buyer_action_on_delivered_media_releases_the_share(harness, signals):
    participant = await join(harness)
    await deliver(harness, participant, **signals)
    assert await sweep(harness) == {'acted': 1, 'auto_7d': 0}
    pro = await read(harness, Profile, 'pro')
    assert (pro.credit_balance, pro.withdrawable_credits) == (pytest.approx(30.0 + SHARE), pytest.approx(SHARE))
    assert (await read(harness, LiveSessionParticipant, participant.id)).escrow_status == 'released'
    assert [e.amount for e in await earnings(harness)] == [pytest.approx(SHARE)]


async def test_selecting_included_photos_releases_the_share(harness):
    participant = await join(harness)
    async with harness.maker() as db:
        db.add(SurferSelectionQuota(surfer_id='owner', photographer_id='pro', live_session_id=participant.live_session_id,
                                    photos_allowed=3, photos_selected=1))
        await db.commit()
    assert await sweep(harness) == {'acted': 1, 'auto_7d': 0}


async def test_viewing_or_untouched_media_does_not_release(harness):
    participant = await join(harness)
    await deliver(harness, participant, viewed_at=datetime.now(timezone.utc))
    assert await sweep(harness, now=datetime.now(timezone.utc) + timedelta(days=6)) == {'acted': 0, 'auto_7d': 0}
    assert (await read(harness, LiveSessionParticipant, participant.id)).escrow_status == 'held'


async def test_media_delivered_before_this_join_does_not_release_it(harness):
    participant = await join(harness)
    await deliver(harness, participant, is_favorite=True, added_at=participant.joined_at - timedelta(days=2))
    assert await sweep(harness) == {'acted': 0, 'auto_7d': 0}


async def test_seven_days_without_action_releases_to_the_photographer(harness):
    participant = await join(harness, 'hobby')
    assert await sweep(harness, now=datetime.now(timezone.utc) + timedelta(days=7, minutes=1)) == {'acted': 0, 'auto_7d': 1}
    hobby = await read(harness, Profile, 'hobby')
    assert (hobby.credit_balance, hobby.gear_only_credits) == (pytest.approx(30.0 + SHARE), pytest.approx(SHARE))
    assert (await read(harness, LiveSessionParticipant, participant.id)).escrow_status == 'released'


async def test_a_released_share_is_paid_once_and_not_refunded_by_a_late_leave(harness):
    participant = await join(harness)
    await deliver(harness, participant, is_favorite=True)
    await sweep(harness)
    await sweep(harness, now=datetime.now(timezone.utc) + timedelta(days=8))
    body = await leave(harness, participant)
    assert body['refunded'] is False
    assert len(await earnings(harness)) == 1
    assert (await read(harness, Profile, 'pro')).credit_balance == pytest.approx(30.0 + SHARE)
    assert (await read(harness, Profile, 'owner')).credit_balance == pytest.approx(100.0 - BUYIN)


async def test_two_concurrent_releases_of_the_same_row_pay_once(harness):
    participant = await join(harness)
    async with harness.maker() as first, harness.maker() as second:
        row_a = await first.get(LiveSessionParticipant, participant.id)
        row_b = await second.get(LiveSessionParticipant, participant.id)  # both loaded while still held
        assert await escrow.release(first, row_a, 'acted') is True
        await first.commit()
        assert await escrow.release(second, row_b, 'acted') is False
        await second.commit()
    assert len(await earnings(harness)) == 1
    assert (await read(harness, Profile, 'pro')).credit_balance == pytest.approx(30.0 + SHARE)


async def test_an_early_leave_cannot_cancel_a_share_released_concurrently(harness):
    participant = await join(harness)
    async with harness.maker() as sweeper, harness.maker() as leaver:
        stale = await leaver.get(LiveSessionParticipant, participant.id)
        assert await escrow.release(sweeper, await sweeper.get(LiveSessionParticipant, participant.id), 'acted')
        await sweeper.commit()
        assert await escrow.cancel_for_early_leave(leaver, stale) is False


async def test_a_row_from_before_escrow_keeps_its_promised_refund(harness):
    async with harness.maker() as db:
        legacy = LiveSessionParticipant(photographer_id='pro', surfer_id='owner', amount_paid=BUYIN,
                                        payment_method='credits', status='active')
        db.add(legacy)
        await db.commit()
    body = await leave(harness, legacy)
    assert body['refunded'] is True
    assert (await read(harness, Profile, 'owner')).credit_balance == pytest.approx(100.0 + BUYIN)


def test_hold_rounds_to_cents_and_skips_free_joins():
    paid, free = SimpleNamespace(), SimpleNamespace()
    escrow.hold(paid, 12.345)
    escrow.hold(free, 0)
    assert (paid.escrow_amount, paid.escrow_status) == (9.88, 'held')
    assert (free.escrow_amount, free.escrow_status) == (0.0, None)
