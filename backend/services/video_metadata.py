"""Read, then remove, the location metadata of an MP4 / MOV video IN PLACE (T1 P3). Pure Python, no ffmpeg.

Phone videos keep their position and capture time in small metadata boxes inside `moov`: QuickTime `udta` (the
`©xyz` ISO 6709 string) and `meta` (Apple's `com.apple.quicktime.location.ISO6709` and `.creationdate`), at movie or
track level. This module
1. READS those boxes for the server's PRIVATE record (the go-live location check), then
2. NEUTERS each one: its type becomes `free` and its payload is zeroed. Players skip `free` boxes by design, and the
   file length never changes, so every chunk offset stays valid: lossless, no remux, the media data is untouched.
The file is patched on disk with seeks, so a large video is never copied in memory.

Only ISO base media files (MP4, MOV, M4V) are handled; anything else (WebM from a browser recorder carries no GPS,
MPEG-PS) is reported as not stripped.
"""
from __future__ import annotations

import re
import struct
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Iterator, Optional, Tuple

from services.media_metadata import MetadataError

_TOP_LEVEL = {b"ftyp", b"moov", b"mdat", b"free", b"skip", b"wide", b"pnot", b"uuid", b"moof", b"mfra", b"styp",
              b"sidx", b"meta", b"udta", b"pdin", b"prft", b"emsg"}
_NEUTER = {b"udta", b"meta"}
_MAX_READ = 16 * 1024 * 1024                    # a metadata box larger than this is neutered without being read
_ISO6709 = re.compile(rb"([+-]\d{1,2}(?:\.\d+)?)([+-]\d{1,3}(?:\.\d+)?)(?:[+-]\d+(?:\.\d+)?)?(?:CRS[^/]*)?/")
_DATE = re.compile(rb"(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:?\d{2})?)")


@dataclass
class VideoFacts:
    stripped: bool = False
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    taken_at: Optional[datetime] = None
    neutered: int = 0


def _boxes(f, start: int, end: int) -> Iterator[Tuple[int, int, bytes, int]]:
    """(offset, total size, type, header length) of each box in [start, end)."""
    pos = start
    while pos + 8 <= end:
        f.seek(pos)
        head = f.read(8)
        if len(head) < 8:
            raise MetadataError("truncated box header")
        size, btype = struct.unpack(">I4s", head)
        header = 8
        if size == 1:
            big = f.read(8)
            if len(big) < 8:
                raise MetadataError("truncated large box header")
            size = struct.unpack(">Q", big)[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            raise MetadataError(f"box {btype!r} overruns its parent")
        yield pos, size, btype, header
        pos += size


def parse_location(blob: bytes) -> Tuple[Optional[float], Optional[float]]:
    m = _ISO6709.search(blob)
    if not m:
        return None, None
    lat, lon = float(m.group(1)), float(m.group(2))
    if -90 <= lat <= 90 and -180 <= lon <= 180 and not (lat == 0 and lon == 0):
        return lat, lon
    return None, None


def parse_taken_at(blob: bytes) -> Optional[datetime]:
    m = _DATE.search(blob)
    if not m:
        return None
    text = m.group(1).decode()
    text = re.sub(r"([+-]\d{2})(\d{2})$", r"\1:\2", text).replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _neuter(f, offset: int, size: int, header: int, facts: VideoFacts) -> None:
    payload = size - header
    if payload <= _MAX_READ:
        f.seek(offset + header)
        blob = f.read(payload)
        if facts.latitude is None:
            facts.latitude, facts.longitude = parse_location(blob)
        if facts.taken_at is None:
            facts.taken_at = parse_taken_at(blob)
    f.seek(offset + 4)
    f.write(b"free")
    f.seek(offset + header)
    left = payload
    zeros = b"\x00" * 65536
    while left > 0:
        n = min(left, len(zeros))
        f.write(zeros[:n])
        left -= n
    facts.neutered += 1


def is_isobmff(path) -> bool:
    with open(path, "rb") as f:
        head = f.read(8)
    return len(head) == 8 and head[4:8] in _TOP_LEVEL


def strip_video_in_place(path) -> VideoFacts:
    """Read the location/time privately and neuter every movie- and track-level `udta`/`meta` box. Raises
    MetadataError for a malformed MP4/MOV; returns stripped=False for a file that is not ISO base media."""
    if not is_isobmff(path):
        return VideoFacts(stripped=False)
    facts = VideoFacts(stripped=True)
    with open(path, "r+b") as f:
        f.seek(0, 2)
        end = f.tell()
        for off, size, btype, header in list(_boxes(f, 0, end)):
            if btype in _NEUTER:                               # top-level metadata (rare, but possible)
                _neuter(f, off, size, header, facts)
            elif btype == b"moov":
                for c_off, c_size, c_type, c_header in list(_boxes(f, off + header, off + size)):
                    if c_type in _NEUTER:
                        _neuter(f, c_off, c_size, c_header, facts)
                    elif c_type == b"trak":
                        for t_off, t_size, t_type, t_header in list(_boxes(f, c_off + c_header, c_off + c_size)):
                            if t_type in _NEUTER:
                                _neuter(f, t_off, t_size, t_header, facts)
    return facts
