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
@pytest.mark.parametrize('position,with_logo', [
    ('center', True), ('top-left', True), ('top-right', True), ('bottom-left', True),
    ('bottom-right', True), ('tiled', True), ('top-left', False), ('top-right', False),
])
async def test_logo_only_settings_and_gallery_placement(monkeypatch, position, with_logo):
    def png(size, color):
        output = io.BytesIO()
        Image.new('RGBA', size, color).save(output, 'PNG')
        return output.getvalue()

    photo = 'https://fixture.invalid/photo.png'
    logo = 'https://fixture.invalid/logo.png'
    assets = {photo: png((400, 300), 'black'), logo: png((49, 33), (255, 0, 0, 128))}
    if position == 'center':
        # The second route reads the original paletted PNG from the logo cache.
        indexed = Image.new('P', (49, 33))
        indexed.putpalette([255, 0, 0])
        encoded = io.BytesIO()
        indexed.save(encoded, 'PNG', transparency=bytes([128]))
        assets[logo] = encoded.getvalue()

    async def get(client, url, **kwargs):
        if url == logo and not with_logo:
            return httpx.Response(404, request=httpx.Request('GET', url))
        return httpx.Response(200, content=assets[url], request=httpx.Request('GET', url))

    monkeypatch.setattr(httpx.AsyncClient, 'get', get)
    monkeypatch.setattr(watermark, '_watermark_logo_cache', {})
    request = GenerateWatermarkPreviewRequest(
        photographer_id='fixture', sample_image_url=photo,
        watermark_logo_url=None if not with_logo and position == 'top-left' else logo,
        watermark_text='BEACH', watermark_style='logo', watermark_opacity=0.5, watermark_position=position,
    )
    result = await generate_watermark_preview_endpoint(request)
    jpeg = base64.b64decode(result['preview_url'].split(',')[1])
    rows = Mock()
    photographer = request.model_copy(update={'watermark_position': None}) if position == 'bottom-right' else request
    rows.scalar_one_or_none.return_value = SimpleNamespace(photographer=photographer, preview_url=photo)
    gallery = await get_watermarked_preview('fixture', viewer_id=None, db=AsyncMock(execute=AsyncMock(return_value=rows)))
    assert gallery.body == jpeg
    with Image.open(io.BytesIO(jpeg)) as image:
        assert image.format == 'JPEG'
        if not with_logo:
            text_result = await generate_watermark_preview_endpoint(request.model_copy(update={'watermark_style': 'text'}))
            assert result['preview_url'] == text_result['preview_url']
            box = (0, 0, 200, 150) if position == 'top-left' else (200, 0, 400, 150)
            assert image.crop(box).getchannel('G').getextrema()[1] > 95
            return
        # Half-transparent red at half opacity should peak near 64 on black.
        red = image.getchannel('R')
        assert 54 < red.getextrema()[1] < 80
        assert image.getchannel('G').getextrema()[1] < 20  # No white caption.
        bounds = red.point(lambda value: 255 if value > 50 else 0).getbbox()
        left, top, right, bottom = bounds
        if position == 'center':
            assert abs(left + right - image.width) <= 2
            assert abs(top + bottom - image.height) <= 2
        elif position == 'tiled':
            # Sample the interior of two rows and columns of stamps, and the gap between them.
            for point in ((25, 25), (135, 25), (25, 110), (135, 110)):
                assert red.getpixel(point) > 50
            assert red.getpixel((105, 25)) < 10
        else:
            assert (left if position.endswith('left') else image.width - right) == pytest.approx(15, abs=2)
            assert (top if position.startswith('top') else image.height - bottom) == pytest.approx(15, abs=2)
