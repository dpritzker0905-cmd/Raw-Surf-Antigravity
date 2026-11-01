"""
backend/core/mfa_limits.py -- a small per-key failure window for the step-up checks (password re-entry on MFA changes).

The per-IP sign-in throttle (core/rate_limiter.py) is not touched by MFA work. This module only adds a limiter keyed
by ACCOUNT for the one place a stolen session token could otherwise be used to guess the password: the MFA
management routes ask for the current password, and wrong answers are counted per user id here, in memory, in the
single backend process. A block only affects those management routes, never sign-in.
"""
import time
from collections import defaultdict, deque
from typing import Deque, Dict

from fastapi import HTTPException

_failures: Dict[str, Deque[float]] = defaultdict(deque)

MAX_FAILURES = 8
WINDOW_SECONDS = 900


def _prune(key: str, now: float) -> Deque[float]:
    history = _failures[key]
    while history and history[0] < now - WINDOW_SECONDS:
        history.popleft()
    return history


def check_not_blocked(key: str) -> None:
    now = time.monotonic()
    history = _prune(key, now)
    if len(history) >= MAX_FAILURES:
        retry = max(1, int(WINDOW_SECONDS - (now - history[0])))
        raise HTTPException(status_code=429, detail=f"Too many incorrect attempts. Try again in {retry} seconds.",
                            headers={"Retry-After": str(retry)})


def record_failure(key: str) -> None:
    now = time.monotonic()
    _prune(key, now).append(now)


def clear(key: str) -> None:
    _failures.pop(key, None)


def reset_all_for_tests() -> None:
    _failures.clear()
