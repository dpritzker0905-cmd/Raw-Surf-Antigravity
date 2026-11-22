"""The admin Surf Forecast board says what each flag IS: a switch or a numeric setting, where its value came from, the
guardrail's reason when the manifest set it, and whether the serve box's value says anything about the lane."""
import asyncio
from datetime import datetime, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import AdminLog, Profile, SurfReport, SurfSpot
from models.enums import RoleEnum
from routes.admin import surf_forecast
from services import admin_flag_board as board
from services import runtime_flags as rf


@pytest.fixture
def manifest(monkeypatch):
    """A guardrail manifest that turned SURF_TIDE_DEPTH off, with its reason."""
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "1")
    monkeypatch.delenv("SURF_TIDE_DEPTH", raising=False)
    doc = {"schema": rf.SCHEMA, "flags": {"SURF_TIDE_DEPTH": {
        "state": "off", "reason": "hs_station worse in the 6 h window", "set_by": "flag-guardrail",
        "set_at": "2026-11-18T01:00:00Z", "evidence": "run 123", "extra": "not shown"}}}
    rf._reset_for_tests(lambda: doc)
    yield
    rf._reset_for_tests(None)


def test_numeric_settings_are_settings_not_on_off():
    row = board.flag_row("SURF_REFRACTION_KR", "0.873", "refraction coefficient", "Render env")
    assert row["kind"] == "setting" and row["value"] == "0.873" and row["differs_from_default"] is False
    assert board.flag_row("X_SWITCH", "1", "c", "Render env")["kind"] == "switch"


def test_guardrail_off_comes_with_its_source_reason_and_fix_version(manifest):
    row = board.flag_row("SURF_TIDE_DEPTH", rf.GUARDED["SURF_TIDE_DEPTH"], "tide depth", "runtime manifest")
    assert (row["value"], row["source"], row["guarded"]) == ("0", "manifest", True)
    assert row["manifest_entry"] == {"state": "off", "reason": "hs_station worse in the 6 h window",
                                     "set_by": "flag-guardrail", "set_at": "2026-11-18T01:00:00Z",
                                     "evidence": "run 123"}                        # only the documented keys
    assert row["fix_version"] == rf.FIX_VERSION["SURF_TIDE_DEPTH"]


@pytest.mark.parametrize("where,guarded,expected", [
    ("forecast-ingest and precompute workflow env together; NOT Render (no GWAM fetch on the box)", False, False),
    ("forecast-ingest-pilots.yml env (the global_mid wind ingest)", False, False),
    ("Render env", False, True),
    ("runtime manifest (control/flags.json) - keep Render env UNSET", False, True),
    ("forecast-ingest-pilots.yml env", True, True),
])
def test_serve_box_value_is_marked_when_only_a_workflow_reads_the_flag(where, guarded, expected):
    assert board.serve_box_reads(where, guarded) is expected


def test_every_registered_flag_gets_a_row_with_a_kind():
    rows = board.flag_rows(surf_forecast._RATING_FLAGS)
    assert [r["name"] for r in rows] == list(surf_forecast._RATING_FLAGS)
    assert {r["kind"] for r in rows} <= {"switch", "setting"}
    assert any(r["kind"] == "setting" for r in rows)            # the registry does hold numeric settings


def test_deleting_a_report_is_written_to_the_admin_log():
    async def go():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            for model in (Profile, SurfSpot, SurfReport, AdminLog):
                await conn.run_sync(lambda c, t=model.__table__: t.create(c))
        mk = async_sessionmaker(engine, expire_on_commit=False)
        async with mk() as db:
            admin = Profile(id="adm", user_id="adm", email="a@example.invalid", full_name="A", role=RoleEnum.SURFER,
                            is_admin=True)
            db.add_all([admin, Profile(id="u1", user_id="u1", email="u@example.invalid", full_name="U",
                                       role=RoleEnum.SURFER),
                        SurfSpot(id="s1", name="Pier", latitude=29.0, longitude=-80.9),
                        SurfReport(id="r1", spot_id="s1", user_id="u1", rating=5,
                                   created_at=datetime(2026, 11, 18, tzinfo=timezone.utc))])
            await db.commit()
            assert (await surf_forecast.delete_surf_report("r1", admin=admin, db=db)) == {"deleted": "r1"}
        async with mk() as db:
            assert (await db.execute(select(SurfReport))).scalars().all() == []
            (log,) = (await db.execute(select(AdminLog))).scalars().all()
            assert (log.admin_id, log.action, log.target_type, log.target_id) == (
                "adm", "delete_surf_report", "surf_report", "r1")
            assert '"spot_id": "s1"' in log.details and '"rating": 5' in log.details
        await engine.dispose()
    asyncio.run(go())
