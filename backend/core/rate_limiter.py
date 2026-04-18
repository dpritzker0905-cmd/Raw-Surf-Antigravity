"""
backend/core/rate_limiter.py — Simple in-memory rate limiter for FastAPI.

No external dependencies required. Uses a sliding window algorithm.
Designed for auth endpoints where brute-force protection is critical.

Usage in routes:
    from core.rate_limiter import rate_limit_check

    @router.post("/auth/login")
    async def login(request: Request, ...):
        rate_limit_check(request, max_requests=5, window_seconds=60)
        ...
"""

import time
import logging
from collections import defaultdict, deque
from typing import Dict, Deque
from fastapi import Request, HTTPException

logger = logging.getLogger(__name__)

# In-memory store: IP -> deque of timestamps
_request_log: Dict[str, Deque[float]] = defaultdict(deque)

# Trusted IPs that are never rate-limited (loopback + private network ranges)
_TRUSTED_PREFIXES = ("127.", "10.", "172.16.", "192.168.")


def _get_client_ip(request: Request) -> str:
    """Extract real client IP, respecting common proxy headers."""
    # Render / Cloudflare / Nginx pass the real IP in X-Forwarded-For
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        # Format: "client, proxy1, proxy2" — take leftmost (original client)
        return forwarded.split(",")[0].strip()
    # Direct connection fallback
    return request.client.host if request.client else "unknown"


def rate_limit_check(
    request: Request,
    max_requests: int = 10,
    window_seconds: int = 60,
    key_prefix: str = "",
) -> None:
    """
    Raise 429 if the requesting IP has exceeded max_requests within window_seconds.

    Args:
        request: The FastAPI Request object.
        max_requests: Maximum allowed requests in the window.
        window_seconds: Sliding window size in seconds.
        key_prefix: Namespace the rate limit (e.g., "login:", "signup:").

    Raises:
        HTTPException(429) if rate limit exceeded.
    """
    ip = _get_client_ip(request)

    # Never rate-limit trusted local IPs (development, internal services)
    if any(ip.startswith(p) for p in _TRUSTED_PREFIXES):
        return

    key = f"{key_prefix}{ip}"
    now = time.monotonic()
    window_start = now - window_seconds

    # Clean up timestamps outside the sliding window
    history = _request_log[key]
    while history and history[0] < window_start:
        history.popleft()

    if len(history) >= max_requests:
        retry_after = int(window_seconds - (now - history[0]))
        logger.warning(f"[rate_limiter] {ip} exceeded {max_requests} req/{window_seconds}s on {key_prefix or 'general'}")
        raise HTTPException(
            status_code=429,
            detail=f"Too many requests. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )

    history.append(now)


def cleanup_old_entries() -> int:
    """
    Periodically purge stale entries to prevent unbounded memory growth.
    Call from a scheduled job. Returns number of keys removed.
    """
    now = time.monotonic()
    cutoff = now - 3600  # Remove entries older than 1 hour
    stale = [k for k, v in _request_log.items() if not v or v[-1] < cutoff]
    for k in stale:
        del _request_log[k]
    return len(stale)
