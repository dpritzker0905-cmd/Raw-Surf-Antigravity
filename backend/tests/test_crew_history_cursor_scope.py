"""Booking-scoped visible history cursors through real HTTP, JWT and ORM."""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import Booking, BookingParticipant, CrewChatMessage, Profile, RoleEnum
from routes.crew import crew_chat, crew_chat_reactions


@pytest_asyncio.fixture
async def history_http(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Booking, BookingParticipant, CrewChatMessage):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with maker() as db:
        for pid in ("captain", "crew", "photographer", "outsider"):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                           role=RoleEnum.PHOTOGRAPHER if pid == "photographer" else RoleEnum.SURFER))
        for bid, creator in (("booking", "captain"), ("foreign-booking", "outsider")):
            db.add(Booking(id=bid, creator_id=creator, photographer_id="photographer",
                           location="Fixture beach", session_date=start, total_price=0))
        for pid in ("captain", "crew"):
            db.add(BookingParticipant(booking_id="booking", participant_id=pid, is_captain=pid == "captain"))
        db.add(BookingParticipant(booking_id="foreign-booking", participant_id="outsider", is_captain=True))
        for mid, bid, seconds, deleted in (("old", "booking", 0, False), ("middle", "booking", 1, False),
                                            ("new", "booking", 2, False), ("deleted", "booking", 1.5, True),
                                            ("foreign", "foreign-booking", 1.5, False),
                                            ("foreign-deleted", "foreign-booking", 1.5, True)):
            db.add(CrewChatMessage(id=mid, booking_id=bid, sender_id="captain" if bid == "booking" else "outsider",
                                   content="Fixture " + mid, created_at=start + timedelta(seconds=seconds), is_deleted=deleted))
        await db.commit()
    queries = []

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def capture(connection, cursor, statement, parameters, context, executemany):
        queries.append(statement.lower())

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
            yield SimpleNamespace(client=client, maker=maker, queries=queries, start=start, manager=manager)
    finally:
        await engine.dispose()


async def history(fixture, *, subject="captain", actor=None, credential="valid", booking="booking", before=None, limit=50):
    claims = {} if credential == "no_subject" else {"sub": subject}
    token = security.create_access_token(claims, expires_delta=timedelta(seconds=-5)
                                        if credential == "expired" else timedelta(minutes=5))
    if credential == "invalid":
        token += "corrupt"
    headers = {} if credential == "missing" else {"Authorization": "Bearer " + token}
    params = {"user_id": subject if actor is None else actor, "limit": limit}
    if before is not None:
        params["before"] = before
    fixture.queries.clear()
    return await fixture.client.get(f"/api/crew-chat/{booking}/messages", params=params, headers=headers)


def assert_read_only(fixture):
    fixture.manager.broadcast_to_booking.assert_not_called()
    assert all(statement.lstrip().startswith("select") for statement in fixture.queries)


def assert_no_message_query(fixture):
    assert not any("from " + CrewChatMessage.__tablename__ in statement for statement in fixture.queries)
    assert_read_only(fixture)


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("before", ["foreign", "foreign-deleted", "deleted", "missing"])
@pytest.mark.parametrize("limit", [1, 50])
async def test_unusable_cursor_is_uniformly_refused_for_authorized_roles(history_http, subject, before, limit):
    response = await history(history_http, subject=subject, before=before, limit=limit)
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid message cursor"}
    assert_read_only(history_http)


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
async def test_whitespace_cursor_is_unknown_instead_of_restarting_history(history_http, subject):
    response = await history(history_http, subject=subject, before=" \t ")
    assert response.status_code == 400
    assert response.json() == {"detail": "Invalid message cursor"}
    assert_read_only(history_http)


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("limit,expected", [(1, ["middle"]), (50, ["old", "middle"])])
async def test_visible_same_booking_cursor_preserves_pagination(history_http, subject, limit, expected):
    response = await history(history_http, subject=subject, before="new", limit=limit)
    assert response.status_code == 200
    data = response.json()
    assert [row["id"] for row in data["messages"]] == expected
    assert all(row["booking_id"] == "booking" for row in data["messages"])
    assert data["my_role"] == subject and data["online_users"] == []
    assert data["has_more"] == (limit == 1)
    assert_read_only(history_http)


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("before", [None, ""])
async def test_absent_or_empty_cursor_preserves_visible_first_page(history_http, subject, before):
    response = await history(history_http, subject=subject, before=before)
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["messages"]] == ["old", "middle", "new"]
    assert not response.json()["has_more"]
    assert_read_only(history_http)


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
async def test_oldest_visible_cursor_returns_an_empty_page(history_http, subject):
    response = await history(history_http, subject=subject, before="old")
    assert response.status_code == 200
    assert response.json()["messages"] == [] and not response.json()["has_more"]
    assert_read_only(history_http)


async def test_existing_strict_timestamp_boundary_is_preserved(history_http):
    async with history_http.maker() as db:
        for mid in ("tie-a", "tie-b"):
            db.add(CrewChatMessage(id=mid, booking_id="booking", sender_id="captain", content=mid,
                                   created_at=history_http.start + timedelta(seconds=1.5)))
        await db.commit()
    response = await history(history_http, before="tie-a")
    assert response.status_code == 200
    assert [row["id"] for row in response.json()["messages"]] == ["old", "middle"]
    assert_read_only(history_http)


@pytest.mark.parametrize("credential", ["missing", "invalid", "expired", "no_subject"])
@pytest.mark.parametrize("before", ["new", "foreign", "deleted", "missing"])
async def test_credentials_are_denied_before_any_database_access(history_http, credential, before):
    response = await history(history_http, credential=credential, before=before)
    assert response.status_code == 401 and "messages" not in response.json()
    assert history_http.queries == []


@pytest.mark.parametrize("before", ["new", "foreign", "deleted", "missing"])
async def test_outsider_is_denied_before_cursor_lookup(history_http, before):
    response = await history(history_http, subject="outsider", before=before)
    assert response.status_code == 403 and "messages" not in response.json()
    assert_no_message_query(history_http)


@pytest.mark.parametrize("before", ["new", "foreign"])
async def test_actor_mismatch_is_denied_before_database_access(history_http, before):
    response = await history(history_http, actor="crew", before=before)
    assert response.status_code == 403 and "messages" not in response.json()
    assert history_http.queries == []


@pytest.mark.parametrize("before", ["new", "foreign", "missing"])
async def test_missing_booking_is_denied_before_cursor_lookup(history_http, before):
    response = await history(history_http, booking="missing-booking", before=before)
    assert response.status_code == 403 and "messages" not in response.json()
    assert_no_message_query(history_http)
