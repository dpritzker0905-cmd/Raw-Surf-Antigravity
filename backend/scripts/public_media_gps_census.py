"""READ-ONLY census: how many photos and videos ALREADY in the public buckets still carry a GPS position (T1 P3).

Uploads are stripped from 2026-11-18 on (#1035, #1038, #1042, #1054); files stored before that keep their metadata.
This counts them so the owner can decide on a backfill. It never writes, moves or deletes anything:
- it LISTS objects (paged) and fetches only the first HEAD_BYTES of each file with an HTTP Range request;
- it prints COUNTS per bucket only, never object names (they contain user ids). `--keys-out` writes the names of
  files with GPS to a LOCAL file the operator chooses, for a later, separately approved backfill.
Detection on the head bytes: JPEG (EXIF GPS IFD), PNG/WebP (an EXIF chunk with a GPS IFD), HEIC (the Exif item),
MP4/MOV (a location atom before the media; a file whose `moov` comes after `mdat` is reported UNKNOWN, not clean).

Usage (needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; runs on dev through public-media-gps-census.yml):
    python scripts/public_media_gps_census.py --limit 200 [--buckets conditions,feed] [--keys-out FILE]
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from typing import Iterable, Optional


def _supabase_headers(key):
    """Supabase API-key headers. sb_ keys are not JWTs and are rejected as Bearer, so the Bearer copy is
    sent only for a legacy JWT key (inline copy of core.supabase_auth: this script runs by path)."""
    return {"apikey": key, **({"Authorization": "Bearer " + key} if str(key).startswith("eyJ") else {})}


BUCKETS = ("conditions", "feed", "stories", "general", "user-gallery", "gallery", "avatars")
HEAD_BYTES = 256 * 1024
IMAGE_EXT = (".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif")
VIDEO_EXT = (".mp4", ".mov", ".m4v")
_ISO6709 = re.compile(rb"[+-]\d{1,2}(?:\.\d+)?[+-]\d{1,3}(?:\.\d+)?(?:[+-]\d+(?:\.\d+)?)?(?:CRS[^/]*)?/")

GPS, CLEAN, UNKNOWN = "gps", "clean", "unknown"


def _tiff_has_gps(tiff: bytes) -> bool:
    try:
        import piexif
        gps = piexif.load(tiff if tiff[:4] in (b"II*\x00", b"MM\x00*") else b"Exif\x00\x00" + tiff).get("GPS") or {}
        return bool(gps.get(piexif.GPSIFD.GPSLatitude) or gps.get(piexif.GPSIFD.GPSLongitude))
    except Exception:  # noqa: BLE001 - an unreadable EXIF block is reported as unknown by the caller
        raise ValueError("unreadable EXIF")


def classify(head: bytes, name: str) -> str:
    """GPS / CLEAN / UNKNOWN for a file judged from its first bytes. Pure, so it is tested without storage."""
    lower = name.lower()
    try:
        if head[:2] == b"\xff\xd8":                                     # JPEG: walk the segments before the scan
            i = 2
            while i + 4 <= len(head) and head[i] == 0xFF:
                marker = head[i + 1]
                if marker == 0xDA:
                    return CLEAN
                length = int.from_bytes(head[i + 2:i + 4], "big")
                seg = head[i + 4:i + 2 + length]
                if marker == 0xE1 and seg[:6] == b"Exif\x00\x00":
                    if i + 2 + length > len(head):
                        return UNKNOWN
                    return GPS if _tiff_has_gps(seg[6:]) else CLEAN
                i += 2 + length
            return UNKNOWN if i + 4 > len(head) else CLEAN
        if head[:8] == b"\x89PNG\r\n\x1a\n" or (head[:4] == b"RIFF" and head[8:12] == b"WEBP"):
            tag = b"eXIf" if head[:4] != b"RIFF" else b"EXIF"
            at = head.find(tag)
            if at < 0:
                return CLEAN if len(head) < HEAD_BYTES else UNKNOWN
            size = int.from_bytes(head[at - 4:at], "big") if tag == b"eXIf" else int.from_bytes(head[at + 4:at + 8], "little")
            start = at + 4 if tag == b"eXIf" else at + 8
            if start + size > len(head):
                return UNKNOWN
            return GPS if _tiff_has_gps(head[start:start + size]) else CLEAN
        if head[4:8] == b"ftyp" and lower.endswith((".heic", ".heif")) or head[8:12] in (b"heic", b"heix", b"mif1"):
            from services.heic_metadata import extract_heif_exif
            tiff = extract_heif_exif(head)
            if tiff is None:
                return UNKNOWN if len(head) >= HEAD_BYTES else CLEAN
            return GPS if _tiff_has_gps(tiff) else CLEAN
        if head[4:8] == b"ftyp" or lower.endswith(VIDEO_EXT):
            if _ISO6709.search(head):
                return GPS
            moov, mdat = head.find(b"moov"), head.find(b"mdat")
            if moov >= 0 and (mdat < 0 or moov < mdat):
                return CLEAN if len(head) < HEAD_BYTES or mdat >= 0 else UNKNOWN
            return UNKNOWN                                             # the movie header is after the media data
    except ValueError:
        return UNKNOWN
    return UNKNOWN


class Storage:
    """List objects and read a file's head. GET/POST-list only: nothing here can change storage."""

    def __init__(self):
        import requests
        self.requests = requests
        self.base = os.environ["SUPABASE_URL"].rstrip("/")
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.headers = _supabase_headers(key)

    def list(self, bucket: str, prefix: str = "", depth: int = 0) -> Iterable[str]:
        offset = 0
        while True:
            r = self.requests.post(f"{self.base}/storage/v1/object/list/{bucket}", headers=self.headers, timeout=30,
                                   json={"prefix": prefix, "limit": 1000, "offset": offset,
                                         "sortBy": {"column": "name", "order": "asc"}})
            r.raise_for_status()
            page = r.json() or []
            for entry in page:
                name = f"{prefix}{entry['name']}"
                if entry.get("id") is None:                              # a folder
                    if depth < 4:
                        yield from self.list(bucket, name + "/", depth + 1)
                else:
                    yield name
            if len(page) < 1000:
                return
            offset += 1000

    def head(self, bucket: str, key: str) -> Optional[bytes]:
        from urllib.parse import quote
        r = self.requests.get(f"{self.base}/storage/v1/object/{bucket}/{quote(key, safe='/')}", timeout=30,
                              headers={**self.headers, "Range": f"bytes=0-{HEAD_BYTES - 1}"})
        if r.status_code not in (200, 206):
            return None
        return r.content[:HEAD_BYTES]


def census(storage, buckets, limit: int, pause: float = 0.05, keys_out=None) -> dict:
    out = {}
    for bucket in buckets:
        counts = {GPS: 0, CLEAN: 0, UNKNOWN: 0, "skipped_type": 0, "unreadable": 0, "listed": 0}
        for key in storage.list(bucket):
            counts["listed"] += 1
            if not key.lower().endswith(IMAGE_EXT + VIDEO_EXT):
                counts["skipped_type"] += 1
                continue
            if sum(counts[k] for k in (GPS, CLEAN, UNKNOWN, "unreadable")) >= limit:
                continue
            head = storage.head(bucket, key)
            if head is None:
                counts["unreadable"] += 1
                continue
            verdict = classify(head, key)
            counts[verdict] += 1
            if verdict == GPS and keys_out is not None:
                keys_out.write(f"{bucket}\t{key}\n")
            time.sleep(pause)
        out[bucket] = counts
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--limit", type=int, default=200, help="files to inspect per bucket (the listing is complete)")
    ap.add_argument("--buckets", default=",".join(BUCKETS))
    ap.add_argument("--keys-out", help="LOCAL file for the names of files with GPS (never printed)")
    ap.add_argument("--json", help="write the counts as JSON")
    args = ap.parse_args(argv)
    sink = open(args.keys_out, "w", encoding="utf-8") if args.keys_out else None
    try:
        result = census(Storage(), [b for b in args.buckets.split(",") if b], args.limit, keys_out=sink)
    finally:
        if sink:
            sink.close()
    print(f"{'bucket':<14}{'listed':>8}{'gps':>7}{'clean':>7}{'unknown':>9}{'unread':>8}{'other':>7}")
    for bucket, c in result.items():
        print(f"{bucket:<14}{c['listed']:>8}{c[GPS]:>7}{c[CLEAN]:>7}{c[UNKNOWN]:>9}{c['unreadable']:>8}{c['skipped_type']:>7}")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump(result, fh, indent=1)
    return 0


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    sys.exit(main())
