"""AI moderation: the Pydantic AI Gateway path is default-off, fails open, and runs as a named agent."""
import asyncio

import httpx

from services import ai_moderation


def _run(coro):
    return asyncio.run(coro)


def _anthropic_reply(text):
    return {"id": "msg_1", "type": "message", "role": "assistant", "model": "claude-opus-4-8",
            "content": [{"type": "text", "text": text}], "stop_reason": "end_turn", "stop_sequence": None,
            "usage": {"input_tokens": 5, "output_tokens": 5}}


def test_flag_default_off(monkeypatch):
    monkeypatch.delenv("MODERATION_USE_PYDANTIC_GATEWAY", raising=False)
    assert ai_moderation._gateway_enabled() is False


def test_flag_on_without_key_fails_open(monkeypatch):
    monkeypatch.setenv("MODERATION_USE_PYDANTIC_GATEWAY", "1")
    monkeypatch.delenv("PYDANTIC_AI_GATEWAY_API_KEY", raising=False)
    out = _run(ai_moderation.moderate_review_content("great session, thanks"))
    assert out["approved"] is True and out["error"]


def test_gateway_agent_request_shape(monkeypatch):
    monkeypatch.delenv("PYDANTIC_AI_GATEWAY_BASE_URL", raising=False)
    seen = {}

    def handler(request):
        seen["url"] = str(request.url)
        seen["body"] = request.read().decode()
        return httpx.Response(200, json=_anthropic_reply('{"approved": false, "reason": "spam"}'))

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    text = _run(ai_moderation._complete_via_gateway("test-key", "buy cheap watches", http_client=client))
    assert '"approved": false' in text
    assert seen["url"].startswith("https://gateway-us.pydantic.dev/proxy/anthropic/")
    assert "claude-opus-4-8" in seen["body"] and "content moderation assistant" in seen["body"]


def test_gateway_failure_fails_open(monkeypatch):
    monkeypatch.setenv("MODERATION_USE_PYDANTIC_GATEWAY", "1")
    monkeypatch.setenv("PYDANTIC_AI_GATEWAY_API_KEY", "test-key")

    async def boom(api_key, review_text, http_client=None):
        raise RuntimeError("gateway down")

    monkeypatch.setattr(ai_moderation, "_complete_via_gateway", boom)
    out = _run(ai_moderation.moderate_review_content("solid waves"))
    assert out["approved"] is True and "error" in out


def test_tracing_is_noop_without_token(monkeypatch):
    from services import observability
    monkeypatch.delenv("LOGFIRE_TOKEN", raising=False)
    monkeypatch.setattr(observability, "_configured", False)
    assert observability.setup_agent_tracing() is False
