"""Gallery lists use the authenticated guardian's active or approved legacy links."""
from datetime import datetime, timezone

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import GalleryItem, GromGuardian, PhotoTag, Profile, RoleEnum
from routes.gallery.grom import get_grom_highlights, get_linked_groms


@pytest.mark.asyncio
@pytest.mark.parametrize("actor, expected", [("guardian", ["active", "legacy"]), ("unrelated", [])])
async def test_gallery_membership(actor, expected):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            for model in (Profile, GromGuardian, GalleryItem, PhotoTag):
                await connection.run_sync(model.__table__.create)
        async with async_sessionmaker(engine)() as db:
            for name in ("guardian", "unrelated", "active", "legacy", "revoked", "pending"):
                adult = name in ("guardian", "unrelated")
                db.add(Profile(id=name, user_id=name, email=f"{name}@example.invalid", full_name=name,
                               role=RoleEnum.GROM_PARENT if adult else RoleEnum.GROM,
                               parent_age_verified=adult, parent_id="guardian" if name == "legacy" else None,
                               parent_link_approved=name == "legacy"))
            await db.flush()
            now = datetime.now(timezone.utc)
            db.add_all([
                GromGuardian(grom_id="active", guardian_id="guardian", verified_at=now),
                GromGuardian(grom_id="revoked", guardian_id="guardian", verified_at=now, revoked_at=now),
                GromGuardian(grom_id="pending", guardian_id="guardian"),
            ])
            await db.flush()
            listing = await get_linked_groms(actor, actor, db)
            highlights = await get_grom_highlights(actor, current_user_id=actor, db=db)
            assert [child["id"] for child in listing["groms"]] == expected
            assert all(child["is_approved"] for child in listing["groms"])
            assert [child["id"] for child in highlights["groms"]] == expected
    finally:
        await engine.dispose()
