"""Real alert emitters and ORM transactions; provider and push transport are offline.

SQLite is a causal/local control, not PostgreSQL or provider-delivery qualification.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

import database
from core.security import create_access_token
from database import get_db
from models import Notification, Profile, RoleEnum, SurfAlert, SurfSpot
from routes.surf_data import alerts as manual
from scheduler import surf_alerts as scheduled


@pytest_asyncio.fixture
async def harness(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'alerts.sqlite'}")
    async with engine.begin() as connection:
        for model in (Profile, SurfSpot, SurfAlert, Notification):
            await connection.run_sync(model.__table__.create)
    maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    async with maker() as db:
        db.add_all([
            Profile(id='owner', user_id='owner', email='owner@example.invalid', role=RoleEnum.SURFER),
            SurfSpot(id='spot', name='Fixture Beach', latitude=28.3, longitude=-80.6),
            SurfAlert(id='alert', user_id='owner', spot_id='spot', min_wave_height=0,
                      max_wave_height=12, notify_push=True),
        ])
        await db.commit()
    pushes = []
    current = {'wave_height_ft': 6.0, 'wave_period': 12, 'rating': 8.0, 'rating_level': 'very_poor'}

    async def resolve(**_):
        return {'current_conditions': dict(current)}

    async def push(_db, user_id, **payload):
        async with maker() as reader:
            # External delivery must observe a durable in-app record.
            rows = list((await reader.scalars(select(Notification))).all())
            assert rows, 'push attempted before notification commit'
        pushes.append((user_id, payload))

    monkeypatch.setattr(database, 'async_session_maker', maker)
    monkeypatch.setattr(manual.point_resolution_service, 'resolve_spot_conditions', resolve)
    monkeypatch.setattr(scheduled.point_resolution_service, 'resolve_spot_conditions', resolve)
    monkeypatch.setattr(scheduled, 'send_push_notification', push)
    monkeypatch.setenv('SURF_ALERT_COOLDOWN_SECONDS', '3600')

    async def run(path):
        if path == 'scheduled':
            await scheduled.check_surf_alerts_task()
        else:
            async with maker() as db:
                return await manual.check_and_trigger_alerts(actor_id='owner', db=db)

    async def edit(**values):
        async with maker() as db:
            alert = await db.get(SurfAlert, 'alert')
            for name, value in values.items():
                setattr(alert, name, value)
            await db.commit()

    async def read():
        async with maker() as db:
            alert = await db.get(SurfAlert, 'alert')
            return alert.trigger_count, list((await db.scalars(select(Notification))).all())

    yield maker, run, edit, read, current, pushes
    await engine.dispose()


@pytest.mark.parametrize('first,second', [('manual', 'manual'), ('scheduled', 'scheduled'),
                                        ('manual', 'scheduled'), ('scheduled', 'manual')])
async def test_successive_emitters_share_one_durable_cooldown(harness, first, second):
    _, run, _, read, _, _ = harness
    await run(first)
    await run(second)
    count, rows = await read()
    assert count == 1 and len(rows) == 1
    assert 'very poor' in rows[0].body and '8/100' in rows[0].body


@pytest.mark.parametrize('path', ['manual', 'scheduled'])
async def test_recent_trigger_suppresses_even_a_matching_forecast(harness, path):
    _, run, edit, read, _, pushes = harness
    await edit(last_triggered=datetime.now(timezone.utc) - timedelta(minutes=15), trigger_count=3)
    await run(path)
    count, rows = await read()
    assert count == 3 and not rows and not pushes


@pytest.mark.parametrize('path', ['manual', 'scheduled'])
@pytest.mark.parametrize('height', [None, float('nan'), float('inf'), -1.0, True])
async def test_unusable_height_never_becomes_a_zero_height_alert(harness, path, height):
    _, run, _, read, current, pushes = harness
    current['wave_height_ft'] = height
    await run(path)
    count, rows = await read()
    assert count == 0 and not rows and not pushes


@pytest.mark.parametrize('path', ['manual', 'scheduled'])
async def test_maximum_zero_is_an_actual_bound(harness, path):
    _, run, edit, read, _, pushes = harness
    await edit(max_wave_height=0)
    await run(path)
    count, rows = await read()
    assert count == 0 and not rows and not pushes


@pytest.mark.parametrize('path', ['manual', 'scheduled'])
async def test_measured_zero_is_distinct_from_missing_height(harness, path):
    _, run, edit, read, current, _ = harness
    await edit(max_wave_height=0)
    current['wave_height_ft'] = 0.0
    await run(path)
    count, rows = await read()
    assert count == 1 and len(rows) == 1 and '0.0ft' in rows[0].body


async def test_scheduled_push_observes_committed_notification(harness):
    _, run, _, read, _, pushes = harness
    await run('scheduled')
    assert len(pushes) == 1
    assert (await read())[0] == 1


async def test_commit_failure_cannot_send_push_or_consume_cooldown(harness, monkeypatch):
    maker, run, _, read, _, pushes = harness

    class BrokenCommit(AsyncSession):
        async def commit(self):
            raise RuntimeError('injected commit failure')

    monkeypatch.setattr(database, 'async_session_maker',
                        async_sessionmaker(maker.kw['bind'], class_=BrokenCommit, expire_on_commit=False))
    await run('scheduled')
    count, rows = await read()
    assert count == 0 and not rows and not pushes


async def test_overlapping_manual_and_scheduled_workers_cannot_both_win(harness, monkeypatch):
    _, run, _, read, current, _ = harness
    barrier = asyncio.Barrier(2)

    async def resolve(**_):
        await barrier.wait()
        return {'current_conditions': dict(current)}

    monkeypatch.setattr(manual.point_resolution_service, 'resolve_spot_conditions', resolve)
    monkeypatch.setattr(scheduled.point_resolution_service, 'resolve_spot_conditions', resolve)
    await asyncio.wait_for(asyncio.gather(run('manual'), run('scheduled')), timeout=10)
    count, rows = await read()
    assert count == 1 and len(rows) == 1


@pytest.mark.parametrize('path', ['manual', 'scheduled'])
async def test_absent_height_and_explicit_no_data_do_not_emit(harness, path):
    _, run, _, read, current, _ = harness
    current.pop('wave_height_ft')
    await run(path)
    assert (await read())[0] == 0
    current.update(wave_height_ft=6, status='no_data')
    await run(path)
    assert (await read())[0] == 0


@pytest.mark.parametrize('low,high', [(8, 2), (-1, 12), (0, float('inf'))])
async def test_malformed_stored_bounds_are_not_unbounded(harness, low, high):
    _, run, edit, read, _, _ = harness
    await edit(min_wave_height=low, max_wave_height=high)
    await run('manual')
    assert (await read())[0] == 0


@pytest.mark.parametrize('elapsed,expected', [(3599.999, False), (3600, True), (3600.001, True), (-1, False)])
async def test_utc_cooldown_boundary_and_future_stamp(harness, elapsed, expected):
    from services.surf_alert_delivery import claim_alert_delivery
    maker, _, edit, _, current, _ = harness
    now = datetime(2026, 10, 4, 12, tzinfo=timezone(timedelta(hours=12)))
    await edit(last_triggered=now.astimezone(timezone.utc) - timedelta(seconds=elapsed))
    async with maker() as db:
        alert = await db.get(SurfAlert, 'alert')
        assert await claim_alert_delivery(db, alert, current, now=now) is expected
        await db.rollback()


async def test_rollback_restores_claim_and_existing_null_counter(harness):
    from services.surf_alert_delivery import claim_alert_delivery
    maker, _, edit, read, current, _ = harness
    await edit(trigger_count=None)
    async with maker() as db:
        alert = await db.get(SurfAlert, 'alert')
        assert await claim_alert_delivery(db, alert, current)
        await db.rollback()
    assert (await read())[0] is None
    async with maker() as db:
        alert = await db.get(SurfAlert, 'alert')
        assert await claim_alert_delivery(db, alert, current)
        await db.commit()
    assert (await read())[0] == 1


@pytest.mark.parametrize('changed', [{'is_active': False}, {'spot_id': 'different'},
                                   {'max_wave_height': 2}, {'user_id': 'different'}])
async def test_database_rechecks_stale_worker_eligibility(harness, changed):
    from services.surf_alert_delivery import claim_alert_delivery
    maker, _, edit, _, current, _ = harness
    async with maker() as worker:
        snapshot = await worker.get(SurfAlert, 'alert')
        await edit(**changed)
        assert not await claim_alert_delivery(worker, snapshot, current)


@pytest.mark.parametrize('raw,expected', [('900', 900), ('86400', 86400), ('3601', 3601),
                                        ('0', 3600), ('899', 3600), ('86401', 3600),
                                        ('NaN', 3600), ('', 3600)])
def test_cooldown_override_is_bounded_and_bad_values_keep_default(monkeypatch, raw, expected):
    from services.surf_alert_delivery import cooldown_seconds
    monkeypatch.setenv('SURF_ALERT_COOLDOWN_SECONDS', raw)
    assert cooldown_seconds() == expected


async def test_push_disabled_keeps_in_app_delivery(harness):
    _, run, edit, read, _, pushes = harness
    await edit(notify_push=False)
    await run('scheduled')
    count, rows = await read()
    assert count == 1 and len(rows) == 1 and not pushes


async def test_push_failure_keeps_durable_record_and_cooldown(harness, monkeypatch):
    _, run, _, read, _, _ = harness
    attempts = []

    async def failed_push(*args, **kwargs):
        attempts.append(1)
        raise RuntimeError('injected transport failure')

    monkeypatch.setattr(scheduled, 'send_push_notification', failed_push)
    await run('scheduled')
    await run('scheduled')
    count, rows = await read()
    assert count == 1 and len(rows) == 1 and len(attempts) == 1


async def test_api_reports_server_cadence_and_preserves_zero_bounds(harness):
    maker, _, edit, _, _, _ = harness
    await edit(max_wave_height=0)
    async with maker() as db:
        rows = await manual.get_user_alerts('owner', actor_id='owner', db=db)
    assert rows[0]['cooldown_seconds'] == 3600 and rows[0]['max_wave_height'] == 0


@pytest.mark.parametrize('identity', ['missing', 'invalid', 'expired'])
async def test_manual_check_refuses_unauthenticated_actor_before_database(identity):
    app = FastAPI()
    app.include_router(manual.router)

    async def forbidden_database():
        raise AssertionError('Unauthorized check opened a database session')
        yield  # Dependency is deliberately an async generator.

    app.dependency_overrides[get_db] = forbidden_database
    headers = {}
    if identity == 'invalid':
        headers['Authorization'] = 'Bearer invalid'
    elif identity == 'expired':
        headers['Authorization'] = 'Bearer ' + create_access_token(
            {'sub': 'owner'}, expires_delta=timedelta(seconds=-1))
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://offline.invalid') as client:
        response = await client.post('/alerts/check?user_id=owner', headers=headers)
    assert response.status_code == 401


async def _second_owner(maker):
    async with maker() as db:
        db.add_all([
            Profile(id='foreign', user_id='foreign', email='foreign@example.invalid', role=RoleEnum.SURFER),
            SurfAlert(id='foreign-alert', user_id='foreign', spot_id='spot', min_wave_height=0,
                      max_wave_height=12, notify_push=False),
        ])
        await db.commit()


@pytest.mark.parametrize('actor', ['owner', 'foreign'])
async def test_manual_check_scopes_real_queries_to_jwt_subject_not_query(harness, actor):
    maker, _, _, _, _, _ = harness
    await _second_owner(maker)
    app = FastAPI()
    app.include_router(manual.router)

    async def session():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = session
    other = 'foreign' if actor == 'owner' else 'owner'
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://offline.invalid') as client:
        response = await client.post('/alerts/check?user_id=' + other,
            headers={'Authorization': 'Bearer ' + create_access_token({'sub': actor})})
    assert response.status_code == 200 and response.json()['triggered_count'] == 1
    async with maker() as db:
        rows = list((await db.scalars(select(Notification))).all())
        assert len(rows) == 1 and rows[0].user_id == actor
        untouched = await db.get(SurfAlert, 'foreign-alert' if actor == 'owner' else 'alert')
        assert untouched.trigger_count == 0 and untouched.last_triggered is None


async def test_scheduled_check_retains_all_owners(harness):
    maker, run, _, _, _, _ = harness
    await _second_owner(maker)
    await run('scheduled')
    async with maker() as db:
        assert {row.user_id for row in (await db.scalars(select(Notification))).all()} == {'owner', 'foreign'}


CONFIG_CASES = [
    ('POST', '/alerts?user_id=owner', {'spot_id': 'spot'}),
    ('GET', '/alerts/user/owner', None),
    ('PATCH', '/alerts/alert', {'max_wave_height': 0}),
    ('PUT', '/alerts/alert', {'spot_id': 'spot', 'max_wave_height': 0}),
    ('DELETE', '/alerts/alert', None),
    ('POST', '/alerts/share', {'alert_id': 'alert', 'sender_id': 'owner', 'recipient_identifier': 'foreign@example.invalid'}),
]


@pytest.mark.parametrize('method,path,body', CONFIG_CASES)
async def test_alert_config_requires_jwt_before_database(method, path, body):
    app = FastAPI()
    app.include_router(manual.router)

    async def forbidden_database():
        raise AssertionError('Anonymous configuration opened database session')
        yield

    app.dependency_overrides[get_db] = forbidden_database
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://offline.invalid') as client:
        response = await client.request(method, path, json=body)
    assert response.status_code == 401


async def _config_client(maker):
    app = FastAPI()
    app.include_router(manual.router)

    async def session():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = session
    return AsyncClient(transport=ASGITransport(app=app), base_url='http://offline.invalid')


@pytest.mark.parametrize('method,path,body', CONFIG_CASES)
async def test_foreign_alert_config_cannot_read_or_mutate(harness, method, path, body):
    maker, _, _, _, _, _ = harness
    async with maker() as db:
        db.add(Profile(id='foreign', user_id='foreign', email='foreign@example.invalid', role=RoleEnum.SURFER))
        await db.commit()
    async with await _config_client(maker) as client:
        response = await client.request(method, path, json=body,
            headers={'Authorization': 'Bearer ' + create_access_token({'sub': 'foreign'})})
    assert response.status_code == (404 if method in ('PATCH', 'PUT', 'DELETE') else 403)
    async with maker() as db:
        alerts = list((await db.scalars(select(SurfAlert))).all())
        assert len(alerts) == 1 and alerts[0].user_id == 'owner' and alerts[0].max_wave_height == 12
        assert not list((await db.scalars(select(Notification))).all())


async def test_alert_share_requires_source_owner_even_with_own_sender(harness):
    maker, _, _, _, _, _ = harness
    async with maker() as db:
        db.add(Profile(id='foreign', user_id='foreign', email='foreign@example.invalid', role=RoleEnum.SURFER))
        await db.commit()
    async with await _config_client(maker) as client:
        response = await client.post('/alerts/share', json={
            'alert_id': 'alert', 'sender_id': 'foreign', 'recipient_identifier': 'owner@example.invalid'},
            headers={'Authorization': 'Bearer ' + create_access_token({'sub': 'foreign'})})
    assert response.status_code == 404


async def test_owner_alert_config_keeps_edit_delete_create_and_read(harness):
    maker, _, _, _, _, _ = harness
    headers = {'Authorization': 'Bearer ' + create_access_token({'sub': 'owner'})}
    async with await _config_client(maker) as client:
        for method, payload in [('PATCH', {'max_wave_height': 0}),
                                ('PUT', {'spot_id': 'spot', 'min_wave_height': 0, 'max_wave_height': 0})]:
            response = await client.request(method, '/alerts/alert', json=payload, headers=headers)
            assert response.status_code == 200
        response = await client.get('/alerts/user/owner', headers=headers)
        assert response.json()[0]['max_wave_height'] == 0
        assert (await client.delete('/alerts/alert', headers=headers)).status_code == 200
        assert (await client.get('/alerts/user/owner', headers=headers)).json() == []
        response = await client.post('/alerts?user_id=owner', headers=headers,
            json={'spot_id': 'spot', 'min_wave_height': 0, 'max_wave_height': 0})
        assert response.status_code == 200 and response.json()['max_wave_height'] == 0


async def test_owner_can_share_own_alert_to_fixture_recipient(harness):
    maker, _, _, _, _, _ = harness
    async with maker() as db:
        db.add(Profile(id='foreign', user_id='foreign', email='foreign@example.invalid', role=RoleEnum.SURFER))
        await db.commit()
    async with await _config_client(maker) as client:
        response = await client.post('/alerts/share', json={
            'alert_id': 'alert', 'sender_id': 'owner', 'recipient_identifier': 'foreign@example.invalid'},
            headers={'Authorization': 'Bearer ' + create_access_token({'sub': 'owner'})})
    assert response.status_code == 200 and response.json()['recipient_id'] == 'foreign'
    async with maker() as db:
        assert {row.user_id for row in (await db.scalars(select(SurfAlert))).all()} == {'owner', 'foreign'}
        assert len((await db.scalars(select(Notification))).all()) == 1
