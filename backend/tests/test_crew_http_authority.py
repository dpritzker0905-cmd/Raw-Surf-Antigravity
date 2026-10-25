"""P1 residual: real HTTP routes/JWT/membership over synthetic records, no live service."""
import secrets
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from core import security
from database import get_db
from models import Booking, CrewChatMessage, Profile
from routes.crew import crew_chat, crew_chat_reactions as reactions


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
def crew_http(monkeypatch):
    # Signing material is ephemeral and never persisted in source/evidence.
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    booking = SimpleNamespace(id="booking", creator_id="member-a", photographer_id="photographer",
                              participants=[SimpleNamespace(participant_id=u, is_captain=u == "member-a")
                                            for u in ("member-a", "member-b")])
    messages = [SimpleNamespace(id="message", booking_id="booking", sender_id="photographer",
                                is_deleted=False, read_by={}, reactions={reactions.REACTION_EMOJIS[0]: ["member-a"]}),
                SimpleNamespace(id="second", booking_id="booking", sender_id="member-a",
                                is_deleted=False, read_by={"member-b": "existing"}, reactions={})]
    profiles = {u: SimpleNamespace(id=u, full_name=u, avatar_url=None)
                for u in ("member-a", "member-b", "photographer")}
    foreign = SimpleNamespace(id="foreign-message", booking_id="other-booking", sender_id="outsider",
                              is_deleted=False, read_by={}, reactions={reactions.REACTION_EMOJIS[0]: ["outsider"]})

    class DB:
        def __init__(self):
            self.statements = []
            self.commits = 0

        async def execute(self, query):
            self.statements.append(query)
            params = query.compile().params
            model = query.column_descriptions[0]["entity"]
            if model is Booking:
                return Result([booking] if params.get("id_1") == booking.id else [])
            if model is Profile:
                profile = profiles.get(params.get("id_1"))
                return Result([profile] if profile else [])
            assert model is CrewChatMessage
            rows = [m for m in messages + [foreign] if m.booking_id == params["booking_id_1"]]
            if "id_1" in params:
                rows = [m for m in rows if m.id == params["id_1"]]
            if "sender_id_1" in params:
                rows = [m for m in rows if m.sender_id != params["sender_id_1"] and not m.is_deleted]
            return Result(rows)

        async def commit(self):
            self.commits += 1

    db = DB()

    async def dependency():
        yield db

    manager = reactions.CrewChatConnectionManager()
    monkeypatch.setattr(manager, "broadcast_to_booking", AsyncMock())
    monkeypatch.setattr(reactions, "crew_chat_manager", manager)
    monkeypatch.setattr(crew_chat, "crew_chat_manager", manager)
    app = FastAPI()
    app.include_router(crew_chat.router, prefix="/api")
    app.include_router(reactions.router, prefix="/api")
    app.dependency_overrides[get_db] = dependency
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, db=db, messages=messages, manager=manager)


def headers(subject="member-a", credential="valid"):
    if credential == "missing":
        return {}
    claims = {} if credential == "no_subject" else {"sub": subject}
    token = security.create_access_token(claims, expires_delta=timedelta(seconds=-5)
                                        if credential == "expired" else timedelta(minutes=5))
    if credential == "invalid":
        token += "corrupt"
    return {"Authorization": "Bearer " + token}


def request(fixture, endpoint, *, auth=None, actor="member-a", booking="booking", message="message"):
    path = f"/api/crew-chat/{booking}"
    path += f"/messages/{message}/reactions" if endpoint == "reactions" else "/mark-read"
    return fixture.client.request("GET" if endpoint == "reactions" else "POST", path,
                                  params={} if actor is None else {"user_id": actor}, headers=auth or {})


@pytest.mark.parametrize("endpoint", ["reactions", "mark-read"])
@pytest.mark.parametrize("credential", ["missing", "invalid", "expired", "no_subject"])
def test_bad_credentials_cannot_read_or_mutate_member_state(crew_http, endpoint, credential):
    response = request(crew_http, endpoint, auth=headers(credential=credential))
    assert response.status_code == 401
    assert crew_http.db.statements == []
    assert crew_http.db.commits == 0 and crew_http.messages[0].read_by == {}


@pytest.mark.parametrize("endpoint", ["reactions", "mark-read"])
def test_authenticated_outsider_cannot_borrow_member_query_identity(crew_http, endpoint):
    response = request(crew_http, endpoint, auth=headers("outsider"), actor="member-a")
    assert response.status_code == 403
    assert len(crew_http.db.statements) == 1 and crew_http.db.commits == 0
    assert crew_http.messages[0].read_by == {}


@pytest.mark.parametrize("endpoint", ["reactions", "mark-read"])
@pytest.mark.parametrize("subject", ["member-a", "member-b", "photographer"])
@pytest.mark.parametrize("legacy_query", [False, True])
def test_authorized_roles_work_with_and_without_legacy_query(crew_http, endpoint, subject, legacy_query):
    response = request(crew_http, endpoint, auth=headers(subject), actor=subject if legacy_query else None)
    assert response.status_code == 200
    if endpoint == "reactions":
        assert response.json()["total_count"] == 1
        assert response.json()["reactions"][reactions.REACTION_EMOJIS[0]][0]["user_id"] == "member-a"
        assert crew_http.db.commits == 0
    else:
        assert response.json()["success"] is True and crew_http.db.commits == 1


@pytest.mark.parametrize("subject", ["member-a", "member-b", "photographer"])
def test_mark_read_uses_verified_subject_even_if_query_names_another_member(crew_http, subject):
    other = "member-b" if subject != "member-b" else "member-a"
    before = [dict(m.read_by) for m in crew_http.messages]
    response = request(crew_http, "mark-read", auth=headers(subject), actor=other)
    assert response.status_code == 200
    for msg, original in zip(crew_http.messages, before):
        assert msg.read_by.get(other) == original.get(other)
        if msg.sender_id != subject and subject not in original:
            assert subject in msg.read_by
        else:
            assert msg.read_by == original


@pytest.mark.parametrize("endpoint", ["reactions", "mark-read"])
def test_unknown_booking_stays_forbidden(crew_http, endpoint):
    assert request(crew_http, endpoint, auth=headers(), booking="absent").status_code == 403
    assert crew_http.db.commits == 0


@pytest.mark.parametrize("message,booking", [("absent", "booking"), ("foreign-message", "booking")])
def test_missing_or_foreign_message_is_not_disclosed(crew_http, message, booking):
    assert request(crew_http, "reactions", auth=headers(), message=message, booking=booking).status_code == 404


def test_public_emoji_catalogue_stays_public(crew_http):
    response = crew_http.client.get("/api/crew-chat/reaction-emojis")
    assert response.status_code == 200 and response.json()["emojis"] == reactions.REACTION_EMOJIS


def test_adjacent_reaction_write_broadcasts_verified_actor(crew_http):
    response = crew_http.client.post("/api/crew-chat/booking/messages/message/react",
                                    params={"emoji": reactions.REACTION_EMOJIS[1], "user_id": "member-b"},
                                    headers=headers())
    assert response.status_code == 200
    assert response.json()["reactions"][reactions.REACTION_EMOJIS[1]] == ["member-a"]
    event = crew_http.manager.broadcast_to_booking.call_args.args[1]
    assert event["data"]["user_id"] == "member-a"


@pytest.mark.parametrize("credential", ["missing", "invalid", "expired", "no_subject"])
def test_existing_history_authority_is_preserved(crew_http, credential):
    response = crew_http.client.get("/api/crew-chat/booking/messages", params={"user_id": "member-a"},
                                   headers=headers(credential=credential))
    assert response.status_code == 401 and crew_http.db.statements == []
