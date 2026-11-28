"""Transparent source pixels must composite correctly in gallery watermark previews."""
import io

import httpx
import pytest
from PIL import Image

from routes.uploads.core import add_watermark
from services import watermark


@pytest.fixture(params=["RGBA", "P"])
def source_png(request):
    if request.param == "RGBA":
        source = Image.new("RGBA", (192, 144), (255, 0, 255, 0))
        source.paste((0, 200, 0, 128), (64, 0, 128, 144))
        source.paste((0, 0, 200, 255), (128, 0, 192, 144))
    else:
        source = Image.new("P", (192, 144), 0)
        source.putpalette([255, 0, 255, 0, 200, 0, 0, 0, 200])
        source.info["transparency"] = bytes([0, 128, 255])
        source.paste(1, (64, 0, 128, 144))
        source.paste(2, (128, 0, 192, 144))
    stream = io.BytesIO()
    source.save(stream, "PNG")
    return stream.getvalue()


def check_jpeg(preview):
    assert preview.format == "JPEG"
    for x, expected in [(32, (0, 0, 0)), (96, (0, 100, 0)), (160, (0, 0, 200))]:
        assert preview.getpixel((x, 128)) == pytest.approx(expected, abs=4)
    # The source contributes no red on the black matte. The half-opacity white
    # lettering should remain visible without becoming opaque over transparent pixels.
    peak_red = preview.getchannel("R").getextrema()[1]
    assert 40 < peak_red < 165


@pytest.mark.asyncio
async def test_gallery_preview_flattens_transparency(monkeypatch, source_png):
    client = httpx.AsyncClient(transport=httpx.MockTransport(
        lambda request: httpx.Response(200, content=source_png)
    ))
    monkeypatch.setattr(watermark.httpx, "AsyncClient", lambda **kwargs: client)
    jpeg = await watermark.generate_watermarked_preview(
        "https://example.test/gallery.png", watermark_text="TEST", watermark_style="top-left",
    )
    with Image.open(io.BytesIO(jpeg)) as preview:
        check_jpeg(preview)


@pytest.mark.parametrize("extension", ["jpg", "png"])
def test_uploaded_watermarked_preview_respects_output_format(tmp_path, source_png, extension):
    source = tmp_path / "source.png"
    source.write_bytes(source_png)
    output = tmp_path / f"preview.{extension}"
    add_watermark(str(source), str(output), text="TEST", position="top-left", opacity=0.5)
    with Image.open(output) as preview:
        if extension == "jpg":
            check_jpeg(preview)
        else:
            assert preview.mode == "RGBA"
            assert [preview.getpixel((x, 8))[3] for x in (32, 96, 160)] == [0, 128, 255]
