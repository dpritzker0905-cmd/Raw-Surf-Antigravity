"""SSRF and resource-boundary controls for remote watermark media."""

import io
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from PIL import Image

from core.security import create_access_token
from database import get_db
from models import RoleEnum
from routes.gallery import gallery_purchases, items
from services import watermark


def _bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


def _png(width=4, height=4):
    output = io.BytesIO()
    Image.new('RGB', (width, height), (20, 80, 160)).save(output, 'PNG')
    return output.getvalue()


class _Response:
    def __init__(self, chunks, *, status=200, content_type='image/png', content_length=None):
        self.status_code = status
        self.headers = {'content-type': content_type}
        if content_length is not None:
            self.headers['content-length'] = str(content_length)
        self._chunks = chunks

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError('fixture error', request=None, response=None)

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk


def test_exact_https_origins_preserve_owned_and_sample_images(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://project.supabase.co')
    monkeypatch.setenv('WATERMARK_MEDIA_ALLOWED_ORIGINS', 'https://media.example.com')
    storage = watermark._validate_remote_media_url(
        'https://project.supabase.co/storage/v1/object/public/gallery/pro/photo.jpg'
    )
    sample = watermark._validate_remote_media_url(
        'https://images.unsplash.com/photo-fixture?w=800'
    )
    configured = watermark._validate_remote_media_url('https://media.example.com/pro/photo.jpg')
    assert storage[1:] == ('project.supabase.co', 443)
    assert sample[1:] == ('images.unsplash.com', 443)
    assert configured[1:] == ('media.example.com', 443)


def test_url_policy_rejects_ssrf_parser_variants(monkeypatch):
    monkeypatch.setenv('SUPABASE_URL', 'https://project.supabase.co')
    refused = (
        'http://project.supabase.co/storage/photo.jpg',
        'https://user:pass@project.supabase.co/storage/photo.jpg',
        'https://project.supabase.co.evil.invalid/photo.jpg',
        'https://project.supabase.co/rest/v1/profiles',
        'https://127.0.0.1/photo.jpg',
        'https://[::1]/photo.jpg',
        'file:///etc/passwd',
    )
    for url in refused:
        with pytest.raises(watermark.RemoteImageError):
            watermark._validate_remote_media_url(url)


async def test_dns_answers_must_all_be_public(monkeypatch):
    def mixed_answers(*args, **kwargs):
        return [
            (2, 1, 6, '', ('93.184.216.34', 443)),
            (2, 1, 6, '', ('127.0.0.1', 443)),
        ]

    monkeypatch.setattr(watermark.socket, 'getaddrinfo', mixed_answers)
    with pytest.raises(watermark.RemoteImageError, match='non-public'):
        await watermark._resolve_public_address('images.unsplash.com', 443)


async def test_stream_reader_enforces_type_redirect_and_byte_caps():
    with pytest.raises(watermark.RemoteImageError, match='redirect'):
        await watermark._read_limited_image_response(_Response([], status=302), 10)
    with pytest.raises(watermark.RemoteImageError, match='not an image'):
        await watermark._read_limited_image_response(_Response([b'ok'], content_type='text/plain'), 10)
    with pytest.raises(watermark.RemoteImageError, match='byte limit'):
        await watermark._read_limited_image_response(_Response([b'123', b'456']), 5)
    assert await watermark._read_limited_image_response(_Response([b'123', b'45']), 5) == b'12345'


def test_decoder_checks_magic_pixels_and_complete_image():
    decoded = watermark._decode_remote_image(_png(), max_pixels=16)
    assert decoded.size == (4, 4)
    with pytest.raises(watermark.RemoteImageError, match='pixel limit'):
        watermark._decode_remote_image(_png(), max_pixels=15)
    with pytest.raises(Exception):
        watermark._decode_remote_image(b'not an image', max_pixels=16)


def test_logo_cache_is_entry_and_byte_bounded(monkeypatch):
    monkeypatch.setattr(watermark, 'MAX_LOGO_CACHE_ENTRIES', 2)
    monkeypatch.setattr(watermark, 'MAX_LOGO_CACHE_BYTES', 5)
    watermark._watermark_logo_cache.clear()
    monkeypatch.setattr(watermark, '_watermark_logo_cache_bytes', 0)
    watermark._cache_logo('https://images.unsplash.com/a', b'12')
    watermark._cache_logo('https://images.unsplash.com/b', b'34')
    watermark._cache_logo('https://images.unsplash.com/c', b'5')
    assert list(watermark._watermark_logo_cache) == [
        'https://images.unsplash.com/b',
        'https://images.unsplash.com/c',
    ]
    assert watermark._watermark_logo_cache_bytes == 3


class _Db:
    def __init__(self):
        self.added = []
        self.profile_role = RoleEnum.PHOTOGRAPHER

    async def execute(self, statement):
        profile = SimpleNamespace(
            id='pro',
            role=self.profile_role,
            is_grom_parent=False,
            full_name='Fixture Pro',
        )
        return SimpleNamespace(scalar_one_or_none=lambda: profile)

    def add(self, value):
        self.added.append(value)

    async def commit(self):
        return None

    async def refresh(self, value):
        value.id = 'gallery-item'


@pytest_asyncio.fixture
async def client(monkeypatch):
    app = FastAPI()
    app.include_router(items.router, prefix='/api')
    app.include_router(gallery_purchases.router, prefix='/api')
    database = _Db()

    async def database_dependency():
        yield database

    generated = []

    async def generate(**kwargs):
        generated.append(kwargs)
        return b'fixture-jpeg'

    app.dependency_overrides[get_db] = database_dependency
    monkeypatch.setattr(gallery_purchases, 'generate_watermarked_preview', generate)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url='https://fixture.invalid',
    ) as test_client:
        yield SimpleNamespace(client=test_client, database=database, generated=generated)


async def test_gallery_sources_require_bound_identity_before_fetch(client):
    item = {'original_url': 'https://127.0.0.1/o.jpg', 'preview_url': 'https://127.0.0.1/p.jpg'}
    preview = {
        'photographer_id': 'pro',
        'sample_image_url': 'https://127.0.0.1/secret.png',
    }
    assert (await client.client.post('/api/gallery?photographer_id=pro', json=item)).status_code == 401
    assert (await client.client.post('/api/gallery/generate-watermark-preview', json=preview)).status_code == 401
    assert (
        await client.client.post('/api/gallery?photographer_id=pro', json=item, headers=_bearer('other'))
    ).status_code == 403
    assert (
        await client.client.post(
            '/api/gallery/generate-watermark-preview', json=preview, headers=_bearer('other')
        )
    ).status_code == 403
    client.database.profile_role = RoleEnum.SURFER
    assert (
        await client.client.post(
            '/api/gallery/generate-watermark-preview',
            json={**preview, 'photographer_id': 'other'},
            headers=_bearer('other'),
        )
    ).status_code == 403
    client.database.profile_role = RoleEnum.PHOTOGRAPHER
    assert client.generated == []


async def test_authenticated_owner_keeps_gallery_and_preview_workflows(client):
    item = {
        'original_url': 'https://project.supabase.co/storage/v1/object/public/gallery/pro/o.jpg',
        'preview_url': 'https://project.supabase.co/storage/v1/object/public/gallery/pro/p.jpg',
    }
    created = await client.client.post('/api/gallery?photographer_id=pro', json=item, headers=_bearer('pro'))
    assert created.status_code == 200
    assert created.json()['id'] == 'gallery-item'

    preview = {
        'photographer_id': 'pro',
        'sample_image_url': 'https://images.unsplash.com/photo-fixture?w=800',
        'watermark_text': 'Fixture',
    }
    rendered = await client.client.post(
        '/api/gallery/generate-watermark-preview', json=preview, headers=_bearer('pro')
    )
    assert rendered.status_code == 200
    assert rendered.json()['preview_url'].startswith('data:image/jpeg;base64,')
    assert client.generated[-1]['original_url'] == preview['sample_image_url']
