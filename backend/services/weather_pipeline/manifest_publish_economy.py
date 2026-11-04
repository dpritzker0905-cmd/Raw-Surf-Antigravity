"""A freshness-neutral saving for the one-step manifest publisher (2026-11-04, the egress program; PR #724).

Measured (Supabase edge logs, 11-03T20:03Z..11-04T20:03Z): 1,532 publications a day, a full cycle every 5-11 s during runs
(head GET 22 MB + unique POST 22 MB + pointer PATCH + legacy manifest.json POST 22 MB), 648 of them (42%) the same byte length
as the generation before.

1. NO-OP SKIP (kill switch MANIFEST_SKIP_NOOP_PUBLISH=0). When the merged manifest equals the head it was merged against,
   ignoring only the per-dump stamps `last_manifest_update` and `written_by`, the publish uploads nothing and swaps nothing: the
   head ALREADY serves exactly these products. Order-sensitive and byte-canonical, so any real change (a new entry, a replaced
   filename, a reordering) publishes as before. Only a merge against the REAL head is compared, never the legacy fallback.

(A drain-end legacy manifest.json write was considered and DROPPED: manifest.json is a LIVE fallback for every reader whenever
   the pointer read returns None, so it is still PUT after every win.)
"""

import hashlib
import json
import logging
import os
import threading

logger = logging.getLogger(__name__)

_STAMPS = ("last_manifest_update", "written_by")

noop_skips = 0
_lock = threading.Lock()


def skip_noop_enabled() -> bool:
    return os.environ.get("MANIFEST_SKIP_NOOP_PUBLISH", "1") != "0"


def content_signature(data):
    """sha256 of the manifest with the per-dump stamps removed (canonical, order-preserving), or None if it cannot be read."""
    try:
        doc = json.loads(data)
        if not isinstance(doc, dict) or not isinstance(doc.get("products"), list):
            return None
        for stamp in _STAMPS:
            doc.pop(stamp, None)
        canon = json.dumps(doc, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(canon.encode("utf-8")).hexdigest()
    except Exception:
        return None


def is_noop(head_signature, merged) -> bool:
    """True only when the switch is on, both signatures exist, and they are equal. Counts the skip."""
    global noop_skips
    if not skip_noop_enabled() or head_signature is None:
        return False
    if content_signature(merged) != head_signature:
        return False
    with _lock:
        noop_skips += 1
    return True
