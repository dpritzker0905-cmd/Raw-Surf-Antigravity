"""Gallery previews use the same orientation as the photographer's original."""
import io

import httpx
import pytest
from PIL import Image

from services import watermark


@pytest.mark.asyncio
@pytest.mark.parametrize(("orientation", "size", "red_first"), [
    (6, (120, 240), True),   # 90 degrees clockwise
    (8, (120, 240), False),  # 90 degrees counterclockwise
    (2, (240, 120), False),  # horizontal mirror
    (None, (240, 120), True),
])
async def test_preview_orients_photo_before_drawing(monkeypatch, orientation, size, red_first):
    source = Image.new("RGB", (480, 240), "blue")
    source.paste("red", (0, 0, 240, 240))
    exif = source.getexif()
    if orientation is not None:
        exif[274] = orientation
    original = io.BytesIO()
    source.save(original, "JPEG", exif=exif)

    transport = httpx.MockTransport(lambda request: httpx.Response(200, content=original.getvalue()))
    client = httpx.AsyncClient(transport=transport)
    monkeypatch.setattr(watermark.httpx, "AsyncClient", lambda **kwargs: client)
    jpeg = await watermark.generate_watermarked_preview(
        "https://example.test/photo.jpg", max_dimension=240, watermark_text="TEST",
        watermark_style="bottom-right", opacity=1,
    )
    with Image.open(io.BytesIO(jpeg)) as preview:
        assert preview.size == size
        assert preview.getexif().get(274, 1) == 1
        w, h = size
        for point, expect_red in [((w // 4, h // 4), red_first), ((3 * w // 4, 3 * h // 4), not red_first)]:
            r, _, b = preview.getpixel(point)
            assert (r > b) == expect_red
        # The source has no green. Bright green-channel pixels locate the white lettering.
        letters = preview.getchannel("G").point(lambda value: 255 if value > 120 else 0).getbbox()
        assert letters is not None
        assert 0 <= w - letters[2] <= w // 10
        assert 0 <= h - letters[3] <= h // 10
