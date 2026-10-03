"""Paid-event effects and acknowledgements, with real ORM transactions and no Stripe calls."""
import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from database import get_db
from models import CreditTransaction, PaymentTransaction
from tests.test_audit_account_boundaries import accounts, headers, row


@pytest.fixture
def payments(accounts, monkeypatch):
    _, engine = accounts
    PaymentTransaction.__table__.create(engine)
    CreditTransaction.__table__.create(engine)
    path = Path(__file__).parents[1] / 'routes/subscriptions_billing/payments.py'
    spec = importlib.util.spec_from_file_location('audit_payment_routes', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    credit_spec = importlib.util.spec_from_file_location('audit_credit_routes', path.with_name('credits.py'))
    credit_module = importlib.util.module_from_spec(credit_spec)
    credit_spec.loader.exec_module(credit_module)
    async_engine = create_async_engine('sqlite+aiosqlite:///' + engine.url.database)
    sessions = async_sessionmaker(async_engine, expire_on_commit=False)

    async def database():
        async with sessions() as session:
            yield session

    monkeypatch.setattr(module, 'STRIPE_API_KEY', None)
    # Any marker is sufficient to reach the processor boundary; no credential is used.
    monkeypatch.setattr(module, 'STRIPE_API_KEY', 'synthetic-configured')
    verified = {'type': 'checkout.session.completed', 'session': 'checkout-a', 'status': 'paid'}

    async def webhook(self, body, signature):
        if 'error' in verified:
            raise HTTPException(verified['error'], 'Synthetic verification rejection')
        return module.WebhookResponse(verified['type'], verified['session'], verified['status'], {})

    async def status(self, session):
        return SimpleNamespace(payment_status=verified['status'], amount_total=2550,
                               status='complete', currency='usd', metadata={})

    monkeypatch.setattr(module.StripeCheckout, 'handle_webhook', webhook)
    monkeypatch.setattr(module.StripeCheckout, 'get_checkout_status', status)
    monkeypatch.setattr(credit_module.stripe.checkout.Session, 'retrieve', lambda session:
                        SimpleNamespace(payment_status=verified['status'], amount_total=2550))
    app = FastAPI()
    app.include_router(module.router, prefix='/api')
    app.include_router(credit_module.router, prefix='/api')
    app.dependency_overrides[get_db] = database
    with TestClient(app) as client:
        yield client, engine, verified, sessions, module
    asyncio.run(async_engine.dispose())


def seed(engine, metadata, actor='owner'):
    with engine.begin() as conn:
        conn.execute(PaymentTransaction.__table__.insert(), dict(
            id='payment-a', user_id=actor, session_id='checkout-a', amount=25.50,
            currency='usd', status='Pending', payment_status='Pending',
            transaction_metadata=json.dumps(metadata)))


def transaction(engine):
    with engine.connect() as conn:
        return conn.execute(select(PaymentTransaction.__table__)).mappings().one()


@pytest.mark.parametrize('path', ['/api/webhook/stripe', '/api/payments/checkout/status/checkout-a',
                                  '/api/credits/status/checkout-a'])
def test_paid_credit_purchase_fulfills_once(payments, path):
    client, engine, _, _, _ = payments
    seed(engine, {'credits': 25})
    for _ in range(2):
        response = client.post(path, content=b'{}') if 'webhook' in path else client.get(path, headers=headers('owner'))
        assert response.status_code == 200
        assert response.json().get('status') != 'error'
    assert row(engine)['credit_balance'] == 35
    assert transaction(engine)['payment_status'] == 'paid'
    with engine.connect() as conn:
        ledger = conn.execute(select(CreditTransaction.__table__)).mappings().all()
    assert len(ledger) == 1
    assert ledger[0]['amount'] == 25
    assert ledger[0]['balance_before'] == 10
    assert ledger[0]['balance_after'] == 35


@pytest.mark.parametrize('error', [400, 503])
def test_webhook_keeps_verification_error_status(payments, error):
    client, engine, verified, _, _ = payments
    seed(engine, {'credits': 25})
    verified['error'] = error
    response = client.post('/api/webhook/stripe', content=b'{}')
    assert response.status_code == error
    assert row(engine)['credit_balance'] == 10
    assert transaction(engine)['status'] == 'Pending'


@pytest.mark.parametrize('kind', ['subscription', 'photo_subscription'])
def test_other_payment_types_cannot_become_wallet_credits(payments, kind):
    client, engine, _, _, _ = payments
    seed(engine, {'type': kind, 'tier_name': 'premium'})
    response = client.post('/api/webhook/stripe', content=b'{}')
    assert response.status_code == 200
    assert response.json().get('status') != 'error'
    assert row(engine)['credit_balance'] == 10
    assert transaction(engine)['status'] == 'Pending'


def test_commit_failure_is_retryable_and_rolls_back(payments, monkeypatch):
    client, engine, _, sessions, _ = payments
    seed(engine, {'credits': 25})
    async def commit(self):
        raise RuntimeError('Synthetic commit failure')
    monkeypatch.setattr(sessions.class_, 'commit', commit)
    response = client.post('/api/webhook/stripe', content=b'{}')
    assert response.status_code == 500
    assert response.json() == {'detail': 'Payment processing failed'}
    assert row(engine)['credit_balance'] == 10
    assert transaction(engine)['payment_status'] == 'Pending'


def test_missing_profile_does_not_acknowledge_fulfillment(payments):
    client, engine, _, _, _ = payments
    seed(engine, {'credits': 25}, actor='absent')
    response = client.post('/api/webhook/stripe', content=b'{}')
    assert response.status_code == 500
    assert transaction(engine)['status'] == 'Pending'


def test_unpaid_checkout_cannot_credit_wallet(payments):
    client, engine, verified, _, _ = payments
    seed(engine, {'credits': 25})
    verified['status'] = 'unpaid'
    assert client.post('/api/webhook/stripe', content=b'{}').status_code == 200
    assert row(engine)['credit_balance'] == 10
    assert transaction(engine)['status'] == 'Pending'


def test_status_then_webhook_share_one_fulfillment(payments):
    client, engine, _, _, _ = payments
    seed(engine, {'credits': 25})
    response = client.get('/api/payments/checkout/status/checkout-a', headers=headers('owner'))
    assert response.status_code == 200
    assert client.post('/api/webhook/stripe', content=b'{}').status_code == 200
    assert client.get('/api/credits/status/checkout-a', headers=headers('owner')).status_code == 200
    assert row(engine)['credit_balance'] == 35


@pytest.mark.parametrize('actor,status', [(None, 401), ('other', 404)])
def test_credit_status_requires_payment_owner(payments, actor, status):
    client, engine, _, _, _ = payments
    seed(engine, {'credits': 25})
    response = client.get('/api/credits/status/checkout-a', headers=headers(actor) if actor else {})
    assert response.status_code == status
    assert row(engine)['credit_balance'] == 10
