"""DM mention context authority through real HTTP, JWT and asynchronous ORM."""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import delete, event
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import Conversation, ConversationParticipant, Follow, Profile, RoleEnum
from routes.crew.crew_chat import router


@pytest_asyncio.fixture
async def dm_http(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Conversation, ConversationParticipant, Follow):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid in ("one", "two", "group", "departed", "outsider", "public", "followed"):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid",
                           full_name="Match " + pid, role=RoleEnum.SURFER))
        conversations = {}
        for cid in ("legacy", "direct", "group", "missing-row", "deleted"):
            conversations[cid] = Conversation(id=cid, participant_one_id="one", participant_two_id="two")
            db.add(conversations[cid])
        now = datetime.now(timezone.utc)
        for cid, active, left in (("direct", ("one", "two"), ("departed",)),
                                  ("group", ("one", "group"), ("two", "departed")),
                                  ("missing-row", ("one", "group"), ())):
            for pid in (*active, *left):
                db.add(ConversationParticipant(conversation_id=cid, user_id=pid,
                                               left_at=now if pid in left else None))
        # SQLite permits this orphan by default: it must not authorize a missing parent.
        db.add(ConversationParticipant(conversation_id="orphan", user_id="outsider"))
        for pid in ("one", "two", "group", "departed", "outsider"):
            db.add(Follow(follower_id=pid, following_id="followed"))
        await db.flush()
        await db.execute(delete(Conversation).where(Conversation.id == "deleted"))
        await db.commit()
    queries = []

    @event.listens_for(engine.sync_engine, "before_cursor_execute")
    def capture(connection, cursor, statement, parameters, context, executemany):
        queries.append(statement.lower())

    app = FastAPI()
    app.include_router(router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(client=client, maker=maker, queries=queries)
    finally:
        await engine.dispose()


async def search(fixture, subject="one", conversation="legacy", *, legacy=False, actor=None,
                 credential="valid", query="match", context="dm"):
    claims = {} if credential == "no_subject" else {"sub": subject}
    token = security.create_access_token(claims, expires_delta=timedelta(seconds=-5)
                                        if credential == "expired" else timedelta(minutes=5))
    if credential == "invalid":
        token += "corrupt"
    headers = {} if credential == "missing" else {"Authorization": "Bearer " + token}
    params = {"query": query, "context": context}
    if conversation is not None:
        params["context_id"] = conversation
    if legacy or actor is not None:
        params["user_id"] = subject if actor is None else actor
    fixture.queries.clear()
    return await fixture.client.get("/api/mentions/search", params=params, headers=headers)


def assert_read_only(fixture):
    assert all(statement.lstrip().startswith("select") for statement in fixture.queries)


def assert_denied_before_discovery(fixture, response, status=403):
    assert response.status_code == status
    assert "users" not in response.json()
    assert not any("from profiles" in statement or "from follows" in statement for statement in fixture.queries)
    assert_read_only(fixture)


@pytest.mark.parametrize("query", ["match", ""])
async def test_existing_member_discovery_positive_control(dm_http, query):
    response = await search(dm_http, "group", "group", legacy=True, query=query)
    assert response.status_code == 200
    rows = response.json()["users"]
    assert any(row["user_id"] == "followed" and not row["is_priority"] for row in rows)
    if query:
        assert any(row["user_id"] == "one" and row["is_priority"] for row in rows)
    assert_read_only(dm_http)


@pytest.mark.parametrize("conversation,subject,priority", [
    ("legacy", "one", {"two"}), ("legacy", "two", {"one"}),
    ("direct", "one", {"two"}), ("direct", "two", {"one"}),
    ("group", "group", {"one"}),
])
@pytest.mark.parametrize("legacy", [False, True])
async def test_current_members_get_only_active_priority_and_public_fallback(dm_http, conversation, subject, priority, legacy):
    response = await search(dm_http, subject, conversation, legacy=legacy)
    assert response.status_code == 200
    rows = response.json()["users"]
    assert {row["user_id"] for row in rows if row["is_priority"]} == priority
    assert subject not in {row["user_id"] for row in rows}
    assert any(row["user_id"] == "public" and not row["is_priority"] for row in rows)
    assert any(row["user_id"] == "followed" and not row["is_priority"] for row in rows)
    assert all(not row["is_priority"] for row in rows if row["user_id"] == "departed")
    assert_read_only(dm_http)


DENIED = [("legacy", "outsider"), ("direct", "outsider"), ("group", "outsider"),
          ("group", "two"), ("group", "departed"), ("missing-row", "two"),
          ("missing", "one"), ("deleted", "one"), ("orphan", "outsider")]


@pytest.mark.parametrize("conversation,subject", DENIED)
@pytest.mark.parametrize("query", ["match", "", "no-result-at-all"])
async def test_private_context_denial_precedes_priority_followers_and_public_search(dm_http, conversation, subject, query):
    response = await search(dm_http, subject, conversation, legacy=True, query=query)
    assert_denied_before_discovery(dm_http, response)


@pytest.mark.parametrize("conversation,subject", [("legacy", "outsider"), ("group", "two"),
                                                 ("missing-row", "two"), ("missing", "one")])
async def test_jwt_only_denial_uses_the_same_authority_boundary(dm_http, conversation, subject):
    assert_denied_before_discovery(dm_http, await search(dm_http, subject, conversation))


@pytest.mark.parametrize("credential", ["missing", "invalid", "expired", "no_subject"])
@pytest.mark.parametrize("selector", [None, "one", "outsider"])
async def test_credentials_are_required_even_with_a_legacy_actor_selector(dm_http, credential, selector):
    response = await search(dm_http, actor=selector, credential=credential)
    assert_denied_before_discovery(dm_http, response, 401)


@pytest.mark.parametrize("conversation", [None, "", " \t "])
async def test_dm_requires_a_nonblank_context_before_discovery(dm_http, conversation):
    assert_denied_before_discovery(dm_http, await search(dm_http, conversation=conversation, legacy=True), 400)


@pytest.mark.parametrize("subject,actor", [("outsider", "one"), ("one", "two")])
@pytest.mark.parametrize("context", ["dm", "post"])
async def test_legacy_query_cannot_borrow_another_identity(dm_http, subject, actor, context):
    response = await search(dm_http, subject, actor=actor, context=context)
    assert_denied_before_discovery(dm_http, response)


@pytest.mark.parametrize("context", ["post", "comment", "crew_chat"])
@pytest.mark.parametrize("legacy", [False, True])
async def test_authenticated_non_dm_discovery_contract_is_preserved(dm_http, context, legacy):
    response = await search(dm_http, context=context, conversation=None, legacy=legacy)
    assert response.status_code == 200
    assert response.json()["users"]
    assert not any(row["is_priority"] for row in response.json()["users"])
    assert "one" not in {row["user_id"] for row in response.json()["users"]}
    assert_read_only(dm_http)


async def test_membership_is_rechecked_after_a_member_leaves(dm_http):
    response = await search(dm_http, "group", "group", legacy=True)
    assert response.status_code == 200
    async with dm_http.maker() as db:
        from sqlalchemy import select
        member = (await db.execute(select(ConversationParticipant).where(
            ConversationParticipant.conversation_id == "group", ConversationParticipant.user_id == "group"
        ))).scalar_one()
        member.left_at = datetime.now(timezone.utc)
        await db.commit()
    assert_denied_before_discovery(dm_http, await search(dm_http, "group", "group", legacy=True))
