"""XP for blind surf observations rewards QUALITY, never agreement (T1 crowd truth, P2).

Over real HTTP + JWT against SQLite: base XP only past the quality gate; caps per account, account-spot-day, device
and spot-day; a random audit holds XP until an admin passes it; bonuses pay only after an INDEPENDENT observer
(another account on another device) reports the same spot within 90 minutes, whatever either of them reported; and
no rule reads the height (the same world with wildly different heights pays exactly the same XP).
"""
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (CompanyDetailsChange, TosContent, SurfTruthConsentEvent,CheckIn, ConditionReport, ObservationMedia, Profile, RoleEnum, SurfObservation, SurfReport,
                    SurfSpot, SurfTruthAdminAction, SurfTruthAnchor, XPTransaction)
from routes.surf_data import observation_audits, observations
from services import observation_rewards

URL = "/api/surf-observations"
NOW = datetime.now(timezone.utc)
SPOTS = {f"s{i}": (29.0 + i * 0.1, -80.9) for i in range(5)}
USERS = ("ana", "ben", "cai", "dee", "eli")
DEV = {u: str(uuid.uuid4()) for u in USERS}


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")  # the XP kill switch reads runtime_flags: no network in tests
    monkeypatch.setattr(observation_rewards, "audit_draw", lambda: False)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, TosContent, SurfTruthConsentEvent, CompanyDetailsChange,SurfSpot, CheckIn, ConditionReport, SurfReport, SurfObservation, ObservationMedia,
                      XPTransaction, SurfTruthAnchor, SurfTruthAdminAction):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid in USERS + ("admin",):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid, role=RoleEnum.SURFER,
                           is_admin=(pid == "admin"), xp_total=0))
        for sid, (lat, lon) in SPOTS.items():
            db.add(SurfSpot(id=sid, name=sid, latitude=lat, longitude=lon, state_province="Florida", country="USA"))
        for u in USERS:
            for sid in SPOTS:
                for n in range(3):
                    db.add(CheckIn(id=f"ci-{u}-{sid}-{n}", user_id=u, spot_id=sid, spot_name=sid, created_at=NOW))
        await db.commit()
    app = FastAPI()
    for module in (observations, observation_audits):
        app.include_router(module.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency

    async def xp(user):
        async with maker() as db:
            rows = (await db.execute(select(XPTransaction.reason, XPTransaction.amount)
                                     .where(XPTransaction.user_id == user))).all()
            cache = (await db.get(Profile, user)).xp_total
        assert sum(a for _, a in rows) == cache  # ledger and cache move together
        return sorted(rows)

    async def row(obs_id):
        async with maker() as db:
            return await db.get(SurfObservation, obs_id)

    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            yield SimpleNamespace(client=c, xp=xp, row=row, maker=maker)
    finally:
        await engine.dispose()


async def _post(world, user, spot="s0", n=0, device=None, height=3.0, scale="face", **over):
    lat, lon = SPOTS[spot]
    body = dict(entry_screen="checkin_modal", ref_id=f"ci-{user}-{spot}-{n}", height_value=height, height_unit="ft",
                height_scale=scale, set_or_avg="sets", latitude=lat, longitude=lon,
                device_id=device if device is not None else DEV[user])
    body.update(over)
    body = {k: v for k, v in body.items() if v is not None}
    r = await world.client.post(URL, json=body, headers=_token(user))
    assert r.status_code == 200, r.text
    return r.json()["id"]


async def test_a_gated_observation_pays_base_xp(world):
    obs = await _post(world, "ana")
    assert (await world.row(obs)).xp_status == "granted"
    assert await world.xp("ana") == [("surf_observation", 5)]


@pytest.mark.parametrize("over", [
    {"device_id": None},                                      # no device id: cannot be capped per device
    {"ref_id": None, "spot_id": "s0"},                        # no parent report
    {"latitude": 40.0, "longitude": -70.0},                   # GPS far from the spot
    {"latitude": None, "longitude": None},                    # no location evidence at all
])
async def test_failing_the_gate_pays_nothing_but_the_row_is_kept(world, over):
    obs = await _post(world, "ana", **over)
    stored = await world.row(obs)
    assert stored.quality_ok is False and stored.xp_status == "not_eligible"
    assert await world.xp("ana") == []


async def test_xp_is_value_blind(world):
    """Same people, same places, same times; only the heights and scales differ wildly. Same XP, to the point."""
    plan = [("ana", "s0", 0), ("ben", "s0", 0), ("cai", "s1", 0), ("ana", "s2", 0)]
    for (user, spot, n), (height, scale) in zip(plan, [(1, "face"), (20, "hawaiian"), (0, "face"), (60, "face")]):
        await _post(world, user, spot, n, height=height, scale=scale)
    first = {u: await world.xp(u) for u in USERS}
    async with world.maker() as db:  # reset and replay with the heights reversed
        await db.execute(XPTransaction.__table__.delete())
        await db.execute(SurfObservation.__table__.delete())
        await db.execute(update(Profile).values(xp_total=0))
        await db.commit()
    for (user, spot, n), (height, scale) in zip(plan, [(60, "hawaiian"), (0, "face"), (20, "face"), (1, "hawaiian")]):
        await _post(world, user, spot, n, height=height, scale=scale)
    assert {u: await world.xp(u) for u in USERS} == first


async def test_one_paid_observation_per_account_per_spot_day(world):
    await _post(world, "ana", "s0", 0)
    second = await _post(world, "ana", "s0", 1)
    assert (await world.row(second)).xp_status == "capped"
    assert await world.xp("ana") == [("surf_observation", 5)]


async def test_account_day_cap(world):
    ids = [await _post(world, "ana", spot) for spot in ("s0", "s1", "s2", "s3")]
    assert [(await world.row(i)).xp_status for i in ids] == ["granted"] * 3 + ["capped"]


async def test_device_day_cap_across_accounts(world):
    shared = str(uuid.uuid4())
    ids = [await _post(world, user, spot, device=shared)
           for user, spot in (("ana", "s0"), ("ben", "s1"), ("cai", "s2"), ("dee", "s3"))]
    assert [(await world.row(i)).xp_status for i in ids] == ["granted"] * 3 + ["capped"]


async def test_spot_day_cap(world, monkeypatch):
    monkeypatch.setattr(observation_rewards, "SPOT_DAY_CAP", 2)
    ids = [await _post(world, user, "s0") for user in ("ana", "ben", "cai")]
    assert [(await world.row(i)).xp_status for i in ids] == ["granted", "granted", "capped"]


async def test_corroboration_pays_both_sides_and_the_first_observers_bonuses(world):
    a = await _post(world, "ana", "s0", height=1)
    b = await _post(world, "ben", "s0", height=12)   # wildly different: corroboration is presence, not agreement
    assert (await world.row(a)).corroborated and (await world.row(b)).corroborated
    assert await world.xp("ana") == sorted([("surf_observation", 5), ("surf_observation_corroborated", 5),
                                            ("surf_observation_first_of_day", 5), ("surf_observation_quiet_spot", 10)])
    assert await world.xp("ben") == sorted([("surf_observation", 5), ("surf_observation_corroborated", 5)])
    c = await _post(world, "cai", "s0")             # a third observer corroborates too, but pays A and B nothing twice
    assert await world.xp("ana") == sorted([("surf_observation", 5), ("surf_observation_corroborated", 5),
                                            ("surf_observation_first_of_day", 5), ("surf_observation_quiet_spot", 10)])
    assert ("surf_observation_corroborated", 5) in await world.xp("cai") and (await world.row(c)).corroborated


async def test_no_corroboration_from_the_same_device_or_outside_the_window(world):
    shared = str(uuid.uuid4())
    await _post(world, "ana", "s0", device=shared)
    await _post(world, "ben", "s0", device=shared)                  # another account, same phone: not independent
    assert await world.xp("ben") == [("surf_observation", 5)]
    old = await _post(world, "cai", "s1")
    async with world.maker() as db:
        await db.execute(update(SurfObservation).where(SurfObservation.id == old)
                         .values(received_at=NOW - timedelta(hours=3)))
        await db.commit()
    await _post(world, "dee", "s1")                                 # three hours later: not the same session
    assert await world.xp("dee") == [("surf_observation", 5)]
    assert await world.xp("cai") == [("surf_observation", 5)]


async def test_audit_holds_xp_until_an_admin_passes_it(world, monkeypatch):
    monkeypatch.setattr(observation_rewards, "audit_draw", lambda: True)
    held = await _post(world, "ana", "s0")
    failed = await _post(world, "ben", "s1")
    assert (await world.row(held)).xp_status == "held_audit" and await world.xp("ana") == []
    queue = (await world.client.get("/api/admin/surf-observations/audits", headers=_token("admin"))).json()
    assert {q["id"] for q in queue} == {held, failed}
    assert "forecast" not in str(queue).lower()
    assert (await world.client.get("/api/admin/surf-observations/audits", headers=_token("cai"))).status_code == 403
    ok = await world.client.post(f"/api/admin/surf-observations/{held}/audit", json={"verdict": "pass"},
                                 headers=_token("admin"))
    assert ok.status_code == 200 and await world.xp("ana") == [("surf_observation", 5)]
    bad = await world.client.post(f"/api/admin/surf-observations/{failed}/audit", json={"verdict": "fail", "reason": "photo_reused"},
                                  headers=_token("admin"))
    assert bad.json()["xp_status"] == "audit_failed" and await world.xp("ben") == []
    again = await world.client.post(f"/api/admin/surf-observations/{held}/audit", json={"verdict": "pass"},
                                    headers=_token("admin"))
    assert again.status_code == 409 and await world.xp("ana") == [("surf_observation", 5)]


async def test_an_admin_cannot_audit_their_own_observation(world, monkeypatch):
    monkeypatch.setattr(observation_rewards, "audit_draw", lambda: True)
    async with world.maker() as db:
        db.add(CheckIn(id="ci-admin", user_id="admin", spot_id="s0", spot_name="s0", created_at=NOW))
        await db.commit()
    lat, lon = SPOTS["s0"]
    r = await world.client.post(URL, json=dict(entry_screen="checkin_modal", ref_id="ci-admin", height_value=3,
                                               height_unit="ft", height_scale="face", set_or_avg="sets",
                                               latitude=lat, longitude=lon, device_id=str(uuid.uuid4())),
                                headers=_token("admin"))
    own = await world.client.post(f"/api/admin/surf-observations/{r.json()['id']}/audit", json={"verdict": "pass"},
                                  headers=_token("admin"))
    assert own.status_code == 403


async def test_the_reply_still_reveals_no_verdict(world):
    r = await world.client.post(URL, json=dict(entry_screen="checkin_modal", ref_id="ci-ana-s0-0", height_value=3,
                                               height_unit="ft", height_scale="face", set_or_avg="sets",
                                               latitude=SPOTS["s0"][0], longitude=SPOTS["s0"][1],
                                               device_id=DEV["ana"]), headers=_token("ana"))
    assert set(r.json()) == {"id", "height_scale", "scale_default"}


async def test_the_audit_queue_shows_no_height(world, monkeypatch):
    monkeypatch.setattr(observation_rewards, "audit_draw", lambda: True)
    await _post(world, "ana", "s0", height=12)
    (item,) = (await world.client.get("/api/admin/surf-observations/audits", headers=_token("admin"))).json()
    assert not {"height_value", "height_unit", "height_bucket", "height_scale", "set_or_avg", "face_m"} & set(item)
    assert "12" not in str({k: v for k, v in item.items() if k not in ("id", "received_at", "media_url")})


async def test_kill_switch_stops_payment_but_keeps_the_truth(world, monkeypatch):
    monkeypatch.setenv(observation_rewards.KILL_FLAG, "0")
    a = await _post(world, "ana", "s0")
    b = await _post(world, "ben", "s0")       # would corroborate a, but nothing pays while paused
    assert [(await world.row(i)).xp_status for i in (a, b)] == ["paused", "paused"]
    assert (await world.row(a)).quality_ok is True   # still assessed, still truth
    assert await world.xp("ana") == [] and await world.xp("ben") == []
    monkeypatch.setenv(observation_rewards.KILL_FLAG, "1")
    c = await _post(world, "cai", "s0")       # back on: paused rows are never paid later, and do not corroborate
    assert await world.xp("ana") == [] and (await world.row(c)).xp_status == "granted"
    assert await world.xp("cai") == [("surf_observation", 5)]


async def test_an_audit_pass_while_paused_pays_nothing(world, monkeypatch):
    monkeypatch.setattr(observation_rewards, "audit_draw", lambda: True)
    held = await _post(world, "ana", "s0")
    monkeypatch.setenv(observation_rewards.KILL_FLAG, "0")
    r = await world.client.post(f"/api/admin/surf-observations/{held}/audit", json={"verdict": "pass"},
                                headers=_token("admin"))
    assert r.json()["xp_status"] == "paused" and await world.xp("ana") == []
