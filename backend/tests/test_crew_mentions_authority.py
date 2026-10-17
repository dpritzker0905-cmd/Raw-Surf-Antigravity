"""Crew mention search: real HTTP/JWT/service over synthetic database records."""
import secrets
from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core import security
from database import get_db
from models import Booking, Profile
from routes.crew import crew_chat


class Result:
    def __init__(self, rows):
        self.rows = rows

    def scalar_one_or_none(self):
        return self.rows[0] if self.rows else None

    def scalars(self):
        return self

    def all(self):
        return self.rows


@pytest.fixture
def mentions_http(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    booking = SimpleNamespace(id="booking", photographer_id="photographer", creator_id="captain",
                              participants=[SimpleNamespace(participant_id=u, is_captain=u == "captain")
                                            for u in ("captain", "crew")])
    profiles = {u: SimpleNamespace(id=u, full_name="Match " + u, avatar_url=None)
                for u in ("captain", "crew", "photographer", "own-follow", "victim-follow", "public")}
    follows = {"captain": ["own-follow"], "crew": ["victim-follow"], "outsider": ["own-follow"]}

    class DB:
        def __init__(self):
            self.statements = []

        async def execute(self, statement):
            self.statements.append(statement)
            params = statement.compile().params
            model = statement.column_descriptions[0]["entity"]
            if model is Booking:
                return Result([booking] if params.get("id_1") == booking.id else [])
            assert model is Profile
            if "follower_id_1" in params:
                ids = follows.get(params["follower_id_1"], [])
            elif "id_1" in params:
                ids = params["id_1"]
            else:
                ids = list(profiles)
            # SQLAlchemy names the exclusion bind id_1 on follow/public searches.
            excluded = params.get("id_1", []) if "follower_id_1" in params or "NOT IN" in str(statement) else []
            if "NOT IN" in str(statement) and "follower_id_1" not in params:
                ids = list(profiles)
            needle = params.get("full_name_1", "%%").strip("%").lower()
            rows = [profiles[u] for u in ids if u not in excluded and needle in profiles[u].full_name.lower()]
            return Result(rows[:params.get("param_1", 10)])

    db = DB()

    async def dependency():
        yield db

    app = FastAPI()
    app.include_router(crew_chat.router, prefix="/api")
    app.dependency_overrides[get_db] = dependency
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, db=db)


def auth(subject="captain", credential="valid"):
    if credential == "missing":
        return {}
    claims = {} if credential == "no_subject" else {"sub": subject}
    token = security.create_access_token(claims, expires_delta=timedelta(seconds=-5)
                                        if credential == "expired" else timedelta(minutes=5))
    if credential == "invalid":
        token += "corrupt"
    return {"Authorization": "Bearer " + token}


def search(fixture, *, subject="captain", credential="valid", actor="captain", context="crew_chat",
           context_id="booking", query="match", limit=10):
    params = {"query": query, "context": context, "limit": limit}
    if actor is not None:
        params["user_id"] = actor
    if context_id is not None:
        params["context_id"] = context_id
    return fixture.client.get("/api/mentions/search", params=params, headers=auth(subject, credential))


@pytest.mark.parametrize("credential", ["missing", "invalid", "expired", "no_subject"])
@pytest.mark.parametrize("context_id", [None, "booking"])
def test_invalid_auth_cannot_search_as_member(mentions_http, credential, context_id):
    response = search(mentions_http, credential=credential, context_id=context_id)
    assert response.status_code == 401
    assert mentions_http.db.statements == []


@pytest.mark.parametrize("actor", [None, "captain", "outsider"])
def test_outsider_cannot_disclose_booking_priority(mentions_http, actor):
    response = search(mentions_http, subject="outsider", actor=actor)
    assert response.status_code == 403
    assert len(mentions_http.db.statements) == 1


@pytest.mark.parametrize("subject", ["captain", "crew", "photographer"])
@pytest.mark.parametrize("actor", [None, "captain", "outsider"])
def test_authorized_roles_get_actual_booking_priority(mentions_http, subject, actor):
    response = search(mentions_http, subject=subject, actor=actor)
    assert response.status_code == 200
    users = response.json()["users"]
    priority = {u["user_id"] for u in users if u["is_priority"]}
    assert priority == {"captain", "crew", "photographer"} - {subject}
    assert subject not in {u["user_id"] for u in users}
    assert set(users[0]) == {"user_id", "username", "full_name", "avatar_url", "is_priority"}


@pytest.mark.parametrize("actor", [None, "captain"])
def test_unknown_booking_is_forbidden_before_profile_search(mentions_http, actor):
    response = search(mentions_http, actor=actor, context_id="absent")
    assert response.status_code == 403 and len(mentions_http.db.statements) == 1


@pytest.mark.parametrize("context", ["crew_chat", "comment", "post"])
@pytest.mark.parametrize("actor", [None, "crew"])
def test_context_free_search_uses_verified_follow_graph(mentions_http, context, actor):
    response = search(mentions_http, actor=actor, context=context, context_id=None, query="", limit=1)
    assert response.status_code == 200
    assert response.json()["users"][0]["user_id"] == "own-follow"
    assert not response.json()["users"][0]["is_priority"]


def test_public_fallback_and_limit_preserved(mentions_http):
    response = search(mentions_http, context="post", context_id="post", query="public", limit=1)
    assert response.status_code == 200
    assert [u["user_id"] for u in response.json()["users"]] == ["public"]
    assert response.json()["users"][0]["is_priority"] is False


def test_no_matches_stays_empty(mentions_http):
    assert search(mentions_http, query="absent").json() == {"users": []}
