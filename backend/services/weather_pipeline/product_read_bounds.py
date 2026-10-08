"""Product filename validation and bounded read coordination."""
from contextlib import contextmanager
from dataclasses import dataclass, field
import threading


PRODUCT_ID_PATTERN = (r"\A[a-z][a-z0-9_]{1,180}_[0-9]{8}T[0-9]{6}Z"
                      r"(?:_estimated|(?:_-?[0-9]{1,3}\.[0-9]{2}){4})?\.json\z")


@dataclass
class _DownloadEntry:
    lock: object = field(default_factory=threading.Lock)
    users: int = 0


@contextmanager
def download_slot(store_class, filename):
    """Pin both owners and waiters; only idle entries may be evicted.

    Saturation refuses an additional unique read instead of growing the pool or
    creating a second lock for an in-flight filename.
    """
    with store_class._download_locks_lock:
        cache = store_class._download_locks
        entry = cache.pop(filename, None)
        if entry is None:
            if len(cache) >= store_class._DOWNLOAD_LOCK_LIMIT:
                idle = next((key for key, value in cache.items() if value.users == 0), None)
                if idle is not None:
                    del cache[idle]
                else:
                    entry = None
            if len(cache) < store_class._DOWNLOAD_LOCK_LIMIT:
                entry = _DownloadEntry()
        if entry is not None:
            entry.users += 1
            cache[filename] = entry
    try:
        yield entry.lock if entry is not None else None
    finally:
        if entry is not None:
            with store_class._download_locks_lock:
                entry.users -= 1
                # The last completed lease is the most recent idle entry.
                if entry.users == 0:
                    cache[filename] = cache.pop(filename)


def negative_hit(store_class, filename, now):
    with store_class._l2_negative_cache_lock:
        cache = store_class._l2_negative_cache
        failed_at = cache.pop(filename, None)
        if failed_at is None or now - failed_at >= store_class._L2_NEGATIVE_CACHE_TTL:
            return False
        cache[filename] = failed_at
        return True


def remember_negative(store_class, filename, failed_at):
    with store_class._l2_negative_cache_lock:
        cache = store_class._l2_negative_cache
        cache.pop(filename, None)
        while len(cache) >= store_class._L2_NEGATIVE_CACHE_LIMIT:
            del cache[next(iter(cache))]
        cache[filename] = failed_at
