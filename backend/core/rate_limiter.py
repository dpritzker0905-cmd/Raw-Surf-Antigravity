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

import ipaddress
import os
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


def env_positive_int(name: str, default: int) -> int:
    """A positive int from the environment, read at CALL time; a typo or a value below 1 gives the default."""
    try:
        value = int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default
    return value if value >= 1 else default


def _trusted_proxy_hops() -> int:
    """How many reverse proxies in front of us append to X-Forwarded-For (env, default 1 = Render's edge).

    0 means no proxy is trusted: the header is ignored and the socket peer is the client.
    """
    try:
        return max(0, int(os.environ.get("RATE_LIMIT_TRUSTED_PROXY_HOPS", "1")))
    except ValueError:
        return 1


def _get_client_ip(request: Request) -> str:
    """The address a trusted proxy saw connect, never a value the client chose.

    Every proxy APPENDS the address it received the request from, so the left of X-Forwarded-For is whatever the
    client sent (rotating it reset a login limiter 30 times in a row, 2026-10-18 audit F-10/A1) and the right-most
    entries are the trustworthy ones. With N trusted proxies the real client is the Nth entry from the right.
    Falls back to the socket peer when the header is absent, has fewer entries than there are trusted proxies, or
    the chosen entry is not an IP address.
    """
    peer = request.client.host if request.client else "unknown"
    hops = _trusted_proxy_hops()
    forwarded = request.headers.get("x-forwarded-for")
    if hops and forwarded:
        parts = [p.strip() for p in forwarded.split(",") if p.strip()]
        if len(parts) >= hops:
            candidate = parts[-hops]
            try:
                return str(ipaddress.ip_address(candidate))
            except ValueError:
                logger.warning("[rate_limiter] ignoring non-IP forwarded entry; keying on the socket peer")
    return peer


get_client_ip = _get_client_ip


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


# --- Failure throttles: count only the attempts that failed -----------------------------------------------------
# A request limiter cannot protect an account (the attacker rotates addresses) or a gate that legitimate clients
# re-check on every page load. These count FAILURES per caller-chosen key, so a correct login or a valid code costs
# nothing and a wrong guess is what runs the budget down.

def failure_throttle_check(key: str, max_failures: int, window_seconds: int) -> None:
    """Raise 429 when `key` already has `max_failures` recorded failures inside the window."""
    now = time.monotonic()
    history = _request_log.get(key)
    if not history:
        return
    while history and history[0] < now - window_seconds:
        history.popleft()
    if len(history) >= max_failures:
        retry_after = max(1, int(window_seconds - (now - history[0])))
        logger.warning("[rate_limiter] failure throttle tripped on %s", key.split(":", 1)[0])
        raise HTTPException(
            status_code=429,
            detail=f"Too many failed attempts. Try again in {retry_after} seconds.",
            headers={"Retry-After": str(retry_after)},
        )


def failure_throttle_record(key: str) -> None:
    _request_log[key].append(time.monotonic())


def failure_throttle_clear(key: str) -> None:
    _request_log.pop(key, None)


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
