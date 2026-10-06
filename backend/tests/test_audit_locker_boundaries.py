"""Locker HTTP boundaries: real JWT validation, synthetic reads, no customer writes."""
import asyncio
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from core.security import create_access_token
from database import get_db
from routes.surfer_gallery import gallery_core, claims, schemas


CASES = [
    ("GET", "/?surfer_id=owner", None, 200),
    ("GET", "/my-gallery/owner?visibility_filter=private", None, 200),
    ("GET", "/claim-queue?surfer_id=owner", None, 200),
    ("GET", "/claim-queue/owner", None, 200),
    ("GET", "/claim-queue-count/owner", None, 200),
    ("GET", "/pending-selections?surfer_id=owner", None, 200),
    ("GET", "/purchase-history?surfer_id=owner", None, 200),
    ("PUT", "/fixture/visibility?surfer_id=owner&is_public=true", None, 404),
    ("PUT", "/fixture/favorite", {"surfer_id": "owner", "is_favorite": False}, 404),
    ("POST", "/fixture/request-edit?surfer_id=owner&message=test", None, 404),
    ("PATCH", "/item/fixture/visibility?surfer_id=owner", {"is_public": True}, 404),
    ("GET", "/download/fixture?surfer_id=owner", None, 404),
    ("POST", "/add-from-booking?surfer_id=owner&booking_id=missing", None, 404),
    ("POST", "/scan-locker?surfer_id=owner", {"selfie_url": "https://images.example.invalid/selfie"}, 503),
]


class EmptyResult:
    def __init__(self, row=None):
        self.row = row

    def scalar_one_or_none(self):
        return self.row

    def scalar(self):
        return 0

    def scalars(self):
        return self

    def all(self):
        return []

    def fetchall(self):
        return []

    def fetchone(self):
        return None


class ReadDB:
    def __init__(self, queue=None):
        self.queries = []
        self.commits = 0
        self.queue = queue

    async def execute(self, statement):
        self.queries.append(statement)
        sql = str(statement)
        if "FROM surfer_gallery_claim_queue" in sql:
            return EmptyResult(self.queue)
        if "FROM profiles" in sql and "JOIN" not in sql:
            return EmptyResult(SimpleNamespace(id="owner"))
        return EmptyResult()

    async def commit(self):
        self.commits += 1


def request(method, path, body, actor, db):
    app = FastAPI()
    app.include_router(gallery_core.router, prefix="/locker")
    app.include_router(claims.router, prefix="/locker")

    async def database():
        yield db

    app.dependency_overrides[get_db] = database
    headers = {} if actor is None else {
        "Authorization": "Bearer " + ("invalid" if actor == "invalid" else create_access_token({"sub": actor})),
    }

    async def perform():
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            return await client.request(method, "/locker" + path, json=body, headers=headers)

    return asyncio.run(perform())


@pytest.mark.parametrize("method,path,body,owner_status", CASES)
@pytest.mark.parametrize("actor", [None, "invalid", "foreign", "owner"])
def test_private_locker_requires_authenticated_owner(method, path, body, owner_status, actor):
    db = ReadDB()
    response = request(method, path, body, actor, db)
    expected = owner_status if actor == "owner" else (403 if actor == "foreign" else 401)
    assert response.status_code == expected
    assert db.commits == 0
    if actor != "owner" or owner_status == 503:
        assert db.queries == []
    if actor == "owner" and owner_status == 200:
        assert db.queries  # An owner read reaches real SQL construction.


@pytest.mark.parametrize("actor,expected", [(None, 401), ("invalid", 401), ("foreign", 403), ("owner", 200)])
def test_queue_action_uses_stored_owner_before_status_or_write(actor, expected):
    queue = SimpleNamespace(surfer_id="owner", status="pending")
    db = ReadDB(queue)
    response = request("POST", "/claim-queue/fixture/action", {"action": "reject"}, actor, db)
    assert response.status_code == expected
    assert queue.status == ("rejected" if actor == "owner" else "pending")
    assert db.commits == (1 if actor == "owner" else 0)
    assert len(db.queries) == (0 if actor in (None, "invalid") else 1)


def test_unavailable_background_matcher_cannot_read_or_fabricate_claims(monkeypatch):
    def forbidden():
        raise AssertionError("Unavailable identity matching must not open a database")

    monkeypatch.setattr(schemas, "AsyncSessionLocal", forbidden)
    result = asyncio.run(schemas.async_global_scan("owner", "https://images.example.invalid/selfie"))
    assert result["analysis_status"] == "unavailable"


def test_public_preview_route_remains_anonymous_and_filters_paid_public_items():
    db = ReadDB()
    response = request("GET", "/public/owner", None, None, db)
    assert response.status_code == 200 and response.json() == {"items": [], "count": 0}
    sql = str(db.queries[0])
    assert "is_public = true" in sql and "is_paid = true" in sql
    assert db.commits == 0
