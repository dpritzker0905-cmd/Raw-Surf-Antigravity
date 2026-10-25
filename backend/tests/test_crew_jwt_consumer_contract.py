"""Actual crew consumer request shapes: real HTTP/JWT/ORM, no query actor required."""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import Booking, BookingParticipant, CrewChatMessage, Notification, Profile, RoleEnum
from routes.crew import crew_chat, crew_chat_reactions


@pytest_asyncio.fixture
async def consumer_http(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Booking, BookingParticipant, CrewChatMessage, Notification):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with maker() as db:
        for pid in ("captain", "crew", "photographer", "outsider"):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                           role=RoleEnum.PHOTOGRAPHER if pid == "photographer" else RoleEnum.SURFER))
        db.add(Booking(id="booking", creator_id="captain", photographer_id="photographer",
                       location="Fixture beach", session_date=timestamp, total_price=0))
        for pid in ("captain", "crew"):
            db.add(BookingParticipant(booking_id="booking", participant_id=pid, is_captain=pid == "captain"))
        for number in range(2):
            db.add(CrewChatMessage(id=f"message-{number}", booking_id="booking", sender_id="captain",
                                   content=f"History {number}", created_at=timestamp + timedelta(seconds=number)))
        await db.commit()
    manager = crew_chat_reactions.CrewChatConnectionManager()
    monkeypatch.setattr(manager, "broadcast_to_booking", AsyncMock())
    monkeypatch.setattr(crew_chat, "crew_chat_manager", manager)
    app = FastAPI()
    app.include_router(crew_chat.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(client=client, maker=maker, manager=manager)
    finally:
        await engine.dispose()


def auth(subject, credential="valid"):
    if credential == "missing":
        return {}
    claims = {} if credential == "no_subject" else {"sub": subject}
    token = security.create_access_token(claims, expires_delta=timedelta(seconds=-5)
                                        if credential == "expired" else timedelta(minutes=5))
    if credential == "invalid":
        token += "corrupt"
    return {"Authorization": "Bearer " + token}


async def request(fixture, endpoint, *, subject="captain", actor=None, credential="valid", booking="booking",
                  limit=50, before=None):
    params = {"user_id": actor} if actor is not None else {}
    if endpoint == "messages":
        params["limit"] = limit
        if before:
            params["before"] = before
    # Mirrors useCrewChat's JWT-only GET ?limit=50 and POST body, plus explicit legacy controls.
    return await fixture.client.request("GET" if endpoint == "messages" else "POST",
                                        f"/api/crew-chat/{booking}/{endpoint}", params=params,
                                        headers=auth(subject, credential),
                                        **({"json": {"content": "Consumer message", "message_type": "text",
                                                     "reply_to_id": None}} if endpoint == "send" else {}))


async def stored(fixture):
    async with fixture.maker() as db:
        messages = (await db.execute(select(CrewChatMessage))).scalars().all()
        notifications = (await db.execute(select(Notification))).scalars().all()
        return {m.id: (m.booking_id, m.sender_id, m.content) for m in messages}, [n.user_id for n in notifications]


@pytest.mark.parametrize("endpoint", ["messages", "send"])
@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("legacy_query", [False, True])
async def test_consumer_and_matching_legacy_requests_work_for_all_roles(consumer_http, endpoint, subject, legacy_query):
    before = await stored(consumer_http)
    response = await request(consumer_http, endpoint, subject=subject, actor=subject if legacy_query else None)
    assert response.status_code == 200
    if endpoint == "messages":
        data = response.json()
        assert [m["id"] for m in data["messages"]] == ["message-0", "message-1"]
        assert data["my_role"] == subject and not data["has_more"]
        assert await stored(consumer_http) == before
        consumer_http.manager.broadcast_to_booking.assert_not_called()
    else:
        rows, notifications = await stored(consumer_http)
        assert rows[response.json()["message_id"]] == ("booking", subject, "Consumer message")
        assert len(rows) == len(before[0]) + 1
        assert set(notifications) == {"captain", "crew", "photographer"} - {subject}
        consumer_http.manager.broadcast_to_booking.assert_awaited_once()
        bid, event = consumer_http.manager.broadcast_to_booking.call_args.args
        assert bid == "booking" and event["data"]["sender_id"] == subject


@pytest.mark.parametrize("endpoint", ["messages", "send"])
@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
async def test_legacy_other_member_query_still_rejected(consumer_http, endpoint, subject):
    before = await stored(consumer_http)
    actor = "crew" if subject != "crew" else "captain"
    response = await request(consumer_http, endpoint, subject=subject, actor=actor)
    assert response.status_code == 403
    assert await stored(consumer_http) == before
    consumer_http.manager.broadcast_to_booking.assert_not_called()


@pytest.mark.parametrize("endpoint", ["messages", "send"])
@pytest.mark.parametrize("legacy_query", [False, True])
async def test_outsider_cannot_bypass_membership_or_borrow_actor(consumer_http, endpoint, legacy_query):
    before = await stored(consumer_http)
    response = await request(consumer_http, endpoint, subject="outsider", actor="captain" if legacy_query else None)
    assert response.status_code == 403
    assert await stored(consumer_http) == before
    consumer_http.manager.broadcast_to_booking.assert_not_called()


@pytest.mark.parametrize("endpoint", ["messages", "send"])
@pytest.mark.parametrize("credential", ["missing", "invalid", "expired", "no_subject"])
@pytest.mark.parametrize("legacy_query", [False, True])
async def test_invalid_auth_stays_denied_with_or_without_query(consumer_http, endpoint, credential, legacy_query):
    before = await stored(consumer_http)
    response = await request(consumer_http, endpoint, credential=credential, actor="captain" if legacy_query else None)
    assert response.status_code == 401
    assert await stored(consumer_http) == before
    consumer_http.manager.broadcast_to_booking.assert_not_called()


@pytest.mark.parametrize("endpoint", ["messages", "send"])
async def test_unknown_booking_is_forbidden_for_jwt_only_consumer(consumer_http, endpoint):
    before = await stored(consumer_http)
    response = await request(consumer_http, endpoint, booking="missing")
    assert response.status_code == 403
    assert await stored(consumer_http) == before
    consumer_http.manager.broadcast_to_booking.assert_not_called()


async def test_jwt_only_history_preserves_pagination(consumer_http):
    first = await request(consumer_http, "messages", limit=1)
    assert first.status_code == 200 and first.json()["has_more"]
    assert first.json()["messages"][0]["id"] == "message-1"
    previous = await request(consumer_http, "messages", limit=1, before="message-1")
    assert previous.status_code == 200
    assert [m["id"] for m in previous.json()["messages"]] == ["message-0"]
