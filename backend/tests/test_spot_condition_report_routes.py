"""Execute the production router with deterministic database/socket boundaries.

No live credentials, service, schema migration or network calls. Populated responses
matter: empty-list and startup checks missed the split module's runtime NameErrors.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from database import get_db
from models import ConditionReport, Post, RoleEnum, Story
from routes.condition_reports import router
from websocket_manager import ws_manager


class Result:
    def __init__(self, value=None):
        self.value = value

    def scalars(self):
        return self

    def all(self):
        return self.value

    def fetchall(self):
        return self.value

    def scalar(self):
        return self.value

    def scalar_one_or_none(self):
        return self.value

    def first(self):
        return self.value


class Database:
    def __init__(self, *results):
        self.execute = AsyncMock(side_effect=[r if isinstance(r, Exception) else Result(r) for r in results])
        self.commit = AsyncMock()
        self.refresh = AsyncMock()
        self.added = []

    def add(self, obj):
        obj.id = f'new-{len(self.added)}'
        obj.created_at = datetime.now(timezone.utc)
        self.added.append(obj)

    async def flush(self):
        pass


@pytest.fixture
def report():
    now = datetime.now(timezone.utc)
    return SimpleNamespace(
        id='report-1', photographer_id='photographer-1', spot_id='spot-1',
        photographer=SimpleNamespace(full_name='Test photographer', avatar_url=None, role=RoleEnum.PHOTOGRAPHER),
        spot=SimpleNamespace(name='Test spot', region='Central America'), spot_name=None, region=None,
        media_url='https://media.example.test/original.jpg', thumbnail_url='https://media.example.test/thumb.jpg',
        media_type='image', caption='Observed conditions', wave_height_ft=4.0, conditions_label='Clean',
        wind_conditions='Offshore', crowd_level='Low', view_count=3, is_active=True,
        created_at=now - timedelta(minutes=5), expires_at=now + timedelta(hours=23), live_session_id=None)


async def request(db, method, path, **kwargs):
    app = FastAPI()
    app.include_router(router, prefix='/api')

    async def override_db():
        yield db

    app.dependency_overrides[get_db] = override_db
    async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
        return await client.request(method, '/api' + path, **kwargs)


async def test_regions_resolves_static_route_without_database():
    db = Database()
    response = await request(db, 'GET', '/condition-reports/regions')
    assert response.status_code == 200
    assert response.json()['regions'] == [
        'North Shore', 'South Shore', 'East Coast', 'West Coast', 'Gold Coast', 'SoCal', 'NorCal',
        'Baja', 'Central America', 'Hawaii', 'Caribbean', 'Europe', 'Indonesia', 'Australia', 'Japan', 'Other']
    db.execute.assert_not_called()


@pytest.mark.parametrize('path', ['/condition-reports/spot/spot-1', '/condition-reports/feed'])
@pytest.mark.parametrize('live', [True, False, 'lookup-fails'])
async def test_populated_list_serializes_and_live_lookup_degrades(path, live, report):
    live_rows = RuntimeError('live lookup failed') if live == 'lookup-fails' else [('photographer-1',)] if live else []
    db = Database([report], live_rows, *([1] if path.endswith('/feed') else []))
    response = await request(db, 'GET', path)
    assert response.status_code == 200
    body = response.json()
    assert body['total'] == 1
    row = body['reports'][0]
    assert row['id'] == report.id
    assert row['spot_name'] == 'Test spot'
    assert row['region'] == 'Central America'
    assert row['wave_height_ft'] == 4.0
    assert row['time_ago'] == '5m ago'
    assert row['is_photographer_live'] is (live is True)
    assert row['media_url'] == report.media_url
    db.commit.assert_not_awaited()


@pytest.mark.parametrize('path', ['/condition-reports/spot/spot-1', '/condition-reports/feed'])
@pytest.mark.parametrize('commit_fails', [False, True])
async def test_watermarked_media_heals_through_real_helper(path, commit_fails, report):
    report.media_url = 'https://media.example.test/session_preview.jpg'
    report.thumbnail_url = '/api/uploads/session.jpg'
    item = SimpleNamespace(original_url='https://media.example.test/session.jpg', url_standard=None, url_web=None)
    db = Database([report], [], item, *([1] if path.endswith('/feed') else []))
    if commit_fails:
        db.commit.side_effect = RuntimeError('persistence failed')
    response = await request(db, 'GET', path)
    assert response.status_code == 200
    row = response.json()['reports'][0]
    assert row['media_url'] == row['thumbnail_url'] == item.original_url
    db.commit.assert_awaited_once()


async def test_feed_retains_public_gallery_link(report):
    report.live_session_id = 'session-1'
    db = Database([report], [], ('gallery-1', 7), 1)
    response = await request(db, 'GET', '/condition-reports/feed')
    assert response.status_code == 200
    row = response.json()['reports'][0]
    assert (row['gallery_id'], row['gallery_item_count']) == ('gallery-1', 7)


@pytest.mark.parametrize('viewer', [None, 'photographer-1', 'other-viewer'])
async def test_detail_serializes_and_retains_view_count_policy(viewer, report):
    db = Database(report)
    response = await request(db, 'GET', '/condition-reports/report-1', params={'viewer_id': viewer} if viewer else {})
    assert response.status_code == 200
    assert response.json()['view_count'] == (4 if viewer == 'other-viewer' else 3)
    assert response.json()['time_ago'] == '5m ago'
    assert db.commit.await_count == (1 if viewer == 'other-viewer' else 0)


async def test_create_preserves_report_story_post_and_broadcast(monkeypatch):
    photographer = SimpleNamespace(role=RoleEnum.PHOTOGRAPHER, full_name='Test photographer', avatar_url=None)
    db = Database(photographer)
    broadcast = AsyncMock()
    # Patch only socket I/O. The real imported broadcast function must execute.
    monkeypatch.setattr(ws_manager, 'broadcast', broadcast)
    start = datetime.now(timezone.utc)
    response = await request(db, 'POST', '/condition-reports', params={'photographer_id': 'photographer-1'},
                             json={'media_url': 'https://media.example.test/original.jpg', 'spot_name': 'Test spot'})
    end = datetime.now(timezone.utc)
    assert response.status_code == 200
    report_obj, story, post = db.added
    assert isinstance(report_obj, ConditionReport) and isinstance(story, Story) and isinstance(post, Post)
    assert start + timedelta(hours=24) <= report_obj.expires_at <= end + timedelta(hours=24)
    assert story.expires_at == report_obj.expires_at
    assert story.story_type == 'photographer' and story.is_live_report is True
    assert (report_obj.story_id, report_obj.post_id) == (story.id, post.id)
    assert response.json()['condition_report_id'] == report_obj.id
    db.commit.assert_awaited_once()
    broadcast.assert_awaited_once()
    assert broadcast.await_args.kwargs == {'room': 'conditions'}
    assert broadcast.await_args.args[0]['data']['id'] == report_obj.id


async def test_media_update_returns_success_after_commit(report):
    db = Database(report)
    response = await request(db, 'PATCH', '/condition-reports/report-1/update-media',
                             params={'photographer_id': 'photographer-1'},
                             json={'media_url': 'https://media.example.test/replacement.jpg'})
    assert response.status_code == 200
    assert response.json()['updated']['media_url']['new'] == report.media_url
    db.commit.assert_awaited_once()


@pytest.mark.parametrize('path', ['/condition-reports/spot/spot-1', '/condition-reports/feed'])
async def test_empty_list_positive_control(path):
    db = Database([], *([0] if path.endswith('/feed') else []))
    response = await request(db, 'GET', path)
    assert response.status_code == 200
    assert response.json()['reports'] == []


async def test_missing_report_positive_control():
    response = await request(Database(None), 'GET', '/condition-reports/missing')
    assert response.status_code == 404


@pytest.mark.parametrize('method,path,payload', [
    ('PATCH', '/condition-reports/report-1/update-media', {'media_url': 'https://media.example.test/no.jpg'}),
    ('PATCH', '/condition-reports/report-1/deactivate', None),
    ('DELETE', '/condition-reports/report-1', None),
])
async def test_wrong_photographer_does_not_mutate(method, path, payload, report):
    db = Database(report)
    response = await request(db, method, path, params={'photographer_id': 'other'}, json=payload)
    assert response.status_code == 403
    db.commit.assert_not_awaited()
    assert report.is_active is True


async def test_orphan_cleanup_retains_admin_authentication():
    db = Database()
    response = await request(db, 'DELETE', '/condition-reports/cleanup/orphaned', params={'photographer_id': 'other'})
    assert response.status_code in (401, 403)
    db.execute.assert_not_called()
