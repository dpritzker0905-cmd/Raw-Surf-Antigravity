"""XP has ONE write path (services/xp.py): server-decided amounts, replay-safe, ledger and cache in step.

Two kinds of test. A real-SQLite check of `grant_xp` itself (amount from the rule table, once per reference,
hot-streak doubling, `Profile.xp_total` equals the ledger sum). And structural guards so a new XP-minting route or
a direct `xp_total` write cannot come back: no mounted route takes an XP amount from a request, and no route
module assigns `xp_total` (the legacy places that still build ledger rows by hand are listed and can only shrink).
"""
import os
import re

import pytest
import pytest_asyncio
from fastapi.routing import APIRoute
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import Profile, RoleEnum, XPTransaction
from services import xp as xp_service
from services.xp import XP_RULES, grant_xp

ROUTES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes")


@pytest_asyncio.fixture
async def db():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, XPTransaction):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        session.add(Profile(id="p1", user_id="p1", email="p1@example.invalid", full_name="p1",
                            role=RoleEnum.PHOTOGRAPHER, xp_total=0))
        session.add(Profile(id="p2", user_id="p2", email="p2@example.invalid", full_name="p2",
                            role=RoleEnum.SURFER, xp_total=0))
        await session.commit()
        yield session
    await engine.dispose()


async def _state(db, user):
    await db.commit()
    ledger = (await db.execute(select(func.coalesce(func.sum(XPTransaction.amount), 0))
                               .where(XPTransaction.user_id == user))).scalar()
    cache = (await db.execute(select(Profile.xp_total).where(Profile.id == user))).scalar()
    return ledger, cache


async def test_the_amount_comes_from_the_server_rule(db):
    granted = await grant_xp(db, "p1", "on_demand_connect", reference_type="dispatch", reference_id="d1")
    assert granted == XP_RULES["on_demand_connect"].amount == 50
    assert await _state(db, "p1") == (50, 50)


async def test_an_unknown_reason_is_refused_not_invented(db):
    with pytest.raises(ValueError):
        await grant_xp(db, "p1", "whatever_the_caller_typed", reference_id="x")
    assert await _state(db, "p1") == (0, 0)


async def test_a_replayed_action_grants_nothing_twice(db):
    first = await grant_xp(db, "p1", "on_demand_connect", reference_type="dispatch", reference_id="d1")
    again = await grant_xp(db, "p1", "on_demand_connect", reference_type="dispatch", reference_id="d1")
    other = await grant_xp(db, "p1", "on_demand_connect", reference_type="dispatch", reference_id="d2")
    assert (first, again, other) == (50, 0, 50)
    assert await _state(db, "p1") == (100, 100)


async def test_the_hot_streak_doubles_only_where_the_rule_says_so(db):
    assert await grant_xp(db, "p1", "on_demand_connect", reference_type="dispatch", reference_id="a", streak=2) == 50
    assert await grant_xp(db, "p1", "on_demand_connect", reference_type="dispatch", reference_id="b", streak=3) == 100
    assert await grant_xp(db, "p2", "on_demand_requested", reference_type="dispatch", reference_id="b", streak=9) == 25
    assert await _state(db, "p1") == (150, 150)
    assert await _state(db, "p2") == (25, 25)


async def test_the_cache_and_the_ledger_never_drift(db):
    for i in range(5):
        await grant_xp(db, "p2", "review_given", reference_type="review", reference_id=f"r{i}")
        await grant_xp(db, "p2", "review_given", reference_type="review", reference_id=f"r{i}")  # replay
    ledger, cache = await _state(db, "p2")
    assert ledger == cache == 5 * XP_RULES["review_given"].amount


# ---------------------------------------------------------------- structural guards

def test_no_route_takes_an_xp_amount_from_a_request():
    from server import app
    minting = []
    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        params = [p.name.lower() for p in route.dependant.query_params + route.dependant.body_params]
        if "award-xp" in route.path or "xp_amount" in params or ("amount" in params and "xp" in route.path.lower()):
            minting.append(route.path)
    assert minting == []


def _route_sources():
    for folder, _dirs, files in os.walk(ROUTES_DIR):
        for name in files:
            if name.endswith(".py"):
                path = os.path.join(folder, name)
                with open(path, encoding="utf-8") as fh:
                    yield os.path.relpath(path, ROUTES_DIR).replace(os.sep, "/"), fh.read()


def test_no_route_writes_the_xp_cache_directly():
    writers = [rel for rel, src in _route_sources() if re.search(r"\.xp_total\s*(\+=|-=|=(?!=))", src)]
    assert writers == []


# Routes that still build ledger rows by hand. They are moved onto grant_xp one by one; this list only shrinks.
LEGACY_LEDGER_WRITERS = {
    "career_hub/career.py",
    "career_hub/career_stoke_sponsor.py",
    "gallery/gallery_purchases.py",
    "sessions/join.py",
}


def test_hand_built_ledger_rows_only_shrink():
    builders = {rel for rel, src in _route_sources() if re.search(r"\bXPTransaction\(", src)}
    assert builders <= LEGACY_LEDGER_WRITERS, sorted(builders - LEGACY_LEDGER_WRITERS)
    # a legacy entry that no longer builds rows must be deleted from the list
    assert LEGACY_LEDGER_WRITERS <= builders, sorted(LEGACY_LEDGER_WRITERS - builders)


def test_the_rule_table_amounts_are_sane():
    assert all(isinstance(r.amount, int) and 0 < r.amount <= 100 for r in XP_RULES.values())
    assert xp_service.HOT_STREAK_MULTIPLIER >= 1
