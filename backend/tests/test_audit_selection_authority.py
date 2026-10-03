"""Selection JWT and quota-owner boundaries before reads or mutations."""
import asyncio
import datetime
import types

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from core.security import create_access_token
from database import get_db
from routes.surfer_gallery import selection

OWNER = "fixture-owner"


class Result:
    def __init__(self, rows):
        self.rows = rows

    def scalars(self):
        return self

    def all(self):
        return self.rows

    def scalar_one_or_none(self):
        return self.rows[0] if self.rows else None


class SelectionDB:
    def __init__(self, quota):
        self.quota = quota
        self.queries = []
        self.commits = 0

    async def execute(self, statement, *args, **kwargs):
        self.queries.append(str(statement))
        if "FROM surfer_selection_quotas" in str(statement):
            return Result([self.quota] if self.quota is not None else [])
        return Result([])

    async def commit(self):
        self.commits += 1


def quota(expired=False):
    return types.SimpleNamespace(
        id="fixture-quota", surfer_id=OWNER, photographer_id="fixture-photographer",
        status="pending_selection", photos_allowed=2, photos_selected=0,
        videos_allowed=0, videos_selected=0, booking_id="fixture-booking",
        live_session_id=None, photographer=None, expiry_reminder_sent=False,
        auto_select_on_expiry=None,
        selection_deadline=datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=-1 if expired else 100),
    )


def request(route, actor, db):
    app = FastAPI()
    app.include_router(selection.router, prefix="/api/surfer-gallery")

    async def database():
        yield db

    app.dependency_overrides[get_db] = database
    headers = {} if actor is None else {
        "Authorization": "Bearer " + ("invalid" if actor == "invalid" else create_access_token({"sub": actor})),
    }
    if route == "queue":
        method, url, body = "GET", "/selection-queue/" + OWNER, None
    else:
        suffix = {"select": "select", "items": "items", "preference": "preference", "deadline": "deadline-info"}[route]
        method = {"select": "POST", "preference": "PATCH"}.get(route, "GET")
        url = "/selection-queue/fixture-quota/" + suffix
        body = {"item_ids": []} if route == "select" else (
            {"auto_select_on_expiry": False} if route == "preference" else None
        )

    async def perform():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, "/api/surfer-gallery" + url, headers=headers, json=body)

    return asyncio.run(perform())


@pytest.mark.parametrize("route", ["queue", "select", "items", "preference", "deadline"])
@pytest.mark.parametrize("actor,expected", [(None, 401), ("invalid", 401), ("foreign", 403), (OWNER, 200)])
def test_selection_actor_and_quota_owner_controls(route, actor, expected):
    row = quota()
    db = SelectionDB(None if route == "queue" else row)
    initial = vars(row).copy()
    response = request(route, actor, db)
    assert response.status_code == expected
    if expected != 200:
        assert db.commits == 0 and vars(row) == initial
        assert "fixture-photographer" not in response.text
        if actor in (None, "invalid") or route == "queue":
            assert db.queries == []
        else:
            assert len(db.queries) == 1
    elif route == "queue":
        assert response.json() == {"quotas": [], "pending_count": 0}
    elif route == "preference":
        assert row.auto_select_on_expiry is False and db.commits == 1
    elif route == "select":
        assert response.json()["success"] is True and db.commits == 1
        assert row.photos_selected == 0


@pytest.mark.parametrize("route", ["select", "items", "preference", "deadline"])
def test_owner_missing_quota_remains_not_found(route):
    db = SelectionDB(None)
    assert request(route, OWNER, db).status_code == 404
    assert db.commits == 0 and len(db.queries) == 1


def test_foreign_owner_cannot_expire_quota_or_change_preferences():
    row = quota(expired=True)
    db = SelectionDB(row)
    initial = vars(row).copy()
    assert request("select", "foreign", db).status_code == 403
    assert row.status == "pending_selection" and db.commits == 0
    assert request("preference", "foreign", db).status_code == 403
    assert vars(row) == initial and db.commits == 0
