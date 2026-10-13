"""Assembled Stripe route authority and verified-event no-write boundaries."""

import asyncio
import os
import socket
from unittest.mock import AsyncMock
import pytest
from httpx import AsyncClient, ASGITransport

@pytest.fixture(scope='module')
def assembled():
    def no_network(*args, **kwargs):
        raise AssertionError('External network forbidden during route assembly')
    with pytest.MonkeyPatch.context() as patch:
        patch.setenv('PYTHON_DOTENV_DISABLED', '1')
        patch.setenv('TESTING', '1')
        patch.setattr(socket.socket, 'connect', no_network)
        import server
    return server.app

def routes(app):
    return [r for r in app.routes if getattr(r,'path',None)=='/api/webhook/stripe' and 'POST' in getattr(r,'methods',[])]

def test_only_one_stripe_signature_authority(assembled):
    assert len(routes(assembled))==1

def test_actual_first_registered_handler_is_canonical(assembled):
    from routes.subscriptions_billing import payments
    assert routes(assembled)[0].endpoint is payments.stripe_webhook

@pytest.mark.parametrize('mode,status',[('missing_config',503),('missing_signature',400),('invalid_signature',400),('verified_unrelated',200)])
def test_dispatch_keeps_verification_before_any_payment_writes(assembled,monkeypatch,mode,status):
    from routes.subscriptions_billing import payments
    from database import get_db
    import stripe
    db=type('DB',(),{})()
    db.rollback=AsyncMock();db.commit=AsyncMock();db.execute=AsyncMock(side_effect=AssertionError('No customer reads'))
    async def dependency():yield db
    assembled.dependency_overrides[get_db]=dependency
    # Objects stand for configured credentials; no credential strings or provider calls.
    monkeypatch.setattr(payments,'STRIPE_API_KEY',object())
    monkeypatch.setattr(payments.StripeCheckout,'__init__',lambda self,api_key,webhook_url:None)
    real_get=os.environ.get
    monkeypatch.setattr(os.environ,'get',lambda key,default=None: (None if mode=='missing_config' else object()) if key=='STRIPE_WEBHOOK_SECRET' else real_get(key,default))
    sdk_calls=[]
    def verify(body,signature,secret):
        sdk_calls.append(1)
        if mode=='invalid_signature':
            raise stripe.error.SignatureVerificationError('Rejected fixture',signature)
        return {'type':'audit.unrelated','data':{'object':{}}}
    monkeypatch.setattr(stripe.Webhook,'construct_event',verify)
    async def run():
        async with AsyncClient(transport=ASGITransport(app=assembled),base_url='https://audit.example.invalid') as c:
            return await c.post('/api/webhook/stripe',content=b'{}',headers={} if mode=='missing_signature' else {'Stripe-Signature':'invalid'})
    try:
        response=asyncio.run(run())
        assert response.status_code==status
        assert len(sdk_calls)==(1 if mode in ('invalid_signature','verified_unrelated') else 0)
        assert db.execute.await_count==0 and db.commit.await_count==0
        if mode=='verified_unrelated':assert response.json()=={'status':'received'}
        else:assert db.rollback.await_count==1
    finally:
        assembled.dependency_overrides.pop(get_db,None)
