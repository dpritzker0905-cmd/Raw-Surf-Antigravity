"""
backend/core/totp.py -- RFC 6238 time-based one-time passwords, standard library only.

Parameters are the ones every authenticator app implements: HMAC-SHA1, 6 digits, 30 second step. Nothing here
touches the network, the database or the environment; it is pure functions so the RFC test vectors can pin it.

Verification returns the MATCHED STEP, not a bool. The caller stores that step and refuses any step it has already
accepted (RFC 6238 section 5.2: a code may be used once), which is what stops a code shoulder-surfed or replayed
inside its validity window from being accepted twice.
"""
import base64
import hashlib
import hmac
import secrets
import struct
import time
from typing import Optional
from urllib.parse import quote

DIGITS = 6
PERIOD = 30
SKEW_STEPS = 1  # accept the previous and the next step as well as the current one


def generate_secret() -> str:
    """A fresh 160-bit secret as unpadded base32 (the form authenticator apps take)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _key_bytes(secret_b32: str) -> bytes:
    cleaned = secret_b32.replace(" ", "").upper()
    return base64.b32decode(cleaned + "=" * (-len(cleaned) % 8))


def hotp(secret_b32: str, counter: int, digits: int = DIGITS, digest=hashlib.sha1) -> str:
    """RFC 4226 HOTP value for a counter."""
    mac = hmac.new(_key_bytes(secret_b32), struct.pack(">Q", counter), digest).digest()
    offset = mac[-1] & 0x0F
    truncated = struct.unpack(">I", mac[offset:offset + 4])[0] & 0x7FFFFFFF
    return str(truncated % (10 ** digits)).zfill(digits)


def step_for(now: Optional[float] = None, period: int = PERIOD) -> int:
    return int((time.time() if now is None else now) // period)


def totp_at(secret_b32: str, now: Optional[float] = None, period: int = PERIOD,
            digits: int = DIGITS, digest=hashlib.sha1) -> str:
    return hotp(secret_b32, step_for(now, period), digits, digest)


def verify(secret_b32: str, code: str, now: Optional[float] = None, last_used_step: Optional[int] = None,
           skew: int = SKEW_STEPS) -> Optional[int]:
    """
    The step a submitted code matches, or None.

    Every candidate step is computed and compared in constant time, with no early exit, so response time does not
    reveal which step (or how many digits) matched. Steps at or before `last_used_step` are never returned.
    """
    submitted = "".join(ch for ch in (code or "") if not ch.isspace())
    if len(submitted) != DIGITS or not submitted.isascii() or not submitted.isdigit():
        return None
    current = step_for(now)
    matched: Optional[int] = None
    for step in range(current - skew, current + skew + 1):
        expected = hotp(secret_b32, step)
        if hmac.compare_digest(expected.encode("ascii"), submitted.encode("ascii")):
            if (last_used_step is None or step > last_used_step) and (matched is None or step > matched):
                matched = step
    return matched


def provisioning_uri(secret_b32: str, account: str, issuer: str = "Raw Surf") -> str:
    """otpauth:// URI for QR codes. The account label and issuer are percent-encoded."""
    label = f"{quote(issuer, safe='')}:{quote(account, safe='')}"
    return (f"otpauth://totp/{label}?secret={secret_b32}&issuer={quote(issuer, safe='')}"
            f"&algorithm=SHA1&digits={DIGITS}&period={PERIOD}")
