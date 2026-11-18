"""Strip embedded metadata (GPS position, camera serial, timestamps, XMP, IPTC, comments) from a photo BEFORE it is
stored in a public bucket (T1 P3). Lossless: the image data is never re-encoded.

WHY: go-live condition photos are stored in the PUBLIC `conditions` bucket. Phone photos carry the GPS position they
were taken at, so anyone holding a photo's link could read where (and when) the photographer stood. The server still
reads those facts from the ORIGINAL bytes first (services/observation_media.inspect_media) and keeps them private in
`observation_media`; only the copy that goes to public storage is stripped.

- JPEG: every APPn segment except APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform) is
  dropped, and COM comments; then, if the photo had an EXIF Orientation other than 1, a minimal EXIF holding ONLY that
  orientation is put back, so phone photos do not display sideways.
- PNG: eXIf, tEXt, iTXt, zTXt and tIME chunks are dropped.
- WebP: EXIF and XMP chunks are dropped and the VP8X flags and RIFF size are corrected.
- Anything else (GIF, HEIC/HEIF, video) is returned unchanged with `stripped=False`: Pillow here cannot rewrite HEIC
  and video needs a video tool. Callers record that, and it is a listed follow-up.
"""
from __future__ import annotations

import io
import struct
from typing import Tuple

_JPEG_KEEP_APP = {0xE0, 0xE2, 0xEE}            # APP0 JFIF, APP2 ICC, APP14 Adobe
_PNG_DROP = {b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"tIME"}
_WEBP_DROP = {b"EXIF", b"XMP "}


class MetadataError(ValueError):
    """The bytes could not be parsed as the format they claim to be."""


def _jpeg_orientation(content: bytes) -> int:
    try:
        from PIL import Image
        with Image.open(io.BytesIO(content)) as im:
            return int(im.getexif().get(0x0112, 1) or 1)
    except Exception:
        return 1


def strip_jpeg(content: bytes) -> bytes:
    if content[:2] != b"\xff\xd8":
        raise MetadataError("not a JPEG")
    orientation = _jpeg_orientation(content)
    out = bytearray(b"\xff\xd8")
    i = 2
    n = len(content)
    while i < n:
        if content[i] != 0xFF:
            raise MetadataError("bad JPEG marker")
        marker = content[i + 1]
        if marker == 0xFF:                       # fill byte
            i += 1
            continue
        if marker == 0xDA:                       # start of scan: the rest is image data, copied as is
            out += content[i:]
            break
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:   # standalone markers
            out += content[i:i + 2]
            i += 2
            continue
        if i + 4 > n:
            raise MetadataError("truncated JPEG")
        length = struct.unpack(">H", content[i + 2:i + 4])[0]
        segment = content[i:i + 2 + length]
        if (0xE0 <= marker <= 0xEF and marker not in _JPEG_KEEP_APP) or marker == 0xFE:
            pass                                  # metadata: dropped
        else:
            out += segment
        i += 2 + length
    else:
        raise MetadataError("JPEG has no image data")
    stripped = bytes(out)
    if orientation != 1:
        import piexif
        exif = piexif.dump({"0th": {piexif.ImageIFD.Orientation: orientation}})
        buf = io.BytesIO()
        piexif.insert(exif, stripped, buf)
        stripped = buf.getvalue()
    return stripped


def strip_png(content: bytes) -> bytes:
    sig = b"\x89PNG\r\n\x1a\n"
    if content[:8] != sig:
        raise MetadataError("not a PNG")
    out, i = bytearray(sig), 8
    while i < len(content):
        if i + 8 > len(content):
            raise MetadataError("truncated PNG")
        length = struct.unpack(">I", content[i:i + 4])[0]
        ctype = content[i + 4:i + 8]
        chunk = content[i:i + 12 + length]
        if ctype not in _PNG_DROP:
            out += chunk
        i += 12 + length
        if ctype == b"IEND":
            break
    return bytes(out)


def strip_webp(content: bytes) -> bytes:
    if content[:4] != b"RIFF" or content[8:12] != b"WEBP":
        raise MetadataError("not a WebP")
    chunks, i = [], 12
    while i + 8 <= len(content):
        ctype = content[i:i + 4]
        size = struct.unpack("<I", content[i + 4:i + 8])[0]
        body = content[i + 8:i + 8 + size]
        if ctype not in _WEBP_DROP:
            if ctype == b"VP8X" and body:
                body = bytes([body[0] & ~0x0C]) + body[1:]   # clear the EXIF (0x08) and XMP (0x04) flags
            chunks.append(ctype + struct.pack("<I", size) + body + (b"\x00" if size % 2 else b""))
        i += 8 + size + (size % 2)
    payload = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(payload)) + payload


def strip_image_metadata(content: bytes, content_type: str) -> Tuple[bytes, bool]:
    """(bytes to store publicly, whether metadata was stripped). Raises MetadataError for a malformed JPEG/PNG/WebP."""
    ct = (content_type or "").lower()
    if ct in ("image/jpeg", "image/jpg") or content[:2] == b"\xff\xd8":
        return strip_jpeg(content), True
    if ct == "image/png" or content[:8] == b"\x89PNG\r\n\x1a\n":
        return strip_png(content), True
    if ct == "image/webp" or (content[:4] == b"RIFF" and content[8:12] == b"WEBP"):
        return strip_webp(content), True
    return content, False
