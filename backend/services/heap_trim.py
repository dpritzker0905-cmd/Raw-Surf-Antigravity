"""heap_trim — hand freed heap back to the OS after the transient spikes this service is known for.

WHY (2026-09-26, the memory-headroom arc). Render's 7-day memory chart holds this box at 70-80% of its
2 GB cgroup, touching ~90% on Sep 19-20; the 2026-09-21 incident showed the box degrading from ~85%
(slow routes, 5xx, "Couldn't load surf spots"). memory_trace's `growing` set stays EMPTY while RSS
climbs with process age, and the bounded product-cache control sits flat at its limit — so the
growth is not live retention in any registered cache.

What IS measured is CHURN: a cold wide-bbox grid_series materialises up to 15.5x the vectors it serves
(test_series_build_materialisation.py), a transient of +157 to +813 MB. Python frees those objects,
but glibc keeps the pages in its arenas, so RSS ratchets to each new high-water mark and stays there:
exactly the "memory tracks uptime, a restart clears it" shape. malloc_trim(0) returns the free pages
at the top of every arena to the kernel. It changes no object, no cache and no response.

This module is deliberately an INSTRUMENT as much as a fix: every trim records RSS before/after, so
/api/health shows how much each call gave back. If `released_mb` stays ~0 the ratchet is not arena
free-space, and the next search (MALLOC_ARENA_MAX, then bounding the dynamic-viewport lane at
resolution) starts from a measurement instead of a guess.

Linux/glibc only; a no-op that reports `available: false` everywhere else (Windows dev box, musl).
Called from the existing 5-minute memory_trace job — never from a request path. Kill: HEAP_TRIM=0.
"""
import ctypes
import ctypes.util
import os
import time
from typing import Any, Dict, Optional

_libc = None
_libc_checked = False
_stats: Dict[str, Any] = {"trims": 0, "released_mb_total": 0.0, "last": None, "max_released_mb": 0.0}


def enabled() -> bool:
    return os.environ.get("HEAP_TRIM") != "0"


def _malloc_trim():
    """The glibc malloc_trim symbol, or None where it does not exist. Resolved once."""
    global _libc, _libc_checked
    if not _libc_checked:
        _libc_checked = True
        try:
            name = ctypes.util.find_library("c")
            lib = ctypes.CDLL(name) if name else None
            fn = getattr(lib, "malloc_trim", None) if lib is not None else None
            if fn is not None:
                fn.argtypes = [ctypes.c_size_t]
                fn.restype = ctypes.c_int
            _libc = fn
        except Exception:
            _libc = None
    return _libc


def _rss_mb() -> Optional[float]:
    try:
        import psutil
        return psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024)
    except Exception:
        return None


def trim() -> Dict[str, Any]:
    """Run malloc_trim(0) once and record what it gave back. Never raises."""
    if not enabled():
        return {"available": False, "reason": "HEAP_TRIM=0"}
    fn = _malloc_trim()
    if fn is None:
        return {"available": False, "reason": "no glibc malloc_trim on this platform"}
    try:
        before = _rss_mb()
        t0 = time.perf_counter()
        fn(0)
        ms = (time.perf_counter() - t0) * 1000.0
        after = _rss_mb()
        released = round(max(0.0, (before or 0.0) - (after or 0.0)), 1) if before is not None and after is not None else None
        last = {"rss_before_mb": round(before, 1) if before is not None else None,
                "rss_after_mb": round(after, 1) if after is not None else None,
                "released_mb": released, "ms": round(ms, 1), "at": round(time.time(), 0)}
        _stats["trims"] += 1
        _stats["last"] = last
        if released is not None:
            _stats["released_mb_total"] = round(_stats["released_mb_total"] + released, 1)
            _stats["max_released_mb"] = max(_stats["max_released_mb"], released)
        return {"available": True, **last}
    except Exception as e:
        return {"available": False, "reason": f"{type(e).__name__}"}


def stats() -> Dict[str, Any]:
    """Cumulative figures for /api/health. `available` is resolved without trimming."""
    return {"enabled": enabled(), "available": enabled() and _malloc_trim() is not None, **_stats}


def _reset_for_test() -> None:
    global _libc, _libc_checked
    _libc, _libc_checked = None, False
    _stats.update({"trims": 0, "released_mb_total": 0.0, "last": None, "max_released_mb": 0.0})
