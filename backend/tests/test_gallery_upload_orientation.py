"""Stored watermarked previews follow the uploaded JPEG's display orientation."""
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from routes.uploads import core


@pytest.mark.parametrize(("orientation", "raw_size", "display_size", "red_first"), [
    (6, (320, 160), (160, 320), True),      # clockwise
    (8, (320, 160), (160, 320), False),     # counterclockwise
    (2, (320, 160), (320, 160), False),     # horizontal reflection
    (6, (4608, 288), (256, 4096), True),    # also exercises the upload size cap
    (None, (320, 160), (320, 160), True),
])
def test_upload_stores_upright_preview(monkeypatch, tmp_path, orientation, raw_size, display_size, red_first):
    source = Image.new("RGB", raw_size, "blue")
    source.paste("red", (0, 0, source.width // 2, source.height))
    exif = source.getexif()
    if orientation is not None:
        exif[274] = orientation
    data = io.BytesIO()
    source.save(data, "JPEG", exif=exif)

    app = FastAPI()
    app.include_router(core.router, prefix="/api")
    app.dependency_overrides[core.uploader_id] = lambda: "photographer"
    monkeypatch.setattr(core, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(core, "upload_to_supabase_storage", lambda *args, **kwargs: None)
    with TestClient(app) as client:
        upload = client.post("/api/upload/gallery", files={"file": ("photo.jpg", data.getvalue(), "image/jpeg")})
        assert upload.status_code == 200
        urls = upload.json()
        assert client.get(urls["original_url"]).content == data.getvalue()
        response = client.get(urls["preview_url"])
        assert response.status_code == 200

    with Image.open(io.BytesIO(response.content)) as preview:
        assert preview.format == "JPEG"
        assert preview.size == display_size
        assert preview.getexif().get(274, 1) == 1
        w, h = display_size
        for point, expected in [((w // 4, h // 4), red_first), ((3 * w // 4, 3 * h // 4), not red_first)]:
            red, _, blue = preview.getpixel(point)
            assert (red > blue) == expected
        # White tiled lettering starts at (40, 40) on a source with no green.
        lettering = preview.crop((40, 40, 125, 75)).getchannel("G")
        assert lettering.getextrema()[1] > 12
