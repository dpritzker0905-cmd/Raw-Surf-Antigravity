"""APP-06: mounted real-JWT/ORM OAuth boundary; provider transport is synthetic."""
import asyncio
import hashlib
import importlib.util
from pathlib import Path
import secrets
from urllib.parse import parse_qs, urlparse
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import pytest
import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from core.security import create_access_token
from database import get_db
from models import Profile, RoleEnum

@pytest.fixture
def strava(tmp_path, monkeypatch):
    monkeypatch.setenv('STRAVA_CLIENT_ID', '1234')
    monkeypatch.setenv('STRAVA_CLIENT_SECRET', secrets.token_hex(24))
    monkeypatch.setenv('FRONTEND_URL', 'https://example.invalid')
    path = Path(__file__).parents[1] / 'routes/strava.py'
    spec = importlib.util.spec_from_file_location('audit_strava_authority', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    dbfile = tmp_path / 'strava.sqlite'
    engine = create_engine(f'sqlite:///{dbfile}')
    Profile.__table__.create(engine)
    if hasattr(module, 'StravaOAuthState'):
        module.StravaOAuthState.__table__.create(engine)
    tokens = {'access_token': secrets.token_hex(24), 'refresh_token': secrets.token_hex(24),
              'expires_at': int(datetime.now(timezone.utc).timestamp()) + 3600}
    with engine.begin() as conn:
        conn.execute(Profile.__table__.insert(), [dict(id=actor, user_id=actor, email=f'{actor}@example.invalid',
                     role=RoleEnum.SURFER, **{'strava_' + k: v for k, v in tokens.items()}) for actor in ('owner', 'other')])
    async_engine = create_async_engine(f'sqlite+aiosqlite:///{dbfile}')
    sessions = async_sessionmaker(async_engine, expire_on_commit=False)
    monkeypatch.setattr(module, 'async_session_maker', sessions)
    calls = []
    provider = {'status': 200, 'data': tokens.copy()}

    class Transport:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def post(self, url, **kwargs):
            calls.append(('post', url))
            return httpx.Response(provider['status'], json=provider['data'])
        async def get(self, url, **kwargs):
            calls.append(('get', url))
            return httpx.Response(200, json=[{'id': 1, 'type': 'Surfing', 'distance': 1000, 'elapsed_time': 1800}])

    monkeypatch.setattr(module.httpx, 'AsyncClient', Transport)
    async def database():
        async with sessions() as db:
            yield db
    app = FastAPI()
    app.include_router(module.router, prefix='/api/strava')
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        yield SimpleNamespace(client=client, engine=engine, module=module, calls=calls, provider=provider, tokens=tokens)
    asyncio.run(async_engine.dispose())
    engine.dispose()

def headers(actor):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': actor})} if actor else {}

def issue(env, actor='owner'):
    response = env.client.get('/api/strava/auth-url', params={'user_id': actor}, headers=headers(actor))
    assert response.status_code == 200
    state = parse_qs(urlparse(response.json()['url']).query)['state'][0]
    assert bool(len(state) >= 32 and state != actor)
    return state

def callback(env, state, actor='owner'):
    return env.client.get('/api/strava/callback', params={'code': secrets.token_hex(16), 'state': state}, headers=headers(actor))

def wallet_tokens(env):
    with env.engine.connect() as conn:
        rows = conn.execute(select(Profile.__table__)).mappings().all()
    # Hash-only readback; never include raw credentials in assertion diagnostics or evidence.
    return {r['id']: tuple(hashlib.sha256(str(r.get('strava_' + k)).encode()).hexdigest()
                          for k in ('access_token', 'refresh_token', 'expires_at')) for r in rows}

@pytest.mark.parametrize('path', ['status', 'auth-url', 'sync-recent'])
@pytest.mark.parametrize('actor,status', [(None, 401), ('other', 403), ('owner', 200)])
def test_private_strava_actions_require_verified_owner(strava, path, actor, status):
    before = wallet_tokens(strava)
    response = strava.client.get('/api/strava/' + path, params={'user_id': 'owner'}, headers=headers(actor))
    assert response.status_code == status
    assert wallet_tokens(strava) == before
    if status != 200:
        assert strava.calls == []

@pytest.mark.parametrize('actor,state,status', [(None, 'owner', 401), ('other', 'owner', 400),
                                              ('owner', 'owner', 400), ('owner', 'unknown', 400)])
def test_asserted_user_id_is_not_oauth_state(strava, actor, state, status):
    before = wallet_tokens(strava)
    response = callback(strava, state, actor)
    assert response.status_code == status
    assert strava.calls == []
    assert wallet_tokens(strava) == before

@pytest.mark.parametrize('redirect', ['https://evil.invalid/surf-log', 'https://example.invalid/other',
                                     'https://example.invalid/surf-log?return=evil', 'javascript:alert(1)'])
def test_redirect_requires_configured_frontend_callback(strava, redirect):
    response = strava.client.get('/api/strava/auth-url', params={'user_id': 'owner', 'redirect_uri': redirect}, headers=headers('owner'))
    assert response.status_code == 400
    assert strava.calls == []

def test_issued_state_is_unique_and_hashed_in_database(strava):
    first, second = issue(strava), issue(strava)
    assert bool(first != second)
    with strava.engine.connect() as conn:
        hashes = set(conn.execute(text('SELECT state_hash FROM strava_oauth_states')).scalars())
    assert bool(hashlib.sha256(first.encode()).hexdigest() in hashes)
    assert bool(first not in hashes and second not in hashes)

def test_wrong_owner_cannot_consume_legitimate_state(strava):
    state = issue(strava)
    assert callback(strava, state, 'other').status_code == 400
    assert strava.calls == []
    assert callback(strava, state).status_code == 200
    assert len(strava.calls) == 1

def test_callback_is_single_use_and_leaves_other_account_unchanged(strava):
    state = issue(strava)
    before = wallet_tokens(strava)
    strava.provider['data'] = {'access_token': secrets.token_hex(24), 'refresh_token': secrets.token_hex(24),
                              'expires_at': int(datetime.now(timezone.utc).timestamp()) + 7200}
    assert callback(strava, state).status_code == 200
    after = wallet_tokens(strava)
    assert after['owner'] != before['owner'] and after['other'] == before['other']
    assert callback(strava, state).status_code == 400
    assert len(strava.calls) == 1
    assert wallet_tokens(strava) == after

def test_expired_state_fails_before_provider(strava):
    state = issue(strava)
    with strava.engine.begin() as conn:
        conn.execute(text('UPDATE strava_oauth_states SET expires_at = :expired'),
                     {'expired': datetime.now(timezone.utc) - timedelta(seconds=1)})
    assert callback(strava, state).status_code == 400
    assert strava.calls == []

def test_provider_failure_requires_fresh_authorization_state(strava):
    state = issue(strava)
    strava.provider['status'] = 400
    before = wallet_tokens(strava)
    assert callback(strava, state).status_code == 400
    strava.provider['status'] = 200
    assert callback(strava, state).status_code == 400
    assert len(strava.calls) == 1 and wallet_tokens(strava) == before

@pytest.mark.parametrize('field,value', [('access_token', None), ('refresh_token', ''), ('expires_at', None)])
def test_malformed_provider_tokens_are_not_acknowledged_or_saved(strava, field, value):
    state = issue(strava)
    strava.provider['data'][field] = value
    before = wallet_tokens(strava)
    assert callback(strava, state).status_code == 502
    assert wallet_tokens(strava) == before
