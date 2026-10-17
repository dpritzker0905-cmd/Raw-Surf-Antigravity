"""LA-UPL-01: every upload write route acts as the token's subject.

All 13 upload routes used to run for anyone: most had no token, and the form `user_id` was trusted as the
uploader. Real JWT + HTTP + an ephemeral SQLite ORM; storage is stubbed and nothing leaves the process.
"""
import io
from datetime import timedelta
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from PIL import Image
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import Gallery, GalleryItem, Profile, RoleEnum
from routes.uploads import comments as upload_comments
from routes.uploads import core as upload_core
from routes.uploads import media as upload_media
from routes.uploads import media_gallery


def bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


def _png():
    buffer = io.BytesIO()
    Image.new('RGB', (64, 64), (10, 120, 200)).save(buffer, 'PNG')
    return buffer.getvalue()


NO_AUTH = [
    {},
    {'Authorization': 'Bearer invalid'},
    {'Authorization': 'Bearer ' + create_access_token({'sub': 'pro'}, expires_delta=timedelta(minutes=-1))},
]
NO_AUTH_IDS = ['none', 'invalid', 'expired']

# (path, the legacy form field naming the uploader, or None when the route never had one)
FORM_ROUTES = [
    ('/api/upload/comment', 'user_id'),
    ('/api/upload', None),
    ('/api/upload/story', 'user_id'),
    ('/api/upload/conditions', 'user_id'),
    ('/api/upload/gallery', 'user_id'),
    ('/api/upload/avatar', 'user_id'),
    ('/api/upload/feed', 'user_id'),
    ('/api/upload/wave', 'user_id'),
    ('/api/upload/user-gallery', 'user_id'),
    ('/api/upload/photographer-gallery', 'user_id'),
    ('/api/uploads/test-watermark', None),
    ('/api/photos/upload', 'photographer_id'),
]
CLAIMING = [(path, field) for path, field in FORM_ROUTES if field]
EXPORT = '/api/gallery/item/{item}/export-frame'


@pytest_asyncio.fixture
async def harness(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'upl01.sqlite'}")

    def create_all(sync_connection):
        for table in Base.metadata.sorted_tables:
            try:
                table.create(sync_connection, checkfirst=True)
            except Exception:  # tables this test never reads may use types sqlite cannot create
                pass

    async with engine.begin() as connection:
        await connection.run_sync(create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid in ('pro', 'other'):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid,
                           role=RoleEnum.PHOTOGRAPHER, full_name=pid.title(), credit_balance=0.0,
                           withdrawable_credits=0.0, gear_only_credits=0.0))
        db.add(Gallery(id='g_pro', photographer_id='pro', title='Pro'))
        db.add(Gallery(id='g_other', photographer_id='other', title='Other'))
        db.add(GalleryItem(id='vid_pro', gallery_id='g_pro', photographer_id='pro', media_type='video',
                           original_url='https://cdn.fixture.invalid/v.mp4',
                           preview_url='https://cdn.fixture.invalid/p.mp4'))
        db.add(GalleryItem(id='vid_other', gallery_id='g_other', photographer_id='other', media_type='video',
                           original_url='https://cdn.fixture.invalid/v2.mp4',
                           preview_url='https://cdn.fixture.invalid/p2.mp4'))
        await db.commit()

    stored = []

    def record(local_path, bucket, key, content_type='image/jpeg'):
        stored.append((bucket, key))
        return f'https://cdn.fixture.invalid/{bucket}/{key}'

    for module in (upload_core, media_gallery):
        monkeypatch.setattr(module, 'UPLOAD_DIR', tmp_path / 'uploads')
        monkeypatch.setattr(module, 'upload_to_supabase_storage', record)
    (tmp_path / 'uploads').mkdir()

    app = FastAPI()
    for module in (upload_comments, upload_core, upload_media, media_gallery):
        app.include_router(module.router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield SimpleNamespace(client=client, stored=stored, tmp=tmp_path)
    await engine.dispose()


def post(harness, path, headers, claim=None):
    return harness.client.post(path, headers=headers, data=claim or {},
                               files={'file': ('a.png', _png(), 'image/png')})


@pytest.mark.parametrize('headers', NO_AUTH, ids=NO_AUTH_IDS)
@pytest.mark.parametrize('path,field', FORM_ROUTES, ids=[p for p, _ in FORM_ROUTES])
async def test_every_upload_route_needs_a_valid_token(harness, path, field, headers):
    claim = {field: 'pro'} if field else None
    response = await post(harness, path, headers, claim)
    assert response.status_code == 401, response.text
    assert harness.stored == []


@pytest.mark.parametrize('headers', NO_AUTH, ids=NO_AUTH_IDS)
async def test_frame_export_needs_a_valid_token(harness, headers):
    response = await harness.client.post(EXPORT.format(item='vid_pro'), headers=headers,
                                         json={'timestamp': 1.0, 'gallery_id': 'g_pro'})
    assert response.status_code == 401, response.text


@pytest.mark.parametrize('path,field', CLAIMING, ids=[p for p, _ in CLAIMING])
async def test_an_upload_cannot_claim_to_be_another_user(harness, path, field):
    response = await post(harness, path, bearer('pro'), {field: 'other'})
    assert response.status_code == 403, response.text
    assert harness.stored == []


async def test_frame_export_refuses_another_photographers_video(harness):
    response = await harness.client.post(EXPORT.format(item='vid_other'), headers=bearer('pro'),
                                         json={'timestamp': 1.0, 'gallery_id': 'g_pro'})
    assert response.status_code == 403, response.text


async def test_frame_export_refuses_another_photographers_gallery(harness):
    response = await harness.client.post(EXPORT.format(item='vid_pro'), headers=bearer('pro'),
                                         json={'timestamp': 1.0, 'gallery_id': 'g_other'})
    assert response.status_code == 403, response.text


@pytest.mark.parametrize('claim', [None, {'user_id': 'pro'}], ids=['no-claim', 'matching-claim'])
async def test_the_owner_still_uploads_and_the_file_lands_under_the_token_user(harness, claim):
    response = await post(harness, '/api/upload/gallery', bearer('pro'), claim)
    assert response.status_code == 200, response.text
    assert harness.stored, 'the upload reached storage'
    assert all('/pro/' in key or key.startswith('pro/') or 'pro' in key for _, key in harness.stored)
    assert not any('other' in key for _, key in harness.stored)
