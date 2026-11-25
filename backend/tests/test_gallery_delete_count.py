"""Deletion from either gallery endpoint counts each active photo once."""
import pytest
import pytest_asyncio
from fastapi import HTTPException
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import selectinload

from models import Gallery, GalleryItem, GalleryPurchase, PhotoTag, Profile, RoleEnum, SurferGalleryItem
from routes.gallery.gallery_purchases import claim_free_photo, download_gallery_item, purchase_gallery_item
from routes.gallery.schemas import PurchaseRequest
from routes.gallery.collections import get_gallery, remove_item_from_gallery
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
            for model in (Profile, Gallery, GalleryItem, GalleryPurchase, PhotoTag, SurferGalleryItem):
                await conn.run_sync(model.__table__.create)
        factory = async_sessionmaker(engine, expire_on_commit=False)
        async with factory.begin() as db:
            db.add(Profile(id="owner", user_id="owner", email="owner@example.invalid", role=RoleEnum.SURFER))
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


@pytest.mark.asyncio
@pytest.mark.parametrize("price", [None, 12])
async def test_delete_removes_unentitled_tag(sessions, price):
    async with sessions.begin() as db:
        db.add(PhotoTag(id="tag", gallery_item_id="first", photographer_id="owner",
                        surfer_id="purchased", session_photo_price=price))
    assert not (await remove(sessions, "folder", "first"))["soft_delete"]
    async with sessions() as db:
        assert await db.get(PhotoTag, "tag") is None
        assert await db.get(GalleryItem, "first") is None
    await assert_source_count(sessions, 2)


@pytest.mark.asyncio
@pytest.mark.parametrize("grant", [{"is_gift": True}, {"access_granted": True}, {"session_photo_price": 0}])
async def test_granted_tag_remains_claimable_after_archive(sessions, grant):
    async with sessions.begin() as db:
        db.add(PhotoTag(id="tag", gallery_item_id="first", photographer_id="owner",
                        surfer_id="purchased", **grant))
    assert (await remove(sessions, "folder", "first"))["preserved_for_surfers"] == 1
    async with sessions() as db:
        result = await claim_free_photo("first", "purchased", "tag", "purchased", db)
        assert result["success"]
    # The same surfer now holds both a tag and a purchase.
    assert (await remove(sessions, "library", "first"))["preserved_for_surfers"] == 1
    async with sessions() as db:
        result = await download_gallery_item("first", "purchased", "high", "purchased", db)
        assert result["download_url"] == "/original/first"
    await assert_source_count(sessions, 2)


@pytest.mark.asyncio
async def test_purchase_without_locker_remains_downloadable(sessions):
    async with sessions.begin() as db:
        db.add(GalleryPurchase(gallery_item_id="first", buyer_id="purchased", photographer_id="owner",
                               quality_tier="web", amount_paid=3))
    assert (await remove(sessions, "library", "first"))["soft_delete"]
    async with sessions() as db:
        result = await download_gallery_item("first", "purchased", "web", "purchased", db)
        assert result["download_url"] == "/preview/first"
        with pytest.raises(HTTPException) as exc:
            await download_gallery_item("first", "purchased", "high", "purchased", db)
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as exc:
            await download_gallery_item("first", "pending", "web", "pending", db)
        assert exc.value.status_code == 403
    await assert_source_count(sessions, 2)


@pytest.mark.asyncio
async def test_archive_refuses_new_purchase(sessions):
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            await purchase_gallery_item("paid", "pending", PurchaseRequest(), "pending", db)
        assert (exc.value.status_code, exc.value.detail) == (404, "Gallery item not found")


@pytest.mark.asyncio
async def test_paid_locker_with_pending_label_survives(sessions):
    async with sessions.begin() as db:
        db.add(SurferGalleryItem(id="legacy", gallery_item_id="first", surfer_id="purchased",
                                 photographer_id="owner", access_type="pending", is_paid=True))
    assert (await remove(sessions, "folder", "first"))["preserved_for_surfers"] == 1
    async with sessions() as db:
        assert (await db.get(SurferGalleryItem, "legacy")).preserved_original_url == "/original/first"


@pytest.mark.asyncio
async def test_unpaid_tag_cannot_claim_archived_photo(sessions):
    async with sessions.begin() as db:
        db.add(PhotoTag(id="offer", gallery_item_id="paid", photographer_id="owner",
                        surfer_id="pending", session_photo_price=12))
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            await claim_free_photo("paid", "pending", "offer", "pending", db)
        assert exc.value.status_code == 400
        assert await db.scalar(select(func.count()).select_from(GalleryPurchase)) == 0


@pytest.mark.asyncio
async def test_folder_detail_hides_archive_and_keeps_active_private_item_for_owner(sessions):
    await remove(sessions, "folder", "paid")
    for viewer, expected in (("owner", {"first", "last"}), (None, {"first"})):
        async with sessions.begin() as db:
            (await db.get(GalleryItem, "last")).is_public = True
        async with sessions() as db:
            loaded = await db.get(Gallery, "source", options=[selectinload(Gallery.items)])
            assert len(loaded.items) == 3
            await db.execute(update(GalleryItem).where(GalleryItem.id == "last")
                             .values(is_public=False).execution_options(synchronize_session=False))
            assert next(item for item in loaded.items if item.id == "last").is_public
            folder = await get_gallery("source", viewer, viewer, db)
            assert {item["id"] for item in folder["items"]} == expected
            assert folder["item_count"] == len(expected)
