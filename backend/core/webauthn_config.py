"""
backend/core/webauthn_config.py -- which sites may use passkeys with this backend, and under which relying-party id.

A passkey is bound to the RP ID chosen when it was created and the BROWSER checks it against the page's own origin,
which is the FRONTEND (Netlify), not this API (Render). One backend serves several frontends (production, the dev
branch site, local development), so the server keeps an allow-list rather than one value:

  WEBAUTHN_ALLOWED_ORIGINS  exact origins, comma-separated, e.g. the production site and the dev branch site.
                            Empty or unset = passkeys are unavailable (the Security page says so).
  WEBAUTHN_RP_ID            optional registrable domain shared by several allowed origins (a custom domain and its
                            www). Used for an origin whose host equals it or is a subdomain of it; any other
                            origin gets its OWN host as RP ID. Unset = every origin uses its own host, so
                            production and dev passkeys are separate credentials (a dev passkey is never a
                            production one).

The request's Origin header must match an allowed origin exactly. A ceremony stores the RP ID and origin it was opened
with and verification uses those stored values, never the request's. Names only here; no values.
"""
import os
from typing import List, NamedTuple, Optional
from urllib.parse import urlparse

ENV_ORIGINS = "WEBAUTHN_ALLOWED_ORIGINS"
ENV_RP_ID = "WEBAUTHN_RP_ID"
RP_NAME = "Raw Surf"


class RpContext(NamedTuple):
    rp_id: str
    origin: str


def normalize_origin(value: Optional[str]) -> Optional[str]:
    """scheme://host[:port], lower-cased, no path or trailing slash; None when it is not an origin."""
    try:
        parsed = urlparse((value or "").strip())
        host = parsed.hostname
        if parsed.scheme not in ("http", "https") or not host or parsed.path not in ("", "/"):
            return None
        port = f":{parsed.port}" if parsed.port else ""
        return f"{parsed.scheme}://{host.lower()}{port}"
    except ValueError:
        return None


def allowed_origins() -> List[str]:
    out = []
    for part in os.environ.get(ENV_ORIGINS, "").split(","):
        origin = normalize_origin(part)
        if origin and origin not in out:
            out.append(origin)
    return out


def passkeys_available() -> bool:
    return bool(allowed_origins())


def resolve_rp(origin_header: Optional[str]) -> Optional[RpContext]:
    """The relying party for a request, or None when its Origin is not an allowed site."""
    origin = normalize_origin(origin_header)
    if origin is None or origin not in allowed_origins():
        return None
    host = urlparse(origin).hostname
    shared = os.environ.get(ENV_RP_ID, "").strip().lower()
    if shared and (host == shared or host.endswith("." + shared)):
        return RpContext(rp_id=shared, origin=origin)
    return RpContext(rp_id=host, origin=origin)
