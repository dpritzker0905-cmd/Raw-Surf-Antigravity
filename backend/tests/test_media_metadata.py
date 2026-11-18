"""T1 P3: a photo stored in the PUBLIC conditions bucket carries no GPS or other embedded metadata, losslessly; the
server keeps its own facts (from the original bytes) privately."""
import io
import struct

import httpx
import piexif
import pytest
import pytest_asyncio
from fastapi import FastAPI
from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import get_db
from models import ObservationMedia, Profile, RoleEnum
from routes.uploads import core as upload_core
from services.media_metadata import MetadataError, strip_image_metadata, strip_jpeg, strip_png, strip_webp

GPS = {piexif.GPSIFD.GPSLatitudeRef: b"N", piexif.GPSIFD.GPSLatitude: ((21, 1), (39, 1), (54, 1)),
       piexif.GPSIFD.GPSLongitudeRef: b"W", piexif.GPSIFD.GPSLongitude: ((158, 1), (3, 1), (0, 1))}


def _exif(orientation=6):
    return piexif.dump({"0th": {piexif.ImageIFD.Orientation: orientation, piexif.ImageIFD.Make: b"PhoneCo",
                                piexif.ImageIFD.BodySerialNumber if hasattr(piexif.ImageIFD, "BodySerialNumber")
                                else piexif.ImageIFD.Model: b"SERIAL-123"},
                        "Exif": {piexif.ExifIFD.DateTimeOriginal: b"2026:11:18 07:30:00"}, "GPS": GPS})


def _jpeg(orientation=6, comment=True):
    buf = io.BytesIO()
    Image.new("RGB", (32, 16), (200, 30, 30)).save(buf, "JPEG", exif=_exif(orientation), quality=90)
    data = buf.getvalue()
    if comment:   # a COM segment right after SOI
        text = b"shot at the pier"
        data = data[:2] + b"\xff\xfe" + struct.pack(">H", len(text) + 2) + text + data[2:]
    return data


def _pixels(data):
    with Image.open(io.BytesIO(data)) as im:
        return im.convert("RGB").tobytes()


def test_jpeg_loses_gps_and_comments_keeps_orientation_and_pixels():
    original = _jpeg()
    assert piexif.load(original)["GPS"]                      # the fixture really is geotagged
    stripped = strip_jpeg(original)
    exif = piexif.load(stripped)
    assert exif["GPS"] == {} and exif["Exif"] == {}
    assert exif["0th"] == {piexif.ImageIFD.Orientation: 6}   # only the orientation survives
    assert b"shot at the pier" not in stripped and b"PhoneCo" not in stripped and b"SERIAL-123" not in stripped
    assert _pixels(stripped) == _pixels(original)             # lossless: the scan data is copied as is


def test_jpeg_with_upright_orientation_gets_no_exif_back():
    stripped = strip_jpeg(_jpeg(orientation=1))
    assert b"Exif\x00\x00" not in stripped


def test_png_text_and_exif_chunks_are_dropped():
    buf = io.BytesIO()
    from PIL import PngImagePlugin
    info = PngImagePlugin.PngInfo()
    info.add_text("Location", "21.665,-158.05")
    Image.new("RGB", (8, 8), (1, 2, 3)).save(buf, "PNG", pnginfo=info, exif=_exif(1))
    original = buf.getvalue()
    assert b"tEXt" in original and b"eXIf" in original
    stripped = strip_png(original)
    assert b"tEXt" not in stripped and b"eXIf" not in stripped and b"21.665" not in stripped
    assert _pixels(stripped) == _pixels(original)


def test_webp_exif_chunk_and_flag_are_removed():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (9, 9, 9)).save(buf, "WEBP", exif=_exif(1), lossless=True)
    original = buf.getvalue()
    assert b"EXIF" in original
    stripped = strip_webp(original)
    assert b"EXIF" not in stripped and b"PhoneCo" not in stripped
    assert struct.unpack("<I", stripped[4:8])[0] == len(stripped) - 8      # RIFF size corrected
    assert _pixels(stripped) == _pixels(original)


def test_unsupported_types_are_reported_unstripped_and_malformed_ones_refused():
    assert strip_image_metadata(b"GIF89a....", "image/gif") == (b"GIF89a....", False)
    assert strip_image_metadata(b"....ftypheic", "image/heic")[1] is False
    with pytest.raises(MetadataError):
        strip_image_metadata(b"\xff\xd8\x00garbage", "image/jpeg")


@pytest_asyncio.fixture
async def harness(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'm.sqlite'}")
    async with engine.begin() as conn:
        for model in (Profile, ObservationMedia):
            await conn.run_sync(lambda c, t=model.__table__: t.create(c))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(Profile(id="pro", user_id="pro", email="pro@example.invalid", username="pro", full_name="Pro",
                       role=RoleEnum.PHOTOGRAPHER))
        await db.commit()
    stored = {}

    def record(local_path, bucket, key, content_type="image/jpeg"):
        stored[key] = open(local_path, "rb").read()
        return f"https://cdn.fixture.invalid/{bucket}/{key}"
    monkeypatch.setattr(upload_core, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(upload_core, "upload_to_supabase_storage", record)
    app = FastAPI()
    app.include_router(upload_core.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db
    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
        yield client, stored, maker
    await engine.dispose()


async def test_the_public_copy_has_no_gps_and_the_server_keeps_its_own_record(harness):
    client, stored, maker = harness
    headers = {"Authorization": "Bearer " + create_access_token({"sub": "pro"})}
    r = await client.post("/api/upload/conditions", headers=headers,
                          files={"file": ("pier.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    assert r.json()["metadata_stripped"] is True
    (public_bytes,) = stored.values()
    assert piexif.load(public_bytes)["GPS"] == {}
    async with maker() as db:
        (rec,) = (await db.execute(select(ObservationMedia))).scalars().all()
    assert rec.exif_latitude == pytest.approx(21.665, abs=1e-3)      # read from the ORIGINAL, kept private
    assert rec.exif_longitude == pytest.approx(-158.05, abs=1e-3)
    bad = await client.post("/api/upload/conditions", headers=headers,
                            files={"file": ("x.jpg", b"\xff\xd8\x00garbage", "image/jpeg")})
    assert bad.status_code == 400
