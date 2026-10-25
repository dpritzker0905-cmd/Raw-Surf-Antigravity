"""Provider-agnostic email types. Nothing here performs I/O."""
import hashlib
import re
from dataclasses import dataclass
from typing import Optional

_ADDRESS_RE = re.compile(r"^[^@\s,;<>\"()\[\]\\]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9.-]{0,253}[A-Za-z0-9])?\.[A-Za-z]{2,63}$")


def normalize_address(address: str) -> str:
    return (address or "").strip().lower()


def is_valid_address(address: str) -> bool:
    """Deliberately strict: one plain mailbox, no display name, no list, no control characters."""
    return bool(address) and len(address) <= 254 and bool(_ADDRESS_RE.match(address))


def address_hash(address: str) -> str:
    """The only identifier used for suppression, rate limits and logs."""
    return hashlib.sha256(("rawsurf-email:" + normalize_address(address)).encode("utf-8")).hexdigest()


def log_ref(address: str) -> str:
    """Short, non-reversible reference that is safe to log in place of an address."""
    return address_hash(address)[:10]


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    html: str
    text: str
    template: str = ""


@dataclass(frozen=True)
class SendResult:
    ok: bool
    provider_message_id: Optional[str] = None
    error: Optional[str] = None      # short code: "http_503", "timeout", "not_configured" ... never a body
    retryable: bool = False
    configured: bool = True


class EmailSender:
    """Interface every provider implements. `idempotency_key` lets a provider dedupe our own retries."""

    name = "base"
    configured = True

    async def send(self, message: EmailMessage, idempotency_key: str) -> SendResult:  # pragma: no cover
        raise NotImplementedError
