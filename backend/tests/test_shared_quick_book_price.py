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
