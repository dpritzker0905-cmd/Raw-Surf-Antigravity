"""Remove the location and other embedded metadata from a HEIC/HEIF photo, losslessly, without decoding it (T1 P3).

The server has no HEIC decoder (pillow-heif is not installed), so a HEIC photo used to be stored exactly as uploaded,
GPS included. HEIC is an ISO base media file, like MP4: an iPhone keeps its position, time and camera serial in an
`Exif` ITEM (and sometimes an XMP `mime` item) whose bytes sit in `mdat` or `idat`, located by the `iloc` box. The
photo's rotation is NOT in EXIF here: it is the `irot`/`imir` item properties, so it is untouched.

This module finds those items through `iinf` + `iloc` and overwrites their bytes IN PLACE:
- the Exif item becomes a valid EMPTY EXIF block (offset 0, a big-endian TIFF header, an IFD with no entries), padded
  with zeros to its original length;
- an XMP item becomes zeros.
The file length and every offset stay the same and the image data is untouched.
A malformed file raises MetadataError (the caller refuses it rather than publishing it unchecked). The walk is bounded:
at most MAX_BOXES boxes and MAX_ITEMS items, so a crafted file cannot make it allocate without limit.
"""
from __future__ import annotations

import struct
from typing import Dict, List, Tuple

from services.media_metadata import MetadataError

MAX_BOXES = 4096
MAX_ITEMS = 4096
_EMPTY_EXIF = b"\x00\x00\x00\x00" + b"MM\x00\x2a\x00\x00\x00\x08" + b"\x00\x00" + b"\x00\x00\x00\x00"
_HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1", b"avif"}


def is_heif(content: bytes) -> bool:
    return len(content) >= 12 and content[4:8] == b"ftyp" and content[8:12] in _HEIF_BRANDS


def _boxes(buf: bytes, start: int, end: int, budget: list):
    pos = start
    while pos + 8 <= end:
        budget[0] -= 1
        if budget[0] < 0:
            raise MetadataError(f"more than {MAX_BOXES} boxes")
        size, btype = struct.unpack_from(">I4s", buf, pos)
        header = 8
        if size == 1:
            if pos + 16 > end:
                raise MetadataError("truncated large box")
            size = struct.unpack_from(">Q", buf, pos + 8)[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            raise MetadataError(f"box {btype!r} overruns its parent")
        yield pos, size, btype, header
        pos += size


def _cstring(buf: bytes, pos: int, end: int) -> Tuple[bytes, int]:
    z = buf.find(b"\x00", pos, end)
    if z < 0:
        raise MetadataError("unterminated string")
    return buf[pos:z], z + 1


def _items(buf: bytes, start: int, end: int, budget: list) -> Dict[int, bytes]:
    """iinf: item_ID -> item_type ('Exif', 'mime' for XMP, 'hvc1', ...)."""
    version = buf[start]
    pos = start + 4
    count = struct.unpack_from(">H" if version == 0 else ">I", buf, pos)[0]
    if count > MAX_ITEMS:
        raise MetadataError("too many items")
    pos += 2 if version == 0 else 4
    types: Dict[int, bytes] = {}
    for off, size, btype, header in _boxes(buf, pos, end, budget):
        if btype != b"infe":
            continue
        v = buf[off + header]
        p = off + header + 4
        if v < 2:
            continue                                         # pre-2 infe has no item_type; Apple writes v2
        item_id = struct.unpack_from(">H" if v == 2 else ">I", buf, p)[0]
        p += 2 if v == 2 else 4
        p += 2                                               # item_protection_index
        item_type = buf[p:p + 4]
        p += 4
        if item_type == b"mime":
            _name, p = _cstring(buf, p, off + size)
            content_type, p = _cstring(buf, p, off + size)
            if b"xml" in content_type.lower():
                item_type = b"XMP "
        types[item_id] = item_type
    return types


def _read_uint(buf: bytes, pos: int, nbytes: int) -> int:
    return int.from_bytes(buf[pos:pos + nbytes], "big") if nbytes else 0


def _locations(buf: bytes, start: int, end: int) -> Dict[int, List[Tuple[int, int, int]]]:
    """iloc: item_ID -> [(construction_method, offset, length)]; offsets are absolute for method 0, idat-relative
    for method 1."""
    version = buf[start]
    pos = start + 4
    sizes = buf[pos]
    offset_size, length_size = sizes >> 4, sizes & 0x0F
    sizes2 = buf[pos + 1]
    base_offset_size = sizes2 >> 4
    index_size = (sizes2 & 0x0F) if version in (1, 2) else 0
    pos += 2
    count = struct.unpack_from(">H" if version < 2 else ">I", buf, pos)[0]
    pos += 2 if version < 2 else 4
    if count > MAX_ITEMS:
        raise MetadataError("too many items")
    out: Dict[int, List[Tuple[int, int, int]]] = {}
    for _ in range(count):
        item_id = struct.unpack_from(">H" if version < 2 else ">I", buf, pos)[0]
        pos += 2 if version < 2 else 4
        method = 0
        if version in (1, 2):
            method = struct.unpack_from(">H", buf, pos)[0] & 0x0F
            pos += 2
        pos += 2                                             # data_reference_index
        base = _read_uint(buf, pos, base_offset_size)
        pos += base_offset_size
        extents = struct.unpack_from(">H", buf, pos)[0]
        pos += 2
        if extents > MAX_ITEMS:
            raise MetadataError("too many extents")
        spans = []
        for _e in range(extents):
            pos += index_size
            off = _read_uint(buf, pos, offset_size)
            pos += offset_size
            length = _read_uint(buf, pos, length_size)
            pos += length_size
            spans.append((method, base + off, length))
        if pos > end:
            raise MetadataError("iloc overruns its box")
        out[item_id] = spans
    return out


def _metadata_spans(buf) -> List[Tuple[bytes, List[Tuple[int, int]]]]:
    """[(b"Exif" or b"XMP ", [(absolute offset, length)])] for the file's metadata items. Raises MetadataError."""
    budget = [MAX_BOXES]
    meta = next(((o, s, h) for o, s, t, h in _boxes(buf, 0, len(buf), budget) if t == b"meta"), None)
    if meta is None:
        return []                                            # no meta box: no items
    m_off, m_size, m_header = meta
    types, locs, idat = {}, {}, None
    for o, s, t, h in _boxes(buf, m_off + m_header + 4, m_off + m_size, budget):   # meta is a FullBox
        if t == b"iinf":
            types = _items(buf, o + h, o + s, budget)
        elif t == b"iloc":
            locs = _locations(buf, o + h, o + s)
        elif t == b"idat":
            idat = o + h
    out = []
    for item_id, kind in types.items():
        if kind not in (b"Exif", b"XMP "):
            continue
        spans = locs.get(item_id)
        if not spans:
            raise MetadataError(f"{kind.decode()} item {item_id} has no location")
        absolute = []
        for method, off, length in spans:
            if method == 1:
                if idat is None:
                    raise MetadataError("idat-relative item without an idat box")
                off += idat
            elif method != 0:
                raise MetadataError(f"unsupported construction method {method}")
            if length == 0 or off < 0 or off + length > len(buf):
                raise MetadataError("metadata item outside the file (or of open length)")
            absolute.append((off, length))
        out.append((kind, absolute))
    return out


def extract_heif_exif(content: bytes):
    """The TIFF bytes of the Exif item (for the server's PRIVATE record), or None. Never raises."""
    try:
        if not is_heif(content):
            return None
        for kind, spans in _metadata_spans(content):
            if kind == b"Exif":
                data = b"".join(content[o:o + n] for o, n in spans)
                if len(data) < 8:
                    return None
                start = 4 + struct.unpack_from(">I", data, 0)[0]
                return data[start:] or None
    except (MetadataError, struct.error, IndexError):
        return None
    return None


def strip_heif(content: bytes) -> bytes:
    """A copy of `content` whose Exif and XMP items are blanked in place. Raises MetadataError if malformed or if a
    metadata item cannot be located (it is never published unchecked)."""
    if not is_heif(content):
        raise MetadataError("not a HEIF file")
    buf = bytearray(content)
    try:
        spans_by_item = _metadata_spans(buf)
    except (struct.error, IndexError) as exc:
        raise MetadataError(f"malformed HEIF: {exc}") from exc
    for kind, spans in spans_by_item:
        first = True
        for off, length in spans:
            fill = bytearray(length)
            if kind == b"Exif" and first and length >= len(_EMPTY_EXIF):
                fill[:len(_EMPTY_EXIF)] = _EMPTY_EXIF            # a valid, empty EXIF block
            buf[off:off + length] = fill
            first = False
    return bytes(buf)
