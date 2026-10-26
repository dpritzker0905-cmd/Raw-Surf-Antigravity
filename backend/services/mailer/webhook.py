"""Bounce/complaint webhook signature check (Svix scheme, which Resend uses).

Signed content is f"{svix-id}.{svix-timestamp}.{raw body}", HMAC-SHA256 with the secret (base64 after a
"whsec_" prefix), base64-encoded; the header holds one or more space-separated "v1,<signature>" entries.
Fails closed: no secret, missing headers, a stale timestamp or a wrong signature all return False/raise.
"""
import base64
import binascii
import hashlib
import hmac
import time
from typing import Optional

TOLERANCE_SECONDS = 300


def _key(secret: str) -> Optional[bytes]:
    if secret.startswith("whsec_"):
        try:
            return base64.b64decode(secret[len("whsec_"):], validate=True)
        except (binascii.Error, ValueError):
            return None
    return secret.encode("utf-8") or None


def sign(secret: str, msg_id: str, timestamp: str, body: bytes) -> str:
    key = _key(secret)
    if key is None:
        raise ValueError("bad secret")
    digest = hmac.new(key, f"{msg_id}.{timestamp}.".encode("utf-8") + body, hashlib.sha256).digest()
    return "v1," + base64.b64encode(digest).decode("ascii")


def verify(secret: str, msg_id: str, timestamp: str, signature_header: str, body: bytes,
           now: Optional[float] = None) -> bool:
    if not (secret and msg_id and timestamp and signature_header):
        return False
    try:
        age = abs((now if now is not None else time.time()) - int(timestamp))
    except ValueError:
        return False
    if age > TOLERANCE_SECONDS:
        return False
    try:
        expected = sign(secret, msg_id, timestamp, body)
    except ValueError:
        return False
    # Constant-time comparison against every offered signature (a rotated secret sends two).
    return any(hmac.compare_digest(expected, candidate) for candidate in signature_header.split())
