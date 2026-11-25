"""Deletion from either gallery endpoint counts each active photo once."""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import Gallery, GalleryItem, GalleryPurchase, PhotoTag, SurferGalleryItem
from routes.gallery.collections import remove_item_from_gallery
from routes.gallery.items import delete_gallery_item
from services.gallery_sync import safe_delete_gallery_item


async def seed_gallery(sessions):
    async with sessions.begin() as db:
        db.add_all([
            Gallery(id="source", title="Source", photographer_id="owner", item_count=3),
            Gallery(id="other", title="Other", photographer_id="owner", item_count=0),
        ])
        await db.flush()
        for name in ("first", "paid", "last"):
            db.add(GalleryItem(
                id=name, gallery_id="source", photographer_id="owner",
                original_url=f"/original/{name}", preview_url=f"/preview/{name}",
                thumbnail_url=f"/thumb/{name}", media_type="image",
            ))
        await db.flush()
        for access in ("purchased", "pending"):
            db.add(SurferGalleryItem(
                id=access, surfer_id=access, gallery_item_id="paid",
                photographer_id="owner", access_type=access,
            ))


@pytest_asyncio.fixture
async def sessions():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as conn:
            for model in (Gallery, GalleryItem, GalleryPurchase, PhotoTag, SurferGalleryItem):
                await conn.run_sync(model.__table__.create)
        factory = async_sessionmaker(engine)
        await seed_gallery(factory)
        yield factory
    finally:
        await engine.dispose()


async def remove(sessions, endpoint, item_id):
    async with sessions() as db:
        if endpoint == "folder":
            return await remove_item_from_gallery("source", item_id, "owner", db)
        return await delete_gallery_item(item_id, "owner", db)


async def assert_source_count(sessions, expected):
    async with sessions() as db:
        active = await db.scalar(select(func.count()).select_from(GalleryItem).where(
            GalleryItem.gallery_id == "source", GalleryItem.is_deleted.is_(False),
        ))
        assert (await db.get(Gallery, "source")).item_count == active == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["folder", "library"])
async def test_hard_delete_and_retry(sessions, endpoint):
    result = await remove(sessions, endpoint, "first")
    assert result["soft_delete"] is False
    await assert_source_count(sessions, 2)
    with pytest.raises(HTTPException) as exc:
        await remove(sessions, endpoint, "first")
    assert exc.value.status_code == 404
    await assert_source_count(sessions, 2)


@pytest.mark.asyncio
@pytest.mark.parametrize("first,second", [("folder", "library"), ("library", "folder"), ("folder", "folder")])
async def test_paid_delete_and_retry(sessions, first, second):
    deleted_at = None
    for endpoint in (first, second):
        result = await remove(sessions, endpoint, "paid")
        assert result["soft_delete"] and result["preserved_for_surfers"] == 1
        await assert_source_count(sessions, 2)
        async with sessions() as db:
            photo = await db.get(GalleryItem, "paid")
            assert photo.is_deleted and not photo.is_public
            assert photo.deleted_at is not None
            if deleted_at is not None:
                assert photo.deleted_at == deleted_at
            deleted_at = photo.deleted_at
            locker = await db.get(SurferGalleryItem, "purchased")
            assert (locker.preserved_original_url, locker.preserved_preview_url,
                    locker.preserved_thumbnail_url, locker.preserved_media_type) == (
                "/original/paid", "/preview/paid", "/thumb/paid", "image",
            )
            assert await db.get(SurferGalleryItem, "pending") is None


@pytest.mark.asyncio
async def test_wrong_folder_cannot_remove_photo(sessions):
    async with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            await remove_item_from_gallery("other", "first", "owner", db)
        assert exc.value.status_code == 404
    await assert_source_count(sessions, 3)


@pytest.mark.asyncio
async def test_rollback_restores_count_photo_and_locker(sessions):
    async with sessions() as db:
        await safe_delete_gallery_item(db, "paid", "owner")
        await db.rollback()
    await assert_source_count(sessions, 3)
    async with sessions() as db:
        assert not (await db.get(GalleryItem, "paid")).is_deleted
        assert (await db.get(SurferGalleryItem, "purchased")).preserved_original_url is None
        assert await db.get(SurferGalleryItem, "pending") is not None
