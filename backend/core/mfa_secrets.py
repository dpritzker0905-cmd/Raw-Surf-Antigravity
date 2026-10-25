"""
backend/core/mfa_secrets.py -- encryption of TOTP secrets and hashing of recovery codes.

The key comes from the environment variable MFA_ENCRYPTION_KEY (its NAME only is referenced anywhere in the repo).
It holds one Fernet key, or several separated by commas: the FIRST encrypts and hashes, ALL are tried when
decrypting or matching, so the key can be rotated without invalidating anything already stored.

Generate a key with:  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Fail-closed rules:
  * unset or malformed key -> mfa_configured() is False, a startup warning names the variable, and the enrolment
    route refuses. Users with no factor are unaffected; users who already have one cannot be silently downgraded
    because decryption raises instead of guessing.
  * a secret is never logged, returned after enrolment, or stored in the clear.
"""
import base64
import hashlib
import hmac
import logging
import os
import secrets
from typing import List, Optional

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF

logger = logging.getLogger(__name__)

ENV_NAME = "MFA_ENCRYPTION_KEY"
RECOVERY_CODE_COUNT = 10
RECOVERY_CODE_LENGTH = 10  # 32-symbol alphabet -> 50 bits each
# No 0/1/I/O: a code read off paper or a screen must survive being typed back in.
_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
_warned = False


class MfaKeyError(RuntimeError):
    """The encryption key is missing, malformed, or cannot open a stored value."""


def _raw_keys() -> List[bytes]:
    value = os.environ.get(ENV_NAME, "")
    return [part.strip().encode("ascii", "ignore") for part in value.split(",") if part.strip()]


def _fernets() -> List[Fernet]:
    try:
        return [Fernet(key) for key in _raw_keys()]
    except (ValueError, TypeError):
        return []


def mfa_configured() -> bool:
    """True when at least one well-formed key is present and ALL listed keys parse."""
    keys = _raw_keys()
    return bool(keys) and len(_fernets()) == len(keys)


def warn_if_unconfigured() -> None:
    """One startup warning naming the variable. Called when the MFA routes are imported."""
    global _warned
    if _warned or mfa_configured():
        return
    _warned = True
    logger.warning(
        "[mfa] %s is not set (or is malformed): two-factor ENROLMENT IS DISABLED until a Fernet key is provided. "
        "Accounts without a second factor sign in as before. Generate a key with: python -c \"from cryptography."
        "fernet import Fernet; print(Fernet.generate_key().decode())\"", ENV_NAME,
    )


def encrypt_secret(plain: str) -> str:
    fernets = _fernets()
    if not fernets or len(fernets) != len(_raw_keys()):
        raise MfaKeyError("MFA_ENCRYPTION_KEY is not configured")
    return MultiFernet(fernets).encrypt(plain.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str:
    fernets = _fernets()
    if not fernets:
        raise MfaKeyError("MFA_ENCRYPTION_KEY is not configured")
    try:
        return MultiFernet(fernets).decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError, UnicodeError) as exc:
        raise MfaKeyError("stored MFA secret cannot be decrypted with the configured key") from exc


# ── Recovery codes ────────────────────────────────────────────────────────────

def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> List[str]:
    codes = []
    for _ in range(count):
        raw = "".join(secrets.choice(_ALPHABET) for _ in range(RECOVERY_CODE_LENGTH))
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def normalize_recovery_code(raw: str) -> str:
    return "".join(ch for ch in (raw or "").upper() if ch.isalnum())


def _hash_keys() -> List[bytes]:
    """One 32-byte HMAC key per configured encryption key, domain-separated from the encryption use."""
    derived = []
    for key in _raw_keys():
        try:
            material = base64.urlsafe_b64decode(key)
        except (ValueError, TypeError):
            continue
        derived.append(HKDF(algorithm=hashes.SHA256(), length=32, salt=None,
                            info=b"raw-surf mfa recovery code v1").derive(material))
    return derived


def hash_recovery_code(code: str) -> str:
    """HMAC-SHA256 under the FIRST key. Codes carry 50 bits, so the secret key (not a work factor) is the defence."""
    keys = _hash_keys()
    if not keys:
        raise MfaKeyError("MFA_ENCRYPTION_KEY is not configured")
    return hmac.new(keys[0], normalize_recovery_code(code).encode("ascii"), hashlib.sha256).hexdigest()


def recovery_code_matches(code: str, stored_hash: str) -> bool:
    """Constant-time check against every configured key (so a rotation keeps old codes valid)."""
    normalized = normalize_recovery_code(code).encode("ascii", "ignore")
    matched = False
    for key in _hash_keys():
        candidate = hmac.new(key, normalized, hashlib.sha256).hexdigest()
        if hmac.compare_digest(candidate.encode("ascii"), stored_hash.encode("ascii", "ignore")):
            matched = True
    return matched


# ── Opaque challenge tokens ───────────────────────────────────────────────────

def new_opaque_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: Optional[str]) -> str:
    """SHA-256 of an opaque token: the only form the database ever holds."""
    return hashlib.sha256((token or "").encode("utf-8", "ignore")).hexdigest()
