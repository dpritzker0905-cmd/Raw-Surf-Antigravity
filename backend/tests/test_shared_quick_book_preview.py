"""Mounted support preview on the same funding and cancellation routes as the app."""
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from sqlalchemy import select

from models import Booking, CreditTransaction, DispatchRequest, DispatchRequestParticipant, Profile, SurferPhotoSubscription
from routes.admin import quick_book_preview
from routes.dispatch import dispatch_transitions
from tests.test_audit_money_route_authority import harness, bearer
from tests.test_shared_quick_book_price import shared, create, preview, TERMS, CAPTAIN, PRO


async def assert_allocations(client, path, headers, subscriber, first, second):
    async def run(seats):
        response = await client.post(path, headers=headers, json={"seats": seats})
        assert response.status_code == 200, response.text
        assert response.headers["cache-control"] == "no-store"
        data = response.json()
        assert data["preview_only"] and data["as_of"]
        assert data["collected_cents"] == sum(data[k] for k in ("refund_cents", "photographer_gross_cents", "reserved_cents"))
        return data

    initial = await run([])
    assert (initial["collected_cents"], initial["reserved_cents"], initial["included_session"]["action"]) == (7000, 7000, "keep_reserved")
    refund = [{"seat": seat, "outcome": "no_service"} for seat in (subscriber, first, second)]
    all_returned = await run(refund)
    assert (all_returned["refund_cents"], all_returned["photographer_gross_cents"],
            all_returned["included_session"]["action"]) == (7000, 0, "restore_one")
    partial = dict(seat=first, outcome="partial", earned_cents=2000, evidence="agreed deliverable")
    approved = await run([refund[0], partial, refund[2]])
    assert (approved["refund_cents"], approved["photographer_gross_cents"]) == (5000, 2000)
    assert next(s for s in approved["seats"] if s["seat"] == first)["refund_cents"] == 1500
    fee = dict(seat=first, outcome="no_show", evidence="attendance record", accepted_fee_percent=20,
               accepted_fee_cap_cents=1000, fee_terms_reference="accepted by actual payer")
    subject = await run([refund[0], fee, refund[2]])
    assert (subject["refund_cents"], subject["photographer_gross_cents"]) == (6300, 700)
    no_terms = await run([dict(seat=first, outcome="no_show", evidence="attendance")])
    assert no_terms["photographer_gross_cents"] == 0 and no_terms["refund_cents"] == 3500
    for decision, action in [
        (dict(outcome="delivered", evidence="delivered"), "consume_one"),
        (dict(outcome="partial", earned_cents=0, evidence="photo"), "restore_one"),
        (dict(outcome="partial", earned_cents=0, evidence="photo", partial_unit_consent="subscriber acknowledged"), "consume_one"),
        (dict(outcome="disputed"), "keep_reserved"),
    ]:
        result = await run([dict(seat=subscriber, **decision)])
        assert result["included_session"]["action"] == action
        assert result["photographer_gross_cents"] == 0


@pytest_asyncio.fixture
async def held(shared, harness, request):
    from models import DispatchRequestStatusEnum as Status
    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    app.include_router(quick_book_preview.router, prefix="/api")
    did = (await create(client, TERMS, (await preview(client, TERMS))["quote_id"])).json()["id"]
    assert (await client.post(f"/api/dispatch/{did}/pay?payer_id={CAPTAIN}", headers=bearer(CAPTAIN))).status_code == 200
    async with maker.begin() as db:
        row = await db.get(DispatchRequest, did)
        row.status, row.accepted_at, row.photographer_id = Status.EN_ROUTE, datetime.now(timezone.utc), PRO
        (await db.get(Profile, PRO)).is_admin = True
        (await db.get(Profile, "north")).spend_only_credits = 9.25
        seats = {s.participant_id: s.id for s in await db.scalars(select(DispatchRequestParticipant))}
    if getattr(request, "param", None) == "covered":
        from routes.dispatch import progress
        app.include_router(progress.router, prefix="/api")
        response = await client.post(f"/api/dispatch/{did}/cover-remaining",
                                     json={"captain_id":CAPTAIN}, headers=bearer(CAPTAIN))
        assert response.status_code == 200, response.text
    else:
        for guest, sid in seats.items():
            response = await client.post(f"/api/dispatch/crew-invite/{sid}/pay?payer_id={guest}",
                                         json={"selfie_url":"fixture.jpg"}, headers=bearer(guest))
            assert response.status_code == 200, response.text
    closed = await client.post(f"/api/dispatch/{did}/cancel", headers=bearer(CAPTAIN), json={})
    assert closed.status_code == 200, closed.text
    return client, maker, "/api/admin/support/quick-books/" + did + "/settlement-preview", closed.json()["booking_id"]


async def test_preview_money_and_personal_unit(held):
    client, maker, path, booking = held
    await assert_allocations(client, path, bearer(PRO), CAPTAIN, "north", "south")
    async with maker() as db:
        assert (await db.get(Booking, booking)).escrow_amount == 70
        assert (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining == 0
        assert [r.amount for r in await db.scalars(select(CreditTransaction))] == [-35, -35]


async def test_preview_refuses_unmatched_funds_and_unauthorized_requests(held):
    client, maker, path, bid = held
    for headers, code in [({}, 401), (bearer("south"), 403)]:
        assert (await client.post(path, json={}, headers=headers)).status_code == code
    for invalid in [
        {"seat":"north", "outcome":"no_show", "accepted_fee_percent":20, "evidence":"claim"},
        {"seat":"north", "outcome":"partial", "earned_cents":3501, "evidence":"claim"},
        {"seat":"north", "outcome":"partial", "earned_cents":0, "evidence":"photo", "partial_unit_consent":"claim"},
        {"seat":"unrelated", "outcome":"delivered", "evidence":"photo"},
    ]:
        response = await client.post(path, headers=bearer(PRO), json={"seats":[invalid]})
        assert response.status_code == 422, response.text
    async with maker.begin() as db:
        (await db.get(Booking, bid)).escrow_amount = 105
    assert (await client.post(path, json={}, headers=bearer(PRO))).status_code == 409


async def test_preview_expired_subscription_and_promo(held):
    client, maker, path, _ = held
    async with maker.begin() as db:
        (await db.get(SurferPhotoSubscription, "plan")).expires_at = datetime.now(timezone.utc) - timedelta(days=1)
    resp = await client.post(path, headers=bearer(PRO), json={"seats":[
        {"seat":CAPTAIN, "outcome":"no_service"},
        {"seat":"north", "outcome":"partial", "earned_cents":3000, "evidence":"photo delivered"},
    ]})
    assert resp.status_code == 200, resp.text
    result = resp.json()
    assert result["included_session"]["action"] == "replacement_review"
    line = next(s for s in result["funding"] if s["payer_id"] == "north")
    assert line["refund_cents"] == line["promo_refund_cents"] == 500


@pytest.mark.parametrize("held", ["covered"], indirect=True)
async def test_single_captain_debit_funds_two_guest_refunds(held):
    client, _, path, _ = held
    result = (await client.post(path, headers=bearer(PRO), json={"seats":[
        {"seat":"north", "outcome":"partial", "earned_cents":2000, "evidence":"delivery"},
        {"seat":"south", "outcome":"no_service"},
    ]})).json()
    source, = result["funding"]
    assert source["payer_id"] == CAPTAIN
    assert (source["collected_cents"], source["refund_cents"], result["photographer_gross_cents"]) == (7000, 5000, 2000)


async def test_disputed_debit_reserves_only_that_funding(held):
    from models import Dispute
    client, maker, path, _ = held
    async with maker.begin() as db:
        debit = await db.scalar(select(CreditTransaction).where(CreditTransaction.user_id == "north"))
        db.add(Dispute(complainant_id="north", respondent_id=PRO, subject="payment",
                       description="synthetic disputed portion", dispute_type="payment", transaction_id=debit.id))
    result = (await client.post(path, headers=bearer(PRO), json={"seats":[
        {"seat":"north", "outcome":"delivered", "evidence":"delivery"},
        {"seat":"south", "outcome":"no_service"},
    ]})).json()
    assert (result["refund_cents"], result["reserved_cents"], result["photographer_gross_cents"]) == (3500, 3500, 0)


def test_per_seat_fee_rounds_half_up_then_caps():
    from routes.admin.quick_book_preview import SeatAssumption, allocate
    fee = SeatAssumption(seat="guest", outcome="no_show", evidence="arrival and contact",
                         accepted_fee_percent=50, accepted_fee_cap_cents=100, fee_terms_reference="terms")
    assert allocate(101, fee) == (50, 51, 0)
    assert allocate(101, fee.model_copy(update={"accepted_fee_cap_cents":45})) == (56, 45, 0)


async def test_prior_refund_request_requires_reconciliation(held):
    from models import RefundRequest
    client, maker, path, booking = held
    async with maker.begin() as db:
        db.add(RefundRequest(user_id="north", booking_id=booking, amount=35, reason="same payment"))
    response = await client.post(path, headers=bearer(PRO), json={"seats":[{"seat":"north","outcome":"no_service"}]})
    assert response.status_code == 409


@pytest.mark.parametrize("confirm_early", [True, False], ids=["completed_guest", "late_guest"])
async def test_preview_from_confirmed_card_checkouts(shared, harness, monkeypatch, confirm_early):
    from types import SimpleNamespace
    from unittest.mock import AsyncMock
    from models import DispatchRequestStatusEnum as Status, PaymentTransaction
    from routes.dispatch import dispatch_matching, lifecycle, sessions

    app, client, maker = harness
    for router in (dispatch_matching.router, lifecycle.router, dispatch_transitions.router, quick_book_preview.router):
        app.include_router(router, prefix="/api")
    checkouts = {}

    def open_card(**options):
        sid = f"fixture-{len(checkouts)}"
        checkout = SimpleNamespace(id=sid, url="https://fixture.invalid/" + sid, mode="payment",
            status="complete", payment_status="paid", currency="usd", payment_intent="intent-" + sid,
            amount_total=options["line_items"][0]["price_data"]["unit_amount"], metadata=options["metadata"])
        checkouts[sid] = checkout
        return checkout

    monkeypatch.setenv("STRIPE_API_KEY", "fixture")
    monkeypatch.setattr(sessions.stripe, "api_key", "fixture")
    monkeypatch.setattr(sessions.stripe.checkout.Session, "create", open_card)
    monkeypatch.setattr(sessions.stripe.checkout.Session, "retrieve", checkouts.__getitem__)
    monkeypatch.setattr(dispatch_matching, "notify_crew_members", AsyncMock())
    monkeypatch.setattr(dispatch_matching, "process_dispatch_notifications", AsyncMock())
    terms = {**TERMS, "crew_shares": [{"user_id": "north", "covered_by_captain": True}]}
    quote = await preview(client, terms)
    did = (await create(client, terms, quote["quote_id"])).json()["id"]
    response = await client.post("/api/dispatch/checkout", headers=bearer(CAPTAIN), json={
        "dispatch_id": did, "payer_id": CAPTAIN, "origin_url": "https://fixture.invalid"})
    assert response.status_code == 200, response.text
    confirmed = await client.get("/api/dispatch/payment-success", params={
        "dispatch_id": did, "session_id": response.json()["session_id"]})
    assert confirmed.status_code == 200 and confirmed.json()["success"], confirmed.text
    async with maker.begin() as db:
        row = await db.get(DispatchRequest, did)
        row.status, row.accepted_at, row.photographer_id = Status.EN_ROUTE, datetime.now(timezone.utc), PRO
        (await db.get(Profile, PRO)).is_admin = True
        guest = await db.scalar(select(DispatchRequestParticipant.id).where(
            DispatchRequestParticipant.dispatch_request_id == did, DispatchRequestParticipant.participant_id == "south"))

    async def guest_checkout():
        response = await client.post(f"/api/dispatch/crew-invite/{guest}/checkout?payer_id=south",
                                     headers=bearer("south"), json={"origin_url": "https://fixture.invalid"})
        assert response.status_code == 200, response.text
        return response.json()["session_id"]

    async def confirm(sid, expected):
        response = await client.get("/api/dispatch/crew-payment/" + sid, headers=bearer("south"))
        assert response.status_code == 200 and response.json()["status"] == expected, response.text

    first, extra, expired = await guest_checkout(), await guest_checkout(), await guest_checkout()
    checkouts[expired].status, checkouts[expired].payment_status = "expired", "unpaid"
    await confirm(expired, "expired")
    if confirm_early:
        await confirm(first, "completed")
    arrived = await client.post(f"/api/dispatch/{did}/arrived?photographer_id={PRO}", headers=bearer(PRO))
    assert arrived.status_code == 200, arrived.text
    closed = await client.post(f"/api/dispatch/{did}/cancel", headers=bearer(CAPTAIN), json={})
    assert closed.status_code == 200 and closed.json()["booking_id"] == arrived.json()["booking_id"], closed.text
    if not confirm_early:
        await confirm(first, "pending_settlement")
    await confirm(extra, "review_required")

    path = "/api/admin/support/quick-books/" + did + "/settlement-preview"
    seats = [{"seat": member, "outcome": "no_service"} for member in (CAPTAIN, "north", "south")]
    seats[-1]["card_wallet_consent"] = "guest return preference"
    response = await client.post(path, headers=bearer(PRO), json={"seats": seats})
    assert response.status_code == 200, response.text
    result = response.json()
    assert (result["collected_cents"], result["refund_cents"], result["reserved_cents"],
            result["photographer_gross_cents"]) == (7000, 3500, 3500, 0)
    captain = next(s for s in result["seats"] if s["role"] == "captain")
    assert (captain["method"], captain["reserved_cents"], captain["reserve_reason"]) == (
        "card", 3500, "Card return destination needs review")
    south = next(s for s in result["seats"] if s["seat"] == "south")
    assert south["refund_cents"] == 3500 and south["confirmed_after_cancellation"] == (not confirm_early)
    async with maker() as db:
        duplicate = await db.scalar(select(PaymentTransaction).where(PaymentTransaction.session_id == extra))
        assert result["separate_receipts"] == [{"seat": "south", "receipt_id": duplicate.id,
                "status": "review_required", "amount_cents": 3500, "payer_id": "south"}]
    mixed = await client.post(path, headers=bearer(PRO), json={"seats": [
        {"seat": CAPTAIN, "outcome": "delivered", "evidence": "delivery"}, seats[-1]]})
    assert mixed.status_code == 200, mixed.text
    captain = next(s for s in mixed.json()["seats"] if s["role"] == "captain")
    assert captain["photographer_gross_cents"] == 0 and captain["reserved_cents"] == 3500


async def test_wallet_preview_omits_empty_card_lookup_and_checks_missing_period(held):
    from sqlalchemy import event
    client, maker, path, bid = held
    async with maker.begin() as db:
        row = await db.scalar(select(DispatchRequest).where(DispatchRequest.booking_id == bid))
        assert row.stripe_checkout_session_id is None
        row.created_at = None
        engine = db.bind.sync_engine
    lookups = []

    def capture(connection, cursor, statement, params, context, many):
        if "FROM payment_transactions" in statement:
            lookups.append(statement.lower())

    event.listen(engine, "before_cursor_execute", capture)
    try:
        response = await client.post(path, headers=bearer(PRO), json={"seats": [{"seat": CAPTAIN, "outcome": "no_service"}]})
    finally:
        event.remove(engine, "before_cursor_execute", capture)
    assert response.status_code == 200, response.text
    assert response.json()["included_session"]["action"] == "replacement_review"
    assert len(lookups) == 1 and "session_id is null" not in lookups[0]
