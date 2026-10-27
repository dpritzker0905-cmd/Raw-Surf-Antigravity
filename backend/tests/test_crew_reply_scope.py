"""P1 crew replies: real HTTP/JWT/ORM with an isolated SQLite database."""
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
async def reply_http(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    # Create only the actual tables exercised here, without swallowing schema errors.
    # SQLite is a query/persistence control, not PostgreSQL constraint qualification.
    async with engine.begin() as connection:
        for model in (Profile, Booking, BookingParticipant, CrewChatMessage, Notification):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    timestamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with maker() as db:
        for pid in ("captain", "crew", "photographer", "outsider"):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                           role=RoleEnum.PHOTOGRAPHER if pid == "photographer" else RoleEnum.SURFER))
        for bid in ("booking", "foreign-booking"):
            db.add(Booking(id=bid, creator_id="captain" if bid == "booking" else "outsider",
                           photographer_id="photographer", location="Fixture beach", session_date=timestamp,
                           total_price=0))
        for pid in ("captain", "crew"):
            db.add(BookingParticipant(booking_id="booking", participant_id=pid, is_captain=pid == "captain"))
        for mid, bid, deleted, content in (
            ("parent", "booking", False, "Allowed parent " + "x" * 120),
            ("deleted", "booking", True, "Deleted private text"),
            ("foreign", "foreign-booking", False, "Foreign private text"),
            ("foreign-deleted", "foreign-booking", True, "Foreign deleted private text"),
        ):
            db.add(CrewChatMessage(id=mid, booking_id=bid, sender_id="captain", is_deleted=deleted,
                                   content=content, created_at=timestamp))
        db.add(CrewChatMessage(id="child", booking_id="booking", sender_id="crew", content="Visible child",
                               reply_to_id="parent", created_at=timestamp + timedelta(seconds=1)))
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


def auth(subject="captain", credential="valid"):
    if credential == "missing":
        return {}
    token = security.create_access_token({} if credential == "no_subject" else {"sub": subject},
                                        expires_delta=timedelta(seconds=-5) if credential == "expired"
                                        else timedelta(minutes=5))
    if credential == "invalid":
        token += "corrupt"
    return {"Authorization": "Bearer " + token}


async def request(fixture, endpoint, *, subject="captain", actor=None, credential="valid", reply="parent", **params):
    params["user_id"] = actor if actor is not None else subject
    return await fixture.client.request("POST" if endpoint == "send" else "GET",
                                        "/api/crew-chat/booking/" + endpoint, params=params,
                                        headers=auth(subject, credential),
                                        **({"json": {"content": "New reply", "reply_to_id": reply}}
                                           if endpoint == "send" else {}))


async def stored(fixture):
    async with fixture.maker() as db:
        messages = (await db.execute(select(CrewChatMessage))).scalars().all()
        notifications = (await db.execute(select(Notification))).scalars().all()
        return {m.id: (m.booking_id, m.reply_to_id, m.content) for m in messages}, [n.user_id for n in notifications]


@pytest.mark.parametrize("endpoint", ["send", "messages"])
@pytest.mark.parametrize("credential", ["missing", "invalid", "expired", "no_subject"])
async def test_bad_credentials_cannot_read_or_create_replies(reply_http, endpoint, credential):
    before = await stored(reply_http)
    response = await request(reply_http, endpoint, credential=credential)
    assert response.status_code == 401
    assert await stored(reply_http) == before
    reply_http.manager.broadcast_to_booking.assert_not_called()


@pytest.mark.parametrize("endpoint", ["send", "messages"])
async def test_outsider_cannot_use_local_reply(reply_http, endpoint):
    response = await request(reply_http, endpoint, subject="outsider")
    assert response.status_code == 403
    reply_http.manager.broadcast_to_booking.assert_not_called()


@pytest.mark.parametrize("endpoint", ["send", "messages"])
async def test_existing_actor_mismatch_is_rejected(reply_http, endpoint):
    response = await request(reply_http, endpoint, subject="outsider", actor="captain")
    assert response.status_code == 403
    reply_http.manager.broadcast_to_booking.assert_not_called()


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("reply", ["foreign", "deleted", "foreign-deleted", "missing"])
async def test_send_rejects_inaccessible_reply_without_write_or_broadcast(reply_http, subject, reply):
    before = await stored(reply_http)
    response = await request(reply_http, "send", subject=subject, reply=reply)
    assert response.status_code == 404
    assert response.json()["detail"] == "Reply message not found"
    assert await stored(reply_http) == before
    reply_http.manager.broadcast_to_booking.assert_not_called()


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("reply", ["foreign", "deleted", "foreign-deleted", "missing"])
async def test_history_does_not_backfill_inaccessible_legacy_reply(reply_http, subject, reply):
    async with reply_http.maker() as db:
        child = await db.get(CrewChatMessage, "child")
        child.reply_to_id = reply  # Model permits legacy/cross-booking links; reads must contain them.
        await db.commit()
    before = await stored(reply_http)
    response = await request(reply_http, "messages", subject=subject)
    assert response.status_code == 200
    messages = response.json()["messages"]
    assert [m["id"] for m in messages] == ["parent", "child"]
    assert messages[-1]["reply_to"] is None
    assert "private text" not in response.text
    assert await stored(reply_http) == before
    reply_http.manager.broadcast_to_booking.assert_not_called()


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("reply", [None, "parent"])
async def test_authorized_send_preserves_storage_broadcast_and_notifications(reply_http, subject, reply):
    response = await request(reply_http, "send", subject=subject, reply=reply)
    assert response.status_code == 200
    rows, notifications = await stored(reply_http)
    assert rows[response.json()["message_id"]] == ("booking", reply, "New reply")
    assert set(notifications) == {"captain", "crew", "photographer"} - {subject}
    reply_http.manager.broadcast_to_booking.assert_awaited_once()
    booking, event = reply_http.manager.broadcast_to_booking.call_args.args
    assert booking == "booking" and event["data"]["sender_id"] == subject
    context = event["data"]["reply_to"]
    if reply:
        assert context["id"] == "parent" and context["sender_name"] == "captain"
        assert context["content"] == ("Allowed parent " + "x" * 120)[:100] + "..."
    else:
        assert context is None


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
async def test_valid_history_reply_and_main_deleted_filter_are_preserved(reply_http, subject):
    response = await request(reply_http, "messages", subject=subject)
    assert response.status_code == 200
    messages = response.json()["messages"]
    assert [m["id"] for m in messages] == ["parent", "child"]
    assert messages[-1]["reply_to"]["sender_name"] == "captain"
    assert messages[-1]["reply_to"]["content"] == messages[0]["content"][:100] + "..."


async def test_valid_pagination_and_reply_outside_page_are_preserved(reply_http):
    first = await request(reply_http, "messages", limit=1)
    assert first.status_code == 200 and first.json()["has_more"]
    assert first.json()["messages"][0]["id"] == "child"
    assert first.json()["messages"][0]["reply_to"]["id"] == "parent"
    previous = await request(reply_http, "messages", limit=1, before="child")
    assert previous.status_code == 200 and [m["id"] for m in previous.json()["messages"]] == ["parent"]
