"""The read-only GPS census of files already in the public buckets: classification from a file's first bytes, and the
census loop never writes and never prints object names."""
import io
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

import public_media_gps_census as census_mod  # noqa: E402
from services.media_metadata import strip_image_metadata  # noqa: E402
from tests.test_media_metadata import _box, _heic, _jpeg, _mov  # noqa: E402


def test_photos_with_and_without_gps():
    assert census_mod.classify(_jpeg(), "a.jpg") == census_mod.GPS
    assert census_mod.classify(strip_image_metadata(_jpeg(), "image/jpeg")[0], "a.jpg") == census_mod.CLEAN
    assert census_mod.classify(_heic(), "IMG.HEIC") == census_mod.GPS
    assert census_mod.classify(strip_image_metadata(_heic(), "image/heic")[0], "IMG.HEIC") == census_mod.CLEAN


def test_videos_with_gps_without_and_undecidable_from_the_head():
    assert census_mod.classify(_mov(), "clip.mov") == census_mod.GPS
    clean = _box(b"ftyp", b"qt  \x00\x00\x00\x00qt  ") + _box(b"moov", _box(b"mvhd", b"\x00" * 100)) + _box(b"mdat", b"x" * 50)
    assert census_mod.classify(clean, "clip.mov") == census_mod.CLEAN
    media_first = _box(b"ftyp", b"isom\x00\x00\x00\x00isom") + _box(b"mdat", b"x" * 50)    # moov after the head
    assert census_mod.classify(media_first, "clip.mp4") == census_mod.UNKNOWN


def test_a_truncated_exif_block_is_unknown_not_clean():
    jpeg = _jpeg()
    assert census_mod.classify(jpeg[:30], "cut.jpg") == census_mod.UNKNOWN


class FakeStorage:
    def __init__(self, files):
        self.files, self.heads = files, 0

    def list(self, bucket):
        return [k for (b, k) in self.files if b == bucket]

    def head(self, bucket, key):
        self.heads += 1
        return self.files[(bucket, key)]


def test_the_census_counts_respects_the_limit_and_keeps_names_out_of_its_output():
    files = {("feed", "u1/a.jpg"): _jpeg(), ("feed", "u2/b.jpg"): strip_image_metadata(_jpeg(), "image/jpeg")[0],
             ("feed", "u3/c.mov"): _mov(), ("feed", "u4/notes.txt"): b"hello", ("feed", "u5/d.jpg"): _jpeg()}
    store, keys = FakeStorage(files), io.StringIO()
    result = census_mod.census(store, ["feed"], limit=3, pause=0, keys_out=keys)
    c = result["feed"]
    assert c["listed"] == 5 and c["skipped_type"] == 1
    assert c[census_mod.GPS] + c[census_mod.CLEAN] + c[census_mod.UNKNOWN] == 3 and store.heads == 3   # the limit holds
    assert "u1/a.jpg" not in repr(result)                               # counts only; names only in the local file
    assert "feed\tu1/a.jpg" in keys.getvalue()


def test_the_script_has_no_write_path():
    source = Path(census_mod.__file__).read_text(encoding="utf-8")
    for verb in ("requests.delete", "requests.put", "x-upsert", "/object/move", "/object/copy"):
        assert verb not in source, verb
