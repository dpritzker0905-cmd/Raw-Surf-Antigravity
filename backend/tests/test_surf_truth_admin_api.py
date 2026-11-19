"""Admin API for surf-truth anchors and the admin action log (anchors B).

Over real HTTP + JWT against SQLite: only an admin may list, change or read; a status change needs a known profile,
a valid status and a reason, writes the anchor's event log AND the admin action log, and changes nothing else; audit
verdicts are logged too; and no admin request body in the surf-truth area can carry a reported number (the models
refuse unknown fields and declare no height field).
"""
import secrets
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (SurfTruthConsentEvent, CheckIn, ConditionReport, ObservationMedia, Profile, RoleEnum, SurfObservation, SurfReport,
                    SurfSpot, SurfTruthAdminAction, SurfTruthAnchor, SurfTruthAnchorEvent, XPTransaction)
from models import surf_truth_admin as admin_models
from routes.surf_data import observation_audits, observations, surf_truth_admin
from services import observation_rewards


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, SurfTruthConsentEvent, SurfSpot, CheckIn, ConditionReport, SurfReport, SurfObservation, ObservationMedia,
                      SurfTruthAnchor, SurfTruthAnchorEvent, SurfTruthAdminAction, XPTransaction):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid, admin in (("boss", True), ("pho", False), ("ana", False)):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid, role=RoleEnum.SURFER,
                           is_admin=admin, xp_total=0))
        db.add(SurfSpot(id="s0", name="s0", latitude=29.0, longitude=-80.9, state_province="Florida"))
        db.add(CheckIn(id="ci-ana", user_id="ana", spot_id="s0", spot_name="s0",
                       created_at=datetime.now(timezone.utc)))
        await db.commit()
    app = FastAPI()
    for module in (surf_truth_admin, observation_audits, observations):
        app.include_router(module.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as c:
            yield SimpleNamespace(client=c, maker=maker)
    finally:
        await engine.dispose()


def _change(world, profile, status, reason="checked against the pier photo", who="boss"):
    return world.client.post(f"/api/admin/surf-truth/anchors/{profile}/status",
                             json={"status": status, "reason": reason}, headers=_token(who))


async def _actions(world):
    return (await world.client.get("/api/admin/surf-truth/actions", headers=_token("boss"))).json()


@pytest.mark.parametrize("path", ["/api/admin/surf-truth/anchors", "/api/admin/surf-truth/anchors/pho/events",
                                  "/api/admin/surf-truth/actions"])
async def test_reads_are_admin_only(world, path):
    assert (await world.client.get(path)).status_code == 401
    assert (await world.client.get(path, headers=_token("ana"))).status_code == 403
    assert (await world.client.get(path, headers=_token("boss"))).status_code == 200


async def test_a_non_admin_cannot_appoint_anyone(world):
    assert (await _change(world, "ana", "active", who="ana")).status_code == 403
    async with world.maker() as db:
        assert (await db.execute(select(SurfTruthAnchor))).first() is None


async def test_status_change_writes_both_logs(world):
    assert (await _change(world, "pho", "probation")).status_code == 200
    r = await _change(world, "pho", "active", "two weeks of photo checks within 10%")
    assert r.json() == {"profile_id": "pho", "status": "active", "from_status": "probation"}
    (anchor,) = (await world.client.get("/api/admin/surf-truth/anchors", headers=_token("boss"))).json()
    assert (anchor["profile_id"], anchor["status"], anchor["appointed_by"]) == ("pho", "active", "boss")
    events = (await world.client.get("/api/admin/surf-truth/anchors/pho/events", headers=_token("boss"))).json()
    assert [(e["from_status"], e["to_status"]) for e in events] == [(None, "probation"), ("probation", "active")]
    assert {(e["actor_id"], e["actor_name"]) for e in events} == {("boss", "boss")}   # the admin's name, for display
    actions = await _actions(world)
    assert sorted(a["detail"]["to"] for a in actions) == ["active", "probation"]
    assert all(a["action"] == "anchor_status" and a["admin_id"] == "boss" and a["reason"] for a in actions)


@pytest.mark.parametrize("body", [
    {"status": "active", "reason": ""}, {"status": "trusted", "reason": "x"}, {"status": "active"},
    {"status": "active", "reason": "x", "face_m": 2.0},
])
async def test_bad_bodies_are_refused_and_logged_nowhere(world, body):
    r = await world.client.post("/api/admin/surf-truth/anchors/pho/status", json=body, headers=_token("boss"))
    assert r.status_code == 422
    async with world.maker() as db:
        assert (await db.execute(select(SurfTruthAdminAction))).first() is None
        assert (await db.execute(select(SurfTruthAnchorEvent))).first() is None


async def test_unknown_profile_and_no_op_change(world):
    assert (await _change(world, "ghost", "active")).status_code == 404
    assert (await _change(world, "pho", "active")).status_code == 200
    assert (await _change(world, "pho", "active")).status_code == 422
    assert len(await _actions(world)) == 1


async def test_self_appointment_is_allowed_but_marked(world):
    assert (await _change(world, "boss", "active", "owner as first anchor")).status_code == 200
    (action,) = await _actions(world)
    assert action["detail"]["self"] is True


async def test_audit_verdicts_are_logged_and_never_touch_the_number(world, monkeypatch):
    monkeypatch.setattr(observation_rewards, "audit_draw", lambda: True)
    r = await world.client.post("/api/surf-observations", json=dict(
        entry_screen="checkin_modal", ref_id="ci-ana", height_value=3, height_unit="ft", height_scale="face",
        set_or_avg="sets", latitude=29.0, longitude=-80.9, device_id=str(uuid.uuid4())), headers=_token("ana"))
    obs_id = r.json()["id"]
    await world.client.post(f"/api/admin/surf-observations/{obs_id}/audit", json={"verdict": "fail", "reason": "photo of another beach"},
                            headers=_token("boss"))
    (action,) = await _actions(world)
    assert (action["action"], action["target_id"], action["detail"]["verdict"]) == ("audit_verdict", obs_id, "fail")
    assert action["reason"] == "photo of another beach" and action["admin_name"] == "boss"
    async with world.maker() as db:
        obs = await db.get(SurfObservation, obs_id)
    assert obs.height_value == 3 and obs.face_m > 0   # a verdict changes a status, never the reported number


def test_no_admin_body_can_carry_a_reported_number():
    numbers = {"height_value", "height_unit", "height_bucket", "height_scale", "set_or_avg", "face_m", "face_m_low",
               "face_m_high"}
    for model in (surf_truth_admin.AnchorStatusChange, observation_audits.AuditVerdict):
        assert model.model_config.get("extra") == "forbid"
        assert not numbers & set(model.model_fields)


def test_the_admin_log_is_append_only_on_postgres():
    ddl = " | ".join(str(getattr(getattr(fn, "__self__", None), "statement", "") or getattr(fn, "statement", ""))
                     for fn in SurfTruthAdminAction.__table__.dispatch.after_create)
    for needed in ("surf_truth_admin_actions_no_rewrite", "surf_truth_admin_actions_no_truncate",
                   "ENABLE ROW LEVEL SECURITY", "GRANT SELECT, INSERT ON TABLE"):
        assert needed in ddl, needed
    assert "BEFORE TRUNCATE" in admin_models.NO_TRUNCATE_TRIGGER


async def test_a_failed_audit_needs_a_reason(world, monkeypatch):
    monkeypatch.setattr(observation_rewards, "audit_draw", lambda: True)
    r = await world.client.post("/api/surf-observations", json=dict(
        entry_screen="checkin_modal", ref_id="ci-ana", height_value=3, height_unit="ft", height_scale="face",
        set_or_avg="sets", latitude=29.0, longitude=-80.9, device_id=str(uuid.uuid4())), headers=_token("ana"))
    obs_id = r.json()["id"]
    for body in ({"verdict": "fail"}, {"verdict": "fail", "reason": "   "}):
        refused = await world.client.post(f"/api/admin/surf-observations/{obs_id}/audit", json=body,
                                          headers=_token("boss"))
        assert refused.status_code == 422
    assert await _actions(world) == []
    ok = await world.client.post(f"/api/admin/surf-observations/{obs_id}/audit", json={"verdict": "pass"},
                                 headers=_token("boss"))
    assert ok.status_code == 200   # a pass needs no reason


async def test_action_log_names_the_admin_and_the_anchor(world):
    await _change(world, "pho", "probation")
    (action,) = await _actions(world)
    assert (action["admin_name"], action["target_name"]) == ("boss", "pho")
