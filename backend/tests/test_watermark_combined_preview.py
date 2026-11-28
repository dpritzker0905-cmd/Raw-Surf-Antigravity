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
    ('bottom-right', True), ('tiled', True), ('top-left', False),
])
async def test_combined_settings_preview_contains_logo_and_text(monkeypatch, position, with_logo):
    def png(size, color):
        output = io.BytesIO()
        Image.new('RGB', size, color).save(output, 'PNG')
        return output.getvalue()

    photo = 'https://fixture.invalid/photo.png'
    logo = 'https://fixture.invalid/logo.png'
    assets = {photo: png((400, 300), 'black'), logo: png((48, 32), 'red')}

    async def get(client, url):
        return httpx.Response(200, content=assets[url], request=httpx.Request('GET', url))

    monkeypatch.setattr(httpx.AsyncClient, 'get', get)
    monkeypatch.setattr(watermark, '_watermark_logo_cache', {})
    request = GenerateWatermarkPreviewRequest(
        photographer_id='fixture', sample_image_url=photo, watermark_logo_url=logo if with_logo else None,
        watermark_text='BEACH', watermark_style='both', watermark_opacity=0.5, watermark_position=position,
    )
    result = await generate_watermark_preview_endpoint(request)
    jpeg = base64.b64decode(result['preview_url'].split(',')[1])
    item = SimpleNamespace(photographer=request, preview_url=photo)
    rows = Mock()
    rows.scalar_one_or_none.return_value = item
    gallery = await get_watermarked_preview('fixture', viewer_id=None, db=AsyncMock(execute=AsyncMock(return_value=rows)))
    assert gallery.body == jpeg
    if not with_logo:
        text_result = await generate_watermark_preview_endpoint(request.model_copy(update={'watermark_style': 'text'}))
        assert result['preview_url'] == text_result['preview_url']
    with Image.open(io.BytesIO(jpeg)) as image:
        assert image.format == 'JPEG'
        quadrants = {
            'top-left': (0, 0, 200, 150), 'top-right': (200, 0, 400, 150),
            'bottom-left': (0, 150, 200, 300), 'bottom-right': (200, 150, 400, 300),
        }
        regions = list(quadrants.values()) if position == 'tiled' else [
            quadrants.get(position, (100, 75, 300, 225))
        ]
        for region in regions:
            crop = image.crop(region)
            red_rows = [i // crop.width for i, (r, g, b) in enumerate(crop.getdata())
                        if 100 < r < 150 and max(g, b) < 30]
            white_rows = [i // crop.width for i, pixel in enumerate(crop.getdata())
                          if 95 < min(pixel) and max(pixel) < 155]
            assert bool(red_rows) == with_logo, 'unexpected logo visibility'
            assert white_rows, 'text missing at requested opacity'
            if with_logo and position != 'tiled':
                assert min(white_rows) > max(red_rows)
        if position in quadrants:
            for name, box in quadrants.items():
                if name != position:
                    assert image.crop(box).getextrema() == ((0, 0), (0, 0), (0, 0))
