"""Missing integration configuration must never select an embedded credential."""
import importlib.util
from pathlib import Path
import secrets

from fastapi import FastAPI
from fastapi.testclient import TestClient


def load_module(monkeypatch, configured=False):
    monkeypatch.delenv('STRAVA_CLIENT_SECRET', raising=False)
    monkeypatch.delenv('STRAVA_CLIENT_ID', raising=False)
    if configured:
        monkeypatch.setenv('STRAVA_CLIENT_SECRET', secrets.token_hex(24))
        monkeypatch.setenv('STRAVA_CLIENT_ID', '1234')
    path = Path(__file__).parents[1] / 'routes/strava.py'
    spec = importlib.util.spec_from_file_location('audit_strava_routes', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_unset_strava_secret_has_no_embedded_fallback(monkeypatch):
    module = load_module(monkeypatch)
    # Only booleans can appear in failure diagnostics; never expose the original value.
    configured = bool(module.STRAVA_CLIENT_SECRET)
    assert configured is False


def test_unconfigured_oauth_fails_before_provider_redirect(monkeypatch):
    module = load_module(monkeypatch)
    app = FastAPI()
    app.include_router(module.router, prefix='/strava')
    with TestClient(app) as client:
        response = client.get('/strava/auth-url?user_id=synthetic&redirect_uri=https://example.invalid/callback')
    assert response.status_code == 503
    assert response.json() == {'detail': 'Strava integration is not configured'}


def test_configured_oauth_can_build_provider_redirect(monkeypatch):
    module = load_module(monkeypatch, configured=True)
    app = FastAPI()
    app.include_router(module.router, prefix='/strava')
    with TestClient(app) as client:
        response = client.get('/strava/auth-url?user_id=synthetic&redirect_uri=https://example.invalid/callback')
    assert response.status_code == 200
    assert response.json()['url'].startswith('https://www.strava.com/oauth/authorize?')
