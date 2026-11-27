import io

import httpx
import pytest
from PIL import Image

from services import watermark


def png(color):
    output = io.BytesIO()
    Image.new('RGB', (100, 100), color).save(output, format='PNG')
    return output.getvalue()


@pytest.mark.asyncio
async def test_repeated_custom_logo_preview_returns_same_jpeg(monkeypatch):
    logo_url = 'https://fixture.invalid/logo.png'
    photo_url = 'https://fixture.invalid/photo.png'
    images = {logo_url: png('red'), photo_url: png('white')}
    requests = []

    async def get(client, url):
        requests.append(url)
        return httpx.Response(200, content=images[url], request=httpx.Request('GET', url))

    monkeypatch.setattr(watermark, '_watermark_logo_cache', {})
    monkeypatch.setattr(httpx.AsyncClient, 'get', get)
    first = await watermark.generate_watermarked_preview(photo_url, custom_logo_url=logo_url)
    second = await watermark.generate_watermarked_preview(photo_url, custom_logo_url=logo_url)

    with Image.open(io.BytesIO(first)) as image:
        assert image.format == 'JPEG'
        red, green, blue = image.getpixel((50, 50))
        assert red > green and red > blue
    assert second == first
    assert requests.count(logo_url) == 1


@pytest.mark.asyncio
async def test_invalid_download_can_be_retried_at_the_same_url(monkeypatch):
    logo = Image.new('P', (2, 1))
    logo.putpalette([0, 0, 0, 255, 0, 0])
    logo.putpixel((1, 0), 1)
    output = io.BytesIO()
    logo.save(output, format='PNG', transparency=0)
    responses = iter([b'invalid image', output.getvalue()])

    async def get(client, url):
        return httpx.Response(200, content=next(responses), request=httpx.Request('GET', url))

    monkeypatch.setattr(watermark, '_watermark_logo_cache', {})
    monkeypatch.setattr(httpx.AsyncClient, 'get', get)
    url = 'https://fixture.invalid/logo.png'
    assert await watermark.get_custom_logo(url) is None
    recovered = await watermark.get_custom_logo(url)
    cached = await watermark.get_custom_logo(url)
    for image in (recovered, cached):
        assert image.getpixel((0, 0))[3] == 0
        assert image.getpixel((1, 0)) == (255, 0, 0, 255)
