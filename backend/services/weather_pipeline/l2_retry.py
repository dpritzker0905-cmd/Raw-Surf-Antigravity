"""Retry TRANSIENT Supabase Storage rejections on the L2 upload path.

WHY (measured 2026-09-25, pilots run 36155404099): 521 of ~6,929 L2 product uploads (7.5%) came back
`HTTP 429 {"error":"too_many_connections","code":"SlowDown"}` and `_upload_to_supabase` logged a
warning and moved on — no retry. The manifest still listed those products, so the serve box restored
entries whose files never reached L2: holes that surface as partial frames (a 16-vector frame between
two 169-vector ones in srilanka_maldives that same run). Every region and model was hit; the rate is a
property of the upload burst, not of any lane.

A 429 "SlowDown" is Supabase asking the client to back off, so the fix is to back off: bounded
attempts, exponential delay with jitter (a burst of rejected uploads must not retry in lockstep and
re-trigger the same limit), honouring Retry-After when the server sends one. Only transient answers
are retried; a 4xx that means "no" (auth, bad key, duplicate with x-upsert false) is returned as-is
on the first attempt so a real error is never hidden behind five slow copies of itself.

Tunables: L2_UPLOAD_MAX_ATTEMPTS (default 5, 1 disables retries), L2_UPLOAD_RETRY_BASE_SEC (0.5),
L2_UPLOAD_RETRY_CAP_SEC (8).
"""
import logging
import os
import random
import time

logger = logging.getLogger(__name__)

RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _retry_after_seconds(resp):
    raw = (getattr(resp, "headers", None) or {}).get("Retry-After")
    try:
        return max(0.0, float(raw)) if raw is not None else None
    except (TypeError, ValueError):
        return None


def backoff_delay(attempt: int, base: float, cap: float, rand=random.random) -> float:
    """Delay before retry number `attempt` (1-based): base * 2**(attempt-1), capped, then jittered
    into [0.5x, 1.5x) so concurrent writers spread out instead of colliding again."""
    return min(cap, base * (2 ** (attempt - 1))) * (0.5 + rand())


def post_with_retry(post, label: str, *, sleep=None, rand=None):
    """Call `post()` (-> a requests.Response) until it is not a transient rejection or attempts run out.

    Returns (response, retries_used). Transport errors (connection reset / timeout) are retried the
    same way; any other exception propagates at once. The final response is returned even when it is
    still a 429 — the caller decides how loudly to fail, exactly as before this helper existed.
    """
    import requests

    # Resolved per CALL, not as default arguments: a default binds `time.sleep` once at import, which
    # would make the module-level seam (and any monkeypatch of it) silently ineffective.
    sleep = sleep or time.sleep
    rand = rand or random.random
    attempts = max(1, int(_env_float("L2_UPLOAD_MAX_ATTEMPTS", 5)))
    base = _env_float("L2_UPLOAD_RETRY_BASE_SEC", 0.5)
    cap = _env_float("L2_UPLOAD_RETRY_CAP_SEC", 8.0)
    for attempt in range(1, attempts + 1):
        try:
            resp = post()
        except (requests.ConnectionError, requests.Timeout) as exc:
            if attempt == attempts:
                raise
            delay = backoff_delay(attempt, base, cap, rand)
            logger.info(f"[L2 retry] {label}: {type(exc).__name__}; retry {attempt}/{attempts - 1} in {delay:.1f}s")
            sleep(delay)
            continue
        if resp.status_code not in RETRYABLE_STATUS or attempt == attempts:
            return resp, attempt - 1
        hinted = _retry_after_seconds(resp)
        delay = min(cap, hinted) if hinted is not None else backoff_delay(attempt, base, cap, rand)
        logger.info(f"[L2 retry] {label}: HTTP {resp.status_code}; retry {attempt}/{attempts - 1} in {delay:.1f}s")
        sleep(delay)
    return resp, attempts - 1  # unreachable; keeps linters honest
