"""Audit 2026-10-24, T-04 / F1 / F2: a password-reset token is a credential and travels by email ONLY.

`include_dev_reset_details` put `_dev_token` and `_dev_reset_link` in the forgot-password response whenever the
environment name was NOT exactly "production"/"prod" -- the "have we been told it is production?" direction that
core/security.py documents as a production defect -- so on a host that sets none of ENVIRONMENT / ENV / NODE_ENV the
endpoint handed the reset token for ANY existing address (admins included) to an unauthenticated caller. The sender
also logged the complete link and the recipient at INFO.

Real router, real handler, ephemeral SQLite, `resend` stubbed (no email, no network). The log oracle captures every
record production's sink would see (root at INFO, our own loggers at DEBUG) plus stdout/stderr and requires that the token, the link and the recipient appear in
none of it while the stubbed provider still receives one complete message.
"""
import contextlib
import logging
import re

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

import database
from database import Base
from models import PasswordResetToken, Profile, RoleEnum
from routes.auth_pkg import password_reset

EMAIL = 'synthetic-reset@example.com'
APP_URL = 'https://app.example.invalid'
ENVIRONMENTS = [
    pytest.param({}, id='nothing-set'),
    pytest.param({'ENVIRONMENT': 'production'}, id='ENVIRONMENT=production'),
    pytest.param({'ENVIRONMENT': 'staging'}, id='ENVIRONMENT=staging'),
    pytest.param({'ENV': 'development'}, id='ENV=development'),
    pytest.param({'NODE_ENV': 'test'}, id='NODE_ENV=test'),
]
LONG_RUN = re.compile(r'[A-Za-z0-9_-]{40,}')  # a reset token (token_urlsafe(48)) is 64 of these


@pytest.fixture
def env(monkeypatch):
    for name in ('ENVIRONMENT', 'ENV', 'NODE_ENV', 'IS_PROD', 'TESTING'):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv('APP_URL', APP_URL)
    return monkeypatch


@pytest.fixture
def sent(env):
    """The stubbed provider: records every message instead of sending one."""
    calls = []

    def fake_send(params):
        calls.append(params)
        return {'id': 'synthetic-message-id'}

    env.setattr(password_reset, 'RESEND_API_KEY', 'synthetic')
    env.setattr(password_reset.resend.Emails, 'send', staticmethod(fake_send))
    return calls


@pytest.fixture
def client(tmp_path, env):
    path = tmp_path / 'reset.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    with sessionmaker(sync_engine)() as db:
        db.add(Profile(id='owner', user_id='owner', email=EMAIL, username='owner', role=RoleEnum.SURFER,
                       full_name='Owner Synthetic', credit_balance=0.0, withdrawable_credits=0.0,
                       gear_only_credits=0.0))
        db.commit()
    sync_engine.dispose()

    async def get_db():
        engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
        await engine.dispose()

    app = FastAPI()
    app.include_router(password_reset.router, prefix='/api')
    app.dependency_overrides[database.get_db] = get_db
    app.dependency_overrides[password_reset.get_db] = get_db
    with TestClient(app) as test_client:
        test_client.sqlite_path = path
        yield test_client


@contextlib.contextmanager
def capture(caplog):
    """What production's sink sees: the root logger at INFO (server.py), plus DEBUG from our own code. The SQLite
    driver's DEBUG output, which echoes bound parameters, is not part of that sink (production is Postgres)."""
    with caplog.at_level(logging.INFO), caplog.at_level(logging.DEBUG, logger='routes'):
        yield


def stored_tokens(client):
    engine = create_engine(f'sqlite:///{client.sqlite_path}')
    try:
        with sessionmaker(engine)() as db:
            return [t.token for t in db.execute(select(PasswordResetToken)).scalars().all()]
    finally:
        engine.dispose()


def forgot(client, email=EMAIL):
    return client.post('/api/auth/forgot-password', json={'email': email})


def everything_logged(caplog, capfd):
    """Every byte the request could have written: formatted records, their raw message/args/traceback, stdout/stderr."""
    out, err = capfd.readouterr()
    parts = [caplog.text, out, err]
    for record in caplog.records:
        parts += [record.getMessage(), repr(record.args), record.exc_text or '']
    return '\n'.join(parts)


def assert_no_credentials_in(text, token):
    assert token not in text, 'the reset token reached a log'
    assert 'reset-password?token=' not in text, 'a reset link reached a log'
    assert f'{APP_URL}/reset-password' not in text
    assert EMAIL not in text, 'the recipient address reached a log'
    assert not LONG_RUN.findall(text), f'a token-sized run reached a log: {LONG_RUN.findall(text)}'


@pytest.mark.parametrize('environment', ENVIRONMENTS)
def test_the_response_never_carries_the_token_or_link_in_any_environment(client, sent, env, environment):
    for name, value in environment.items():
        env.setenv(name, value)
    response = forgot(client)
    assert response.status_code == 200
    body = response.json()
    assert set(body) == {'message', 'success'}, sorted(body)  # no _dev_token / _dev_reset_link / _dev_note
    (token,) = stored_tokens(client)
    assert token not in response.text and 'reset-password' not in response.text


@pytest.mark.parametrize('environment', ENVIRONMENTS)
def test_delivery_works_and_no_log_holds_the_token_link_or_recipient(client, sent, env, caplog, capfd, environment):
    for name, value in environment.items():
        env.setenv(name, value)
    with capture(caplog):
        response = forgot(client)
    assert response.status_code == 200
    (token,) = stored_tokens(client)
    # delivery is intact: exactly one message, to the owner, carrying the complete link in both bodies
    assert len(sent) == 1
    message = sent[0]
    link = f'{APP_URL}/reset-password?token={token}'
    assert message['to'] == [EMAIL] and link in message['html'] and link in message['text']
    assert_no_credentials_in(everything_logged(caplog, capfd), token)


def test_a_failing_provider_neither_changes_the_response_nor_leaks_into_the_log(client, env, caplog, capfd):
    def explode(params):  # a provider error that quotes the recipient and the whole message, the worst case
        raise RuntimeError(f"rejected {params['to'][0]}: {params['text']}")

    env.setattr(password_reset, 'RESEND_API_KEY', 'synthetic')
    env.setattr(password_reset.resend.Emails, 'send', staticmethod(explode))
    with capture(caplog):
        response = forgot(client)
    assert response.status_code == 200 and set(response.json()) == {'message', 'success'}
    (token,) = stored_tokens(client)
    assert_no_credentials_in(everything_logged(caplog, capfd), token)
    assert any('Failed to send password reset email' in r.getMessage() for r in caplog.records)  # still visible


def test_no_email_service_configured_gives_the_same_response_and_logs_nothing_secret(client, env, caplog, capfd):
    env.setattr(password_reset, 'RESEND_API_KEY', None)
    with capture(caplog):
        response = forgot(client)
    assert response.status_code == 200 and set(response.json()) == {'message', 'success'}
    (token,) = stored_tokens(client)
    assert_no_credentials_in(everything_logged(caplog, capfd), token)


def test_an_unknown_address_gets_the_identical_response(client, sent):
    known = forgot(client)
    unknown = forgot(client, 'nobody-here@example.com')
    assert (unknown.status_code, unknown.json()) == (known.status_code, known.json())
    assert len(sent) == 1  # only the real account was mailed


def test_the_debug_response_helper_is_gone():
    assert not hasattr(password_reset, 'include_dev_reset_details')
