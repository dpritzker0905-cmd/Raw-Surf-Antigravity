"""T1 P3: a data-deletion request reaches the surf-truth tables; a data export includes them.

Runs the REAL `/compliance/delete-my-data` handler against SQLite. The profile is anonymized, not deleted, so the
foreign-key cascades never fire: before P3 the observations (device GPS, photo EXIF) survived the request.
"""
import asyncio
from datetime import datetime, timezone

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import (SurfTruthAdminAction, SurfTruthConsentEvent, Booking, CheckIn, Comment, Follow, GalleryPurchase, Message, ObservationMedia, PaymentTransaction,
                    Post, Profile, Review, SurfObservation, SurfTruthAnchor, TosAcknowledgement, TosViolation)
from models.enums import RoleEnum
from routes.compliance_pkg.gdpr import request_data_deletion
from services.surf_truth_erasure import erase_surf_truth, export_surf_truth

NOW = datetime(2026, 11, 18, 1, 0, tzinfo=timezone.utc)


def _obs(oid, user, **kw):
    base = dict(id=oid, user_id=user, spot_id="pipe", observer_role="surfer", surface="checkin",
                entry_screen="checkin_modal", height_value=4.0, height_unit="ft", height_scale="face",
                set_or_avg="typical", scale_default="face", normalization_version="v1", face_m=1.2, face_m_low=1.2,
                input_kind="number", received_at=NOW, latitude=21.66, longitude=-158.05, gps_check="ok",
                exif_check="ok", device_hash="d" * 64)
    base.update(kw)
    return SurfObservation(**base)


@pytest.fixture
def maker():
    async def build():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            for model in (Profile, Post, Comment, Follow, CheckIn, Review, Message, SurfObservation,
                          ObservationMedia, SurfTruthAnchor, Booking, GalleryPurchase, PaymentTransaction,
                          TosAcknowledgement, TosViolation, SurfTruthConsentEvent, SurfTruthAdminAction):
                await conn.run_sync(lambda c, t=model.__table__: t.create(c))
        mk = async_sessionmaker(engine, expire_on_commit=False)
        async with mk() as db:
            for pid in ("leaver", "stayer"):
                db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                               role=RoleEnum.SURFER, home_latitude=21.6, home_longitude=-158.0,
                               home_location_name="Haleiwa", instagram_url="https://instagram.com/" + pid))
            db.add(Follow(follower_id="stayer", following_id="leaver"))
            db.add_all([
                _obs("o1", "leaver"), _obs("o2", "leaver", surface="surf_report"),
                _obs("o3", "stayer", audited_by="leaver", audit_verdict="pass", audited_at=NOW),
                ObservationMedia(id="m1", user_id="leaver", media_url="https://x/conditions/leaver/a.jpg",
                                 media_type="image", sha256="a" * 64, exif_latitude=21.66, exif_longitude=-158.05),
                ObservationMedia(id="m2", user_id="stayer", media_url="https://x/conditions/stayer/b.jpg",
                                 media_type="image", sha256="b" * 64),
                SurfTruthAnchor(profile_id="leaver", status="active"),
                SurfTruthAnchor(profile_id="stayer", status="active"),
                SurfTruthConsentEvent(id="c1", profile_id="leaver", granted=True, version="v", source="settings",
                                      at=NOW),
            ])
            await db.commit()
        return mk
    return asyncio.run(build())


def _count(db, model, *where):
    return db.execute(select(func.count()).select_from(model).where(*where))


def test_deletion_request_erases_the_users_surf_truth_rows_and_keeps_others(maker):
    async def go():
        async with maker() as db:
            result = await request_data_deletion(user_id="leaver", db=db)
            assert result["success"] is True
        async with maker() as db:
            assert (await _count(db, SurfObservation, SurfObservation.user_id == "leaver")).scalar() == 0
            assert (await _count(db, ObservationMedia, ObservationMedia.user_id == "leaver")).scalar() == 0
            assert (await _count(db, SurfTruthAnchor, SurfTruthAnchor.profile_id == "leaver")).scalar() == 0
            # the other user's rows survive; the verdict on their report stays, the deleted auditor's name does not
            kept = (await db.execute(select(SurfObservation).where(SurfObservation.id == "o3"))).scalar_one()
            assert kept.audit_verdict == "pass" and kept.audited_by is None
            assert (await _count(db, ObservationMedia, ObservationMedia.user_id == "stayer")).scalar() == 1
            assert (await _count(db, SurfTruthAnchor, SurfTruthAnchor.profile_id == "stayer")).scalar() == 1
            # the route used to crash on Follow.followed_id before reaching any of this
            assert (await _count(db, Follow, Follow.following_id == "leaver")).scalar() == 0
            gone = (await db.execute(select(Profile).where(Profile.id == "leaver"))).scalar_one()
            assert (gone.full_name, gone.home_latitude, gone.home_longitude, gone.home_location_name,
                    gone.instagram_url) == ("Deleted User", None, None, None, None)
            stays = (await db.execute(select(Profile).where(Profile.id == "stayer"))).scalar_one()
            assert stays.home_latitude == 21.6
            # the retention job's trigger: WHEN an account was erased, never who
            (mark,) = (await db.execute(select(SurfTruthAdminAction))).scalars().all()
            assert (mark.action, mark.admin_id, mark.target_type) == ("account_erasure", "system", "account")
            assert "leaver" not in (mark.target_id or "") and mark.reason is None and mark.detail is None
            # the consent history is the proof of consent: kept, like ToS acknowledgements
            assert (await _count(db, SurfTruthConsentEvent, SurfTruthConsentEvent.profile_id == "leaver")
                    ).scalar() == 1
    asyncio.run(go())


def test_admin_data_export_route_completes_and_carries_surf_truth(maker):
    """The export used Follow.followed_id, Review.reviewed_id and Booking.surfer_id (none exist): it never ran."""
    from routes.compliance_pkg.gdpr import export_user_data

    async def go():
        async with maker() as db:
            package = await export_user_data("leaver", admin=Profile(id="admin"), db=db)
        assert sorted(o["id"] for o in package["surf_observations"]) == ["o1", "o2"]
        assert package["summary"]["total_surf_observations"] == 2
        assert package["summary"]["total_followers"] == 1
    asyncio.run(go())


def test_erase_reports_counts_and_does_not_commit(maker):
    async def go():
        async with maker() as db:
            counts = await erase_surf_truth(db, "leaver")
            assert counts == {"surf_observations": 2, "observation_media": 1, "surf_truth_anchor": 1,
                              "audits_unattributed": 1}
            await db.rollback()                       # the caller's transaction decides; nothing was committed
        async with maker() as db:
            assert (await _count(db, SurfObservation, SurfObservation.user_id == "leaver")).scalar() == 2
    asyncio.run(go())


def test_data_export_includes_the_users_surf_truth_rows_only(maker):
    async def go():
        async with maker() as db:
            package = await export_surf_truth(db, "leaver")
        assert sorted(o["id"] for o in package["surf_observations"]) == ["o1", "o2"]
        assert [m["id"] for m in package["observation_media"]] == ["m1"]
        assert package["observation_media"][0]["exif_latitude"] == 21.66      # their own data, every column
        assert [a["profile_id"] for a in package["surf_truth_anchor"]] == ["leaver"]
        assert [(c["granted"], c["source"]) for c in package["surf_truth_consent_history"]] == [(True, "settings")]
        assert isinstance(package["surf_observations"][0]["received_at"], str)  # JSON-safe
    asyncio.run(go())
