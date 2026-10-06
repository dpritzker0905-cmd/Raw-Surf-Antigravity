"""Actual HTTPX request logging and public health; randomly generated fixture secrets."""
import json
import logging
import secrets

import httpx
import pytest
from fastapi import FastAPI

from routes.ai import ai_health
from services import ai_gemini_matcher as gemini


@pytest.mark.parametrize('operation', ['vision', 'health'])
@pytest.mark.parametrize('status_code', [200, 403])
async def test_gemini_credential_is_header_only_and_absent_from_logs(monkeypatch, caplog,
                                                                  operation, status_code):
    key = secrets.token_urlsafe(36)
    requests = []

    async def provider(request):
        requests.append(request)
        return httpx.Response(status_code, json={'candidates': [{'content': {'parts': [{
            'text': json.dumps({'is_match': True, 'confidence': 0.9})}]}}],
            'error': key})

    original = httpx.AsyncClient
    caplog.set_level(logging.INFO, logger='httpx')
    monkeypatch.setattr(gemini, 'GEMINI_API_KEY', key)
    monkeypatch.setattr(gemini.httpx, 'AsyncClient', lambda **kw: original(
        transport=httpx.MockTransport(provider), **kw))
    with caplog.at_level(logging.INFO):
        result = (await gemini._call_gemini_vision('Fixture', []) if operation == 'vision'
                  else await gemini.check_gemini_health())
    assert len(requests) == 1
    assert 'HTTP Request:' in caplog.text
    assert requests[0].headers['x-goog-api-key'] == key
    assert key not in str(requests[0].url) and not requests[0].url.query
    assert key not in caplog.text and key[:8] not in json.dumps(result)
    if operation == 'vision' and status_code == 200:
        assert result['is_match'] and result['confidence'] == 0.9
    if operation == 'health':
        assert result['api_reachable'] is (status_code == 200)


async def test_public_ai_health_returns_presence_without_key_fragments(monkeypatch):
    gemini_key, openai_key = secrets.token_urlsafe(36), secrets.token_urlsafe(36)
    monkeypatch.setattr(gemini, 'GEMINI_API_KEY', gemini_key)
    monkeypatch.setenv('OPENAI_API_KEY', openai_key)
    original = httpx.AsyncClient
    monkeypatch.setattr(gemini.httpx, 'AsyncClient', lambda **kw: original(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={})), **kw))
    app = FastAPI()
    app.include_router(ai_health.router, prefix='/api')
    async with original(transport=httpx.ASGITransport(app=app), base_url='http://fixture.invalid') as client:
        response = await client.get('/api/ai/health')
    assert response.status_code == 200
    assert response.json()['engines']['gemini']['key_configured'] is True
    assert response.json()['engines']['openai']['key_configured'] is True
    assert gemini_key[:8] not in response.text and openai_key[:8] not in response.text


async def test_transport_exception_cannot_echo_credentials(monkeypatch, caplog):
    key = secrets.token_urlsafe(36)

    def provider(request):
        raise httpx.RequestError(key, request=request)

    original = httpx.AsyncClient
    monkeypatch.setattr(gemini, 'GEMINI_API_KEY', key)
    monkeypatch.setattr(gemini.httpx, 'AsyncClient', lambda **kw: original(
        transport=httpx.MockTransport(provider), **kw))
    with caplog.at_level(logging.INFO):
        health = await gemini.check_gemini_health()
        vision = await gemini._call_gemini_vision('Fixture', [])
    assert key not in json.dumps([health, vision]) and key not in caplog.text


async def test_missing_gemini_configuration_reports_absence_without_transport(monkeypatch):
    monkeypatch.setattr(gemini, 'GEMINI_API_KEY', '')

    def forbidden(**kw):
        raise AssertionError('missing key reached transport')

    monkeypatch.setattr(gemini.httpx, 'AsyncClient', forbidden)
    result = await gemini.check_gemini_health()
    assert result['key_configured'] is False and result['api_reachable'] is False
    assert 'key_preview' not in result
