"""Every Admin > Surf Forecast route refuses a caller without a token (401) and a signed-in non-admin (403).

Advisor limit on #1029-#1033: no test pinned the auth of the new admin routes. The routes are ENUMERATED from the
routers, so a route added later is covered without editing this file. Also pins the guardrail view's one-minute cache
(#1032: each open panel polled two private-bucket reads every 60 s).
"""
import re
import secrets

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import Profile, RoleEnum
from routes.admin import surf_forecast, surf_guardrail, surf_spot_inspector
from services import admin_guardrail_view as agv

ROUTERS = (surf_forecast.router, surf_spot_inspector.router, surf_guardrail.router)


def _routes():
    out = []
    for router in ROUTERS:
        for r in router.routes:
            if isinstance(r, APIRoute) and r.path.startswith("/admin/surf-forecast"):
                for method in sorted(r.methods - {"HEAD", "OPTIONS"}):
                    out.append((method, re.sub(r"\{[^}]+\}", "x1", r.path)))
    return out


ROUTES = _routes()


def test_the_enumeration_sees_the_routes_it_must_guard():
    paths = {p for _m, p in ROUTES}
    for must in ("/admin/surf-forecast/status", "/admin/surf-forecast/guardrail", "/admin/surf-forecast/spots",
                 "/admin/surf-forecast/spots/x1"):
        assert must in paths, must


@pytest_asyncio.fixture
async def client(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Profile.__table__.create(c))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(Profile(id="joe", user_id="joe", email="joe@example.invalid", full_name="Joe", role=RoleEnum.SURFER,
                       is_admin=False))
        await db.commit()
    app = FastAPI()
    for router in ROUTERS:
        app.include_router(router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db
    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
        yield c
    await engine.dispose()


@pytest.mark.parametrize("method,path", ROUTES)
async def test_no_token_is_401_and_a_non_admin_is_403(client, method, path):
    assert (await client.request(method, "/api" + path)).status_code == 401
    joe = {"Authorization": "Bearer " + security.create_access_token({"sub": "joe"})}
    assert (await client.request(method, "/api" + path, headers=joe)).status_code == 403


def test_the_guardrail_view_is_read_at_most_once_a_minute(monkeypatch):
    calls = []
    monkeypatch.setattr(agv, "guardrail_view", lambda: calls.append(1) or {"n": len(calls)})
    monkeypatch.setattr(agv, "_cache", {"at": None, "value": None})
    assert agv.cached_guardrail_view(now=1000.0) == {"n": 1}
    assert agv.cached_guardrail_view(now=1059.0) == {"n": 1}            # inside the minute: no new read
    assert agv.cached_guardrail_view(now=1060.5) == {"n": 2} and len(calls) == 2
