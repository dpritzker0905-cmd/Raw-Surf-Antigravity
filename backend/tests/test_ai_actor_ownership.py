"""Offline HTTP regressions for AI/photo and review-report authority."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI

from core.security import create_access_token
from database import get_db
from routes.ai import ai_tagging
from routes.ai.ai_vision import compare_faces
from routes.reviews_pkg import review_moderation


CASES = [
    ("POST", "/api/ai/analyze-photo", {}, {"image_url": "https://example.invalid/photo.jpg"}),
    ("POST", "/api/ai/suggest-tags", {}, {"image_url": "https://example.invalid/photo.jpg"}),
    ("POST", "/api/ai/confirm-tags", {"photographer_id": "victim"},
     {"gallery_item_id": "photo", "surfer_ids": []}),
    ("GET", "/api/ai/my-tagged-photos", {"user_id": "victim"}, None),
    ("POST", "/api/ai/mark-photo-viewed", {"user_id": "victim", "tag_id": "tag"}, None),
    ("POST", "/api/ai/face-match", {}, {"photographer_id": "victim", "surfer_id": "other"}),
    ("POST", "/api/ai/scan-surfboard", {},
     {"image_url": "https://example.invalid/board.jpg", "surfboard_id": "board"}),
    ("POST", "/api/reviews/review/report", {}, {"reporter_id": "victim", "reason": "spam"}),
]


def result(value=None):
    row = MagicMock()
    row.scalar_one_or_none.return_value = value
    row.scalars.return_value.all.return_value = []
    row.fetchall.return_value = []
    return row


@pytest.fixture
async def boundary():
    db = MagicMock()
    db.execute = AsyncMock(return_value=result())
    db.commit = AsyncMock()

    async def override_db():
        yield db

    app = FastAPI()
    app.include_router(ai_tagging.router, prefix="/api")
    app.include_router(review_moderation.router, prefix="/api")
    app.dependency_overrides[get_db] = override_db
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
        yield client, db


def auth(subject="caller"):
    return {"Authorization": "Bearer " + create_access_token({"sub": subject})}


@pytest.mark.parametrize("method,path,params,body", CASES)
@pytest.mark.parametrize("headers", [{}, {"Authorization": "Bearer invalid"}])
async def test_missing_or_invalid_login_stops_before_database(boundary, method, path, params, body, headers):
    client, db = boundary
    response = await client.request(method, path, params=params, json=body, headers=headers)
    assert response.status_code == 401
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("index", [2, 5, 7])
async def test_cannot_name_another_actor(boundary, index):
    client, db = boundary
    method, path, params, body = CASES[index]
    response = await client.request(method, path, params=params, json=body, headers=auth())
    assert response.status_code == 403
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


async def test_confirm_tags_owner_still_commits(boundary):
    client, db = boundary
    item = SimpleNamespace(gallery=None, tagged_surfer_ids=None)
    db.execute.return_value = result(item)
    response = await client.post("/api/ai/confirm-tags", params={"photographer_id": "caller"},
                                 json={"gallery_item_id": "photo", "surfer_ids": []}, headers=auth())
    assert response.status_code == 200
    assert item.tagged_surfer_ids == "[]"
    db.commit.assert_awaited_once()


@pytest.mark.parametrize("subject", ["photographer", "surfer"])
async def test_face_match_allows_either_participant(boundary, subject):
    client, db = boundary
    db.execute.side_effect = [result(SimpleNamespace(full_name="Surfer"))] + [result() for _ in range(4)]
    response = await client.post("/api/ai/face-match", headers=auth(subject),
                                 json={"photographer_id": "photographer", "surfer_id": "surfer"})
    assert response.status_code == 200
    assert response.json()["matches"] == []


@pytest.mark.parametrize("legacy_id", [None, "victim"])
async def test_tagged_photos_use_login_identity(boundary, legacy_id):
    client, db = boundary
    response = await client.get("/api/ai/my-tagged-photos", headers=auth(),
                                params={} if legacy_id is None else {"user_id": legacy_id})
    assert response.status_code == 200
    values = db.execute.call_args.args[0].compile().params.values()
    assert "caller" in values and "victim" not in values


async def test_mark_viewed_works_without_legacy_user_id(boundary):
    client, db = boundary
    now = datetime.now(timezone.utc)
    tag = SimpleNamespace(viewed_at=None, tagged_at=now, gallery_item_id="photo",
                          photographer_id="photographer", access_granted=False)
    db.execute.return_value = result(tag)
    response = await client.post("/api/ai/mark-photo-viewed", params={"tag_id": "tag", "user_id": "victim"}, headers=auth())
    assert response.status_code == 200 and response.json()["first_view"]
    values = db.execute.call_args.args[0].compile().params.values()
    assert "caller" in values and "victim" not in values
    db.commit.assert_awaited_once()


@pytest.mark.parametrize("owner,expected", [("victim", 403), (None, 404)])
async def test_board_update_requires_owner(boundary, owner, expected):
    client, db = boundary
    board = SimpleNamespace(user_id=owner, brand=None, model=None, board_type=None, fin_setup=None, tail_shape=None) if owner else None
    db.execute.return_value = result(board)
    response = await client.post("/api/ai/scan-surfboard", headers=auth(),
                                 json={"image_url": "https://example.invalid/board.jpg", "surfboard_id": "board"})
    assert response.status_code == expected
    db.commit.assert_not_awaited()
    if board:
        assert board.brand is None and board.fin_setup is None


async def test_report_owner_still_queues_review(boundary):
    client, db = boundary
    review = SimpleNamespace(reviewer_id="other", comment=None, moderation_notes=None, status="approved")
    db.execute.side_effect = [result(SimpleNamespace(full_name="Caller")), result(review)]
    response = await client.post("/api/reviews/review/report", headers=auth(),
                                 json={"reporter_id": "caller", "reason": "spam"})
    assert response.status_code == 200 and review.status == "pending"
    assert "Caller (caller)" in review.moderation_notes
    db.commit.assert_awaited_once()


@pytest.mark.parametrize("path,payload", [
    ("/api/ai/analyze-photo", {"image_url": "https://example.invalid/action.jpg"}),
    ("/api/ai/analyze-photo", {"image_base64": "not-an-image"}),
    ("/api/ai/suggest-tags", {"image_url": "https://example.invalid/surfer.jpg"}),
    ("/api/ai/scan-surfboard", {"image_url": "https://example.invalid/channel-happy.jpg"}),
])
async def test_unimplemented_vision_cannot_return_invented_analysis(boundary, path, payload):
    client, db = boundary
    response = await client.post(path, json=payload, headers=auth())
    assert response.status_code == 503
    assert "unavailable" in response.json()["detail"].lower()
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


async def test_board_owner_is_checked_but_guesses_are_not_saved(boundary):
    client, db = boundary
    board = SimpleNamespace(user_id="caller", brand=None, model=None, board_type=None, fin_setup=None, tail_shape=None)
    db.execute.return_value = result(board)
    response = await client.post("/api/ai/scan-surfboard", headers=auth(),
                                 json={"image_url": "https://example.invalid/channel-happy.jpg", "surfboard_id": "board"})
    assert response.status_code == 503
    assert vars(board) == {"user_id": "caller", "brand": None, "model": None,
                           "board_type": None, "fin_setup": None, "tail_shape": None}
    db.execute.assert_awaited_once()
    db.commit.assert_not_awaited()


async def test_face_comparison_never_invents_identity_matches():
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as error:
        await compare_faces("plain.jpg", [{"id": "surfer", "name": "Surfer"}],
                            [{"user_id": "surfer", "brand": "UnrelatedBrand"}])
    assert error.value.status_code == 503
