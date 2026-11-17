"""A bad frame buffer is refused with a ValueError that says why. It never decodes into numbers, never raises anything
else, and a gzip that expands past the cap is refused while it is being decompressed.

Found 2026-11-17 (LongCat, verified by the helper), each reproduced on `dev` before the fix, in decode_frame AND in its
vectorised twin decode_plane:
  * `header_bytes` was never checked against the descriptor table: with a wrong value the planes were read from inside
    the header and the frame DECODED, silently, into wrong numbers;
  * a short buffer raised struct.error, and a zero-width field IndexError;
  * gzip had no size cap: 200 kB of input allocated 200 MB before the magic was read.
A good frame decodes exactly as before."""
import gzip
import random
import struct

import pytest

from services import frame_binary as fb
from tests.test_frame_binary import _product

RAW = fb.encode_frame(_product())
HB = fb.read_header(RAW)["header_bytes"]                 # 72 + 4 descriptors of 24 = 168
DECODERS = [fb.decode_frame, fb.decode_plane]
IDS = ["decode_frame", "decode_plane"]


def _with(offset, fmt, value):
    b = bytearray(RAW)
    struct.pack_into(fmt, b, offset, value)
    return bytes(b)


# name -> (buffer, a fragment the message must contain)
BAD = {
    "empty": (b"", "bad magic"),
    "bad magic": (b"XXXX" + RAW[4:], "bad magic"),
    "ten bytes": (RAW[:10], "fixed header needs 72"),
    "one byte short of the fixed header": (RAW[:fb.HEADER_FIXED - 1], "fixed header needs 72"),
    "the fixed header and nothing else": (RAW[:fb.HEADER_FIXED], "descriptor table ends at 168"),
    "cut in the middle of a descriptor": (RAW[:fb.HEADER_FIXED + 30], "descriptor table ends at 168"),
    "the header and no plane": (RAW[:HB], "truncated frame: field 0 needs"),
    "one byte short": (RAW[:-1], "truncated frame: field"),
    "header_bytes points into the descriptors": (_with(20, "<I", 72), "header_bytes is 72"),
    "header_bytes of 8": (_with(20, "<I", 8), "header_bytes is 8"),
    "header_bytes past the planes": (_with(20, "<I", len(RAW) + 50), "header_bytes is"),
    "header_bytes one too many": (_with(20, "<I", HB + 1), "header_bytes is 169"),
    "200 descriptors claimed": (_with(18, "<B", 200), "200 descriptor(s) end at"),
    "no descriptors claimed": (_with(18, "<B", 0), "0 descriptor(s) end at 72"),
    "a field three bytes wide": (_with(fb.HEADER_FIXED + 1, "<B", 3), "3 byte(s) wide"),
    "a field zero bytes wide": (_with(fb.HEADER_FIXED + 1, "<B", 0), "0 byte(s) wide"),
    "an unknown layout": (_with(fb.HEADER_FIXED + 2, "<B", 7), "layout 7"),
    "an unknown encoding version": (_with(4, "<H", 9), "unsupported encoding_version 9"),
}


@pytest.mark.parametrize("decode", DECODERS, ids=IDS)
@pytest.mark.parametrize("name", sorted(BAD))
def test_a_seeded_bad_buffer_is_refused_with_a_value_error_that_says_why(decode, name):
    data, fragment = BAD[name]
    with pytest.raises(ValueError, match=fragment.replace("(", r"\(").replace(")", r"\)")):
        decode(data)


@pytest.mark.parametrize("decode", DECODERS, ids=IDS)
def test_a_wrong_header_length_no_longer_decodes_into_numbers(decode):
    """The dangerous one: before the fix these two buffers decoded WITHOUT error, reading planes out of the header."""
    for bad in (72, 8):
        with pytest.raises(ValueError):
            decode(_with(20, "<I", bad))


@pytest.mark.parametrize("decode", DECODERS, ids=IDS)
def test_every_truncation_is_a_value_error_and_only_the_whole_frame_decodes(decode):
    for n in range(len(RAW)):
        with pytest.raises(ValueError):
            decode(RAW[:n])
    decode(RAW)


@pytest.mark.parametrize("decode", DECODERS, ids=IDS)
def test_flipped_header_bytes_never_raise_anything_but_value_error(decode):
    """Seeded fuzz over the header and descriptor table. A flip may leave a decodable frame (a scale, a bound); what it
    may never do is escape as struct.error, IndexError, MemoryError or a numpy error."""
    rng = random.Random(20261117)
    for _ in range(600):
        b = bytearray(RAW)
        for _k in range(rng.randint(1, 3)):
            b[rng.randrange(0, HB)] = rng.randrange(256)
        try:
            decode(bytes(b))
        except ValueError:
            pass


def test_a_good_frame_decodes_exactly_as_before_plain_and_gzipped():
    plain, zipped = fb.decode_frame(RAW), fb.decode_frame(fb.gzip_frame(RAW))
    assert plain == zipped and plain["cols"] == 4 and plain["rows"] == 3 and sorted(plain["fields"]) == [0, 1, 2, 3]
    assert fb.parity(_product(), plain)["bad"] == 0
    head, planes = fb.decode_plane(fb.gzip_frame(RAW))
    assert (head["cols"], head["rows"]) == (4, 3) and sorted(planes) == [0, 1, 2, 3]
    assert fb.checked_header(RAW)[9] == HB and len(fb.checked_header(RAW)[10]) == 4


def test_the_gzip_cap_is_applied_while_decompressing():
    small = gzip.compress(b"\x00" * 10_000)
    assert fb.gunzip_capped(small, limit=10_000) == b"\x00" * 10_000            # exactly at the cap: allowed
    with pytest.raises(ValueError, match="decompresses past the 9999-byte cap"):
        fb.gunzip_capped(small, limit=9_999)
    with pytest.raises(ValueError, match="gzip stream ends early"):
        fb.gunzip_capped(small[:-20])
    with pytest.raises(ValueError, match="bad gzip"):
        fb.gunzip_capped(fb.GZIP_MAGIC + b"\x08\x00" + b"\xff" * 40)


@pytest.mark.parametrize("decode", DECODERS, ids=IDS)
def test_a_gzip_bomb_is_refused_by_both_decoders(decode):
    bomb = gzip.compress(b"\x00" * (fb.MAX_FRAME_BYTES + 4096), compresslevel=1)
    assert len(bomb) < fb.MAX_FRAME_BYTES // 100                                 # a small input, a huge output
    with pytest.raises(ValueError, match="frame too large"):
        decode(bomb)


def test_the_cap_leaves_room_above_the_largest_frame_written_today():
    largest = 1440 * 721 * (2 + 2 + 2 + 1 + 1) + fb.HEADER_FIXED + 5 * fb.DESCRIPTOR.size    # 0.25-degree world, five fields
    assert fb.MAX_FRAME_BYTES >= 4 * largest and fb.MAX_FRAME_BYTES == 64 * 1024 * 1024


def test_read_header_refuses_a_short_buffer_too():
    with pytest.raises(ValueError, match="fixed header needs 72"):
        fb.read_header(RAW[:30])
    assert fb.read_header(RAW)["header_bytes"] == HB
