"""Dispute submit: the six owner-approved rules (2026-10-24), proved against a real SQLite database over HTTP + JWT.

Every refusal is checked for WRITING NOTHING: the dispute, payout-hold and audit tables are counted before and
after. The rules live in routes/admin/dispute_rules.py; the route is routes/admin/moderation_reports.py.
"""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (AuditLog, Booking, BookingParticipant, Dispute, GalleryPurchase, LiveSessionParticipant,
                    PayoutHold, Profile, RoleEnum)
from routes.admin import moderation_reports

NOW = datetime.now(timezone.utc)


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


def body(**over):
    base = {"complainant_id": "buyer", "dispute_type": "payment", "subject": "Wrong charge",
            "description": "I was charged for something I did not receive.", "booking_id": "b1"}
    base.update(over)
    return {k: v for k, v in base.items() if v is not None}


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Booking, BookingParticipant, LiveSessionParticipant, GalleryPurchase,
                      Dispute, PayoutHold, AuditLog):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid, role in (("buyer", RoleEnum.SURFER), ("other", RoleEnum.SURFER), ("photog", RoleEnum.PHOTOGRAPHER),
                          ("photog2", RoleEnum.PHOTOGRAPHER)):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid, role=role))
        for bid, age_days in (("b1", 10), ("b-old", 120)):
            db.add(Booking(id=bid, creator_id="buyer", photographer_id="photog", location="Fixture Beach",
                           session_date=NOW - timedelta(days=age_days), total_price=100.0, invite_code=bid,
                           description="fixture"))
            db.add(BookingParticipant(booking_id=bid, participant_id="buyer", paid_amount=60.0,
                                      payment_status="Paid", share_amount=60.0))
        db.add(LiveSessionParticipant(photographer_id="photog", surfer_id="buyer", live_session_id="ls1",
                                      amount_paid=30.0, joined_at=NOW - timedelta(days=5)))
        db.add(GalleryPurchase(gallery_item_id="gi1", buyer_id="buyer", photographer_id="photog",
                               amount_paid=20.0, purchased_at=NOW - timedelta(days=3)))
        await db.commit()

    app = FastAPI()
    app.include_router(moderation_reports.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency

    async def counts():
        out = []
        async with maker() as db:
            for table in (Dispute, PayoutHold, AuditLog):
                out.append((await db.execute(select(func.count()).select_from(table))).scalar())
        return tuple(out)

    async def submit(payload, who="buyer"):
        return await client.post("/api/disputes/submit", json=payload, headers=_token(who))

    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(client=client, maker=maker, counts=counts, submit=submit)
    finally:
        await engine.dispose()


async def refused(world, payload, status, who="buyer"):
    before = await world.counts()
    r = await world.submit(payload, who)
    assert r.status_code == status, (r.status_code, r.text)
    assert await world.counts() == before, "a refused dispute must write nothing"
    return r


# ---- rule 1: one transaction the complainant took part in

async def test_a_dispute_must_name_exactly_one_transaction(world):
    await refused(world, body(booking_id=None), 400)
    await refused(world, body(live_session_id="ls1"), 400)  # booking AND live session


@pytest.mark.parametrize("who,payload", [
    ("other", body(complainant_id="other")),                                   # not a party to the booking
    ("other", body(complainant_id="other", booking_id=None, live_session_id="ls1")),
    ("other", body(complainant_id="other", booking_id=None, gallery_item_id="gi1")),
    ("buyer", body(booking_id="no-such-booking")),
    ("buyer", body(booking_id=None, gallery_item_id="no-such-item")),
])
async def test_a_stranger_or_unknown_transaction_is_a_404_that_writes_nothing(world, who, payload):
    await refused(world, payload, 404, who)


async def test_naming_someone_elses_id_is_refused_outright(world):
    r = await refused(world, body(complainant_id="other"), 403, "buyer")
    assert r.json()["detail"] == "Cannot act on behalf of another user"


@pytest.mark.parametrize("ref", [{"booking_id": "b1"}, {"booking_id": None, "live_session_id": "ls1"},
                                 {"booking_id": None, "gallery_item_id": "gi1"}])
async def test_a_party_can_dispute_each_kind_of_transaction(world, ref):
    r = await world.submit(body(**ref))
    assert r.status_code == 200, r.text
    async with world.maker() as db:
        d = (await db.execute(select(Dispute))).scalar_one()
    assert d.complainant_id == "buyer" and d.respondent_id == "photog" and d.status == "open"
    assert d.priority == "normal"


async def test_urgency_is_not_the_complainants_to_set(world):
    r = await world.submit({**body(), "priority": "urgent"})
    assert r.status_code == 200
    async with world.maker() as db:
        assert (await db.execute(select(Dispute.priority))).scalar_one() == "normal"


# ---- rule 2: the respondent comes from the transaction

async def test_the_respondent_is_derived_and_a_wrong_one_is_refused(world):
    await refused(world, body(respondent_id="photog2"), 400)
    await refused(world, body(respondent_id="other"), 400)
    ok = await world.submit(body(respondent_id="photog"))  # matching is fine
    assert ok.status_code == 200
    ok2 = await world.submit(body(booking_id=None, gallery_item_id="gi1"))  # omitted is fine
    assert ok2.status_code == 200


# ---- rule 3: the amount cannot exceed what was paid, so neither can the hold

async def test_the_amount_is_capped_at_what_the_complainant_paid(world):
    await refused(world, body(amount_disputed=60.01), 400)
    await refused(world, body(amount_disputed=500), 400)
    await refused(world, body(booking_id=None, gallery_item_id="gi1", amount_disputed=20.5), 400)
    await refused(world, body(booking_id=None, live_session_id="ls1", amount_disputed=31), 400)


@pytest.mark.parametrize("bad", [-1, float("inf")])
async def test_a_negative_or_infinite_amount_is_refused(world, bad):
    before = await world.counts()
    raw = '{"complainant_id": "buyer", "dispute_type": "payment", "subject": "s", "description": "d", ' \
          f'"booking_id": "b1", "amount_disputed": {"-1" if bad == -1 else "Infinity"}}}'
    r = await world.client.post("/api/disputes/submit", content=raw,
                                headers={**_token("buyer"), "content-type": "application/json"})
    assert r.status_code in (400, 422)
    assert await world.counts() == before


async def test_a_valid_amount_opens_a_hold_no_larger_than_it(world):
    r = await world.submit(body(amount_disputed=45.0))
    assert r.status_code == 200
    async with world.maker() as db:
        hold = (await db.execute(select(PayoutHold))).scalar_one()
    assert hold.amount == 45.0 and hold.photographer_id == "photog" and hold.is_active


async def test_a_dispute_without_an_amount_opens_no_hold(world):
    assert (await world.submit(body())).status_code == 200
    assert (await world.counts())[1] == 0


async def test_a_member_who_paid_nothing_cannot_dispute_money(world):
    async with world.maker() as db:
        db.add(Booking(id="b-free", creator_id="other", photographer_id="photog", location="x",
                       session_date=NOW - timedelta(days=1), total_price=50.0, invite_code="b-free", description="x"))
        await db.commit()
    await refused(world, body(complainant_id="other", booking_id="b-free", amount_disputed=10), 400, "other")


# ---- rule 4: 90 days

async def test_the_window_is_ninety_days(world):
    r = await refused(world, body(booking_id="b-old"), 400)
    assert "90 days" in r.json()["detail"]
    assert (await world.submit(body(booking_id="b1"))).status_code == 200  # 10 days old


# ---- rule 5: one open dispute per transaction per complainant

async def test_one_open_dispute_per_transaction(world):
    assert (await world.submit(body())).status_code == 200
    again = await refused(world, body(subject="Same again"), 409)
    assert "open dispute" in again.json()["detail"]
    # a different transaction is a different dispute
    assert (await world.submit(body(booking_id=None, gallery_item_id="gi1"))).status_code == 200


async def test_a_resolved_dispute_frees_the_transaction(world):
    assert (await world.submit(body())).status_code == 200
    async with world.maker() as db:
        d = (await db.execute(select(Dispute))).scalar_one()
        d.status = "resolved_no_action"
        await db.commit()
    assert (await world.submit(body())).status_code == 200


# ---- rule 6: https evidence, at most 10, length limits

@pytest.mark.parametrize("links", [
    ["http://example.invalid/a.png"], ["javascript:alert(1)"], ["ftp://example.invalid/x"],
    ["https://"], ["https://exa mple.invalid/x"], ["not a url"],
    ["https://example.invalid/%d" % i for i in range(11)],
    ["https://example.invalid/" + "a" * 2100],
])
async def test_evidence_must_be_a_few_https_links(world, links):
    await refused(world, body(evidence_urls=links), 400)


async def test_ten_https_links_are_fine(world):
    links = ["https://example.invalid/%d.png" % i for i in range(10)]
    assert (await world.submit(body(evidence_urls=links))).status_code == 200


@pytest.mark.parametrize("change", [
    {"description": "x" * 5001}, {"description": "   "}, {"subject": "x" * 201}, {"subject": " "},
    {"dispute_type": "made_up"},
])
async def test_text_fields_are_bounded_and_the_type_is_known(world, change):
    await refused(world, body(**change), 400)
