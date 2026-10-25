"""Existing crew metadata consumer through actual aggregate HTTP/JWT/ORM."""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import delete, event, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import Booking, BookingParticipant, CrewChatMessage, Profile, RoleEnum
from routes.crew import crew_chat, crew_chat_reactions, router as aggregate_router


@pytest_asyncio.fixture
async def info_http(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Booking, BookingParticipant, CrewChatMessage):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with maker() as db:
        for pid in ("captain", "crew", "photographer", "outsider", "foreign-photo", "creator-only"):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                           avatar_url="/fixture/" + pid + ".png", bio="Private fixture bio",
                           role=RoleEnum.PHOTOGRAPHER if "photo" in pid else RoleEnum.SURFER))
        for bid, creator, photographer in (("booking", "captain", "photographer"),
                                           ("foreign-booking", "outsider", "foreign-photo")):
            db.add(Booking(id=bid, creator_id=creator, photographer_id=photographer,
                           location=bid + " beach", session_date=start, total_price=700,
                           invite_code=bid, description="Private booking fixture"))
        for bid, pid in (("booking", "captain"), ("booking", "crew"), ("foreign-booking", "outsider")):
            db.add(BookingParticipant(booking_id=bid, participant_id=pid, is_captain=pid == "captain"))
        db.add(CrewChatMessage(id="message", booking_id="booking", sender_id="captain",
                               content="History control", created_at=start))
        await db.commit()
    queries = []

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def capture(connection, cursor, statement, parameters, context, executemany):
        queries.append(statement.lower())

    manager = crew_chat_reactions.CrewChatConnectionManager()
    manager.active_connections = {"booking": {pid: object() for pid in ("crew", "photographer", "outsider")},
                                  "foreign-booking": {"foreign-photo": object()}}
    monkeypatch.setattr(manager, "broadcast_to_booking", AsyncMock())
    monkeypatch.setattr(crew_chat_reactions, "crew_chat_manager", manager)
    monkeypatch.setattr(crew_chat, "crew_chat_manager", manager)
    app = FastAPI()
    app.include_router(aggregate_router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(client=client, maker=maker, queries=queries, manager=manager)
    finally:
        await engine.dispose()


async def info(fixture, subject="captain", *, actor=None, credential="valid", booking="booking"):
    headers = {}
    if credential != "missing":
        claims = {} if credential == "no-subject" else {"sub": subject}
        token = security.create_access_token(claims, expires_delta=timedelta(seconds=-5)
                                            if credential == "expired" else timedelta(minutes=5))
        headers["Authorization"] = "Bearer " + (token + "corrupt" if credential == "invalid" else token)
    fixture.queries.clear()
    before = {bid: dict(users) for bid, users in fixture.manager.active_connections.items()}
    response = await fixture.client.get(f"/api/crew-chat/{booking}/info", headers=headers,
                                        params={} if actor is None else {"user_id": actor})
    assert fixture.manager.active_connections == before
    fixture.manager.broadcast_to_booking.assert_not_awaited()
    assert all(sql.lstrip().startswith("select ") for sql in fixture.queries)
    return response


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("legacy", [False, True])
async def test_existing_consumer_metadata_is_minimal_and_booking_scoped(info_http, subject, legacy):
    response = await info(info_http, subject, actor=subject if legacy else None)
    assert response.status_code == 200
    data = response.json()
    assert set(data) == {"location", "participants", "online_users"}
    assert data["location"] == "booking beach"
    expected = [{"user_id": pid, "full_name": pid, "avatar_url": "/fixture/" + pid + ".png"}
                for pid in ("captain", "crew", "photographer")]
    assert data["participants"] == expected
    assert data["online_users"] == ["crew", "photographer"]
    assert not any("crew_chat_messages" in sql for sql in info_http.queries)


@pytest.mark.parametrize("credential", ["missing", "invalid", "expired", "no-subject"])
@pytest.mark.parametrize("actor", [None, "crew"])
@pytest.mark.parametrize("booking", ["booking", "unknown"])
async def test_invalid_credentials_refused_before_database(info_http, credential, actor, booking):
    response = await info(info_http, credential=credential, actor=actor, booking=booking)
    assert response.status_code == 401
    assert info_http.queries == []


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("actor", ["outsider", ""])
async def test_explicit_other_or_empty_actor_refused_before_database(info_http, subject, actor):
    response = await info(info_http, subject, actor=actor)
    assert response.status_code == 403
    assert info_http.queries == []


@pytest.mark.parametrize("legacy", [False, True])
@pytest.mark.parametrize("booking", ["booking", "unknown"])
async def test_outsider_cannot_read_booking_metadata(info_http, legacy, booking):
    response = await info(info_http, "outsider", actor="outsider" if legacy else None, booking=booking)
    assert response.status_code == 403
    assert response.json() == {"detail": "You don't have access to this chat"}


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("legacy", [False, True])
async def test_unknown_booking_refused_uniformly(info_http, subject, legacy):
    response = await info(info_http, subject, actor=subject if legacy else None, booking="unknown")
    assert response.status_code == 403
    assert response.json() == {"detail": "You don't have access to this chat"}


async def test_creator_without_existing_chat_membership_is_not_authorized(info_http):
    async with info_http.maker() as db:
        await db.execute(update(Booking).where(Booking.id == "booking").values(creator_id="creator-only"))
        await db.commit()
    response = await info(info_http, "creator-only")
    assert response.status_code == 403


async def test_photographer_with_empty_crew_still_gets_own_metadata(info_http):
    async with info_http.maker() as db:
        await db.execute(delete(BookingParticipant).where(BookingParticipant.booking_id == "booking"))
        await db.commit()
    response = await info(info_http, "photographer")
    assert response.status_code == 200
    assert response.json()["participants"] == [{"user_id": "photographer", "full_name": "photographer",
                                                 "avatar_url": "/fixture/photographer.png"}]
    assert response.json()["online_users"] == ["photographer"]


async def test_duplicate_roster_and_photographer_rows_do_not_duplicate_people(info_http):
    async with info_http.maker() as db:
        for pid in ("crew", "photographer"):
            db.add(BookingParticipant(booking_id="booking", participant_id=pid))
        await db.commit()
    response = await info(info_http)
    assert response.status_code == 200
    assert [p["user_id"] for p in response.json()["participants"]] == ["captain", "crew", "photographer"]


async def test_optional_avatar_remains_null(info_http):
    async with info_http.maker() as db:
        await db.execute(update(Profile).where(Profile.id == "crew").values(avatar_url=None))
        await db.commit()
    response = await info(info_http)
    assert response.status_code == 200
    assert response.json()["participants"][1] == {"user_id": "crew", "full_name": "crew", "avatar_url": None}


async def test_existing_history_is_a_mounted_authorized_positive_control(info_http):
    token = security.create_access_token({"sub": "captain"})
    response = await info_http.client.get("/api/crew-chat/booking/messages",
        headers={"Authorization": "Bearer " + token}, params={"user_id": "captain", "limit": 1})
    assert response.status_code == 200
    assert [message["id"] for message in response.json()["messages"]] == ["message"]


async def test_existing_public_emoji_route_is_a_router_positive_control(info_http):
    response = await info_http.client.get("/api/crew-chat/reaction-emojis")
    assert response.status_code == 200
    assert response.json()["emojis"]
