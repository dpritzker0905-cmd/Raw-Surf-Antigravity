"""ToS violations after an erasure (David, 2026-11-18: "do the GPS clean-up now"): the location and free text are
scrubbed at erasure, the rows are deleted 12 months later unless a legal hold is set, and the day-30 purge skips an
account with an open moderation case. Each rule has a fail-closed case."""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import (AccountDeletion, Booking, CheckIn, Comment, ConditionReport, Follow, GalleryPurchase, Message,
                    MfaChallenge, MfaRecoveryCode, ModerationHold, ObservationMedia, PaymentTransaction, Post, Profile,
                    Review, SessionRevocation, SurfObservation, SurfTruthAnchor, SurfTruthConsentEvent,
                    TosAcknowledgement, TosViolation, UserMfa, WebauthnCredential)
from models.enums import RoleEnum
from routes.compliance_pkg.gdpr import erase_account, request_data_deletion
from services import account_deletion as ad
from services import violation_retention as vr

NOW = datetime(2026, 11, 19, 1, 0, tzinfo=timezone.utc)
SECRET_TEXT = "claimed Haleiwa, was at home 21.60,-158.00"


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
                          SessionRevocation, AccountDeletion, SurfTruthConsentEvent, ModerationHold):
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
                    evidence={"claimed_coords": [21.6, -158.0], "actual_coords": [34.0, -118.4],
                              "distance_miles": 41.0, "note": SECRET_TEXT},
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
    assert row.evidence == {"distance_miles": 41.0, "scrubbed": True}
    assert row.description == vr.REMOVED_TEXT and row.appeal_text is None and row.title == "Location Fraud"
    assert SECRET_TEXT not in repr((row.title, row.description, row.evidence, row.appeal_text))
    # what shows a decision was made and why survives
    assert (row.violation_type, row.severity, row.strike_points, row.action_taken) == \
        ("location_fraud", "severe", 3, "permanent_ban")
    assert (row.related_type, row.related_id, row.reviewed_by, row.distance_discrepancy_miles) == \
        ("booking", "b1", "stayer", 41.0)
    other = _violations(maker, "stayer")[0]                       # someone else's row is untouched
    assert other.actual_latitude == 34.0 and other.description == SECRET_TEXT


def test_scrub_evidence_keeps_only_whitelisted_numbers_and_never_fails_open():
    assert vr.scrub_evidence({"actual_coords": [1, 2], "distance_miles": 3.5, "a": "text"}) == \
        {"distance_miles": 3.5, "scrubbed": True}
    for bad in (None, "21.6,-158.0", [21.6, -158.0], 7):          # a malformed blob loses everything
        assert vr.scrub_evidence(bad) == {"scrubbed": True}
    assert vr.scrub_evidence({"distance_miles": "41"}) == {"scrubbed": True}      # a string is not kept
    assert vr.scrub_evidence({"distance_miles": True}) == {"scrubbed": True}      # nor a bool


def test_the_retention_period_is_twelve_months():
    assert vr.VIOLATION_RETENTION == timedelta(days=365)


def _purged(db, pid, when, status="purged"):
    db.add(AccountDeletion(profile_id=pid, status=status, requested_at=when, purge_after=when, purged_at=when))


def test_rows_are_deleted_twelve_months_after_the_erasure_unless_held(maker):
    async def go():
        async with maker() as db:
            _purged(db, "leaver", NOW - timedelta(days=366))
            _purged(db, "stayer", NOW - timedelta(days=364))
            await db.commit()
            assert await vr.purge_expired_violations(db, now=NOW) == 1
    asyncio.run(go())
    assert _violations(maker, "leaver") == [] and len(_violations(maker, "stayer")) == 1   # not yet due: kept


def test_a_legal_hold_keeps_the_rows_and_fails_closed_without_an_erasure_record(maker):
    async def go():
        async with maker() as db:
            _purged(db, "leaver", NOW - timedelta(days=900))
            db.add(ModerationHold(profile_id="leaver", legal_hold=True, hold_reason="claim pending"))
            # an account that never completed an erasure is never swept, however old its request
            db.add(AccountDeletion(profile_id="stayer", status="pending", requested_at=NOW - timedelta(days=900),
                                   purge_after=NOW - timedelta(days=870)))
            await db.commit()
            assert await vr.purge_expired_violations(db, now=NOW) == 0
    asyncio.run(go())
    assert len(_violations(maker, "leaver")) == 1 and len(_violations(maker, "stayer")) == 1


def test_a_purged_row_with_no_date_is_not_swept(maker):
    async def go():
        async with maker() as db:
            db.add(AccountDeletion(profile_id="leaver", status="purged", requested_at=NOW, purge_after=NOW))
            await db.commit()
            assert await vr.purge_expired_violations(db, now=NOW) == 0
    asyncio.run(go())
    assert len(_violations(maker, "leaver")) == 1


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
