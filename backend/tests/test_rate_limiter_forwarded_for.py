"""2026-10-18 audit F-10 / Addendum A1: the brute-force limiters could be walked around.

`core/rate_limiter._get_client_ip` keyed on the LEFT-most X-Forwarded-For value, which the client writes (a proxy
appends the address it saw on the RIGHT). Rotating that value gave 30 wrong-password attempts with zero 429s. Also:
`/auth/forgot-password` and `/site-access/verify` had no limiter, and nothing slowed repeated guesses at one account.

Everything here goes through the real routers over an ephemeral SQLite file; nothing leaves the process.
"""
import logging
import types

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker
from starlette.requests import Request

import database
from core import login_throttle, rate_limiter
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
    rate_limiter._backoff.clear()
    monkeypatch.delenv('RATE_LIMIT_TRUSTED_PROXY_HOPS', raising=False)
    yield
    rate_limiter._request_log.clear()
    rate_limiter._backoff.clear()


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


def test_the_login_limits_come_from_the_environment_and_survive_a_typo(monkeypatch):
    assert login_throttle.limits() == {'pair': 5, 'source': 30, 'ceiling': 100}
    monkeypatch.setenv('LOGIN_PAIR_MAX_FAILURES', '3')
    monkeypatch.setenv('LOGIN_SOURCE_MAX_FAILURES', 'lots')
    monkeypatch.setenv('LOGIN_ACCOUNT_CEILING_PER_HOUR', '0')
    assert login_throttle.limits() == {'pair': 3, 'source': 30, 'ceiling': 100}


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


# ---- the layered guess throttles (core/login_throttle.py) -------------------------------------------------------
# These isolate the throttle from the 5-requests-a-minute address limiter and the bcrypt cost, and run on a fake
# clock so backoff and expiry are exact.

class FakeClock:
    def __init__(self):
        self.now = 10_000.0

    def monotonic(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


@pytest.fixture
def clock(monkeypatch):
    fake = FakeClock()
    monkeypatch.setattr(rate_limiter, 'time', types.SimpleNamespace(monotonic=fake.monotonic))
    return fake


@pytest.fixture
def throttle_only(monkeypatch):
    monkeypatch.setattr(auth_module, 'rate_limit_check', lambda *a, **k: None)
    monkeypatch.setattr(auth_module, 'verify_password', lambda plain, hashed: plain == PASSWORD)
    delays = []

    async def record_sleep(seconds):
        delays.append(seconds)

    monkeypatch.setattr(login_throttle, '_sleep', record_sleep)
    return delays


GUESSER = '203.0.113.9'
OWNER = '198.51.100.7'


def source(i):
    return f'203.0.{i // 250}.{i % 250 + 1}'


def spoofed(real, i):
    return f'10.9.8.{i % 250}, {real}'


def retry_after(response):
    return response.headers.get('Retry-After')


def test_a_guesser_is_backed_off_while_the_owner_elsewhere_still_signs_in(client, throttle_only, clock):
    results = [attempt(client, 'alice@example.com', BAD, spoofed(GUESSER, i)) for i in range(5)]
    assert statuses(results) == [401] * 5
    assert [retry_after(r) for r in results] == [None, None, None, None, '15']  # the 5th wrong guess starts it
    # the guesser is now turned away, even with the right password and a fresh spoofed prefix
    blocked = attempt(client, 'alice@example.com', PASSWORD, spoofed(GUESSER, 77))
    assert blocked.status_code == 401 and retry_after(blocked) is not None
    # ... but the owner at another address is untouched, and so is the guesser's address on another account
    assert attempt(client, 'alice@example.com', PASSWORD, OWNER).status_code == 200
    assert attempt(client, 'bob@example.com', PASSWORD, GUESSER).status_code == 200


def test_the_backoff_doubles_up_to_the_cap(client, throttle_only, clock):
    waits = []
    for _ in range(12):  # the owner of the guess waits out each backoff before trying again
        response = attempt(client, 'alice@example.com', BAD, GUESSER)
        if retry_after(response):
            waits.append(int(retry_after(response)))
            clock.advance(int(retry_after(response)) + 1)
    assert waits == [15, 30, 60, 120, 240, 480, 900, 900]  # 480 doubles to 960 and is held at the 15 minute cap


def test_attempts_made_while_backed_off_do_not_extend_it(client, throttle_only, clock):
    for _ in range(5):
        attempt(client, 'alice@example.com', BAD, GUESSER)
    for _ in range(20):
        assert retry_after(attempt(client, 'alice@example.com', BAD, GUESSER)) is not None
    clock.advance(16)
    assert retry_after(attempt(client, 'alice@example.com', BAD, GUESSER)) == '30'  # the 6th counted failure, not the 26th


def test_a_throttled_wrong_guess_looks_like_an_ordinary_one(client, throttle_only, clock):
    ordinary = attempt(client, 'alice@example.com', BAD, OWNER)
    for _ in range(5):
        attempt(client, 'alice@example.com', BAD, GUESSER)
    blocked = attempt(client, 'alice@example.com', BAD, GUESSER)
    assert (blocked.status_code, blocked.json()) == (ordinary.status_code, ordinary.json())
    assert retry_after(ordinary) is None and retry_after(blocked) is not None
    # the same holds for an account that does not exist: nothing new is revealed by being throttled
    ghost_ordinary = attempt(client, 'ghost@example.com', BAD, OWNER)
    for _ in range(5):
        attempt(client, 'ghost@example.com', BAD, GUESSER)
    ghost_blocked = attempt(client, 'ghost@example.com', BAD, GUESSER)
    assert (ghost_blocked.status_code, ghost_blocked.json()) == (ghost_ordinary.status_code, ghost_ordinary.json())
    assert retry_after(ghost_blocked) is not None


def test_a_pair_counter_expires(client, throttle_only, clock):
    for _ in range(5):
        attempt(client, 'alice@example.com', BAD, GUESSER)
    clock.advance(login_throttle.PAIR_RESET_SECONDS + 16)  # past the block and the reset window
    results = [attempt(client, 'alice@example.com', BAD, GUESSER) for _ in range(5)]
    assert [retry_after(r) for r in results] == [None, None, None, None, '15']  # a fresh five, not a sixth


def test_a_successful_login_clears_only_that_account_and_source_pair(client, throttle_only, clock):
    for _ in range(3):
        attempt(client, 'alice@example.com', BAD, GUESSER)
        attempt(client, 'bob@example.com', BAD, GUESSER)
    assert attempt(client, 'alice@example.com', PASSWORD, GUESSER).status_code == 200
    alice = [attempt(client, 'alice@example.com', BAD, GUESSER) for _ in range(4)]
    assert [retry_after(r) for r in alice] == [None] * 4  # alice's pair started again from zero
    bob = [attempt(client, 'bob@example.com', BAD, GUESSER) for _ in range(2)]
    assert [retry_after(r) for r in bob] == [None, '15']  # bob's three earlier failures were kept


def test_credential_stuffing_from_one_address_trips_across_accounts(client, throttle_only, clock):
    results = [attempt(client, f'ghost{i}@example.com', BAD, spoofed(GUESSER, i)) for i in range(30)]
    assert set(statuses(results)) == {404}
    assert [retry_after(r) for r in results[:29]] == [None] * 29
    assert retry_after(results[29]) == '30'  # the 30th wrong login from one address
    # every account is now unreachable from that address, real ones with the right password included ...
    blocked = attempt(client, 'alice@example.com', PASSWORD, GUESSER)
    assert blocked.status_code == 401 and retry_after(blocked) is not None
    # ... while the same account is reachable from anywhere else
    assert attempt(client, 'alice@example.com', PASSWORD, OWNER).status_code == 200


def test_a_success_does_not_clear_the_addresss_stuffing_count(client, throttle_only, clock):
    for i in range(29):
        attempt(client, f'ghost{i}@example.com', BAD, GUESSER)
    assert attempt(client, 'alice@example.com', PASSWORD, GUESSER).status_code == 200
    thirtieth = attempt(client, 'ghost29@example.com', BAD, GUESSER)
    assert retry_after(thirtieth) == '30'  # the address still has 29 on its record


def test_the_stuffing_count_is_forgotten_after_ten_quiet_minutes(client, throttle_only, clock):
    for i in range(30):
        attempt(client, f'ghost{i}@example.com', BAD, GUESSER)
    clock.advance(login_throttle.SOURCE_RESET_SECONDS + 31)
    assert attempt(client, 'alice@example.com', PASSWORD, GUESSER).status_code == 200


def test_the_account_ceiling_delays_failures_but_never_refuses_a_correct_password(client, throttle_only, clock, caplog):
    delays = throttle_only
    with caplog.at_level(logging.WARNING, logger='core.login_throttle'):
        for i in range(99):
            attempt(client, 'alice@example.com', BAD, source(i))
        assert delays == []  # a generous ceiling: nothing yet
        attempt(client, 'alice@example.com', BAD, source(99))
        assert delays == [login_throttle.CEILING_EXTRA_DELAY_SECONDS]
    assert any('ceiling' in r.getMessage() for r in caplog.records)
    # still not a lock: the owner's correct password goes straight through, with no extra wait
    assert attempt(client, 'alice@example.com', PASSWORD, source(500)).status_code == 200
    assert delays == [login_throttle.CEILING_EXTRA_DELAY_SECONDS]
    # and the response to a wrong guess is the ordinary one
    response = attempt(client, 'alice@example.com', BAD, source(501))
    assert (response.status_code, response.json()['detail']) == (401, 'Invalid password')
    assert retry_after(response) is None


def test_the_account_ceiling_count_expires(client, throttle_only, clock):
    delays = throttle_only
    for i in range(100):
        attempt(client, 'alice@example.com', BAD, source(i))
    assert len(delays) == 1
    clock.advance(login_throttle.CEILING_WINDOW_SECONDS + 1)
    attempt(client, 'alice@example.com', BAD, source(900))
    assert len(delays) == 1


def test_a_private_source_is_never_address_throttled(client, throttle_only, clock):
    # development / internal callers (the same exemption the request limiter has): no backoff on loopback
    results = [attempt(client, 'alice@example.com', BAD, '127.0.0.1') for _ in range(8)]
    assert [retry_after(r) for r in results] == [None] * 8


def test_guesses_at_an_account_that_does_not_exist_back_off_too(client, throttle_only, clock):
    results = [attempt(client, 'ghost@example.com', BAD, GUESSER) for _ in range(5)]
    assert statuses(results) == [404] * 5 and retry_after(results[4]) == '15'


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
