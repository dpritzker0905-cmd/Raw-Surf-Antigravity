"""_service_auth.py: the header a scheduled job sends so the forecast clamp knows it (services/weather_service_identity.py).

The key is read from env WEATHER_SERVICE_KEY (a GitHub Actions secret, by name only: this repository is public). Unset,
nothing is added and the request is exactly what it was before the clamp, so a local run or a fork without the secret
behaves as it always did (and gets 401 once the clamp is on, which is the point).

ONLY TO OUR OWN BACKEND. Every job takes a base-URL override (RAW_SURF_BASE_URL, --base, ...). The key is attached only
when the request goes over https to a host in KEY_HOSTS, or to a local server, so a mistyped or hostile override never
receives it. Add a host here deliberately, in review.

Import it the sibling way (scripts run by path, so `scripts` is not a package then):
    try:
        from _service_auth import service_headers
    except ImportError:
        from scripts._service_auth import service_headers
"""
import os
from urllib.parse import urlsplit

ENV = "WEATHER_SERVICE_KEY"
HEADER = "X-Raw-Service-Key"
KEY_HOSTS = ("raw-surf-antigravity.onrender.com",)
LOCAL_HOSTS = ("localhost", "127.0.0.1", "::1")


def key_allowed_for(url):
    """True when `url` is our live backend over https, or a local server (any scheme)."""
    try:
        parts = urlsplit(str(url))
    except ValueError:
        return False
    host = (parts.hostname or "").lower()
    if host in LOCAL_HOSTS:
        return True
    return parts.scheme == "https" and host in KEY_HOSTS


def service_headers(url, headers=None):
    """`headers` (a new dict) plus the service key header when the key is set and `url` may carry it. Never prints or
    logs the key."""
    out = dict(headers or {})
    key = (os.environ.get(ENV) or "").strip()
    if key and key_allowed_for(url):
        out[HEADER] = key
    return out
