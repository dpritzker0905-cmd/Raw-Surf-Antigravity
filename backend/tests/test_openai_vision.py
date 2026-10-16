"""Real HTTP boundary contracts for image inference (provider transport is offline)."""
import json
import base64
import asyncio
from io import BytesIO
import logging
import secrets
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from PIL import Image

from routes.ai import ai_vision
from routes.ai import ai_tagging
from core.security import create_access_token
from database import get_db

HTTP_CLIENT = httpx.AsyncClient


PHOTO = {
    "people_count": 1,
    "people": [{"position": "left", "action": "carrying a board",
                "distinctive_features": ["red wetsuit"], "confidence": "high"}],
    "conditions": {"wave_size": None, "weather": "overcast", "location_hints": []},
    "overall_description": "One person carrying a blue board.",
    "visual_tags": ["blue surfboard", "red wetsuit"],
}
BOARD = {"board_detected": True, "brand": None, "model": None, "board_type": "shortboard",
         "fin_setup": None, "tail_shape": "squash", "visible_text": [],
         "description": "A blue board; its logo is unreadable.", "confidence": "medium"}


@pytest.fixture
def provider(monkeypatch):
    calls = []
    key = secrets.token_urlsafe(36)
    monkeypatch.setenv("OPENAI_API_KEY", key)
    monkeypatch.delenv("OPENAI_VISION_MODEL", raising=False)
    # These tests isolate provider transport. Durable cap/deny behavior has its own suite.
    from services.openai_budget import MODEL_SNAPSHOTS
    monkeypatch.setattr(ai_vision, "reserve_openai_request", AsyncMock(
        side_effect=lambda model, tokens: MODEL_SNAPSHOTS.get(model, model)))

    state = {"payload": PHOTO, "status": 200, "finish_reason": "stop", "refusal": None}

    def handler(request):
        calls.append(request)
        if "exception" in state:
            raise state["exception"](key, request=request)
        if "envelope" in state:
            return httpx.Response(state["status"], json=state["envelope"])
        return httpx.Response(state["status"], json={"choices": [{"finish_reason": state["finish_reason"], "message": {
            "content": json.dumps(state["payload"]), "refusal": state["refusal"]}}], "error": key})

    original = httpx.AsyncClient
    monkeypatch.setattr(httpx, "AsyncClient", lambda **kw: original(
        transport=httpx.MockTransport(handler), **kw))
    return calls, key, state


async def test_photo_reaches_provider_with_actual_image(provider):
    calls, key, state = provider
    url = "https://images.example.com/misleading-filename.jpg"
    result = await ai_vision.analyze_image_with_vision(url)
    assert result == PHOTO
    assert len(calls) == 1 and str(calls[0].url) == "https://api.openai.com/v1/chat/completions"
    body = json.loads(calls[0].content)
    assert body["messages"][1]["content"][1]["image_url"]["url"] == url
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["model"] == "gpt-5.4-mini-2026-03-17" and "temperature" not in body
    assert body["store"] is False
    assert calls[0].headers["Authorization"] == "Bearer " + key
    assert key not in str(calls[0].url)


def png_image():
    stream = BytesIO()
    Image.new("RGB", (16, 16), "blue").save(stream, format="PNG")
    return base64.b64encode(stream.getvalue()).decode()


@pytest.mark.parametrize("prefix", ["", "data:image/png;base64,"])
async def test_base64_mime_comes_from_image_bytes(provider, prefix):
    encoded = png_image()
    await ai_vision.analyze_image_with_vision(prefix + encoded, is_base64=True)
    body = json.loads(provider[0][0].content)
    assert body["messages"][1]["content"][1]["image_url"]["url"] == "data:image/png;base64," + encoded


@pytest.mark.parametrize("url", ["http://example.com/a.jpg", "https://127.0.0.1/a", "file:///etc/passwd",
                               "https://user:password@example.com/a", "https://10.0.0.1/a", "https://host.local/a",
                               "https://example.com:bad/a", "https://example.com:8443/a"])
async def test_bad_image_urls_never_reach_provider(provider, url):
    with pytest.raises(HTTPException) as error:
        await ai_vision.analyze_image_with_vision(url)
    assert error.value.status_code == 400 and provider[0] == []


@pytest.mark.parametrize("image", ["bad base64", "aGVsbG8=", "data:image/jpeg;base64,{}", "too_large"])
async def test_invalid_base64_never_reaches_provider(provider, image):
    if image == "too_large":
        image = "A" * (ai_vision.MAX_ENCODED_LENGTH + 1)
    if image.endswith("{}"):
        image = image.format(png_image())
    with pytest.raises(HTTPException) as error:
        await ai_vision.analyze_image_with_vision(image, is_base64=True)
    assert error.value.status_code == 400 and provider[0] == []


async def test_relative_owned_media_uses_configured_render_origin(provider, monkeypatch):
    monkeypatch.setenv("RENDER_EXTERNAL_URL", "https://backend.example.com")
    await ai_vision.analyze_image_with_vision("/api/uploads/gallery/a.png")
    body = json.loads(provider[0][0].content)
    assert body["messages"][1]["content"][1]["image_url"]["url"] == "https://backend.example.com/api/uploads/gallery/a.png"


@pytest.mark.parametrize("status,expected", [(400, 502), (401, 503), (403, 503), (429, 503), (500, 503)])
async def test_provider_http_failure_has_no_secret_or_payload_echo(provider, caplog, status, expected):
    provider[2]["status"] = status
    with caplog.at_level(logging.INFO), pytest.raises(HTTPException) as error:
        await ai_vision.analyze_image_with_vision("https://example.com/a.jpg")
    assert error.value.status_code == expected
    assert provider[1] not in str(error.value) + caplog.text


@pytest.mark.parametrize("exception,expected", [(httpx.ReadTimeout, 504), (httpx.ConnectError, 503)])
async def test_transport_failure_cannot_echo_key(provider, caplog, exception, expected):
    provider[2]["exception"] = exception
    with caplog.at_level(logging.INFO), pytest.raises(HTTPException) as error:
        await ai_vision.analyze_image_with_vision("https://example.com/a.jpg")
    assert error.value.status_code == expected
    assert provider[1] not in str(error.value) + caplog.text


@pytest.mark.parametrize("change", ["invalid_schema", "extra_field", "count_mismatch", "incomplete", "refusal", "no_choices"])
async def test_malformed_or_refused_provider_output_fails_closed(provider, change):
    state = provider[2]
    if change == "invalid_schema": state["payload"] = {"people_count": "many"}
    if change == "extra_field": state["payload"] = {**PHOTO, "profile_id": "guessed"}
    if change == "count_mismatch": state["payload"] = {**PHOTO, "people_count": 2}
    if change == "incomplete": state["finish_reason"] = "length"
    if change == "refusal": state["refusal"] = "Cannot analyze"
    if change == "no_choices": state["envelope"] = {"choices": []}
    with pytest.raises(HTTPException) as error:
        await ai_vision.analyze_image_with_vision("https://example.com/a.jpg")
    assert error.value.status_code == (422 if change == "refusal" else 502)


async def test_missing_key_never_creates_transport(provider, monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY")
    with pytest.raises(HTTPException) as error:
        await ai_vision.analyze_image_with_vision("https://example.com/a.jpg")
    assert error.value.status_code == 503 and provider[0] == []


async def test_board_returns_observed_fields_not_guessed_dimensions(provider):
    provider[2]["payload"] = BOARD
    result = await ai_vision.analyze_surfboard_with_vision("https://example.com/unreadable.jpg")
    assert result == BOARD and result["brand"] is None and result["model"] is None
    body = json.loads(provider[0][0].content)
    assert body["response_format"]["json_schema"]["name"] == "BoardAnalysis"


@pytest.mark.parametrize("payload", [{**BOARD, "board_detected": False}, {**BOARD, "brand": "X" * 101}])
async def test_invalid_board_output_is_not_returned(provider, payload):
    provider[2]["payload"] = payload
    with pytest.raises(HTTPException) as error:
        await ai_vision.analyze_surfboard_with_vision("https://example.com/a.jpg")
    assert error.value.status_code == 502


async def test_busy_provider_does_not_queue_paid_requests_indefinitely(provider, monkeypatch):
    slots = asyncio.Semaphore(0)
    monkeypatch.setattr(ai_vision, "_slots", slots)
    with pytest.raises(HTTPException) as error:
        await ai_vision.analyze_image_with_vision("https://example.com/a.jpg")
    assert error.value.status_code == 503 and provider[0] == []
    assert slots.locked()


@pytest.fixture
async def api():
    db = MagicMock()
    row = MagicMock()
    row.scalar_one_or_none.return_value = None
    db.execute = AsyncMock(return_value=row)
    db.commit = AsyncMock()
    async def override():
        yield db
    app = FastAPI()
    app.include_router(ai_tagging.router, prefix="/api")
    app.dependency_overrides[get_db] = override
    async with HTTP_CLIENT(transport=httpx.ASGITransport(app=app), base_url="https://fixture.invalid") as client:
        yield client, db


def auth():
    return {"Authorization": "Bearer " + create_access_token({"sub": "caller"})}


async def test_analyze_http_returns_validated_provider_result(api, provider):
    client, db = api
    r = await client.post("/api/ai/analyze-photo", headers=auth(), json={"image_url": "https://example.com/a.jpg"})
    assert r.status_code == 200 and r.json()["analysis"] == PHOTO
    db.execute.assert_not_awaited()
    db.commit.assert_not_awaited()


async def test_tag_suggestions_use_owned_image_and_never_send_profiles(api, provider):
    client, db = api
    db.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        preview_url="https://example.com/owned.jpg", original_url=None, media_type="image")
    r = await client.post("/api/ai/suggest-tags", headers=auth(), json={
        "image_url": "https://example.com/swapped.jpg", "gallery_item_id": "owned"})
    assert r.status_code == 200 and r.json()["visual_tags"] == PHOTO["visual_tags"]
    assert r.json()["suggested_tags"] == [] and r.json()["people_detected"] == 1
    request = json.loads(provider[0][0].content)
    assert request["messages"][1]["content"][1]["image_url"]["url"] == "https://example.com/owned.jpg"
    assert "swapped.jpg" not in provider[0][0].content.decode()
    db.execute.assert_awaited_once()
    assert "caller" in db.execute.call_args.args[0].compile().params.values()


async def test_foreign_photo_rejected_before_paid_call(api, provider):
    client, db = api
    r = await client.post("/api/ai/suggest-tags", headers=auth(), json={
        "image_url": "https://example.com/a.jpg", "gallery_item_id": "foreign"})
    assert r.status_code == 404 and provider[0] == []


@pytest.mark.parametrize("owner,expected", [("other", 403), ("caller", 200)])
async def test_board_owner_checked_before_inference_and_no_automatic_writes(api, provider, owner, expected):
    client, db = api
    board = SimpleNamespace(user_id=owner, brand="Saved brand")
    db.execute.return_value.scalar_one_or_none.return_value = board
    provider[2]["payload"] = BOARD
    r = await client.post("/api/ai/scan-surfboard", headers=auth(), json={
        "image_url": "https://example.com/a.jpg", "surfboard_id": "board"})
    assert r.status_code == expected
    assert len(provider[0]) == (1 if owner == "caller" else 0)
    if expected == 200:
        assert r.json()["analysis"] == BOARD and r.json()["saved"] is False
    assert board.brand == "Saved brand"
    db.commit.assert_not_awaited()


async def test_board_clues_reuse_one_guarded_photo_call_and_keep_profiles_local(api, provider, monkeypatch):
    client, db = api
    db.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        preview_url="https://example.com/owned.jpg", original_url=None, media_type="image", gallery_id="gallery")
    saved = {"surfer_id": "participant", "full_name": "Private local participant", "username": "local",
             "board_id": "saved", "brand": "Coastal", "model": None, "board_type": "fish",
             "fin_setup": None, "tail_shape": None, "description": "Blue board"}
    monkeypatch.setattr(ai_tagging, "load_board_candidates", AsyncMock(return_value={
        "status": "ready", "candidates": [saved], "truncated": False}))
    observed = {"person_index": 0, "relationship": "holding", "colors": ["blue"], "patterns": [],
                "visible_text": ["Coastal"], "board_type": "fish", "fin_setup": None, "tail_shape": None,
                "confidence": "high"}
    provider[2]["payload"] = {**PHOTO, "board_observations": [observed]}
    r = await client.post("/api/ai/suggest-tags", headers=auth(), json={
        "image_url": "https://example.com/swapped.jpg", "gallery_item_id": "owned", "include_board_clues": True})
    assert r.status_code == 200
    data = r.json()
    assert data["board_clues"][0]["surfer_id"] == "participant" and data["suggested_tags"] == []
    assert data["board_clues"][0]["requires_manual_review"] is True
    assert len(provider[0]) == 1
    body = provider[0][0].content.decode()
    assert "Private local participant" not in body and '"saved"' not in body and "swapped.jpg" not in body
    assert "BoardCluePhotoAnalysis" in body and "owned.jpg" in body
    ai_vision.reserve_openai_request.assert_awaited_once_with("gpt-5.4-mini", 2000)
    db.commit.assert_not_awaited()


@pytest.mark.parametrize("case", ["missing_item", "foreign_photo", "foreign_gallery"])
async def test_board_clue_ownership_fails_before_provider(api, provider, monkeypatch, case):
    client, db = api
    if case == "foreign_gallery":
        db.execute.side_effect = [SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(
            gallery_id="foreign", preview_url="https://example.com/owned.jpg", media_type="image")),
            SimpleNamespace(scalar_one_or_none=lambda: None)]
    r = await client.post("/api/ai/suggest-tags", headers=auth(), json={
        "image_url": "https://example.com/a.jpg", "include_board_clues": True,
        **({} if case == "missing_item" else {"gallery_item_id": "foreign"})})
    assert r.status_code == (400 if case == "missing_item" else 404)
    assert provider[0] == []
    ai_vision.reserve_openai_request.assert_not_awaited()


async def test_board_clue_scan_respects_budget_denial_without_retry(api, provider, monkeypatch):
    client, db = api
    db.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        preview_url="https://example.com/owned.jpg", media_type="image", gallery_id="gallery")
    monkeypatch.setattr(ai_tagging, "load_board_candidates", AsyncMock(return_value={
        "status": "ready", "candidates": [{"board_id": "saved"}], "truncated": False}))
    ai_vision.reserve_openai_request.side_effect = HTTPException(503, "AI testing budget paused")
    r = await client.post("/api/ai/suggest-tags", headers=auth(), json={
        "image_url": "https://example.com/a.jpg", "gallery_item_id": "owned", "include_board_clues": True})
    assert r.status_code == 503 and provider[0] == []
    ai_vision.reserve_openai_request.assert_awaited_once()
    db.commit.assert_not_awaited()
