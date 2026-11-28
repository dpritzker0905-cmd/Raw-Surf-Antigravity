"""Check gallery membership and mutations for modern and legacy guardian links."""
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import GalleryItem, GromGuardian, Notification, PhotoTag, Profile, RoleEnum
from routes.gallery.grom import (
    GromTagRequest, get_grom_highlights, get_grom_profile_photos, get_linked_groms,
    tag_grom_in_photo, untag_grom_from_photo,
)


@pytest.mark.asyncio
@pytest.mark.parametrize("actor, expected", [("guardian", ["active"]), ("parent", ["legacy"]), ("unrelated", [])])
async def test_gallery_membership(actor, expected):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as connection:
            for model in (Profile, GromGuardian, GalleryItem, PhotoTag, Notification):
                await connection.run_sync(model.__table__.create)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            adults = {"guardian": RoleEnum.SURFER, "parent": RoleEnum.GROM_PARENT, "unrelated": RoleEnum.SURFER}
            for name in (*adults, "active", "legacy", "revoked", "pending"):
                legacy_parent = {"legacy": "parent", "revoked": "guardian", "pending": "guardian"}.get(name)
                db.add(Profile(id=name, user_id=name, email=f"{name}@example.invalid", full_name=name,
                               role=adults.get(name, RoleEnum.GROM), parent_age_verified=False,
                               is_grom_parent=False, parent_id=legacy_parent, parent_link_approved=bool(legacy_parent)))
            await db.flush()
            now = datetime.now(timezone.utc)
            db.add_all([
                GromGuardian(grom_id="active", guardian_id="guardian", verified_at=now),
                GromGuardian(grom_id="revoked", guardian_id="guardian", verified_at=now, revoked_at=now),
                GromGuardian(grom_id="pending", guardian_id="guardian"),
                GalleryItem(id="photo", photographer_id=actor, original_url="fixture", preview_url="preview"),
            ])
            await db.flush()
            listing = await get_linked_groms(actor, actor, db)
            highlights = await get_grom_highlights(actor, current_user_id=actor, db=db)
            assert [child["id"] for child in listing["groms"]] == expected
            assert all(child["is_approved"] for child in listing["groms"])
            assert [child["id"] for child in highlights["groms"]] == expected
            for child in ("active", "legacy", "pending", "revoked"):
                tag = GromTagRequest(gallery_item_id="photo", grom_id=child)
                if child in expected:
                    await tag_grom_in_photo(tag, actor, actor, db)
                    filtered = await get_grom_highlights(actor, child, current_user_id=actor, db=db)
                    assert [item["id"] for item in filtered["items"]] == ["photo"]
                    await untag_grom_from_photo("photo", child, actor, actor, db)
                else:
                    with pytest.raises(HTTPException) as denied:
                        await tag_grom_in_photo(tag, actor, actor, db)
                    assert denied.value.status_code == 403
                if actor == "guardian" and child == "active":
                    await get_grom_profile_photos(child, current_user_id=actor, db=db)
                else:
                    with pytest.raises(HTTPException) as denied:
                        await get_grom_profile_photos(child, current_user_id=actor, db=db)
                    assert denied.value.status_code == 403
    finally:
        await engine.dispose()
