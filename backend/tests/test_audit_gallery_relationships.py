"""Actual SQL/ORM mutations on ephemeral SQLite: tag, item and session dependencies."""
import asyncio
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session

from core.security import create_access_token
from database import get_db
from models import (
    Profile, RoleEnum, Gallery, GalleryItem, GalleryPurchase, PhotoTag, SurfSpot,
    SurferGalleryItem, SurferSelectionQuota,
)
from routes.gallery import gallery_purchases
from routes.surfer_gallery import selection


class AsyncFacade:
    def __init__(self, session):
        self.session = session

    async def execute(self, statement):
        return self.session.execute(statement)

    def add(self, row):
        self.session.add(row)

    async def commit(self):
        self.session.commit()


@pytest.fixture
def estate():
    engine = create_engine(URL.create("sqlite"))
    models = [Profile, Gallery, GalleryItem, GalleryPurchase, PhotoTag, SurfSpot, SurferGalleryItem, SurferSelectionQuota]
    for model in models:
        model.__table__.create(engine)
    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        for actor in ["owner", "other", "photographer"]:
            connection.execute(Profile.__table__.insert().values(
                id=actor, user_id=actor, email=actor + "@example.invalid", role=RoleEnum.SURFER,
            ))
        for item in ["a", "b", "remaining-a", "remaining-b"]:
            connection.execute(GalleryItem.__table__.insert().values(
                id=item, photographer_id="photographer", media_type="image", price_high=50,
                original_url="https://images.example.invalid/" + item,
                preview_url="https://images.example.invalid/preview-" + item, created_at=now,
            ))
        connection.execute(PhotoTag.__table__.insert().values(
            id="gift-a", gallery_item_id="a", surfer_id="owner", photographer_id="photographer",
            is_gift=True, access_granted=True,
        ))
    session = Session(engine, expire_on_commit=False)
    app = FastAPI()
    app.include_router(gallery_purchases.router)
    app.include_router(selection.router, prefix="/locker")

    async def database():
        yield AsyncFacade(session)

    app.dependency_overrides[get_db] = database

    def request(path, body=None, actor="owner"):
        async def perform():
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                return await client.post(path, json=body, headers={
                    "Authorization": "Bearer " + create_access_token({"sub": actor}),
                })
        return asyncio.run(perform())

    yield session, request
    session.close()
    engine.dispose()


@pytest.mark.parametrize("item,actor,expected", [("a", "owner", 200), ("b", "owner", 404), ("a", "other", 403)])
def test_gift_authority_is_bound_to_the_same_item_and_actor(estate, item, actor, expected):
    session, request = estate
    response = request("/gallery/items/" + item + "/claim?user_id=owner&tag_id=gift-a", actor=actor)
    assert response.status_code == expected
    purchases = list(session.scalars(select(GalleryPurchase)))
    assert len(purchases) == (1 if expected == 200 else 0)
    if purchases:
        assert purchases[0].gallery_item_id == "a" and purchases[0].amount_paid == 0
    assert session.get(GalleryItem, "b").purchase_count == 0


def test_repeated_free_claim_does_not_create_duplicate_entitlements_or_counts(estate):
    session, request = estate
    path = "/gallery/items/a/claim?user_id=owner&tag_id=gift-a"
    assert request(path).status_code == 200
    assert request(path).status_code == 200
    assert len(list(session.scalars(select(GalleryPurchase)))) == 1
    assert session.get(GalleryItem, "a").purchase_count == 1


@pytest.mark.parametrize("scope", ["valid", "missing", "ambiguous"])
def test_duplicate_selection_cannot_consume_quota_or_unlock_items(estate, scope):
    session, request = estate
    quota = SurferSelectionQuota(
        id="duplicate-quota", surfer_id="owner", photographer_id="photographer", photos_allowed=2,
        videos_allowed=0, photos_selected=0, videos_selected=0, status="pending_selection",
        booking_id="session-a" if scope != "missing" else None,
        live_session_id="session-b" if scope == "ambiguous" else None,
    )
    item = SurferGalleryItem(
        id="duplicate-item", surfer_id="owner", photographer_id="photographer", gallery_item_id="a",
        booking_id=quota.booking_id, live_session_id=quota.live_session_id,
        selection_eligible=True, access_type="pending_selection",
    )
    session.add_all([quota, item])
    session.commit()
    response = request("/locker/selection-queue/duplicate-quota/select", {"item_ids": ["duplicate-item", "duplicate-item"]})
    assert response.status_code == 400
    assert quota.photos_selected == 0 and quota.status == "pending_selection"
    assert item.selection_eligible is True and item.access_type == "pending_selection"


@pytest.mark.parametrize("session_field", ["booking_id", "live_session_id"])
def test_finishing_one_quota_cannot_remove_another_sessions_selection(estate, session_field):
    session, request = estate
    quota = SurferSelectionQuota(
        id="quota-a", surfer_id="owner", photographer_id="photographer", photos_allowed=1,
        videos_allowed=0, photos_selected=0, videos_selected=0, status="pending_selection",
        **{session_field: "session-a"},
    )
    session.add(quota)
    for identifier, media, scope in [("selected-a", "a", "session-a"), ("remaining-a", "remaining-a", "session-a"), ("remaining-b", "remaining-b", "session-b")]:
        session.add(SurferGalleryItem(
            id=identifier, surfer_id="owner", photographer_id="photographer", gallery_item_id=media,
            selection_eligible=True, access_type="pending_selection", **{session_field: scope},
        ))
    session.commit()
    response = request("/locker/selection-queue/quota-a/select", {"item_ids": ["selected-a"]})
    assert response.status_code == 200
    assert quota.status == "selections_complete" and quota.photos_selected == 1
    assert session.get(SurferGalleryItem, "selected-a").access_type == "included"
    assert session.get(SurferGalleryItem, "remaining-a").access_type == "pending"
    untouched = session.get(SurferGalleryItem, "remaining-b")
    assert untouched.selection_eligible is True and untouched.access_type == "pending_selection"


@pytest.mark.parametrize("scope", ["missing", "ambiguous"])
def test_invalid_quota_scope_rejects_an_otherwise_unique_selection(estate, scope):
    session, request = estate
    quota = SurferSelectionQuota(
        id="invalid-quota", surfer_id="owner", photographer_id="photographer", photos_allowed=2,
        videos_allowed=0, photos_selected=0, videos_selected=0, status="pending_selection",
        booking_id="session-a" if scope == "ambiguous" else None,
        live_session_id="session-b" if scope == "ambiguous" else None,
    )
    item = SurferGalleryItem(
        id="unique-item", surfer_id="owner", photographer_id="photographer", gallery_item_id="a",
        booking_id=quota.booking_id, live_session_id=quota.live_session_id,
        selection_eligible=True, access_type="pending_selection",
    )
    session.add_all([quota, item])
    session.commit()
    response = request("/locker/selection-queue/invalid-quota/select", {"item_ids": ["unique-item"]})
    assert response.status_code == 400
    assert quota.photos_selected == 0 and quota.status == "pending_selection"
    assert item.selection_eligible is True and item.access_type == "pending_selection"
