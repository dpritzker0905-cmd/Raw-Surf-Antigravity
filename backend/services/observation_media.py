"""Read an uploaded report photo's provenance on the SERVER, from its bytes: SHA-256 and EXIF position/time.

Used by the upload route before the file is stored, so an observation's EXIF check never rests on the client's word.
Only the header is parsed (Pillow's lazy open + getexif); pixels are not decoded. Any parse failure means "no EXIF",
never an error: a photo without EXIF is common (screenshots, stripped by the OS) and is flagged, not refused.

EXIF time: the GPS timestamp is UTC by definition and is preferred. DateTimeOriginal is used only with its
OffsetTimeOriginal; without an offset its zone is unknown, so no time is claimed.
"""
from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Optional

_GPS_IFD = 0x8825
_EXIF_IFD = 0x8769
_DATETIME_ORIGINAL = 36867
_OFFSET_TIME_ORIGINAL = 36881


@dataclass(frozen=True)
class MediaFacts:
    sha256: str
    exif_latitude: Optional[float] = None
    exif_longitude: Optional[float] = None
    exif_taken_at: Optional[datetime] = None


def _rational(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError, ZeroDivisionError):
        num, den = x
        return float(num) / float(den)


def _dms(values, ref) -> Optional[float]:
    try:
        d, m, s = (_rational(v) for v in values)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    deg = d + m / 60.0 + s / 3600.0
    if isinstance(ref, bytes):
        ref = ref.decode("ascii", "ignore")
    if str(ref).strip().upper() in ("S", "W"):
        deg = -deg
    return deg


def _gps_time(gps) -> Optional[datetime]:
    date_stamp, time_stamp = gps.get(29), gps.get(7)
    if not date_stamp or not time_stamp:
        return None
    try:
        h, m, s = (_rational(v) for v in time_stamp)
        day = datetime.strptime(str(date_stamp).strip(), "%Y:%m:%d")
        return (day + timedelta(hours=h, minutes=m, seconds=s)).replace(tzinfo=timezone.utc)
    except (TypeError, ValueError, ZeroDivisionError):
        return None


def _original_time(exif_ifd) -> Optional[datetime]:
    stamp, offset = exif_ifd.get(_DATETIME_ORIGINAL), exif_ifd.get(_OFFSET_TIME_ORIGINAL)
    if not stamp or not offset:
        return None
    try:
        return datetime.strptime(f"{str(stamp).strip()} {str(offset).strip()}", "%Y:%m:%d %H:%M:%S %z")
    except ValueError:
        return None


def inspect_media(content: bytes, is_image: bool) -> MediaFacts:
    digest = hashlib.sha256(content).hexdigest()
    if not is_image:
        return MediaFacts(sha256=digest)
    try:
        from PIL import Image
        with Image.open(io.BytesIO(content)) as img:
            exif = img.getexif()
            gps = exif.get_ifd(_GPS_IFD) or {}
            exif_ifd = exif.get_ifd(_EXIF_IFD) or {}
    except Exception:  # noqa: BLE001 - any unreadable header is "no EXIF", by design
        return MediaFacts(sha256=digest)
    lat = _dms(gps[2], gps.get(1, "N")) if 2 in gps else None
    lon = _dms(gps[4], gps.get(3, "E")) if 4 in gps else None
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        lat = lon = None
    return MediaFacts(sha256=digest, exif_latitude=lat, exif_longitude=lon,
                      exif_taken_at=_gps_time(gps) or _original_time(exif_ifd))
