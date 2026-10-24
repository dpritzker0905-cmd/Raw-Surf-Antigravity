"""2026-10-18 audit F-10 / Addendum A1: the brute-force limiters could be walked around.

`core/rate_limiter._get_client_ip` keyed on the LEFT-most X-Forwarded-For value, which the client writes (a proxy
appends the address it saw on the RIGHT). Rotating that value gave 30 wrong-password attempts with zero 429s. Also:
`/auth/forgot-password` and `/site-access/verify` had no limiter, and nothing slowed repeated guesses at one account.

Everything here goes through the real routers over an ephemeral SQLite file; nothing leaves the process.
"""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

import database
from core import rate_limiter
from database import Base
from models import PlatformSettings, Profile, RoleEnum
from routes.admin import analytics_settings
from routes.auth_pkg import auth as auth_module
from routes.auth_pkg import password_reset

PASSWORD = 'correct-horse-9'
BAD = 'wrong-password'


def fake_request(forwarded=None, peer='198.51.100.77'):
    headers = [(b'x-forwarded-for', forwarded.encode())] if forwarded is not None else []
    return Request({'type': 'http', 'headers': headers, 'client': (peer, 4000) if peer else None})


@pytest.fixture(autouse=True)
def clean_state(monkeypatch):
    rate_limiter._request_log.clear()
    monkeypatch.delenv('RATE_LIMIT_TRUSTED_PROXY_HOPS', raising=False)
    yield
    rate_limiter._request_log.clear()


# ---- the address the limiter keys on ---------------------------------------------------------------------------

def test_a_client_written_leading_value_is_ignored():
    # the proxy appended 203.0.113.9; everything to its left is whatever the client chose to send
    assert rate_limiter._get_client_ip(fake_request('1.2.3.4, 203.0.113.9')) == '203.0.113.9'
    assert rate_limiter._get_client_ip(fake_request('9.9.9.9, 8.8.8.8, 203.0.113.9')) == '203.0.113.9'
    assert rate_limiter._get_client_ip(fake_request('203.0.113.9')) == '203.0.113.9'


def test_the_number_of_trusted_proxy_hops_is_configurable(monkeypatch):
    chain = 'spoofed, 203.0.113.9, 198.51.100.1'  # client -> edge proxy -> platform proxy
    monkeypatch.setenv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '2')
    assert rate_limiter._get_client_ip(fake_request(chain)) == '203.0.113.9'
    monkeypatch.setenv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '3')
    assert rate_limiter._get_client_ip(fake_request(chain)) == '198.51.100.77'  # too few entries: the socket peer


def test_zero_trusted_hops_ignores_the_header_entirely(monkeypatch):
    monkeypatch.setenv('RATE_LIMIT_TRUSTED_PROXY_HOPS', '0')
    assert rate_limiter._get_client_ip(fake_request('203.0.113.9')) == '198.51.100.77'


@pytest.mark.parametrize('forwarded', [None, '', ' , ', 'not-an-ip', '1.2.3.4, <script>'])
def test_a_missing_or_unusable_header_falls_back_to_the_socket_peer(forwarded):
    assert rate_limiter._get_client_ip(fake_request(forwarded)) == '198.51.100.77'


def test_a_request_with_no_peer_at_all_is_still_keyed():
    assert rate_limiter._get_client_ip(fake_request(None, peer=None)) == 'unknown'


def test_a_bad_hops_setting_does_not_disable_the_limiter(monkeypatch):
    monkeypatch.setenv('RATE_LIMIT_TRUSTED_PROXY_HOPS', 'lots')
    assert rate_limiter._get_client_ip(fake_request('1.1.1.1, 203.0.113.9')) == '203.0.113.9'


# ---- the routes -------------------------------------------------------------------------------------------------

@pytest.fixture
def client(tmp_path):
    path = tmp_path / 'ratelimit.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    with sessionmaker(sync_engine)() as db:
        for pid in ('alice', 'bob'):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.com', username=pid, role=RoleEnum.SURFER,
                           full_name=pid.title(), credit_balance=0.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0, password_hash=auth_module.hash_password(PASSWORD)))
        db.add(PlatformSettings(id='settings', access_code_enabled=True, access_code='OPENSESAME'))
        db.commit()
    sync_engine.dispose()

    async def get_db():
        engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
        await engine.dispose()

    app = FastAPI()
    for router in (auth_module.router, password_reset.router, analytics_settings.router):
        app.include_router(router, prefix='/api')
    app.dependency_overrides[database.get_db] = get_db
    for module in (auth_module, password_reset, analytics_settings):
        app.dependency_overrides[module.get_db] = get_db
    with TestClient(app) as test_client:
        yield test_client


def attempt(client, email, password, forwarded):
    return client.post('/api/auth/login', json={'email': email, 'password': password},
                       headers={'X-Forwarded-For': forwarded})


def statuses(responses):
    return [r.status_code for r in responses]


def test_rotating_the_leading_forwarded_value_no_longer_resets_the_login_limiter(client):
    # The audit's measurement: same real address (the proxy-appended 203.0.113.9), a fresh spoofed value each time.
    codes = statuses([attempt(client, 'alice@example.com', BAD, f'10.9.8.{i}, 203.0.113.9') for i in range(8)])
    assert codes[:5] == [401] * 5
    assert codes[5:] == [429] * 3, codes


def test_the_same_real_address_is_limited_and_a_different_one_is_not(client):
    for _ in range(5):
        assert attempt(client, 'alice@example.com', BAD, '203.0.113.9').status_code == 401
    assert attempt(client, 'alice@example.com', BAD, '203.0.113.9').status_code == 429
    # another real address is untouched, and so is a correct login from it
    assert attempt(client, 'alice@example.com', PASSWORD, '203.0.113.10').status_code == 200


def test_repeated_failures_against_one_account_stop_even_when_every_address_is_new(client):
    limit = auth_module.LOGIN_ACCOUNT_MAX_FAILURES
    for i in range(limit):
        assert attempt(client, 'alice@example.com', BAD, f'203.0.113.{i + 1}').status_code == 401
    fresh_address = '198.51.100.200'
    blocked = attempt(client, 'alice@example.com', PASSWORD, fresh_address)
    assert blocked.status_code == 429 and 'Retry-After' in blocked.headers  # paused even for the right password
    # another account from the same fresh address is unaffected
    assert attempt(client, 'bob@example.com', PASSWORD, fresh_address).status_code == 200


def test_a_successful_login_clears_the_account_count(client):
    limit = auth_module.LOGIN_ACCOUNT_MAX_FAILURES
    for i in range(limit - 1):
        assert attempt(client, 'alice@example.com', BAD, f'203.0.113.{i + 1}').status_code == 401
    assert attempt(client, 'alice@example.com', PASSWORD, '198.51.100.1').status_code == 200
    for i in range(limit - 1):  # a fresh budget: these would trip the throttle if the count had survived
        assert attempt(client, 'alice@example.com', BAD, f'192.0.2.{i + 1}').status_code == 401


def test_guesses_at_an_account_that_does_not_exist_are_throttled_too(client):
    limit = auth_module.LOGIN_ACCOUNT_MAX_FAILURES
    for i in range(limit):
        assert attempt(client, 'ghost@example.com', BAD, f'203.0.113.{i + 1}').status_code == 404
    assert attempt(client, 'ghost@example.com', BAD, '198.51.100.9').status_code == 429


def forgot(client, forwarded, email='nobody@example.com'):
    return client.post('/api/auth/forgot-password', json={'email': email}, headers={'X-Forwarded-For': forwarded})


def test_forgot_password_is_rate_limited_per_real_address(client):
    codes = statuses([forgot(client, f'10.0.0.{i}, 203.0.113.9') for i in range(13)])
    assert codes[:10] == [200] * 10
    assert codes[10:] == [429] * 3, codes
    assert forgot(client, '203.0.113.10').status_code == 200  # a different real address is not affected


def test_forgot_password_still_answers_a_normal_user(client):
    response = forgot(client, '203.0.113.50', email='alice@example.com')
    assert response.status_code == 200 and response.json()['success'] is True


def verify(client, code, forwarded):
    return client.post('/api/site-access/verify', json={'code': code}, headers={'X-Forwarded-For': forwarded})


def test_wrong_access_codes_are_limited_per_real_address(client):
    limit = analytics_settings.ACCESS_CODE_MAX_FAILURES
    codes = statuses([verify(client, f'GUESS{i}', f'{i}.1.1.1, 203.0.113.9') for i in range(limit + 3)])
    assert codes[:limit] == [200] * limit
    assert codes[limit:] == [429] * 3, codes
    assert verify(client, 'GUESS', '203.0.113.10').status_code == 200  # another address is not affected


def test_valid_access_codes_never_count_against_a_shared_address(client):
    # the page re-checks a stored valid code on every load; a school or office behind one address must not lock out
    for _ in range(analytics_settings.ACCESS_CODE_MAX_FAILURES * 3):
        response = verify(client, 'opensesame', '203.0.113.9')
        assert response.status_code == 200 and response.json()['valid'] is True


def test_a_valid_code_clears_earlier_misses_from_that_address(client):
    limit = analytics_settings.ACCESS_CODE_MAX_FAILURES
    for i in range(limit - 1):
        assert verify(client, f'GUESS{i}', '203.0.113.9').json()['valid'] is False
    assert verify(client, 'OPENSESAME', '203.0.113.9').json()['valid'] is True
    for i in range(limit - 1):
        assert verify(client, f'AGAIN{i}', '203.0.113.9').status_code == 200
