"""Two freshness-neutral savings for the one-step manifest publisher (2026-11-04, the egress program; PR #724).

Measured (Supabase edge logs, 11-03T20:03Z..11-04T20:03Z): 1,532 publications a day, a full cycle every 5-11 s during runs
(head GET 22 MB + unique POST 22 MB + pointer PATCH + legacy manifest.json POST 22 MB), 648 of them (42%) the same byte length
as the generation before.

1. NO-OP SKIP (kill switch MANIFEST_SKIP_NOOP_PUBLISH=0). When the merged manifest equals the head it was merged against,
   ignoring only the per-dump stamps `last_manifest_update` and `written_by`, the publish uploads nothing and swaps nothing: the
   head ALREADY serves exactly these products. Order-sensitive and byte-canonical, so any real change (a new entry, a replaced
   filename, a reordering) publishes as before. Only a merge against the REAL head is compared, never the legacy fallback.

2. LEGACY REFRESH AT DRAIN END (kill switch MANIFEST_LEGACY_REFRESH_DEFERRED=0). Every reader is pointer-first
   (store.get_manifest via store_helpers, store._fetch_remote_manifest_products, the publisher itself); manifest.json is read
   only when the pointer lane fails or the pointed head is missing/unusable. Instead of a 22 MB PUT after every win, the newest
   merged bytes are held and PUT once when the drain job ends, or sooner whenever the held bytes are older than
   LEGACY_MAX_LAG_SECONDS, so the fallback never lags the pointer by more than that bound (it lagged ~7 s before).
"""

import hashlib
import json
import logging
import os
import threading
import time

logger = logging.getLogger(__name__)

LEGACY_MAX_LAG_SECONDS = 60.0
_STAMPS = ("last_manifest_update", "written_by")

noop_skips = 0
legacy_writes_deferred = 0
legacy_writes = 0
_lock = threading.Lock()
_held = None            # (store, generation, merged bytes, monotonic time first held) or None


def skip_noop_enabled() -> bool:
    return os.environ.get("MANIFEST_SKIP_NOOP_PUBLISH", "1") != "0"


def legacy_deferred_enabled() -> bool:
    return os.environ.get("MANIFEST_LEGACY_REFRESH_DEFERRED", "1") != "0"


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


def _put(store, generation, merged):
    global legacy_writes
    from services.weather_pipeline import manifest_pointer as mp
    try:
        with mp.publish_run_keyed_suppressed():
            store._upload_to_supabase("manifest.json", merged)
        with _lock:
            legacy_writes += 1
    except Exception as exc:
        logger.warning(f"[Manifest Publish] legacy manifest.json refresh after g{generation} failed (the pointer win stands): {exc}")


def refresh_legacy(store, generation, merged):
    """After a won swap: PUT now (switch off), or hold the newest bytes and PUT them when they get older than the lag bound."""
    global _held, legacy_writes_deferred
    if not legacy_deferred_enabled():
        with _lock:
            _held = None                   # never let older held bytes land after these
        _put(store, generation, merged)
        return
    now = time.monotonic()
    with _lock:
        first = _held[3] if _held is not None else now
        _held = (store, generation, merged, first)
        legacy_writes_deferred += 1
        due = now - first >= LEGACY_MAX_LAG_SECONDS
    if due:
        flush_legacy()


def flush_legacy():
    """PUT the held bytes, if any (drain end, lag bound, or the switch). Never raises."""
    global _held
    with _lock:
        held, _held = _held, None
    if held is not None:
        _put(held[0], held[1], held[2])
