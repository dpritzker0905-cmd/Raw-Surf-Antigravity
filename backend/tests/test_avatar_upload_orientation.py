"""Camera-tagged avatars must display upright after the public JPEG drops EXIF."""
import io

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from routes.uploads import core


@pytest.mark.parametrize(("orientation", "corners"), [
    (None, "ABCD"), (1, "ABCD"), (2, "BADC"), (3, "DCBA"), (4, "CDAB"),
    (5, "ACBD"), (6, "CADB"), (7, "DBCA"), (8, "BDAC"),
])
@pytest.mark.parametrize(("width", "output_width"), [(800, 500), (320, 320)])
def test_uploaded_avatar_display_orientation(monkeypatch, tmp_path, orientation, corners, width, output_width):
    colors = {"A": (240, 0, 0), "B": (0, 240, 0), "C": (0, 0, 240), "D": (240, 240, 0)}
    source = Image.new("RGB", (width, width // 2))
    hw, hh = source.width // 2, source.height // 2
    for label, (left, top) in zip("ABCD", [(0, 0), (hw, 0), (0, hh), (hw, hh)]):
        source.paste(colors[label], (left, top, left + hw, top + hh))
    exif = source.getexif()
    exif[315] = "Synthetic photographer"
    if orientation is not None:
        exif[274] = orientation
    data = io.BytesIO()
    source.save(data, "JPEG", exif=exif)

    app = FastAPI()
    app.include_router(core.router, prefix="/api")
    app.dependency_overrides[core.uploader_id] = lambda: "avatar-test"
    monkeypatch.setattr(core, "UPLOAD_DIR", tmp_path)
    monkeypatch.setattr(core, "upload_to_supabase_storage", lambda *args, **kwargs: None)
    with TestClient(app) as client:
        upload = client.post("/api/upload/avatar", files={"file": ("photo.jpg", data.getvalue(), "image/jpeg")})
        assert upload.status_code == 200
        response = client.get(upload.json()["avatar_url"])
        assert response.status_code == 200

    with Image.open(io.BytesIO(response.content)) as avatar:
        assert avatar.format == "JPEG"
        assert not avatar.getexif()
        expected_size = (output_width, output_width // 2)
        assert avatar.size == (expected_size[::-1] if orientation in (5, 6, 7, 8) else expected_size)
        w, h = avatar.size
        for label, (x, y) in zip(corners, [(1, 1), (3, 1), (1, 3), (3, 3)]):
            assert avatar.getpixel((w * x // 4, h * y // 4)) == pytest.approx(colors[label], abs=4)
