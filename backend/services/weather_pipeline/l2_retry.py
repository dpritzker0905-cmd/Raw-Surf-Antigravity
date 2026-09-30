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


# ── THE READ SIDE (2026-09-30, W-23; LESSONS L-F7) ──────────────────────────────────────────────────────────────────
# The serve box's dynamic L2 download had no retry and put EVERY failure, a transient 429 included, in the negative
# cache that means "this file does not exist": a refused read became an absent product, and the resolver silently
# answered from the 2-degree tier while the payload said `regional` (9 of 57 /grid calls in one burst, 2026-09-30
# 02:23Z, each with its own Render line). Three parts: retry transient reads with a SHORT budget (users wait on this
# path), let the caller cache a transient failure for seconds rather than as absence, and record each refused read in
# a per-call registry so the answer can SAY it was served around one. Kill: L2_READ_MAX_ATTEMPTS=1.
import contextvars
import functools
import re

_READ_FAILURES = contextvars.ContextVar("l2_read_failures", default=None)


def transient_storage_error(exc) -> bool:
    """True when a storage exception is Supabase asking us to back off or a transport hiccup (429/5xx, SlowDown,
    too_many_connections, timeouts, resets), False for an answer that means "no" (404 not found, 400, auth). PURE."""
    for arg in getattr(exc, "args", ()) or ():
        if isinstance(arg, dict):
            try:
                if int(arg.get("statusCode") or arg.get("status") or 0) in RETRYABLE_STATUS:
                    return True
            except (TypeError, ValueError):
                pass
    text = f"{type(exc).__name__} {exc}".lower()
    return any(k in text for k in ("429", "too_many_connections", "slowdown", "timeout", "timed out",
                                   "connection reset", "connecterror", "remoteprotocolerror", " 502", " 503", " 504"))


def read_with_retry(read, label: str, *, sleep=None, rand=None):
    """`read()` until it succeeds or fails with a non-transient error; transient failures retry with jittered backoff
    (L2_READ_MAX_ATTEMPTS default 3, base 0.2 s, cap 1 s: at most ~0.9 s added on a user's request). Re-raises."""
    sleep = sleep or time.sleep
    rand = rand or random.random
    attempts = max(1, int(_env_float("L2_READ_MAX_ATTEMPTS", 3)))
    base = _env_float("L2_READ_RETRY_BASE_SEC", 0.2)
    cap = _env_float("L2_READ_RETRY_CAP_SEC", 1.0)
    for attempt in range(1, attempts + 1):
        try:
            return read()
        except Exception as exc:  # noqa: BLE001 - classified below; anything not transient propagates at once
            if attempt == attempts or not transient_storage_error(exc):
                raise
            delay = backoff_delay(attempt, base, cap, rand)
            logger.info(f"[L2 read retry] {label}: {type(exc).__name__}; retry {attempt}/{attempts - 1} in {delay:.2f}s")
            sleep(delay)


def note_read_failure(filename: str, exc) -> None:
    """Record a TRANSIENT refused read in the current call's registry (no-op outside a labelled call)."""
    reg = _READ_FAILURES.get()
    if reg is not None:
        m = re.search(r"\b(429|5\d\d)\b", str(exc))
        reg.append({"file": filename, "status": f"HTTP {m.group(1)}" if m else type(exc).__name__})


def _stamp(result, failures):
    if not failures or result is None:
        return result
    pid = getattr(result, "product_id", None)
    refused = [f for f in failures if f["file"] != pid]
    if not refused:
        return result
    names = ", ".join(sorted({f["file"] for f in refused})[:3])
    msg = (f"L2 read refused ({refused[0]['status']}) for {names}; this answer may come from a coarser or substitute "
           f"tier than the one that covers the request")
    for attr in ("fallbackReason", "fallback_reason"):
        if hasattr(result, attr) and getattr(result, attr) is None:
            setattr(result, attr, "l2_read_refused")
            break
    warns = getattr(result, "warnings", None)
    if isinstance(warns, list) and msg not in warns:
        warns.append(msg)
    return result


def label_l2_read_failures(fn):
    """Decorator for an async resolver: a fresh refused-read registry per call, and the answer stamped
    (`fallbackReason`/`fallback_reason` = "l2_read_refused" + a warning) when a read was refused and the served
    product is not the refused one."""
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        token = _READ_FAILURES.set([])
        try:
            result = await fn(*args, **kwargs)
            return _stamp(result, _READ_FAILURES.get())
        finally:
            _READ_FAILURES.reset(token)
    return wrapper
