from uuid import uuid4

import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event, func, select

from models import Gallery, GalleryCopyReceipt, GalleryItem
from database import get_db
from routes.gallery.items import MoveToFolderRequest, copy_gallery_item_once, router
from tests.test_gallery_delete_count import sessions


@pytest_asyncio.fixture
async def database(sessions):
    async with sessions.kw["bind"].begin() as conn:
        await conn.run_sync(GalleryCopyReceipt.__table__.create)
    return sessions


async def copy(sessions, key, item="first", target="other", owner="owner"):
    async with sessions() as db:
        return await copy_gallery_item_once(item, key, MoveToFolderRequest(target_gallery_id=target), owner, db)


@pytest.mark.asyncio
async def test_lost_ack_returns_same_copy_and_new_operation_creates_another(database):
    key = uuid4()
    original = await copy(database, key)
    assert original["replayed"] is False
    replay = await copy(database, key)
    assert (replay["new_item_id"], replay["replayed"], replay["copy_present"]) == (original["new_item_id"], True, True)
    later = await copy(database, uuid4())
    assert later["new_item_id"] != original["new_item_id"]
    async with database() as db:
        assert (await db.get(Gallery, "other")).item_count == 2
        assert (await db.get(GalleryItem, "first")).gallery_id == "source"
        assert await db.scalar(select(func.count()).select_from(GalleryCopyReceipt)) == 2


@pytest.mark.asyncio
async def test_retry_does_not_resurrect_removed_copy(database):
    key = uuid4()
    first = await copy(database, key)
    async with database.begin() as db:
        await db.delete(await db.get(GalleryItem, first["new_item_id"]))
        (await db.get(Gallery, "other")).item_count = 0
    replay = await copy(database, key)
    assert replay["new_item_id"] == first["new_item_id"] and replay["replayed"] and not replay["copy_present"]
    async with database() as db:
        assert await db.get(GalleryItem, first["new_item_id"]) is None
        assert (await db.get(Gallery, "other")).item_count == 0


@pytest.mark.asyncio
async def test_moved_copy_is_not_reported_as_present_in_original_destination(database):
    key = uuid4()
    first = await copy(database, key)
    async with database.begin() as db:
        (await db.get(GalleryItem, first["new_item_id"])).gallery_id = "source"
    replay = await copy(database, key)
    assert replay["replayed"] and not replay["copy_present"]
    assert replay["new_item_id"] == first["new_item_id"]


@pytest.mark.asyncio
@pytest.mark.parametrize("source,target", [("last", "other"), ("first", "source")])
async def test_reusing_key_for_another_selection_is_rejected(database, source, target):
    key = uuid4()
    await copy(database, key)
    with pytest.raises(HTTPException) as exc:
        await copy(database, key, source, target)
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_receipt_does_not_bypass_ownership_or_archive(database):
    key = uuid4()
    await copy(database, key)
    with pytest.raises(HTTPException) as exc:
        await copy(database, key, owner="other-owner")
    assert exc.value.status_code == 403
    async with database.begin() as db:
        (await db.get(GalleryItem, "first")).is_deleted = True
    with pytest.raises(HTTPException) as exc:
        await copy(database, key)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_failed_copy_rolls_back_its_receipt_and_count(database):
    key = uuid4()

    def interrupt_insert(*args):
        raise RuntimeError("simulated copy failure")

    event.listen(GalleryItem, "before_insert", interrupt_insert)
    try:
        with pytest.raises(RuntimeError, match="simulated copy failure"):
            await copy(database, key)
    finally:
        event.remove(GalleryItem, "before_insert", interrupt_insert)
    async with database() as db:
        assert (await db.get(Gallery, "other")).item_count == 0
        assert await db.scalar(select(func.count()).select_from(GalleryCopyReceipt)) == 0
    assert (await copy(database, key))["new_item_id"]


@pytest.mark.asyncio
async def test_client_cannot_substitute_owner_query_for_authentication(database):
    app = FastAPI()
    app.include_router(router)

    async def local_db():
        async with database() as session:
            yield session

    app.dependency_overrides[get_db] = local_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.put(f"/gallery/item/first/copies/{uuid4()}?photographer_id=owner",
                                    json={"target_gallery_id": "other"})
    assert response.status_code == 401
    async with database() as db:
        assert await db.scalar(select(func.count()).select_from(GalleryCopyReceipt)) == 0
