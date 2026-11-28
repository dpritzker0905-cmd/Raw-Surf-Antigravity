"""Exercise tier-specific transfers and documented historical promises through the real handlers."""

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from models import (
    GalleryItem,
    GalleryOriginalTransferGrant,
    GalleryPurchase,
    Profile,
    RoleEnum,
    UserMedia,
)
from routes.profiles.user_media import (
    _user_media_delivery_url,
    transfer_purchased_media,
)
from services.gallery_tiers import tier_fields


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["image", "video"])
async def test_gallery_transfer_entitlements(kind, private_gallery_store):
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    try:
        async with engine.begin() as conn:
            for model in (
                Profile,
                GalleryItem,
                GalleryPurchase,
                GalleryOriginalTransferGrant,
                UserMedia,
            ):
                await conn.run_sync(model.__table__.create)
        async with async_sessionmaker(engine, expire_on_commit=False)() as db:
            fields = tier_fields(kind)
            low, middle, top = fields
            values = {}
            for tier, field in fields.items():
                key = "gallery_originals/owner/" + tier
                values[field] = "supabase://" + key
                private_gallery_store.objects[key] = tier.encode()
            item = GalleryItem(
                id="asset",
                photographer_id="owner",
                media_type=kind,
                preview_url="/preview",
                **values,
            )
            db.add(item)
            for user in (
                "owner",
                "buyer",
                "legacy",
                "upgraded",
                "missing",
                "unrelated",
            ):
                db.add(
                    Profile(
                        id=user,
                        user_id=user,
                        email=user + "@example.invalid",
                        role=RoleEnum.SURFER,
                    )
                )
            for user, tier in (
                ("buyer", low),
                ("legacy", low),
                ("upgraded", low),
                ("upgraded", middle),
                ("missing", middle),
            ):
                db.add(
                    GalleryPurchase(
                        id=user + tier,
                        gallery_item_id="asset",
                        buyer_id=user,
                        photographer_id="owner",
                        quality_tier=tier,
                        amount_paid=0,
                    )
                )
            db.add(
                GalleryOriginalTransferGrant(
                    purchase_id="legacy" + low, evidence_ref="fixture-terms"
                )
            )
            await db.commit()
            for user, expected in (
                ("buyer", low),
                ("legacy", top),
                ("upgraded", middle),
            ):
                body = await transfer_purchased_media(user, "asset", user, db)
                async with private_gallery_store.client() as client:
                    delivery = await client.get(body["media_url"])
                    assert delivery.content == expected.encode()
                media = await db.get(UserMedia, body["id"])
                media.media_url = item.original_url
                signed = await _user_media_delivery_url(db, media)
                async with private_gallery_store.client() as client:
                    assert (await client.get(signed)).content == expected.encode()
            setattr(item, fields[middle], None)
            for user, status in (("missing", 503), ("unrelated", 403)):
                with pytest.raises(HTTPException) as denied:
                    await transfer_purchased_media(user, "asset", user, db)
                assert denied.value.status_code == status
    finally:
        await engine.dispose()
