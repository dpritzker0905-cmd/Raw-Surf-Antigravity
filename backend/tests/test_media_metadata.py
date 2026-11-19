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
    with pytest.raises(MetadataError):                 # HEIC is handled now (services/heic_metadata): bogus bytes are refused
        strip_image_metadata(b"....ftypheic", "image/heic")
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


# ── videos (MP4 / MOV), patched in place by services/video_metadata ───────────────────────────────────────────────
def _box(btype, payload):
    return struct.pack(">I4s", 8 + len(payload), btype) + payload


def _mov(media=b"MEDIA-SAMPLES" * 50):
    xyz = struct.pack(">HH", 18, 0x15C7) + b"+21.6650-158.0500/"
    udta = _box(b"udta", _box(b"\xa9xyz", xyz) + _box(b"\xa9mak", b"\x00\x07\x00\x00PhoneCo"))
    meta = _box(b"meta", _box(b"keys", b"com.apple.quicktime.creationdate")
                + _box(b"ilst", b"2026-11-18T07:30:00-1000"))
    trak = _box(b"trak", _box(b"tkhd", b"\x00" * 84) + meta)
    moov = _box(b"moov", _box(b"mvhd", b"\x00" * 100) + udta + trak)
    return _box(b"ftyp", b"qt  \x00\x00\x00\x00qt  ") + moov + _box(b"mdat", media)


def test_video_location_is_read_then_neutered_in_place_losslessly(tmp_path):
    from services.video_metadata import strip_video_in_place
    original = _mov()
    path = tmp_path / "v.mov"
    path.write_bytes(original)
    facts = strip_video_in_place(path)
    patched = path.read_bytes()
    assert facts.stripped and facts.neutered == 2
    assert (facts.latitude, facts.longitude) == (pytest.approx(21.665), pytest.approx(-158.05))
    assert facts.taken_at.isoformat() == "2026-11-18T07:30:00-10:00"
    assert len(patched) == len(original)                                   # no offset can move
    assert patched.endswith(_box(b"mdat", b"MEDIA-SAMPLES" * 50))           # media untouched
    for gone in (b"21.6650", b"PhoneCo", b"2026-11-18", b"udta", b"\xa9xyz"):
        assert gone not in patched
    assert patched.count(b"free") == 2


def test_non_isobmff_video_is_left_alone_and_a_malformed_mov_is_refused_without_a_file(tmp_path):
    from services.media_metadata import write_public_copy
    webm = b"\x1a\x45\xdf\xa3" + b"\x00" * 64
    copy = write_public_copy(webm, "video/webm", True, tmp_path / "a.webm")
    assert copy.stripped is False and (tmp_path / "a.webm").read_bytes() == webm
    broken = _box(b"ftyp", b"qt  ") + struct.pack(">I4s", 9999, b"moov") + b"\x00" * 10
    with pytest.raises(MetadataError):
        write_public_copy(broken, "video/quicktime", True, tmp_path / "b.mov")
    assert not (tmp_path / "b.mov").exists()


async def test_a_go_live_video_keeps_its_location_privately_and_not_publicly(harness):
    client, stored, maker = harness
    headers = {"Authorization": "Bearer " + create_access_token({"sub": "pro"})}
    r = await client.post("/api/upload/conditions", headers=headers,
                          files={"file": ("clip.mov", _mov(), "video/quicktime")})
    assert r.status_code == 200, r.text
    assert r.json()["metadata_stripped"] is True and r.json()["media_type"] == "video"
    (public_bytes,) = stored.values()
    assert b"21.6650" not in public_bytes and len(public_bytes) == len(_mov())
    async with maker() as db:
        (rec,) = (await db.execute(select(ObservationMedia))).scalars().all()
    assert (rec.exif_latitude, rec.exif_longitude) == (pytest.approx(21.665), pytest.approx(-158.05))
    assert rec.exif_taken_at is not None


# ── social uploads (T1 P3 part 7): general, story, feed, comment, user gallery store into PUBLIC buckets ──────────────
def test_an_odd_but_decodable_jpeg_is_re_encoded_clean_not_refused():
    from services.media_metadata import public_image_bytes
    good = _jpeg(comment=False)
    seg = struct.unpack(">H", good[4:6])[0]
    odd = good[:4 + seg] + b"\x00\x00" + good[4 + seg:]          # stray bytes between segments
    with pytest.raises(MetadataError):
        strip_jpeg(odd)                                            # the lossless walk refuses it
    out, stripped = public_image_bytes(odd, "image/jpeg")
    assert stripped and piexif.load(out)["GPS"] == {} and b"PhoneCo" not in out
    with Image.open(io.BytesIO(out)) as im:
        assert im.size == (16, 32)                                 # orientation 6 applied, so it still shows upright


@pytest_asyncio.fixture
async def social(tmp_path, monkeypatch):
    from routes.uploads import comments as upload_comments, media as upload_media, media_gallery as upload_gallery
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 's.sqlite'}")
    async with engine.begin() as conn:
        await conn.run_sync(lambda c: Profile.__table__.create(c))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(Profile(id="u1", user_id="u1", email="u1@example.invalid", username="u1", full_name="U One",
                       role=RoleEnum.SURFER))
        await db.commit()
    stored = {}

    def record(local_path, bucket, key, content_type="image/jpeg"):
        stored[f"{bucket}/{key}"] = open(local_path, "rb").read()
        return f"https://cdn.fixture.invalid/{bucket}/{key}"

    def no_transcode(path, *a, **k):          # ffmpeg is not here: every video takes the kept-raw path
        return False, "no ffmpeg in tests", None
    for mod in (upload_core, upload_media, upload_comments, upload_gallery):
        monkeypatch.setattr(mod, "UPLOAD_DIR", tmp_path / "uploads")
        monkeypatch.setattr(mod, "upload_to_supabase_storage", record)
        if hasattr(mod, "SUPABASE_STORAGE_AVAILABLE"):
            monkeypatch.setattr(mod, "SUPABASE_STORAGE_AVAILABLE", True)
        for name in ("process_video_from_path", "process_video_upload"):
            if hasattr(mod, name):
                monkeypatch.setattr(mod, name, no_transcode)
        if hasattr(mod, "generate_video_thumbnail"):
            monkeypatch.setattr(mod, "generate_video_thumbnail", lambda *a, **k: (False, None))
        if hasattr(mod, "get_video_info"):
            monkeypatch.setattr(mod, "get_video_info", lambda *a, **k: None)
    (tmp_path / "uploads").mkdir()
    app = FastAPI()
    for mod in (upload_core, upload_media, upload_comments):
        app.include_router(mod.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db
    app.dependency_overrides[get_db] = dependency
    headers = {"Authorization": "Bearer " + create_access_token({"sub": "u1"})}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid",
                                 headers=headers) as client:
        yield client, stored
    await engine.dispose()


@pytest.mark.parametrize("route", ["/api/upload", "/api/upload/story", "/api/upload/feed", "/api/upload/comment"])
async def test_social_photo_uploads_publish_no_gps(social, route):
    client, stored = social
    r = await client.post(route, files={"file": ("beach.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    (public_bytes,) = stored.values()
    assert piexif.load(public_bytes)["GPS"] == {} and b"shot at the pier" not in public_bytes
    assert r.json()["size"] == len(public_bytes)
    assert (await client.post(route, files={"file": ("x.jpg", b"\xff\xd8\x00garbage", "image/jpeg")})).status_code == 400


@pytest.mark.parametrize("route", ["/api/upload/story", "/api/upload/feed", "/api/upload/comment", "/api/upload/wave"])
async def test_social_video_uploads_publish_no_location(social, route):
    client, stored = social
    r = await client.post(route, files={"file": ("clip.mov", _mov(), "video/quicktime")})
    assert r.status_code == 200, r.text
    (public_bytes,) = stored.values()
    assert b"21.6650" not in public_bytes and b"PhoneCo" not in public_bytes and len(public_bytes) == len(_mov())


async def test_user_gallery_photo_publishes_no_gps(social, tmp_path):
    from routes.uploads import media_gallery as upload_gallery
    client, stored = social
    app = client._transport.app
    app.include_router(upload_gallery.router, prefix="/api")
    r = await client.post("/api/upload/user-gallery", files={"file": ("g.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    (public_bytes,) = stored.values()
    assert piexif.load(public_bytes)["GPS"] == {} and r.json()["size"] == len(public_bytes)

def test_a_file_of_many_tiny_boxes_is_refused_without_building_a_huge_list(tmp_path):
    from services.media_metadata import write_public_copy
    from services.video_metadata import MAX_BOXES
    flood = _box(b"ftyp", b"qt  ") + _box(b"moov", b"".join(_box(b"free", b"") for _ in range(MAX_BOXES + 10)))
    with pytest.raises(MetadataError):
        write_public_copy(flood, "video/quicktime", True, tmp_path / "flood.mov")
    assert not (tmp_path / "flood.mov").exists()
    ok = write_public_copy(_mov(), "video/quicktime", True, tmp_path / "ok.mov")   # a real-shaped file is well inside
    assert ok.stripped and ok.latitude == pytest.approx(21.665)


def test_any_failure_while_stripping_a_video_leaves_no_file(tmp_path, monkeypatch):
    from services import media_metadata, video_metadata

    def boom(path):
        raise RuntimeError("unexpected")
    monkeypatch.setattr(video_metadata, "strip_video_in_place", boom)
    with pytest.raises(RuntimeError):
        media_metadata.write_public_copy(_mov(), "video/quicktime", True, tmp_path / "c.mov")
    assert not (tmp_path / "c.mov").exists()

def test_a_truncated_jpeg_is_a_metadata_error_not_a_crash():
    with pytest.raises(MetadataError):          # was IndexError, which the routes answered with a 500
        strip_image_metadata(b"\xff\xd8\xff", "image/jpeg")
    with pytest.raises(MetadataError):
        strip_image_metadata(_jpeg()[:2] + b"\xff", "image/jpeg")

def _huge_header_jpeg(side=13_000):
    """A tiny JPEG whose SOF header CLAIMS side x side pixels: Image.open reports that size without decoding, which
    is exactly the case the cap must stop (a decompression bomb small on disk)."""
    data = bytearray(_jpeg(comment=False))
    sof = data.index(b"\xff\xc0")
    struct.pack_into(">HH", data, sof + 5, side, side)
    seg = struct.unpack(">H", data[4:6])[0]
    return bytes(data[:4 + seg]) + b"\x00\x00" + bytes(data[4 + seg:])   # stray bytes: the lossless walk refuses it


def test_the_re_encode_fallback_refuses_a_decompression_bomb_before_decoding():
    from services import media_metadata as mm
    bomb = _huge_header_jpeg()
    with Image.open(io.BytesIO(bomb)) as im:
        assert im.size == (13_000, 13_000) and 13_000 * 13_000 > mm.MAX_DECODE_PIXELS
    before = mm.REENCODE_COUNT
    with pytest.raises(MetadataError, match="too large"):
        mm.public_image_bytes(bomb, "image/jpeg")
    assert mm.REENCODE_COUNT == before                     # refused, not counted as a re-encode
    mm.public_image_bytes(_odd_ok(), "image/jpeg")
    assert mm.REENCODE_COUNT == before + 1                 # a normal odd file is re-encoded and counted


def _odd_ok():
    good = _jpeg(comment=False)
    seg = struct.unpack(">H", good[4:6])[0]
    return good[:4 + seg] + b"\x00\x00" + good[4 + seg:]


async def test_an_avatar_bomb_is_refused_and_a_normal_avatar_has_no_gps(social):
    client, stored = social
    r = await client.post("/api/upload/avatar", files={"file": ("me.jpg", _huge_header_jpeg(), "image/jpeg")})
    assert r.status_code == 400 and not stored
    r = await client.post("/api/upload/avatar", files={"file": ("me.jpg", _jpeg(), "image/jpeg")})
    assert r.status_code == 200, r.text
    (public_bytes,) = stored.values()
    assert b"GPS" not in public_bytes and piexif.load(public_bytes)["GPS"] == {}

# ── HEIC (T1 P3): the server cannot decode it, so its Exif/XMP items are blanked in place ────────────────────────────
def _heic(exif_tiff=None, xmp=b'<x:xmpmeta xmlns:x="adobe:ns:meta/">Location 21.665</x:xmpmeta>', image=b"HEVC" * 64,
          bad_offset=False):
    def box(t, p):
        return struct.pack(">I4s", 8 + len(p), t) + p

    def full(t, v, p):
        return box(t, bytes([v, 0, 0, 0]) + p)
    exif_tiff = exif_tiff if exif_tiff is not None else piexif.dump({"GPS": GPS, "0th": {piexif.ImageIFD.Make: b"PhoneCo"}})[6:]
    exif_item = struct.pack(">I", 0) + exif_tiff
    hdlr = full(b"hdlr", 0, b"\x00" * 4 + b"pict" + b"\x00" * 12 + b"\x00")
    infe = (full(b"infe", 2, struct.pack(">HH4s", 1, 0, b"Exif") + b"\x00")
            + full(b"infe", 2, struct.pack(">HH4s", 2, 0, b"mime") + b"\x00application/rdf+xml\x00")
            + full(b"infe", 2, struct.pack(">HH4s", 3, 0, b"hvc1") + b"\x00"))
    iinf = full(b"iinf", 0, struct.pack(">H", 3) + infe)

    def build(offsets):
        entries = b"".join(struct.pack(">HHHII", i, 0, 1, off, n) for i, (off, n) in offsets.items())
        iloc = full(b"iloc", 0, bytes([0x44, 0x00]) + struct.pack(">H", len(offsets)) + entries)
        meta = full(b"meta", 0, hdlr + iinf + iloc)
        ftyp = box(b"ftyp", b"heic\x00\x00\x00\x00mif1heic")
        return ftyp, meta
    sizes = {1: len(exif_item), 2: len(xmp), 3: len(image)}
    ftyp, meta = build({k: (0, n) for k, n in sizes.items()})
    start = len(ftyp) + len(meta) + 8
    offsets, pos = {}, start
    for k, n in sizes.items():
        offsets[k] = (pos + (10_000 if bad_offset and k == 1 else 0), n)
        pos += n
    ftyp, meta = build(offsets)
    return ftyp + meta + box(b"mdat", exif_item + xmp + image)


def test_heic_gps_is_read_privately_then_blanked_losslessly():
    from services.heic_metadata import extract_heif_exif, strip_heif
    from services.observation_media import inspect_media
    original = _heic()
    facts = inspect_media(original, is_image=True)                  # Pillow cannot open HEIC here: the Exif item is read
    assert (facts.exif_latitude, facts.exif_longitude) == (pytest.approx(21.665, abs=1e-3), pytest.approx(-158.05, abs=1e-3))
    stripped, ok = strip_image_metadata(original, "image/heic")
    assert ok and len(stripped) == len(original) and stripped.endswith(b"HEVC" * 64)   # image bytes untouched
    assert b"PhoneCo" not in stripped and b"21.665" not in stripped
    assert piexif.load(extract_heif_exif(stripped))["GPS"] == {}   # a valid, EMPTY Exif block remains
    assert strip_heif(stripped) == stripped                          # idempotent


def test_a_malformed_heic_is_refused_not_published():
    from services.heic_metadata import strip_heif
    with pytest.raises(MetadataError):
        strip_heif(_heic(bad_offset=True))                           # the Exif item points outside the file
    with pytest.raises(MetadataError):
        strip_image_metadata(_heic()[:60], "image/heic")             # truncated


def test_a_heic_whose_iloc_claims_millions_of_zero_width_extents_is_refused_quickly():
    """Advisor hold on #1054: 4,096 items x 4,096 extents with zero-width offset/length fields used to build ~16.7
    million tuples from a ~25 KB file. One extent budget for the whole file now refuses it at once."""
    import time
    from services.heic_metadata import MAX_EXTENTS, strip_heif

    def box(t, p):
        return struct.pack(">I4s", 8 + len(p), t) + p

    def full(t, v, p):
        return box(t, bytes([v, 0, 0, 0]) + p)
    iinf = full(b"iinf", 0, struct.pack(">H", 1) + full(b"infe", 2, struct.pack(">HH4s", 1, 0, b"Exif") + b"\x00"))
    entries = b"".join(struct.pack(">HHH", i, 0, 4096) for i in range(1, 4097))    # no offset/length bytes at all
    iloc = full(b"iloc", 0, bytes([0x00, 0x00]) + struct.pack(">H", 4096) + entries)
    crafted = box(b"ftyp", b"heic\x00\x00\x00\x00mif1heic") + full(b"meta", 0, iinf + iloc)
    assert len(crafted) < 30_000 and 4096 * 4096 > MAX_EXTENTS
    t0 = time.perf_counter()
    with pytest.raises(MetadataError, match="extents"):
        strip_heif(crafted)
    assert time.perf_counter() - t0 < 1.0


async def test_a_heic_feed_photo_is_published_without_gps(social):
    client, stored = social
    r = await client.post("/api/upload/feed", files={"file": ("IMG_0001.HEIC", _heic(), "image/heic")})
    assert r.status_code == 200, r.text
    (public_bytes,) = stored.values()
    assert b"PhoneCo" not in public_bytes and b"21.665" not in public_bytes and public_bytes.endswith(b"HEVC" * 64)
