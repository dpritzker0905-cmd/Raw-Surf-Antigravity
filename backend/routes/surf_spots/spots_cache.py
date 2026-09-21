"""
spots_cache — a single-slot response cache for the unfiltered /api/surf-spots catalogue.

WHY THIS EXISTS — AND THE NUMBER THAT FIRST MOTIVATED IT WAS STATE-DEPENDENT, SO READ BOTH ROWS.

This route's cost is BIMODAL with the health of the serving process. Measured on the live backend
2026-09-21, the same route on the same code, hours apart:

    process up 13h42m (n=18,129 overall)   n=2085   10.2% 5xx   avg 5,848 ms   p90 36,653 ms
    process up  4h05m (n= 9,351 overall)   n= 755    0.0% 5xx   avg   372 ms   p90  1,000 ms

On the degraded process it consumed ~12,193 s of server time — a quarter of everything the box did
— and failed one request in ten, which is the owner-visible "Couldn't load surf spots". On a fresh
process it is a 372 ms route with no errors, under HIGHER load (0.64 vs 0.37 req/s).

⭐⭐⭐ THE FIRST DRAFT OF THIS MODULE, ITS COMMIT MESSAGE AND ITS PR ALL LED WITH "24% OF THE BOX",
MEASURED ONLY ON THE DEGRADED PROCESS, AND DID NOT SAY SO. That is the honest correction: a
14-hour-old process and a 4-hour-old one are two different systems, and a number taken from one
cannot be quoted as a property of the code. ⇒ **STATE THE PROCESS AGE BESIDE ANY LATENCY FIGURE
FROM THIS SERVICE**, or the figure is unreproducible by construction.

WHAT THE CACHE IS ACTUALLY FOR, on the corrected evidence — three claims, in descending strength:

 1. **Unconditional, both states:** repeat polls cost ~0 bytes and no DB work. The client re-fetches
    every 30 s; without an ETag each poll re-queried Supabase, re-materialised 1,773 ORM rows,
    validated them into Pydantic models, let `response_model` validate them a SECOND time, and
    re-serialised ~760 KB (~106 KB gzipped). There were no caching headers at all
    (`cf-cache-status: DYNAMIC`, no ETag, no Cache-Control), so nothing upstream could help.
 2. **Unconditional:** a dead Profile query per poll is gone (see the handler's note).
 3. **Insurance, not a present win:** it removes this route's ability to become the largest
    consumer on the box when the process degrades. That is worth having precisely because the
    degradation recurs — but it is a conditional benefit and must not be sold as a current one.

⭐ THE SHARED-RESOURCE CONTEXT, still true and still the reason this matters beyond one route. The
service runs `uvicorn server:app` with **no --workers**: one process, one event loop, also hosting
17 APScheduler jobs, with a DB pool of `pool_size=5 + max_overflow=3` and `pool_timeout=20`. On the
degraded process, **21 unrelated routes** — hashtags/trending, posts, notifications, grid_series,
spot-ratings — stalled in the same 20-45 s band, which is a shared resource rather than per-route
work. Memory tracked process age across three readings (746 MB at 4 min, 1,181 MB at 4 h, 1,588 MB
at 14 h against a 2,048 MB cgroup limit), which is why `services/memory_trace.py` now samples it:
⚠️ three points from three DIFFERENT processes are suggestive, not a characterised leak.

⚠️ WHAT THIS IS *NOT*. It does not fix the single worker, the memory ceiling or the 8-connection
pool — those are infrastructure, and the owner has deliberately chosen to leave them alone and fix
the code instead. This reduces demand; it does not raise supply. **Do not report the contention as
resolved on the strength of this module**, and do not attribute a future quiet spell to it without
checking the process age first.

## The two deliberate restrictions, and why each is a correctness property rather than a limitation

1. **ONLY the non-geofenced case is cached** — requests carrying `user_lat`/`user_lon` bypass
   entirely. With coordinates the response is per-user: `distance_miles` and `is_within_geofence`
   are computed per spot against that user's subscription-tier visibility radius. Caching it could
   serve one user's Privacy Shield view to another. Refusing to cache it is the only safe rule, and
   it is enforced by construction here rather than by a filter someone could later widen.
   ⭐ Note the corollary the handler now exploits: WITHOUT coordinates the response is identical for
   every caller, because `visibility_radius` feeds `is_within_geofence` and nothing else — so the
   per-request Profile lookup was already dead work on this path.

2. **ONE slot, not a keyed map** — only the wholly unfiltered catalogue is cached. Viewport
   requests carry continuous float bounds, so a keyed cache would have an unbounded key space and
   would leak memory on a box already at 85% of its limit. A single ~760 KB slot is a hard,
   auditable bound. ⛔ Do not turn this into a dict without solving eviction first; the memory
   ceiling is the binding constraint on this service, and a cache that causes an OOM is strictly
   worse than the latency it removed.

Kill switch: `SURF_SPOTS_CACHE=0` restores the previous behaviour exactly.
Tuning: `SURF_SPOTS_CACHE_TTL` seconds (default 30).
"""
import hashlib
import json
import os
import time
from typing import Optional, Tuple

# 30 s matches the client's own poll cadence (`useMapData` re-fetches every 30 s), so in the worst
# case `active_photographers_count` is one poll-interval staler than before. That field is the only
# volatile thing in the payload; the catalogue itself changes on the order of days.
DEFAULT_TTL_SECONDS = 30

# Single slot: {"etag": str, "body": bytes, "expires_at": float}
_slot: Optional[dict] = None


def _env(name: str) -> Optional[str]:
    try:
        return os.environ.get(name)
    except Exception:          # pragma: no cover - os.environ is not realistically absent
        return None


def cache_enabled() -> bool:
    """False restores the pre-cache behaviour byte-for-byte."""
    return _env("SURF_SPOTS_CACHE") != "0"


def ttl_seconds() -> int:
    raw = _env("SURF_SPOTS_CACHE_TTL")
    if raw is None:
        return DEFAULT_TTL_SECONDS
    try:
        return max(0, int(raw))
    except (TypeError, ValueError):
        # A malformed override must not disable caching silently, and must not crash the route.
        return DEFAULT_TTL_SECONDS


def is_cacheable(
    *,
    user_lat: Optional[float],
    user_lon: Optional[float],
    region: Optional[str],
    country: Optional[str],
    state_province: Optional[str],
    viewport_only: bool,
) -> bool:
    """
    True only for the wholly unfiltered, non-geofenced catalogue.

    Written as an explicit conjunction rather than a truthiness check so that a new query parameter
    added to the route does NOT silently inherit a cached response — a new filter will simply not
    be considered here, and the caller must come and think about it. ⭐ The failure mode being
    designed against is a future parameter that changes the payload while this function keeps
    saying "cacheable".
    """
    return (
        user_lat is None
        and user_lon is None
        and region is None
        and country is None
        and state_province is None
        and not viewport_only
    )


def get(now: Optional[float] = None) -> Optional[Tuple[str, bytes]]:
    """Return (etag, body) when a fresh entry exists, else None. Never raises."""
    global _slot
    if not cache_enabled():
        return None
    entry = _slot
    if not entry:
        return None
    current = time.time() if now is None else now
    if current >= entry["expires_at"]:
        _slot = None            # drop it rather than serving stale; the slot is the memory bound
        return None
    return entry["etag"], entry["body"]


def store(body: bytes, now: Optional[float] = None) -> str:
    """Store the serialised payload and return its ETag. Never raises."""
    global _slot
    etag = '"' + hashlib.sha256(body).hexdigest()[:32] + '"'
    if not cache_enabled():
        return etag
    current = time.time() if now is None else now
    _slot = {"etag": etag, "body": body, "expires_at": current + ttl_seconds()}
    return etag


def serialize(payload) -> bytes:
    """
    The one place the catalogue becomes bytes.

    `separators` drops the whitespace `json.dumps` inserts by default — on a 1,773-row payload that
    is a few percent off the wire for free, and the response is machine-read, never human-read.
    """
    return json.dumps(payload, separators=(",", ":")).encode("utf-8")


def invalidate() -> None:
    """Drop the slot. Call after any write that changes the catalogue."""
    global _slot
    _slot = None


# Test-only alias: identical behaviour, but a name that cannot be mistaken for production
# invalidation at a call site.
_reset_for_test = invalidate
