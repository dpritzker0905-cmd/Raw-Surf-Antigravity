import pytest
from fastapi import HTTPException
from sqlalchemy import func, select, update

from models import Gallery, GalleryItem, SurferGalleryItem
from routes.gallery.items import MoveToFolderRequest, copy_item_to_gallery, move_item_to_gallery
from tests.test_gallery_delete_count import remove, sessions


@pytest.mark.asyncio
@pytest.mark.parametrize("transfer", [move_item_to_gallery, copy_item_to_gallery])
async def test_archived_source_rejected_without_altering_folders_or_locker(sessions, transfer):
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        for source in ("paid", "missing"):
            with pytest.raises(HTTPException) as exc:
                await transfer(source, "owner", MoveToFolderRequest(target_gallery_id="other"), db)
            assert (exc.value.status_code, exc.value.detail) == (404, "Gallery item not found")
    async with sessions() as db:
        assert (await db.get(GalleryItem, "paid")).gallery_id == "source"
        assert (await db.get(SurferGalleryItem, "purchased")).preserved_original_url == "/original/paid"
        assert (await db.get(Gallery, "source")).item_count == 2
        folder = await db.get(Gallery, "other")
        assert (folder.item_count, folder.cover_image_url) == (0, None)
        assert await db.scalar(select(func.count()).select_from(GalleryItem)) == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("transfer", [move_item_to_gallery, copy_item_to_gallery])
async def test_legacy_active_source_transfers_with_destination_pricing(sessions, transfer):
    async with sessions.begin() as db:
        await db.execute(update(GalleryItem).where(GalleryItem.id == "first").values(is_deleted=None))
        (await db.get(Gallery, "other")).locked_price_web = 0
    async with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            await transfer("first", "stranger", MoveToFolderRequest(target_gallery_id="other"), db)
        assert exc.value.status_code == 403
        result = await transfer("first", "owner", MoveToFolderRequest(target_gallery_id="other"), db)
    async with sessions() as db:
        dest = await db.get(GalleryItem, result.get("new_item_id", "first"))
        assert (dest.gallery_id, dest.locked_price_web) == ("other", 0)
        assert (await db.get(Gallery, "other")).item_count == 1
        copied = transfer is copy_item_to_gallery
        assert (await db.get(Gallery, "source")).item_count == (3 if copied else 2)
        assert (await db.get(GalleryItem, "first")).gallery_id == ("source" if copied else "other")


@pytest.mark.asyncio
@pytest.mark.parametrize("transfer", [move_item_to_gallery, copy_item_to_gallery])
async def test_transfer_refuses_missing_and_foreign_destination(sessions, transfer):
    async with sessions.begin() as db:
        (await db.get(Gallery, "other")).photographer_id = "stranger"
    for folder, status in (("missing", 404), ("other", 403)):
        async with sessions() as db:
            with pytest.raises(HTTPException) as exc:
                await transfer("first", "owner", MoveToFolderRequest(target_gallery_id=folder), db)
            assert exc.value.status_code == status
    async with sessions() as db:
        assert (await db.get(Gallery, "source")).item_count == 3
        assert (await db.get(Gallery, "other")).item_count == 0


@pytest.mark.asyncio
async def test_move_to_current_folder_leaves_existing_count_alone(sessions):
    async with sessions.begin() as db:
        (await db.get(Gallery, "source")).item_count = 0
    async with sessions() as db:
        await move_item_to_gallery("first", "owner", MoveToFolderRequest(target_gallery_id="source"), db)
    async with sessions() as db:
        assert (await db.get(Gallery, "source")).item_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("transfer", [move_item_to_gallery, copy_item_to_gallery])
async def test_transfer_refreshes_previously_loaded_destination(sessions, transfer):
    async with sessions() as db:
        cached = await db.get(Gallery, "other")
        # An earlier transfer has reached the database while the ORM still holds the old count.
        await db.execute(update(GalleryItem).where(GalleryItem.id == "last").values(gallery_id="other"))
        await db.execute(update(Gallery).where(Gallery.id == "source").values(item_count=2))
        await db.execute(update(Gallery).where(Gallery.id == "other").values(item_count=1)
                         .execution_options(synchronize_session=False))
        assert cached.item_count == 0
        await transfer("first", "owner", MoveToFolderRequest(target_gallery_id="other"), db)
    async with sessions() as db:
        active = await db.scalar(select(func.count()).select_from(GalleryItem).where(
            GalleryItem.gallery_id == "other", GalleryItem.is_deleted.is_not(True)
        ))
        assert (await db.get(Gallery, "other")).item_count == active == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("transfer", [move_item_to_gallery, copy_item_to_gallery])
async def test_transfer_rebuilds_missing_counts_before_changing_membership(sessions, transfer):
    async with sessions.begin() as db:
        db.add(GalleryItem(id="remaining", gallery_id="source", photographer_id="owner",
                           original_url="/original/remaining", preview_url="/preview/remaining"))
        await db.execute(update(GalleryItem).where(GalleryItem.id == "last").values(
            gallery_id="other", is_deleted=None
        ))
        await db.execute(update(GalleryItem).where(GalleryItem.id == "paid").values(is_deleted=True))
        await db.execute(update(Gallery).values(item_count=None))
    async with sessions() as db:
        await transfer("first", "owner", MoveToFolderRequest(target_gallery_id="other"), db)
    async with sessions() as db:
        assert (await db.get(Gallery, "other")).item_count == 2
        source_count = (await db.get(Gallery, "source")).item_count
        assert source_count == (1 if transfer is move_item_to_gallery else None)
