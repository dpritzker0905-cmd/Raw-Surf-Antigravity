"""AI moderation: the Pydantic AI Gateway path is default-off and fails open."""
import asyncio

import httpx

from services import ai_moderation


def _run(coro):
    return asyncio.run(coro)


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv("MODERATION_USE_PYDANTIC_GATEWAY", raising=False)
    assert ai_moderation._gateway_enabled() is False


def test_flag_on_without_key_fails_open(monkeypatch):
    monkeypatch.setenv("MODERATION_USE_PYDANTIC_GATEWAY", "1")
    monkeypatch.delenv("PYDANTIC_AI_GATEWAY_API_KEY", raising=False)
    out = _run(ai_moderation.moderate_review_content("great session, thanks"))
    assert out["approved"] is True and out["error"]


def _patch_transport(monkeypatch, handler, seen):
    real = httpx.AsyncClient

    def factory(*a, **kw):
        kw["transport"] = httpx.MockTransport(handler)
        return real(*a, **kw)

    monkeypatch.setattr(httpx, "AsyncClient", factory)


def test_gateway_flagged_response(monkeypatch):
    monkeypatch.setenv("MODERATION_USE_PYDANTIC_GATEWAY", "true")
    monkeypatch.setenv("PYDANTIC_AI_GATEWAY_API_KEY", "test-key")
    monkeypatch.delenv("PYDANTIC_AI_GATEWAY_BASE_URL", raising=False)
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["key"] = request.headers.get("x-api-key")
        seen["body"] = request.read().decode()
        return httpx.Response(200, json={"content": [{"type": "text", "text": '{"approved": false, "reason": "spam"}'}]})

    _patch_transport(monkeypatch, handler, seen)
    out = _run(ai_moderation.moderate_review_content("buy cheap watches at example"))
    assert out == {"approved": False, "reason": "spam"}
    assert seen["url"] == "https://gateway-us.pydantic.dev/proxy/anthropic/v1/messages"
    assert seen["key"] == "test-key"
    assert "claude-opus-4-8" in seen["body"]


def test_gateway_http_error_fails_open(monkeypatch):
    monkeypatch.setenv("MODERATION_USE_PYDANTIC_GATEWAY", "1")
    monkeypatch.setenv("PYDANTIC_AI_GATEWAY_API_KEY", "test-key")
    _patch_transport(monkeypatch, lambda r: httpx.Response(500, json={}), {})
    out = _run(ai_moderation.moderate_review_content("solid waves"))
    assert out["approved"] is True and "error" in out
