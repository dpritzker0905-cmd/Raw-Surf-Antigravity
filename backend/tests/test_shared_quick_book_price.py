"""Targeted on-demand checkout uses one personal seat and records each guest's amount."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from models import (CreditTransaction, DispatchRequest, DispatchRequestParticipant, Notification,
                    Profile, RoleEnum, SurferPhotoSubscription)
from routes.dispatch import crew, sessions
from tests.test_audit_money_route_authority import bearer, harness

CAPTAIN, PRO = "victim", "attacker"
TERMS = {"target_photographer_id": PRO, "estimated_duration_hours": 1, "friend_ids": ["north", "south"]}


@pytest_asyncio.fixture
async def shared(harness, monkeypatch):
    app, client, maker = harness
    app.include_router(crew.router, prefix="/api")
    async with maker.begin() as db:
        pro = await db.get(Profile, PRO)
        pro.on_demand_available, pro.on_demand_hourly_rate, pro.price_per_additional_surfer = True, 75, 15
        for guest in TERMS["friend_ids"]:
            db.add(Profile(id=guest, user_id=guest, email=guest + "@example.invalid",
                           role=RoleEnum.SURFER, credit_balance=100, full_name=guest.title()))
        db.add(SurferPhotoSubscription(id="plan", surfer_id=CAPTAIN, photographer_id=PRO,
               status="active", amount_paid=10, sessions_remaining=1, live_session_buyins_remaining=2,
               on_demand_discount_pct=20, expires_at=datetime.now(timezone.utc) + timedelta(days=2)))
    # Exercise the real crew notification task with the same isolated database.
    monkeypatch.setattr("database.async_session_maker", maker)
    monkeypatch.setattr("routes.notifications.push.send_push_notification", AsyncMock())
    monkeypatch.setattr(sessions, "process_dispatch_notifications", AsyncMock())
    monkeypatch.setattr(sessions, "check_and_send_spending_alert", AsyncMock())
    provider = Mock(side_effect=AssertionError("unexpected payment intent"))
    monkeypatch.setattr(sessions.stripe.PaymentIntent, "create", provider)
    return client, maker, provider


async def preview(client, terms):
    response = await client.post("/api/dispatch/shared-quote", headers=bearer(CAPTAIN), json=terms)
    assert response.status_code == 200, response.text
    return response.json()


async def create(client, terms, quote_id):
    return await client.post("/api/dispatch/request?requester_id=victim", headers=bearer(CAPTAIN), json={
        **terms, "is_shared": True, "latitude": 1, "longitude": 1, "accepted_shared_quote": quote_id,
    })


async def test_included_session_covers_captain_and_guest_pays_the_invited_amount(shared):
    client, maker, provider = shared
    quote = await preview(client, TERMS)
    assert quote["gross_cents"] == 10500 and quote["total_cents"] == 7000
    assert quote["captain_cents"] == 0 and quote["crew_cents"] == {"north": 3500, "south": 3500}
    result = await create(client, TERMS, quote["quote_id"])
    assert result.status_code == 200, result.text
    dispatch_id = result.json()["id"]
    paid = await client.post(f"/api/dispatch/{dispatch_id}/pay?payer_id=victim", headers=bearer(CAPTAIN))
    assert paid.status_code == 200, paid.text
    async with maker() as db:
        record = await db.get(DispatchRequest, dispatch_id)
        assert (record.captain_share_amount, record.deposit_amount, record.estimated_total) == (0, 0, 70)
        assert (await db.get(Profile, CAPTAIN)).credit_balance == 100
        plan = await db.get(SurferPhotoSubscription, "plan")
        assert (plan.sessions_remaining, plan.live_session_buyins_remaining) == (0, 2)
        notices = (await db.scalars(select(Notification).where(Notification.type == "crew_session_invite"))).all()
        assert {n.user_id for n in notices if "$35.00" in n.body} == {"north","south"}
    for guest in ("north", "south"):
        listing = await client.get(f"/api/dispatch/user/{guest}/crew-invites", headers=bearer(guest))
        invite, = listing.json()["crew_invites"]
        assert "Raw Surf wallet" in invite["cancellation_notice"]
        assert invite["your_share"] == 35
        response = await client.post(f"/api/dispatch/crew-invite/{invite['id']}/pay?payer_id={guest}",
                                     headers=bearer(guest))
        assert response.status_code == 200, response.text
        assert response.json()["remaining_credits"] == 65
    async with maker() as db:
        amounts = (await db.scalars(select(CreditTransaction.amount))).all()
        assert sorted(amounts) == [-35, -35]
    provider.assert_not_called()


@pytest.mark.parametrize("guests,units,captain,benefit,net", [
    ([{"user_id":"north","covered_by_captain":True}], 1, 3500, 3500, 7000),
    ([{"user_id":"north","share_amount":60},{"user_id":"south","share_amount":45}], 1, 0, 0, 10500),
    ([{"user_id":"north","share_amount":40},{"user_id":"south","share_amount":45}], 1, 0, 2000, 8500),
    ([], 0, 2800, 700, 9800),
])
async def test_personal_benefit_is_bounded_by_own_seat_and_obligation(shared, guests, units, captain, benefit, net):
    client, maker, provider = shared
    async with maker.begin() as db:
        (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining = units
    terms = {**TERMS, "crew_shares": guests}
    quote = await preview(client, terms)
    assert (quote["captain_cents"], quote["benefit_cents"], quote["total_cents"]) == (captain, benefit, net)
    result = await create(client, terms, quote["quote_id"])
    assert result.status_code == 200, result.text
    async with maker() as db:
        assert (await db.get(DispatchRequest, result.json()["id"])).estimated_total == net / 100
        rows = (await db.scalars(select(DispatchRequestParticipant))).all()
        assert {r.participant_id: round(r.share_amount * 100) for r in rows} == quote["crew_cents"]
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == units - int(quote["subscription_covered"])
    provider.assert_not_called()


async def test_rate_or_roster_change_requires_review_before_spending(shared):
    client, maker, provider = shared
    quote = await preview(client, TERMS)
    for edited in ({"friend_ids":["north"]}, {"crew_shares":[{"user_id":"north","share_percent":50}]}):
        assert (await create(client, {**TERMS, **edited}, quote["quote_id"])).status_code == 409
    async with maker.begin() as db:
        pro = await db.get(Profile, PRO)
        pro.on_demand_hourly_rate, pro.price_per_additional_surfer = 75.01, 0
    assert (await create(client, TERMS, quote["quote_id"])).status_code == 409
    fresh = await preview(client, TERMS)
    assert fresh["crew_cents"] == {"north":2500,"south":2500} and fresh["benefit_cents"] == 2501
    async with maker() as db:
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 1
        assert await db.scalar(select(func.count()).select_from(DispatchRequest)) == 0
    provider.assert_not_called()

async def test_captain_covering_a_guest_pays_only_that_share_by_card(shared, monkeypatch):
    client, maker, unused_intent = shared
    terms = {**TERMS, "crew_shares": [{"user_id": "north", "covered_by_captain": True}]}
    quote = await preview(client, terms)
    result = await create(client, terms, quote["quote_id"])
    assert result.status_code == 200, result.text
    dispatch_id = result.json()["id"]
    checkout = Mock(return_value=SimpleNamespace(id="cs_fixture", url="https://fixture.invalid/checkout"))
    monkeypatch.setattr(sessions.stripe, "api_key", "fixture")
    monkeypatch.setattr(sessions.stripe.checkout.Session, "create", checkout)
    response = await client.post("/api/dispatch/checkout", headers=bearer(CAPTAIN), json={
        "dispatch_id": dispatch_id, "payer_id": CAPTAIN, "origin_url": "https://fixture.invalid"})
    assert response.status_code == 200, response.text
    assert checkout.call_args.kwargs["line_items"][0]["price_data"]["unit_amount"] == 3500
    async with maker() as db:
        assert (await db.get(DispatchRequest, dispatch_id)).estimated_total == 70
        assert (await db.get(Profile, CAPTAIN)).credit_balance == 100
    unused_intent.assert_not_called()


async def test_two_remainder_cents_go_to_two_seats_and_survive_roster_reordering(shared):
    client, maker, _ = shared
    async with maker.begin() as db:
        pro = await db.get(Profile, PRO)
        pro.on_demand_hourly_rate, pro.price_per_additional_surfer = 75.02, 0
    first = await preview(client, TERMS)
    reverse = await preview(client, {**TERMS, "friend_ids": ["south", "north"]})
    assert first == reverse
    assert first["benefit_cents"] == 2501 and first["crew_cents"] == {"north":2501, "south":2500}
    assert first["captain_cents"] + sum(first["crew_cents"].values()) + first["benefit_cents"] == 7502


@pytest.mark.parametrize("plan_percent,expected_captain", [(None, 3500), (80, 1750)])
async def test_absent_plan_and_capped_discount_preserve_guest_shares(shared, plan_percent, expected_captain):
    client, maker, provider = shared
    async with maker.begin() as db:
        plan = await db.get(SurferPhotoSubscription, "plan")
        if plan_percent is None:
            await db.delete(plan)
        else:
            plan.sessions_remaining = 0
            plan.on_demand_discount_pct = plan_percent
    quote = await preview(client, TERMS)
    assert quote["captain_cents"] == expected_captain
    assert quote["crew_cents"] == {"north": 3500, "south": 3500}
    result = await create(client, TERMS, quote["quote_id"])
    assert result.status_code == 200, result.text
    provider.assert_not_called()


@pytest.mark.parametrize("ending", ["cancel", "expire", "decline"])
async def test_shared_booking_returns_exactly_one_session(shared, harness, monkeypatch, ending):
    from models import DispatchRequestStatusEnum as Status
    from routes.dispatch import dispatch_transitions, lifecycle
    from scheduler.financial import cleanup_abandoned_stripe_sessions_task

    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    app.include_router(lifecycle.router, prefix="/api")
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    quote = await preview(client, TERMS)
    response = await create(client, TERMS, quote["quote_id"])
    dispatch_id = response.json()["id"]
    async with maker.begin() as db:
        dispatch = await db.get(DispatchRequest, dispatch_id)
        dispatch.pending_payment_expires_at = datetime.now(timezone.utc) - timedelta(minutes=2)
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 0

    for attempt in range(2):
        if ending == "cancel":
            result = await client.post(f"/api/dispatch/{dispatch_id}/cancel",
                                       json={}, headers=bearer(CAPTAIN))
            assert result.status_code == (400 if attempt else 200), result.text
        elif ending == "decline":
            result = await client.post(f"/api/dispatch/{dispatch_id}/decline?photographer_id={PRO}",
                                       headers=bearer(PRO))
            assert result.status_code == 200, result.text
        else:
            await cleanup_abandoned_stripe_sessions_task()
    async with maker() as db:
        assert (await db.get(DispatchRequest, dispatch_id)).status == Status.CANCELLED
        plan = await db.get(SurferPhotoSubscription, "plan")
        assert (plan.sessions_remaining, plan.live_session_buyins_remaining) == (1, 2)
        assert (await db.get(Profile, CAPTAIN)).credit_balance == 100


async def test_cancel_restores_original_plan_after_replacement_and_rollback(shared, harness):
    from routes.dispatch import dispatch_transitions
    from services.shared_dispatch_allowance import return_included_session

    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    dispatch_id = (await create(client, TERMS, (await preview(client, TERMS))["quote_id"])).json()["id"]
    async with maker.begin() as db:
        (await db.get(SurferPhotoSubscription, "plan")).status = "expired"
        db.add(SurferPhotoSubscription(id="replacement", surfer_id=CAPTAIN, photographer_id=PRO,
               status="active", amount_paid=10, sessions_remaining=5,
               expires_at=datetime.now(timezone.utc) + timedelta(days=30)))
    async with maker() as db:
        dispatch = await db.get(DispatchRequest, dispatch_id, with_for_update=True)
        await return_included_session(db, dispatch, datetime.now(timezone.utc))
        await db.rollback()
    async with maker() as db:
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 0
        assert (await db.get(DispatchRequest, dispatch_id)).included_session_restored_at is None
    url = f"/api/dispatch/{dispatch_id}/cancel"
    assert (await client.post(url, json={}, headers=bearer("north"))).status_code == 403
    assert (await client.post(url, json={}, headers=bearer(CAPTAIN))).status_code == 200
    async with maker() as db:
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 1
        assert (await db.get(SurferPhotoSubscription, "replacement")).sessions_remaining == 5


@pytest.mark.parametrize("state,expected", [("completed", 0), ("discount", 0), ("paid_searching", 1)])
async def test_only_cancelled_debited_request_returns_allowance(shared, harness, state, expected):
    from models import DispatchRequestStatusEnum as Status
    from routes.dispatch import dispatch_transitions

    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    if state == "discount":
        async with maker.begin() as db:
            (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining = 0
    dispatch_id = (await create(client, TERMS, (await preview(client, TERMS))["quote_id"])).json()["id"]
    if state == "completed":
        async with maker.begin() as db:
            (await db.get(DispatchRequest, dispatch_id)).status = Status.COMPLETED
    if state == "paid_searching":
        payment = await client.post(f"/api/dispatch/{dispatch_id}/pay?payer_id=victim", headers=bearer(CAPTAIN))
        assert payment.status_code == 200
    response = await client.post(f"/api/dispatch/{dispatch_id}/cancel", json={}, headers=bearer(CAPTAIN))
    assert response.status_code == (400 if state == "completed" else 200)
    async with maker() as db:
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == expected


@pytest.mark.parametrize("provider_state", ["open", "paid", "unknown", "expired"])
async def test_card_expiry_requires_definitive_unpaid_checkout(shared, harness, monkeypatch, provider_state):
    from models import DispatchRequestStatusEnum as Status, PaymentTransaction
    from scheduler.financial import cleanup_abandoned_stripe_sessions_task
    app, client, maker = harness
    terms = {**TERMS, "crew_shares": [{"user_id": "north", "covered_by_captain": True}]}
    dispatch_id = (await create(client, terms, (await preview(client, terms))["quote_id"])).json()["id"]
    checkout = SimpleNamespace(id="cs_fixture", url="https://fixture.invalid/card", status="open", payment_status="unpaid")
    checkout.metadata = {"dispatch_id":dispatch_id,"type":"on_demand_dispatch","user_id":CAPTAIN}
    checkout.currency, checkout.amount_total = "usd", 3500
    close = SimpleNamespace(**{**vars(checkout), "status":"expired"})
    monkeypatch.setattr(sessions.stripe.checkout.Session, "expire", Mock(return_value=close))
    monkeypatch.setattr("routes.dispatch.dispatch_matching.process_dispatch_notifications", AsyncMock())
    create_mock = Mock(return_value=checkout)
    monkeypatch.setattr(sessions.stripe.checkout.Session, "create", create_mock)
    monkeypatch.setattr(sessions.stripe.checkout.Session, "retrieve", Mock(return_value=checkout))
    monkeypatch.setenv("STRIPE_SECRET_KEY", "fixture")
    monkeypatch.setattr(sessions.stripe, "api_key", "fixture")
    for _ in range(2):
        response = await client.post("/api/dispatch/checkout", headers=bearer(CAPTAIN), json={
            "dispatch_id": dispatch_id, "payer_id": CAPTAIN, "origin_url": "https://fixture.invalid"})
        assert response.status_code == 200, response.text
    create_mock.assert_called_once()
    checkout.status = "complete"
    blocked = await client.post("/api/dispatch/checkout", headers=bearer(CAPTAIN), json={
        "dispatch_id":dispatch_id,"payer_id":CAPTAIN,"origin_url":"https://fixture.invalid"})
    assert blocked.status_code == 409, blocked.text
    checkout.status = "open"
    async with maker.begin() as db:
        past = datetime.now(timezone.utc) - timedelta(minutes=45)
        (await db.get(DispatchRequest, dispatch_id)).pending_payment_expires_at = past
        (await db.scalar(select(PaymentTransaction))).created_at = past
    if provider_state == "unknown":
        monkeypatch.setattr(sessions.stripe.checkout.Session, "retrieve", Mock(side_effect=TimeoutError))
    elif provider_state == "paid":
        checkout.status, checkout.payment_status = "complete", "paid"
    elif provider_state == "expired":
        checkout.status = "expired"
    for _ in range(2):
        await cleanup_abandoned_stripe_sessions_task()
    expired = provider_state in ("open", "expired")
    paid = provider_state == "paid"
    async with maker() as db:
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == int(expired)
        assert (await db.get(DispatchRequest, dispatch_id)).status == (Status.CANCELLED if expired else Status.SEARCHING_FOR_PRO if paid else Status.PENDING_PAYMENT)
        assert (await db.scalar(select(PaymentTransaction.payment_status))) == ("Expired" if expired else "Completed" if paid else "Pending")


async def test_unknown_card_creation_keeps_allowance_reserved_and_reuses_attempt(shared, harness, monkeypatch):
    from models import DispatchRequestStatusEnum as Status
    from routes.dispatch import dispatch_transitions
    from services.shared_dispatch_allowance import expire_due_included_sessions

    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    terms = {**TERMS, "crew_shares": [{"user_id": "north", "covered_by_captain": True}]}
    dispatch_id = (await create(client, terms, (await preview(client, terms))["quote_id"])).json()["id"]
    session = SimpleNamespace(id="cs_retry", url="https://fixture.invalid/retry")
    provider = Mock(side_effect=[sessions.stripe.error.APIConnectionError("fixture timeout"), session])
    monkeypatch.setattr(sessions.stripe, "api_key", "fixture")
    monkeypatch.setattr(sessions.stripe.checkout.Session, "create", provider)
    pay = {"dispatch_id": dispatch_id, "payer_id": CAPTAIN, "origin_url": "https://fixture.invalid"}
    first = await client.post("/api/dispatch/checkout", json=pay, headers=bearer(CAPTAIN))
    assert first.status_code == 500
    cancel = f"/api/dispatch/{dispatch_id}/cancel"
    assert (await client.post(cancel, json={}, headers=bearer(CAPTAIN))).status_code == 409
    await expire_due_included_sessions(maker, None, datetime.now(timezone.utc)+timedelta(days=1))
    async with maker() as db:
        assert (await db.get(DispatchRequest, dispatch_id)).status == Status.PENDING_PAYMENT
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 0

    retry = await client.post("/api/dispatch/checkout", json=pay, headers=bearer(CAPTAIN))
    assert retry.status_code == 200, retry.text
    assert [c.kwargs["idempotency_key"] for c in provider.call_args_list] == [f"shared-quick-book-{dispatch_id}"] * 2
    closed = Mock(return_value=SimpleNamespace(id=session.id, status="expired", payment_status="unpaid"))
    monkeypatch.setattr(sessions.stripe.checkout.Session, "expire", closed)
    assert (await client.post(cancel, json={}, headers=bearer(CAPTAIN))).status_code == 200
    assert (await client.post(cancel, json={}, headers=bearer(CAPTAIN))).status_code == 400
    closed.assert_called_once_with(session.id)
    async with maker() as db:
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 1
        assert (await db.get(Profile, CAPTAIN)).credit_balance == 100


@pytest.mark.parametrize("outcome", ["absent", "open", "paid", "paid_during_close", "partial_scan", "wrong_amount"])
async def test_deadline_reconciles_unlinked_card_attempt(shared, monkeypatch, outcome):
    from models import DispatchRequestStatusEnum as Status, PaymentTransaction
    from services.shared_dispatch_allowance import expire_due_included_sessions

    client, maker, _ = shared
    terms = {**TERMS, "crew_shares": [{"user_id":"north","covered_by_captain":True}]}
    dispatch_id = (await create(client, terms, (await preview(client, terms))["quote_id"])).json()["id"]
    now = datetime.now(timezone.utc)
    async with maker.begin() as db:
        row = await db.get(DispatchRequest, dispatch_id)
        row.included_checkout_started_at = now - timedelta(hours=3)
        row.pending_payment_expires_at = now - timedelta(hours=2)
    provider = Mock()
    paid = outcome in ("paid", "paid_during_close")
    found = SimpleNamespace(id="cs_recovered", amount_total=800 if outcome == "wrong_amount" else 3500,
        currency="usd", metadata={"type":"on_demand_dispatch","dispatch_id":dispatch_id,"user_id":CAPTAIN},
        status="complete" if outcome == "paid" else "open", payment_status="paid" if outcome == "paid" else "unpaid")
    def pages():
        yield SimpleNamespace(metadata={"dispatch_id":"another"})
        if outcome == "partial_scan":
            raise TimeoutError
        if outcome != "absent":
            yield found
    provider.list.return_value.auto_paging_iter.side_effect = pages
    provider.expire.return_value = SimpleNamespace(**{**vars(found), "status":"expired"})
    if outcome == "paid_during_close":
        provider.expire.side_effect = TimeoutError()
        provider.retrieve.return_value = SimpleNamespace(**{**vars(found), "status":"complete", "payment_status":"paid"})
    monkeypatch.setattr("routes.dispatch.dispatch_matching.process_dispatch_notifications", AsyncMock())
    for _ in range(2):
        await expire_due_included_sessions(maker, provider, now)
    restored = outcome in ("absent", "open")
    async with maker() as db:
        record = await db.get(DispatchRequest, dispatch_id)
        assert record.status == (Status.CANCELLED if restored else Status.SEARCHING_FOR_PRO if paid else Status.PENDING_PAYMENT)
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == int(restored)
        assert await db.scalar(select(func.count()).select_from(CreditTransaction)) == int(paid)
        if paid:
            assert record.stripe_checkout_session_id == found.id
            receipt = await db.scalar(select(PaymentTransaction))
            assert (receipt.payment_status, receipt.amount) == ("Completed", 35)
            notice = await db.scalar(select(Notification).where(Notification.type == "crew_session_covered"))
            assert notice.user_id == "north" and "$0" in notice.body
            provider.list.assert_called_once()
        if outcome in ("absent", "partial_scan", "wrong_amount"):
            provider.expire.assert_not_called()
    provider.create.assert_not_called()


async def test_accepted_cancellation_returns_unit_and_applies_fee_to_paid_cash_only(shared, harness):
    from models import DispatchRequestStatusEnum as Status
    from routes.dispatch import dispatch_transitions
    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    terms = {**TERMS, "crew_shares": [{"user_id":"north","covered_by_captain":True}]}
    dispatch_id = (await create(client, terms, (await preview(client, terms))["quote_id"])).json()["id"]
    assert (await client.post(f"/api/dispatch/{dispatch_id}/pay?payer_id=victim", headers=bearer(CAPTAIN))).status_code == 200
    async with maker.begin() as db:
        row = await db.get(DispatchRequest, dispatch_id)
        row.status, row.photographer_id = Status.ACCEPTED, PRO
        (await db.get(Profile, PRO)).on_demand_cancellation_fee_pct = 50
    response = await client.post(f"/api/dispatch/{dispatch_id}/cancel", json={}, headers=bearer(CAPTAIN))
    assert response.status_code == 200, response.text
    assert response.json()["refund_amount"] == 17.50
    async with maker() as db:
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 1
        assert (await db.get(Profile, CAPTAIN)).credit_balance == 82.50


async def test_no_crew_payment_can_precede_the_captain_confirmation(shared, harness, monkeypatch):
    from routes.dispatch import progress

    app, client, maker = harness
    app.include_router(progress.router, prefix="/api")
    dispatch_id = (await create(client, TERMS, (await preview(client, TERMS))["quote_id"])).json()["id"]
    async with maker() as db:
        seat = await db.scalar(select(DispatchRequestParticipant.id).where(DispatchRequestParticipant.participant_id == "north"))
    listing = await client.get("/api/dispatch/user/north/crew-invites", headers=bearer("north"))
    assert listing.json()["crew_invites"] == []
    create_card = Mock(side_effect=AssertionError("No card checkout before captain confirmation"))
    monkeypatch.setattr(sessions.stripe.checkout.Session, "create", create_card)
    for action in ("pay", "checkout"):
        result = await client.post(f"/api/dispatch/crew-invite/{seat}/{action}?payer_id=north",
                                   json={}, headers=bearer("north"))
        assert result.status_code == 409, result.text
    result = await client.post(f"/api/dispatch/{dispatch_id}/cover-remaining", json={"captain_id":CAPTAIN}, headers=bearer(CAPTAIN))
    assert result.status_code == 409, result.text
    async with maker() as db:
        assert await db.scalar(select(func.count()).select_from(CreditTransaction)) == 0
        assert (await db.get(Profile, "north")).credit_balance == 100
    create_card.assert_not_called()


async def test_booking_escrow_tracks_funded_shares_before_and_after_arrival(shared, harness, monkeypatch):
    from models import Booking, DispatchRequestStatusEnum as Status
    from routes.dispatch import lifecycle, progress

    app, client, maker = harness
    app.include_router(lifecycle.router, prefix="/api")
    app.include_router(progress.router, prefix="/api")
    dispatch_id = (await create(client, TERMS, (await preview(client, TERMS))["quote_id"])).json()["id"]
    assert (await client.post(f"/api/dispatch/{dispatch_id}/pay?payer_id=victim", headers=bearer(CAPTAIN))).status_code == 200
    async with maker.begin() as db:
        row = await db.get(DispatchRequest, dispatch_id)
        row.status, row.photographer_id = Status.EN_ROUTE, PRO
        seat = await db.scalar(select(DispatchRequestParticipant.id).where(DispatchRequestParticipant.participant_id == "north"))
    assert (await client.post(f"/api/dispatch/crew-invite/{seat}/pay?payer_id=north",
                              json={"selfie_url":"fixture.jpg"}, headers=bearer("north"))).status_code == 200
    arrived = await client.post(f"/api/dispatch/{dispatch_id}/arrived?photographer_id={PRO}", headers=bearer(PRO))
    assert arrived.status_code == 200, arrived.text
    async with maker() as db:
        booking = await db.get(Booking, arrived.json()["booking_id"])
        assert (booking.total_price, booking.escrow_amount) == (70, 35)
    for _ in range(2):
        result = await client.post(f"/api/dispatch/{dispatch_id}/cover-remaining",
                                   json={"captain_id":CAPTAIN}, headers=bearer(CAPTAIN))
        assert result.status_code == 200, result.text
    async with maker() as db:
        booking = await db.get(Booking, arrived.json()["booking_id"])
        assert booking.escrow_amount == 70
        assert (await db.get(Profile, CAPTAIN)).credit_balance == 65


@pytest.mark.parametrize("ending,late_card", [("cancel", False), ("decline", False), ("cancel", True), ("decline", True)])
async def test_guest_payments_return_to_each_payer_once(shared, harness, monkeypatch, ending, late_card):
    import json
    from models import PaymentTransaction
    from routes.dispatch import dispatch_transitions, lifecycle

    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    app.include_router(lifecycle.router, prefix="/api")
    dispatch_id = (await create(client, TERMS, (await preview(client, TERMS))["quote_id"])).json()["id"]
    assert (await client.post(f"/api/dispatch/{dispatch_id}/pay?payer_id=victim", headers=bearer(CAPTAIN))).status_code == 200
    async with maker.begin() as db:
        seats = {p.participant_id: p.id for p in (await db.scalars(select(DispatchRequestParticipant)
                 .where(DispatchRequestParticipant.dispatch_request_id == dispatch_id))).all()}
        (await db.get(Profile, "north")).spend_only_credits = 20
        receipt = dict(type="crew_share", version=1, participant_id=seats["south"], dispatch_id=dispatch_id,
                       payer_id="south", currency="usd", amount_cents=3500)
        db.add(PaymentTransaction(user_id="south", amount=35, currency="usd", session_id="cs_guest_fixture",
                                  status="pending", payment_status="pending", transaction_metadata=json.dumps(receipt)))

    response = await client.post(f"/api/dispatch/crew-invite/{seats['north']}/pay?payer_id=north", headers=bearer("north"))
    assert response.status_code == 200, response.text
    checkout = SimpleNamespace(id="cs_guest_fixture", status="complete", payment_status="paid", mode="payment",
                               payment_intent="pi_guest_fixture", currency="usd", amount_total=3500,
                               metadata={key: str(value) for key, value in receipt.items()})
    provider = Mock(return_value=checkout)
    monkeypatch.setattr(sessions.stripe.checkout.Session, "retrieve", provider)
    path = "/api/dispatch/crew-payment/cs_guest_fixture"
    if not late_card:
        response = await client.get(path, headers=bearer("south"))
        assert response.json()["status"] == "completed", response.text
    for attempt in range(2):
        if ending == "cancel":
            response = await client.post(f"/api/dispatch/{dispatch_id}/cancel", json={}, headers=bearer(CAPTAIN))
            assert response.status_code == (400 if attempt else 200), response.text
        else:
            response = await client.post(f"/api/dispatch/{dispatch_id}/decline?photographer_id={PRO}", headers=bearer(PRO))
            assert response.status_code == 200, response.text
        response = await client.get(path, headers=bearer("south"))
        assert response.json()["status"] == "wallet_credited", response.text
    provider.assert_called_once()
    async with maker() as db:
        north = await db.get(Profile, "north")
        assert (north.credit_balance, north.spend_only_credits) == (100, 20)
        assert (await db.get(Profile, "south")).credit_balance == 135
        assert (await db.get(Profile, CAPTAIN)).credit_balance == 100
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 1
        credits = (await db.execute(select(CreditTransaction.user_id, CreditTransaction.amount)
                   .where(CreditTransaction.amount > 0).order_by(CreditTransaction.user_id))).all()
        assert credits == [("north", 35), ("south", 35)]
        if late_card:
            assert not (await db.get(DispatchRequestParticipant, seats["south"])).paid


async def test_captain_recovers_guest_shares_they_covered(shared, harness):
    from routes.dispatch import dispatch_transitions, progress

    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    app.include_router(progress.router, prefix="/api")
    dispatch_id = (await create(client, TERMS, (await preview(client, TERMS))["quote_id"])).json()["id"]
    assert (await client.post(f"/api/dispatch/{dispatch_id}/pay?payer_id=victim", headers=bearer(CAPTAIN))).status_code == 200
    response = await client.post(f"/api/dispatch/{dispatch_id}/cover-remaining", json={"captain_id": CAPTAIN}, headers=bearer(CAPTAIN))
    assert response.json()["amount_covered"] == 70
    response = await client.post(f"/api/dispatch/{dispatch_id}/cancel", json={}, headers=bearer(CAPTAIN))
    assert response.status_code == 200, response.text
    async with maker() as db:
        credits = (await db.execute(select(CreditTransaction.user_id, CreditTransaction.amount)
                   .where(CreditTransaction.amount > 0))).all()
        assert credits == [(CAPTAIN, 70)]
        assert (await db.get(Profile, CAPTAIN)).credit_balance == 100
