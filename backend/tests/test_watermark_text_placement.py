import base64
import io
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from PIL import Image

from routes.gallery.gallery_purchases import (
    GenerateWatermarkPreviewRequest, generate_watermark_preview_endpoint, get_watermarked_preview,
)
from services import watermark


@pytest.mark.asyncio
@pytest.mark.parametrize('position', ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'tiled'])
async def test_text_only_gallery_matches_settings_with_saved_logo(monkeypatch, position):
    def png(size, color):
        output = io.BytesIO()
        Image.new('RGBA', size, color).save(output, 'PNG')
        return output.getvalue()

    photo = 'https://fixture.invalid/photo.png'
    logo = 'https://fixture.invalid/logo.png'
    # Use the settings preview's full width so the rotated text repeats in all four quadrants.
    assets = {photo: png((800, 600), 'black'), logo: png((49, 33), 'red')}
    fetched_urls = []

    async def get(client, url):
        fetched_urls.append(url)
        return httpx.Response(200, content=assets[url], request=httpx.Request('GET', url))

    monkeypatch.setattr(httpx.AsyncClient, 'get', get)
    cache = {logo: assets[logo]} if position == 'center' else {}
    monkeypatch.setattr(watermark, '_watermark_logo_cache', cache)
    request = GenerateWatermarkPreviewRequest(
        photographer_id='fixture', sample_image_url=photo, watermark_logo_url=logo,
        watermark_text='BEACH', watermark_style='text', watermark_opacity=0.5, watermark_position=position,
    )
    photographer = request
    if position == 'bottom-right':
        request.watermark_text = 'Watermark'
        photographer = request.model_copy(update={'watermark_text': None, 'watermark_position': None})
    result = await generate_watermark_preview_endpoint(request)
    jpeg = base64.b64decode(result['preview_url'].split(',')[1])
    rows = Mock()
    rows.scalar_one_or_none.return_value = SimpleNamespace(photographer=photographer, preview_url=photo)
    gallery = await get_watermarked_preview('fixture', viewer_id=None, db=AsyncMock(execute=AsyncMock(return_value=rows)))
    assert logo not in fetched_urls
    assert gallery.body == jpeg
    with Image.open(io.BytesIO(jpeg)) as image:
        assert image.format == 'JPEG'
        quadrants = {
            'top-left': (0, 0, 400, 300), 'top-right': (400, 0, 800, 300),
            'bottom-left': (0, 300, 400, 600), 'bottom-right': (400, 300, 800, 600),
        }
        regions = quadrants.values() if position == 'tiled' else [quadrants.get(position, (200, 150, 600, 450))]
        for region in regions:
            assert any(95 < min(pixel) and max(pixel) < 155 for pixel in image.crop(region).getdata())
        if position in quadrants:
            for name, box in quadrants.items():
                if name != position:
                    assert image.crop(box).getextrema() == ((0, 0), (0, 0), (0, 0))
