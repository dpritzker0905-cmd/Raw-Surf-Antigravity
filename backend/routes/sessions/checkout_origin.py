"""Allowed Raw Surf return origins for live-session checkout."""
import os
from urllib.parse import urlsplit

from fastapi import HTTPException

from core.security import dev_identity_allowed


_DEFAULT = "https://raw.surf"
_ORIGINS = {
    _DEFAULT,
    "https://www.raw.surf",
    "https://rawsurf.netlify.app",
    "https://dev--rawsurf.netlify.app",
}


def checkout_origin(requested: str | None) -> str:
    configured = {os.environ.get(name, "").rstrip("/") for name in ("FRONTEND_URL", "APP_URL")}
    allowed = _ORIGINS | (configured - {""})
    if requested is None:
        return os.environ.get("FRONTEND_URL", "").rstrip("/") or _DEFAULT
    origin = requested.rstrip("/")
    try:
        parsed = urlsplit(origin)
    except ValueError:
        parsed = urlsplit("")
    if origin in allowed:
        return origin
    if (
        dev_identity_allowed()
        and parsed.scheme in {"http", "https"}
        and parsed.hostname in {"localhost", "127.0.0.1"}
        and not (parsed.username or parsed.password or parsed.path or parsed.query or parsed.fragment)
    ):
        return origin
    raise HTTPException(status_code=400, detail="Checkout return site is not supported")
