"""Scored archive bytes; monthly keys and row identity stay stable."""
import gzip
import json

SCORED_PREFIX = 'calibration/skill/scored-'
SIZE_WARN_BYTES = 40 * 1024 * 1024


def is_scored_archive(key):
    return isinstance(key, str) and key.startswith(SCORED_PREFIX) and key.endswith('.json')


def encode_archive(obj, key):
    raw = json.dumps(obj, separators=(',', ':')).encode('utf-8')
    return gzip.compress(raw, compresslevel=6, mtime=0) if is_scored_archive(key) else raw


def decode_archive(data):
    # Existing segments remain readable, including prior months.
    if data.startswith(b'\x1f\x8b'):
        data = gzip.decompress(data)
    return json.loads(data)


def decode_archive_response(response):
    content = getattr(response, 'content', None)
    return decode_archive(content) if isinstance(content, bytes) else response.json()


def archive_size_warning(key, size_bytes):
    if is_scored_archive(key) and size_bytes is not None and size_bytes >= SIZE_WARN_BYTES:
        return f'::warning::Skill archive {key} is {size_bytes} stored bytes; approaching the Storage object limit.'
    return None
