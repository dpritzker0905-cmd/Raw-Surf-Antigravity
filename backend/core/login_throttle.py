"""Layered throttles for password sign-in: guessing is made expensive for the GUESSER, not for the account's owner.

2026-10-18 audit F-10 / Addendum A1 found the old limiter walkable (it trusted the client-written left end of
X-Forwarded-For). A flat "10 wrong guesses pauses the account for everyone" fix would let anyone who knows a username
lock its owner out again and again, so every limit here is keyed on the address a trusted proxy saw
(`rate_limiter.get_client_ip`), and only the account-wide ceiling is account-wide, and it never refuses a password:

1. (account, source address): the 5th wrong guess starts an exponential backoff (15 s, 30 s, 1 min ... capped at
   15 min) for THAT pair only. A guesser at address X does not slow the owner signing in from address Y.
2. source address across all accounts (credential stuffing): the 30th wrong login from one address starts the same
   kind of backoff for that address, counted for 10 minutes after its last failure.
3. account across all sources: a generous ceiling (100 wrong guesses per hour). Over it, FAILED responses wait a
   couple of seconds and a warning is logged; a correct password is never rejected or delayed by this layer.

A blocked caller is answered exactly like an ordinary wrong guess for that account (the route supplies the status
and body) plus a Retry-After header, so the response says nothing about whether the account exists. Blocked
attempts are not counted, and a successful sign-in clears that (account, source) pair only. Counters live in
`core.rate_limiter`'s in-memory store and expire.

Without an email service there is no step-up (confirm-by-link) here: an attacker who rotates addresses can still
guess slowly inside the ceiling. Passkeys / MFA are the real fix.
"""
import asyncio
import logging

from fastapi import Request

from core.rate_limiter import (
    _TRUSTED_PREFIXES, backoff_clear, backoff_record_failure, backoff_remaining, env_positive_int, failure_count,
    failure_throttle_record, get_client_ip,
)

logger = logging.getLogger(__name__)

BACKOFF_BASE_SECONDS = 15
BACKOFF_CAP_SECONDS = 900
PAIR_RESET_SECONDS = 3600        # an (account, source) pair is forgotten an hour after its last failure / block end
SOURCE_BACKOFF_BASE_SECONDS = 30
SOURCE_RESET_SECONDS = 600       # "30 wrong logins per 10 minutes" from one address
CEILING_WINDOW_SECONDS = 3600
CEILING_EXTRA_DELAY_SECONDS = 2
_MAX_ACCOUNT_CHARS = 100         # the account string is caller-chosen: bound what it can make us store


async def _sleep(seconds: float) -> None:
    await asyncio.sleep(seconds)


def limits() -> dict:
    """Read at call time so a deploy-time env change needs no code change."""
    return {
        "pair": env_positive_int("LOGIN_PAIR_MAX_FAILURES", 5),
        "source": env_positive_int("LOGIN_SOURCE_MAX_FAILURES", 30),
        "ceiling": env_positive_int("LOGIN_ACCOUNT_CEILING_PER_HOUR", 100),
    }


class LoginThrottle:
    def __init__(self, request: Request, account: str):
        account = (account or "")[:_MAX_ACCOUNT_CHARS]
        self.source = get_client_ip(request)
        self.account = account
        self.pair_key = f"login_pair:{account}|{self.source}"
        self.source_key = f"login_src:{self.source}"
        self.ceiling_key = f"login_acct:{account}"
        # Loopback / private addresses (development, internal callers) are never address-throttled, the same
        # exemption the request limiter has; the account-wide ceiling still applies.
        self.address_exempt = any(self.source.startswith(p) for p in _TRUSTED_PREFIXES)

    def blocked_for(self) -> int:
        """Seconds this caller must still wait (0 when free to try)."""
        if self.address_exempt:
            return 0
        return max(backoff_remaining(self.pair_key), backoff_remaining(self.source_key))

    def record_failure(self) -> int:
        """Count one wrong guess on every layer; returns the Retry-After seconds it earned (0 for none)."""
        failure_throttle_record(self.ceiling_key)
        if self.address_exempt:
            return 0
        pair = backoff_record_failure(self.pair_key, limits()["pair"], BACKOFF_BASE_SECONDS, BACKOFF_CAP_SECONDS,
                                      PAIR_RESET_SECONDS)
        source = backoff_record_failure(self.source_key, limits()["source"], SOURCE_BACKOFF_BASE_SECONDS,
                                        BACKOFF_CAP_SECONDS, SOURCE_RESET_SECONDS)
        return max(pair, source)

    def record_success(self) -> None:
        """A correct password clears this (account, source) pair and nothing else."""
        backoff_clear(self.pair_key)

    async def delay_if_over_ceiling(self) -> None:
        """Failed responses only: past the account-wide ceiling, answer slowly and leave a trace (no secrets)."""
        if failure_count(self.ceiling_key, CEILING_WINDOW_SECONDS) >= limits()["ceiling"]:
            logger.warning("[login_throttle] account over its %d wrong guesses/hour ceiling; delaying failed "
                           "responses (distributed guessing or a stuffing run)", limits()["ceiling"])
            await _sleep(CEILING_EXTRA_DELAY_SECONDS)
