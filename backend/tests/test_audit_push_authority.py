"""Real JWT/HTTP and ephemeral ORM controls; no live notification provider."""
import logging
from datetime import timedelta
import secrets

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import get_db
from models import Profile, PushSubscription, RoleEnum
from routes.notifications import push


def auth(subject='owner'):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


@pytest_asyncio.fixture
async def harness(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'push.sqlite'}")
    async with engine.begin() as connection:
        for model in (Profile, PushSubscription):
            await connection.run_sync(model.__table__.create)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add_all([Profile(id=name, user_id=name, email=name + '@example.invalid',
                            role=RoleEnum.SURFER) for name in ('owner', 'other')])
        db.add(PushSubscription(id='foreign', user_id='other', endpoint='foreign-device',
                                p256dh_key='fixture', auth_key='fixture'))
        await db.commit()
    app = FastAPI()
    app.include_router(push.router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),
                                base_url='http://fixture.invalid') as client:
        yield app, client, maker
    await engine.dispose()


NATIVE = {'endpoint': 'owner-device', 'p256dh_key': 'fixture', 'auth_key': 'fixture'}
ONE_SIGNAL = {'user_id': 'owner', 'subscription_id': 'fixture-device'}


@pytest.mark.parametrize('headers', [{}, {'Authorization': 'Bearer invalid'}, {
    'Authorization': 'Bearer ' + create_access_token({'sub': 'owner'},
                                                    expires_delta=timedelta(minutes=-1))}])
@pytest.mark.parametrize('path,method,body', [
    ('/push/subscribe?user_id=owner', 'post', NATIVE),
    ('/push/onesignal/subscribe', 'post', ONE_SIGNAL),
    ('/push/unsubscribe?user_id=owner&endpoint=owner-device', 'delete', None),
])
async def test_subscription_writes_require_auth_before_database(harness, headers, path, method, body):
    app, client, _ = harness

    async def forbidden_db():
        raise AssertionError('unauthenticated request reached database')
        yield

    app.dependency_overrides[get_db] = forbidden_db
    response = await client.request(method, '/api' + path, headers=headers,
                                    **({'json': body} if body else {}))
    assert response.status_code == 401


@pytest.mark.parametrize('path,method,body', [
    ('/push/subscribe?user_id=other', 'post', NATIVE),
    ('/push/onesignal/subscribe', 'post', {**ONE_SIGNAL, 'user_id': 'other'}),
    ('/push/unsubscribe?user_id=other&endpoint=foreign-device', 'delete', None),
])
async def test_foreign_user_selector_cannot_write(harness, path, method, body):
    _, client, maker = harness
    response = await client.request(method, '/api' + path, headers=auth(),
                                    **({'json': body} if body else {}))
    assert response.status_code == 403
    async with maker() as db:
        rows = list((await db.scalars(select(PushSubscription))).all())
        assert len(rows) == 1 and rows[0].id == 'foreign'


@pytest.mark.parametrize('selector', ['', '?user_id=owner'])
async def test_native_owner_subscribe_repeat_unsubscribe(harness, selector):
    _, client, maker = harness
    first = await client.post('/api/push/subscribe' + selector, json=NATIVE, headers=auth())
    repeat = await client.post('/api/push/subscribe' + selector, json=NATIVE, headers=auth())
    assert first.status_code == repeat.status_code == 200
    assert first.json()['status'] == 'new' and repeat.json()['status'] == 'existing'
    async with maker() as db:
        rows = list((await db.scalars(select(PushSubscription).where(
            PushSubscription.user_id == 'owner'))).all())
        assert len(rows) == 1 and rows[0].endpoint == NATIVE['endpoint']
    separator = '&' if selector else '?'
    response = await client.delete('/api/push/unsubscribe' + selector + separator +
                                   'endpoint=owner-device', headers=auth())
    assert response.status_code == 200
    async with maker() as db:
        rows = list((await db.scalars(select(PushSubscription))).all())
        assert len(rows) == 1 and rows[0].id == 'foreign'


async def test_other_owner_device_is_not_deleted_by_omitting_selector(harness):
    _, client, maker = harness
    response = await client.delete('/api/push/unsubscribe?endpoint=foreign-device', headers=auth())
    assert response.status_code == 200
    async with maker() as db:
        assert await db.get(PushSubscription, 'foreign') is not None


async def test_legitimate_onesignal_owner_registration_and_update(harness):
    _, client, maker = harness
    for token in ('first-fixture', 'second-fixture'):
        response = await client.post('/api/push/onesignal/subscribe',
                                     json={**ONE_SIGNAL, 'token': token}, headers=auth())
        assert response.status_code == 200
    async with maker() as db:
        rows = list((await db.scalars(select(PushSubscription).where(
            PushSubscription.user_id == 'owner'))).all())
        assert len(rows) == 1 and rows[0].auth_key == 'second-fixture'


@pytest.mark.parametrize('headers', [{}, {'Authorization': 'Bearer invalid'}, auth()])
async def test_public_send_is_unmounted_and_cannot_call_provider(harness, monkeypatch, headers):
    _, client, _ = harness
    deliveries = []

    async def provider(**payload):
        deliveries.append(payload)
        return {'status': 'success'}

    monkeypatch.setattr(push, 'send_push_notification', provider)
    response = await client.post('/api/push/send', headers=headers, json={
        'user_id': 'other', 'title': 'Fixture', 'message': 'Fixture',
        'action_url': 'https://foreign.invalid'})
    assert response.status_code == 404 and deliveries == []


async def test_internal_provider_transport_preserves_target_and_scheduling(monkeypatch, caplog):
    requests = []

    async def provider(request):
        requests.append(request)
        return httpx.Response(200, json={'id': 'fixture-notification'})

    original = httpx.AsyncClient
    monkeypatch.setattr(push, 'ONESIGNAL_APP_ID', 'fixture-app')
    monkeypatch.setattr(push, 'ONESIGNAL_REST_API_KEY', secrets.token_urlsafe(32))
    monkeypatch.setattr(push.httpx, 'AsyncClient', lambda **kw: original(
        transport=httpx.MockTransport(provider), **kw))
    with caplog.at_level(logging.INFO):
        result = await push.send_push_notification('owner', 'Fixture', 'Fixture',
                                                  action_url='/spot-hub/fixture', urgent=False)
    assert result == {'status': 'success', 'notification_id': 'fixture-notification'}
    import json
    payload = json.loads(requests[0].content)
    assert payload['include_aliases'] == {'external_id': ['owner']}
    assert payload['web_url'] == '/spot-hub/fixture'
    assert payload['delayed_option'] == 'timezone' and payload['delivery_time_of_day'] == '9:00AM'
    assert push.ONESIGNAL_REST_API_KEY not in caplog.text
