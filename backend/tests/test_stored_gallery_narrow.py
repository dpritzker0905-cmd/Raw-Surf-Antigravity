"""Stored gallery previews fit narrow photos and tile a visible label."""
import io
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from routes.uploads import core


@pytest.mark.parametrize("size", [(9000, 2), (2, 9000), (960, 32), (32, 960), (640, 320)])
def test_stored_preview_on_narrow_photo(tmp_path, monkeypatch, size):
    data = io.BytesIO()
    source = Image.new("RGB", size, (140, 0, 0))
    w, h = size
    second_half = (w // 2, 0, w, h) if w >= h else (0, h // 2, w, h)
    source.paste((0, 0, 140), second_half)
    source.save(data, "JPEG")
    original = data.getvalue()
    private_store = AsyncMock(return_value="private-test-reference")
    monkeypatch.setattr(core, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(core, "upload_private_media", private_store)
    monkeypatch.setattr(core, "upload_to_supabase_storage", lambda *args, **kwargs: None)
    app = FastAPI()
    app.include_router(core.router, prefix="/api")
    app.dependency_overrides[core.uploader_id] = lambda: "photographer"
    with TestClient(app) as client:
        response = client.post("/api/upload/gallery", files={"file": ("strip.jpg", original, "image/jpeg")})
        assert response.status_code == 200
        preview = client.get(response.json()["preview_url"])
        assert preview.status_code == 200
    assert private_store.await_args.kwargs["content"] == original
    with Image.open(io.BytesIO(preview.content)) as photo:
        assert photo.format == "JPEG"
        if size[0] < size[1]:
            photo = photo.transpose(Image.Transpose.ROTATE_90)
        assert photo.width == min(max(size), 4096)
        if min(size) == 2:
            assert 6 <= photo.height < 32  # room for actual lettering around the single-pixel photo
        else:
            assert photo.height == min(size)
        # Both colors must survive along the photo itself. Green isolates the white lettering.
        if min(size) == 2:
            mid = max(range(photo.height), key=lambda y: photo.getpixel((0, y))[0])
        else:
            mid = photo.height // 2 if min(size) == 32 else 50
        red, _, blue = photo.getpixel((0, mid))
        assert red > blue + 20
        red, _, blue = photo.getpixel((photo.width - 1, mid))
        assert blue > red + 20
        for start in (0, photo.width // 2):
            band = photo.crop((start, mid - 1, start + photo.width // 2, mid + 2)).getchannel("G")
            assert band.getextrema()[1] > 12
