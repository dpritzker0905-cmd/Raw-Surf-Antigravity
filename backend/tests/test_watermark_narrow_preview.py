"""Exercise gallery preview dimensions and logo placement after JPEG encoding."""
import io

import httpx
import pytest
from PIL import Image

from services import watermark


@pytest.mark.asyncio
@pytest.mark.parametrize("from_url", [True, False], ids=["url", "bytes"])
@pytest.mark.parametrize(("source_size", "output_size"), [
    ((2400, 2), (1080, 1)),
    ((2, 2400), (1, 1080)),
    ((1620, 1081), (1080, 720)),
    ((100, 75), (100, 75)),
    ((1, 1), (1, 1)),
])
async def test_logo_survives_preview_resize(monkeypatch, from_url, source_size, output_size):
    photo = io.BytesIO()
    Image.new("RGB", source_size, "black").save(photo, "JPEG")

    async def get_logo(url):
        return Image.new("RGBA", (20, 20), "white")

    monkeypatch.setattr(watermark, "get_custom_logo", get_logo)
    options = dict(custom_logo_url="https://example.test/logo.png",
                   watermark_style="bottom-right", opacity=1)
    if from_url:
        transport = httpx.MockTransport(lambda request: httpx.Response(200, content=photo.getvalue()))
        client = httpx.AsyncClient(transport=transport)
        monkeypatch.setattr(watermark.httpx, "AsyncClient", lambda **kwargs: client)
        result = await watermark.generate_watermarked_preview("https://example.test/photo.jpg", **options)
    else:
        result = await watermark.generate_watermarked_preview_from_bytes(photo.getvalue(), **options)

    assert result is not None
    with Image.open(io.BytesIO(result)) as preview:
        assert preview.format == "JPEG"
        assert preview.size == output_size
        width, height = output_size
        margin = int(min(output_size) * 0.05)
        white = preview.convert("L").point(lambda value: 255 if value > 128 else 0)
        assert white.getpixel((width - margin - 1, height - margin - 1)) == 255
        if output_size != (1, 1):
            assert white.getpixel((0, 0)) == 0
