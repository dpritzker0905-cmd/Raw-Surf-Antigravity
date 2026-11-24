"""Offline profile-note visibility through the mounted route and authenticated session."""
import secrets
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import URL
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import Base, get_db
from models import Follow, Profile, RoleEnum, UserNote
from routes.content.notes import router


@pytest_asyncio.fixture
async def notes_client(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(32))
    engine = create_async_engine(URL.create("sqlite+aiosqlite", database=":memory:"))
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def get_test_db():
        async with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = get_test_db
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all, tables=[
                Profile.__table__, Follow.__table__, UserNote.__table__,
            ])
        async with sessions.begin() as db:
            for user in ["owner", "friend", "one-way", "other"]:
                db.add(Profile(id=user, user_id=user, email=f"{user}@example.invalid", role=RoleEnum.SURFER))
            db.add_all([
                Follow(follower_id="owner", following_id="friend"),
                Follow(follower_id="friend", following_id="owner"),
                Follow(follower_id="one-way", following_id="owner"),
                UserNote(id="note", user_id="owner", content="Dawn patrol",
                         expires_at=datetime.now(timezone.utc) + timedelta(hours=1)),
            ])
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            yield client
    finally:
        await engine.dispose()


def session_headers(user):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": user})}


@pytest.mark.asyncio
async def test_note_requires_sign_in(notes_client):
    response = await notes_client.get("/notes/user/owner")
    assert response.status_code == 401


@pytest.mark.asyncio
@pytest.mark.parametrize("legacy_viewer", [None, "owner", "previous-viewer"])
async def test_owner_can_read_without_counting_a_view(notes_client, legacy_viewer):
    response = await notes_client.get(
        "/notes/user/owner", headers=session_headers("owner"),
        params={"viewer_id": legacy_viewer} if legacy_viewer else {},
    )
    assert response.status_code == 200
    data = response.json()
    assert data["note"]["content"] == "Dawn patrol"
    assert data["note"]["is_own_note"]
    assert data["note"]["view_count"] == 0


@pytest.mark.asyncio
async def test_mutual_follower_can_read_and_counts_one_view(notes_client):
    response = await notes_client.get("/notes/user/owner", headers=session_headers("friend"))
    assert response.status_code == 200
    data = response.json()
    assert data["is_mutual_follower"]
    assert data["note"]["is_own_note"] is False
    assert data["note"]["view_count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("viewer", ["one-way", "other"])
async def test_non_mutual_viewer_has_no_note_and_adds_no_view(notes_client, viewer):
    response = await notes_client.get("/notes/user/owner", headers=session_headers(viewer))
    assert response.status_code == 200
    assert response.json() == {"note": None, "is_mutual_follower": False}
    owner_read = await notes_client.get("/notes/user/owner", headers=session_headers("owner"))
    assert owner_read.json()["note"]["view_count"] == 0
