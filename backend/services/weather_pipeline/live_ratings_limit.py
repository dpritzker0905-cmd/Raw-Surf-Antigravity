"""live_ratings_limit.py — per-IP limit on the /spot-ratings LIVE compute path (audit SRV-6, 2026-11-10).

One anonymous client could hold both live slots (7.5-8.6 s CPU each) indefinitely by asking for times off the
precompute ladder. Sliding window per IP via core.rate_limiter; only the live path calls this, so precomputed and
cached answers are never limited. Default 6 per 60 s; kill: SPOT_RATINGS_LIVE_PER_IP_MAX=0.
(Read here, not in routes/, where tests/test_routes_flags_not_in_registry.py polices operational env reads.)
"""
import os


def check_live_ratings_ip_limit(request) -> None:
    """Raise HTTPException(429) when this IP has used its live-compute budget; no-op without a request or when off."""
    try:
        limit = int(os.environ.get("SPOT_RATINGS_LIVE_PER_IP_MAX", "6") or 0)
    except ValueError:
        limit = 6
    if request is None or limit <= 0:
        return
    from core.rate_limiter import rate_limit_check
    rate_limit_check(request, max_requests=limit, window_seconds=60, key_prefix="spot_ratings_live:")
