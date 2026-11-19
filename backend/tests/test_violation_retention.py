"""ToS violations after an erasure (David, 2026-11-19: "Keep the ban evidence, only wipe GPS and notes"): the GPS and
the notes are scrubbed at erasure, the rest of the row and of its `evidence` is kept with no expiry, and the day-30
purge skips an account with an open moderation case. Each rule has a fail-closed case."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import (AccountDeletion, Booking, CheckIn, Comment, ConditionReport, Follow, GalleryPurchase, Message,
                    MfaChallenge, MfaRecoveryCode, ModerationHold, ObservationMedia, PaymentTransaction, Post, Profile,
                    Review, SessionRevocation, SurfObservation, SurfTruthAnchor, SurfTruthConsentEvent, SurfTruthAdminAction,
                    TosAcknowledgement, TosViolation, UserMfa, WebauthnCredential)
from models.enums import RoleEnum
from routes.compliance_pkg.gdpr import erase_account, request_data_deletion
from services import account_deletion as ad
from services import violation_retention as vr

NOW = datetime(2026, 11, 19, 1, 0, tzinfo=timezone.utc)
SECRET_TEXT = "claimed Haleiwa, was at home 21.60,-158.00"
KEPT = {   # realistic evidence: URLs and paths, isoformat timestamps, id lists, long strings, words that merely CONTAIN
    # "lat", "text", "detail", "summary" or "body"
    "distance_miles": 41.0, "rule": "location_fraud", "source": "auto_detector",
    "screenshots": ["https://cdn.example.invalid/evidence/2026/11/shot-1.png", "evidence/shot-2.jpg"],
    "detected_at": "2026-11-03T18:22:41.512345+00:00", "violation_ids": ["v-100", "v-101"],
    "related_post_id": "p-9", "platform": "ios", "context": "checkin", "detail": {"hits": 3}, "summary": {"n": 2},
    "body": {"len": 120}, "gps_ok": False, "score": 0.93,
    "reason_label": "Claimed location was 41 miles from the device's reported position at check-in time",
    "checks": {"score": 0.93, "platform": "android"}}
GPS_AND_NOTES = {"claimed_coords": [21.6, -158.0], "actual_coords": [34.0, -118.4], "lat": 34.0, "lng": -118.4,
                 "claimedLatitude": 21.6, "note": SECRET_TEXT, "admin_notes": [SECRET_TEXT]}


@pytest.fixture(autouse=True)
def _quiet(monkeypatch, tmp_path):
    from routes.uploads import core as upload_core
    monkeypatch.setattr(upload_core, "UPLOAD_DIR", tmp_path)


@pytest.fixture
def maker():
    async def build():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            for model in (Profile, Post, Comment, Follow, CheckIn, Review, Message, SurfObservation, ObservationMedia,
                          SurfTruthAnchor, Booking, GalleryPurchase, PaymentTransaction, TosAcknowledgement,
                          TosViolation, ConditionReport, WebauthnCredential, UserMfa, MfaRecoveryCode, MfaChallenge,
                          SessionRevocation, AccountDeletion, SurfTruthConsentEvent, SurfTruthAdminAction, ModerationHold):
                await conn.run_sync(lambda c, t=model.__table__: t.create(c))
        mk = async_sessionmaker(engine, expire_on_commit=False)
        async with mk() as db:
            for pid in ("leaver", "stayer"):
                db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                               role=RoleEnum.SURFER))
            for vid, pid in (("v1", "leaver"), ("v2", "stayer")):
                db.add(TosViolation(
                    id=vid, user_id=pid, violation_type="location_fraud", severity="severe", strike_points=3,
                    title="Location Fraud: 41.0 miles discrepancy", description=SECRET_TEXT,
                    evidence={**KEPT, **GPS_AND_NOTES,
                              "checks": {**KEPT["checks"], "lat": 34.0, "remark": SECRET_TEXT}},
                    related_type="booking", related_id="b1", claimed_latitude=21.6, claimed_longitude=-158.0,
                    actual_latitude=34.0, actual_longitude=-118.4, distance_discrepancy_miles=41.0,
                    action_taken="permanent_ban", reviewed_by="stayer", appeal_text="I was there, " + SECRET_TEXT,
                    status="active"))
            await db.commit()
        return mk
    return asyncio.run(build())


def _violations(maker, pid):
    async def go():
        async with maker() as db:
            return (await db.execute(select(TosViolation).where(TosViolation.user_id == pid))).scalars().all()
    return asyncio.run(go())


def test_erasure_scrubs_location_and_free_text_but_keeps_the_decision(maker):
    async def go():
        async with maker() as db:
            await request_data_deletion(user_id="leaver", db=db, immediate=True)
    asyncio.run(go())
    (row,) = _violations(maker, "leaver")
    assert (row.claimed_latitude, row.claimed_longitude, row.actual_latitude, row.actual_longitude) == (None,) * 4
    # the evidence stays EXACTLY as it was, minus the GPS and note entries
    assert row.evidence == {**KEPT, "scrubbed": True}
    assert row.description == vr.REMOVED_TEXT and row.appeal_text is None and row.title == "Location Fraud"
    assert SECRET_TEXT not in repr((row.title, row.description, row.evidence, row.appeal_text))
    # what shows a decision was made and why survives
    assert (row.violation_type, row.severity, row.strike_points, row.action_taken) == \
        ("location_fraud", "severe", 3, "permanent_ban")
    assert (row.related_type, row.related_id, row.reviewed_by, row.distance_discrepancy_miles) == \
        ("booking", "b1", "stayer", 41.0)
    other = _violations(maker, "stayer")[0]                       # someone else's row is untouched
    assert other.actual_latitude == 34.0 and other.description == SECRET_TEXT


def test_scrub_evidence_drops_only_gps_and_note_keys_by_whole_name():
    gone = {"lat": 1, "Lng": 2, "longitude": 3, "claimed_coords": [1, 2], "actual_latitude": 1, "coordinates": {},
            "gps": 1, "geo": 1, "claimedLatitude": 1, "device-lon": 1, "note": "x", "notes": ["a"], "comment": "x",
            "admin_notes": "x", "moderatorNote": "x", "remarks": "x"}
    kept = {"violation_ids": ["a"], "related_post_id": "p", "platform": "ios", "context": "c", "detail": {"a": 1},
            "summary": "s", "body": {"b": 2}, "gps_ok": True, "latency_ms": 90, "template": "t", "notes_count": 2,
            "url": "https://cdn.example.invalid/a/b.png?x=1&y=2", "at": "2026-11-03T18:22:41+00:00",
            "long_text": "x " * 200, "nested": {"lat": 9, "keep": [{"note": "n", "ok": 1}]}}
    out = vr.scrub_evidence({**gone, **kept})
    assert out == {**kept, "nested": {"keep": [{"ok": 1}]}, "scrubbed": True}


def test_scrub_evidence_fails_closed_on_a_malformed_blob():
    for bad in (None, "21.6,-158.0", [21.6, -158.0], 7):
        assert vr.scrub_evidence(bad) == {"scrubbed": True}
    deep = cur = {}
    for _ in range(30):
        cur["x"] = {}
        cur = cur["x"]
    cur["lat"] = 5
    assert "x" in vr.scrub_evidence(deep)                         # depth-limited, never raises


def test_erasure_keeps_the_row_with_no_expiry(maker):
    """David: the evidence stays. Nothing in the module deletes a violation row on a clock."""
    assert not hasattr(vr, "VIOLATION_RETENTION") and not hasattr(vr, "purge_expired_violations")
    assert not hasattr(ModerationHold, "legal_hold")


def _appeal(maker, pid, **values):
    async def go():
        async with maker() as db:
            row = (await db.execute(select(TosViolation).where(TosViolation.user_id == pid))).scalars().one()
            for key, value in values.items():
                setattr(row, key, value)
            await db.commit()
    asyncio.run(go())


@pytest.mark.parametrize("values", [{"appeal_status": "pending"}, {"status": "appealed"}])
def test_the_day_30_purge_skips_and_flags_an_account_with_an_open_case(maker, values):
    _appeal(maker, "leaver", **values)

    async def go():
        async with maker() as db:
            await ad.schedule(db, await db.get(Profile, "leaver"), now=NOW - timedelta(days=31))
            await db.commit()
            assert await ad.purge_due(db, erase_account, now=NOW) == 0
        async with maker() as db:
            assert (await db.get(AccountDeletion, "leaver")).status == "pending"       # kept, retried tomorrow
            assert (await db.get(Profile, "leaver")).full_name == "leaver"             # not anonymised
            assert (await db.get(ModerationHold, "leaver")).open_case_flagged_at is not None
    asyncio.run(go())
    assert _violations(maker, "leaver")[0].actual_latitude == 34.0                    # the evidence is intact


def test_once_the_case_closes_the_next_run_erases_and_scrubs(maker):
    _appeal(maker, "leaver", appeal_status="pending")

    async def go():
        async with maker() as db:
            await ad.schedule(db, await db.get(Profile, "leaver"), now=NOW - timedelta(days=31))
            await db.commit()
            assert await ad.purge_due(db, erase_account, now=NOW) == 0
    asyncio.run(go())
    _appeal(maker, "leaver", appeal_status="denied", status="active")

    async def again():
        async with maker() as db:
            assert await ad.purge_due(db, erase_account, now=NOW + timedelta(days=1)) == 1
    asyncio.run(again())
    assert _violations(maker, "leaver")[0].actual_latitude is None


def test_if_the_open_case_check_fails_nothing_is_erased(maker, monkeypatch):
    async def broken(db, pid):
        raise RuntimeError("database hiccup")
    monkeypatch.setattr(vr, "open_case", broken)

    async def go():
        async with maker() as db:
            await ad.schedule(db, await db.get(Profile, "leaver"), now=NOW - timedelta(days=31))
            await db.commit()
            assert await ad.purge_due(db, erase_account, now=NOW) == 0
        async with maker() as db:
            assert (await db.get(AccountDeletion, "leaver")).status == "pending"
            assert (await db.get(Profile, "leaver")).full_name == "leaver"
    asyncio.run(go())


def test_the_hold_table_is_locked_to_the_backend_role():
    log = " | ".join(str(getattr(getattr(fn, "__self__", None), "statement", "") or getattr(fn, "statement", ""))
                     for fn in ModerationHold.__table__.dispatch.after_create)
    for needed in ("ENABLE ROW LEVEL SECURITY", "REVOKE ALL ON TABLE %(fullname)s FROM anon, authenticated"):
        assert needed in log
