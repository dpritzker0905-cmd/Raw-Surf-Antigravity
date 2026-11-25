"""Public-facing previews and covers after a photographer archives a photo."""
import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from httpx import ASGITransport, AsyncClient
from sqlalchemy import update
from database import get_db

from models import ConditionReport, Gallery, GalleryItem, GalleryPurchase, LiveSession, Profile, RoleEnum, SurferGalleryItem, UserMedia
from routes.condition_reports.feed import get_public_gallery_archive
from routes.profiles.profile_content import get_session_shots
from routes.gallery import gallery_purchases as purchases
from routes.gallery.admin import SetThumbnailRequest, recalculate_gallery_counts, set_gallery_thumbnail
from routes.gallery.collections import get_gallery
from routes.gallery.collections_roster import get_photographer_galleries
from routes.gallery.distribution_tagging import get_photographer_public_galleries
from routes.gallery.gallery_pricing import get_gallery_item_pricing
from routes.gallery.items import get_gallery_item
from routes.gallery.sales import get_quality_previews
from tests.test_gallery_delete_count import remove, sessions


@pytest.mark.asyncio
@pytest.mark.parametrize("viewer", [None, "purchased"])
async def test_standalone_archive_preview_is_missing_before_render(sessions, monkeypatch, viewer):
    renderer = AsyncMock(return_value=b"test jpeg")
    monkeypatch.setattr(purchases, "generate_watermarked_preview", renderer)
    async with sessions.begin() as db:
        db.add(GalleryPurchase(gallery_item_id="paid", buyer_id="purchased", photographer_id="owner",
                               amount_paid=3, quality_tier="web"))
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        for item in ("paid", "nonexistent"):
            with pytest.raises(HTTPException) as exc:
                await purchases.get_watermarked_preview(item, viewer, db)
            assert (exc.value.status_code, exc.value.detail) == (404, "Gallery item not found")
            assert "no-store" in exc.value.headers["Cache-Control"]
        renderer.assert_not_awaited()
        download = await purchases.download_gallery_item("paid", "purchased", "web", "purchased", db)
        assert download["download_url"] == "/preview/paid"


@pytest.mark.asyncio
async def test_active_preview_is_rendered_without_shared_cache(sessions, monkeypatch):
    renderer = AsyncMock(return_value=b"test jpeg")
    monkeypatch.setattr(purchases, "generate_watermarked_preview", renderer)
    async with sessions() as db:
        response = await purchases.get_watermarked_preview("first", None, db)
        assert response.body == b"test jpeg"
        assert "no-store" in response.headers["cache-control"]
        assert renderer.await_args.kwargs["original_url"] == "/preview/first"


@pytest.mark.asyncio
async def test_active_buyer_preview_keeps_its_json_and_is_not_cacheable(sessions):
    async with sessions.begin() as db:
        db.add(GalleryPurchase(gallery_item_id="paid", buyer_id="purchased", photographer_id="owner",
                               amount_paid=3, quality_tier="web"))
    async with sessions() as db:
        result = await purchases.get_watermarked_preview("paid", "purchased", db)
        assert json.loads(result.body) == {"preview_url": "/preview/paid", "is_watermarked": False,
                                           "access_type": "purchased"}
        assert "no-store" in result.headers["cache-control"]


@pytest.mark.asyncio
@pytest.mark.parametrize("stored", [None, "/preview/paid", "/original/paid", "/thumb/paid", "/custom/cover"])
async def test_archived_only_folder_covers(sessions, stored):
    await remove(sessions, "folder", "paid")
    for item in ("first", "last"):
        await remove(sessions, "folder", item)
    async with sessions.begin() as db:
        folder = await db.get(Gallery, "source")
        folder.is_public = True
        folder.cover_image_url = stored
    expected = stored if stored == "/custom/cover" else None
    async with sessions() as db:
        detail = await get_gallery("source", None, None, db)
        assert detail["cover_image_url"] == expected
    async with sessions() as db:
        public = await get_photographer_public_galleries("owner", 20, 0, db)
        folder = next(g for g in public["galleries"] if g["id"] == "source")
        assert folder["cover_image_url"] == expected
        assert not folder["preview_items"]
    async with sessions() as db:
        roster = await get_photographer_galleries("owner", db)
        folder = next(g for g in roster if g["id"] == "source")
        assert (folder["cover_image_url"], folder["first_item_preview"], folder["item_count"]) == (expected, None, 0)
    async with sessions() as db:
        assert (await db.get(Gallery, "source")).item_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("selection", [{"item_id": "paid"}, {"thumbnail_url": "/thumb/paid"}])
async def test_cannot_reselect_archived_photo_for_another_folder(sessions, selection):
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            await set_gallery_thumbnail("other", "owner", SetThumbnailRequest(**selection), db)
        assert exc.value.status_code == 404
        assert (await db.get(Gallery, "other")).cover_image_url is None
    allowed = SetThumbnailRequest(item_id="first") if "item_id" in selection else SetThumbnailRequest(thumbnail_url="/custom/cover")
    expected = "/preview/first" if allowed.item_id else "/custom/cover"
    async with sessions() as db:
        await set_gallery_thumbnail("other", "owner", allowed, db)
    async with sessions() as db:
        assert (await get_gallery("other", None, None, db))["cover_image_url"] == expected


@pytest.mark.asyncio
async def test_same_owner_active_copy_can_still_supply_cover(sessions):
    async with sessions.begin() as db:
        (await db.get(GalleryItem, "first")).preview_url = "/preview/paid"
        (await db.get(Gallery, "other")).cover_image_url = "/preview/paid"
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        detail = await get_gallery("other", None, None, db)
        assert detail["cover_image_url"] == "/preview/paid"


@pytest.mark.asyncio
async def test_legacy_active_copy_and_unrelated_cover_survive_purge(sessions):
    async with sessions.begin() as db:
        await db.execute(update(GalleryItem).where(GalleryItem.id == "first")
                         .values(preview_url="/preview/paid", is_deleted=None))
        (await db.get(Gallery, "other")).cover_image_url = "/preview/paid"
        (await db.get(Gallery, "source")).cover_image_url = "/preview/paid-custom"
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        assert (await get_gallery("other", None, None, db))["cover_image_url"] == "/preview/paid"
    async with sessions.begin() as db:
        await db.delete(await db.get(SurferGalleryItem, "purchased"))
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        assert (await db.get(Gallery, "source")).cover_image_url == "/preview/paid-custom"
        assert (await db.get(Gallery, "other")).cover_image_url == "/preview/paid"


@pytest.mark.asyncio
async def test_last_archived_source_purge_clears_cross_folder_reference(sessions):
    async with sessions.begin() as db:
        (await db.get(Gallery, "other")).cover_image_url = "/preview/paid"
    await remove(sessions, "folder", "paid")
    async with sessions.begin() as db:
        await db.delete(await db.get(SurferGalleryItem, "purchased"))
    assert not (await remove(sessions, "folder", "paid"))["soft_delete"]
    async with sessions() as db:
        assert (await db.get(Gallery, "other")).cover_image_url is None


@pytest.mark.asyncio
async def test_archived_cover_falls_back_to_public_active_item_without_saving_it(sessions):
    async with sessions.begin() as db:
        folder = await db.get(Gallery, "source")
        folder.is_public = True
        folder.cover_image_url = "/thumb/paid"
        (await db.get(GalleryItem, "first")).is_public = False
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        roster = await get_photographer_galleries("owner", db)
        folder = next(g for g in roster if g["id"] == "source")
        assert (folder["cover_image_url"], folder["first_item_preview"], folder["item_count"]) == (
            "/preview/last", "/preview/last", 2)
        published = await get_photographer_public_galleries("owner", 20, 0, db)
        folder = next(g for g in published["galleries"] if g["id"] == "source")
        assert folder["cover_image_url"] == "/preview/last"
        assert [i["id"] for i in folder["preview_items"]] == ["last"]
    async with sessions() as db:
        assert (await db.get(Gallery, "source")).cover_image_url == "/thumb/paid"


@pytest.mark.asyncio
async def test_item_detail_and_pricing_cannot_return_archived_preview(sessions):
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        for route in (get_gallery_item, get_gallery_item_pricing):
            with pytest.raises(HTTPException) as exc:
                await route("paid", None, None, db)
            assert exc.value.status_code == 404
            active = await route("first", None, None, db)
            assert active["preview_url"] == "/preview/first"
        assert (await db.get(GalleryItem, "paid")).view_count == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("media_type", ["image", "video"])
async def test_quality_comparison_serves_only_active_preview(sessions, media_type):
    async with sessions.begin() as db:
        (await db.get(GalleryItem, "first")).media_type = media_type
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        active = await get_quality_previews("first", db)
        assert all(tier["url"] in ("/preview/first", "/thumb/first") for tier in active["previews"].values())
        with pytest.raises(HTTPException) as exc:
            await get_quality_previews("paid", db)
        assert exc.value.status_code == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("report_url", ["/thumb/paid", "/independent/report"])
async def test_gallery_cards_using_condition_report_media(sessions, report_url):
    async with sessions.begin() as db:
        conn = await db.connection()
        for model in (LiveSession, ConditionReport, UserMedia):
            await conn.run_sync(model.__table__.create, checkfirst=True)
        (await db.get(Profile, "owner")).role = RoleEnum.PHOTOGRAPHER
        db.add(LiveSession(id="live", photographer_id="owner"))
        await db.flush()
        folder = await db.get(Gallery, "source")
        folder.live_session_id = "live"
        folder.session_type = "live"
        folder.is_public = True
        folder.cover_image_url = "/original/paid"
        db.add(ConditionReport(photographer_id="owner", live_session_id="live", media_url=report_url,
                               expires_at=datetime.now(timezone.utc)))
    await remove(sessions, "folder", "paid")
    expected = report_url if report_url == "/independent/report" else None
    async with sessions() as db:
        shots = await get_session_shots("owner", db=db)
        assert (shots[0]["thumbnail_url"], shots[0]["item_count"]) == (expected, 2)
        archive = await get_public_gallery_archive(limit=10, db=db)
        card = archive["galleries"][0]
        assert card["cover_image_url"] is None
        assert card["conditions"]["media_url"] == expected


@pytest.mark.asyncio
@pytest.mark.parametrize("field", ["url_web", "url_standard", "url_720p", "url_1080p"])
async def test_archived_cover_matches_known_tier_urls_only(sessions, field):
    path = f"/media/{field}"
    async with sessions.begin() as db:
        setattr(await db.get(GalleryItem, "paid"), field, path)
        (await db.get(Gallery, "other")).cover_image_url = path
        (await db.get(Gallery, "source")).cover_image_url = path + "-custom"
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        assert (await get_gallery("other", None, None, db))["cover_image_url"] is None
        assert (await get_gallery("source", None, None, db))["cover_image_url"] == path + "-custom"


@pytest.mark.asyncio
async def test_preview_http_after_archive_revalidates_before_render(sessions, monkeypatch):
    app = FastAPI()
    app.include_router(purchases.router, prefix="/api")
    async def database():
        async with sessions() as db:
            yield db
    app.dependency_overrides[get_db] = database
    renderer = AsyncMock(return_value=b"test jpeg")
    monkeypatch.setattr(purchases, "generate_watermarked_preview", renderer)
    path = "/api/gallery/watermarked-preview/paid"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://local.test") as client:
        active = await client.get(path)
        assert (active.status_code, active.content) == (200, b"test jpeg")
        assert "no-store" in active.headers["cache-control"]
        await remove(sessions, "folder", "paid")
        archived = await client.get(path, headers={"If-None-Match": '"previous"', "Range": "bytes=0-3"})
        missing = await client.get("/api/gallery/watermarked-preview/absent")
        assert archived.status_code == missing.status_code == 404
        assert archived.json() == missing.json()
        assert "no-store" in archived.headers["cache-control"]
        renderer.assert_awaited_once()


@pytest.mark.asyncio
async def test_cover_recalculation_preserves_archived_paid_media(sessions):
    async with sessions.begin() as db:
        for name in ("first", "last"):
            item = await db.get(GalleryItem, name)
            item.preview_url = f"https://media.example.invalid/{name}"
            item.thumbnail_url = item.preview_url
        (await db.get(Gallery, "source")).cover_image_url = "/thumb/paid"
    await remove(sessions, "folder", "paid")
    async with sessions() as db:
        result = await recalculate_gallery_counts("source", True, db)
        assert result["stale_items_purged"] == 0
        assert result["new_item_count"] == 2
        assert result["new_cover"] in {f"https://media.example.invalid/{n}" for n in ("first", "last")}
        assert (await db.get(GalleryItem, "paid")).is_deleted
        assert (await db.get(SurferGalleryItem, "purchased")).preserved_preview_url == "/preview/paid"
