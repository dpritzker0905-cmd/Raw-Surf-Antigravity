"""weather_service_identity.py: the ONE non-human identity the forecast clamp accepts (flip blocker 1, 2026-11-12).

WHY. With WEATHER_TIER_CLAMP on, a forecast read without a verified account gets 401 (owner 2026-11-12: "we do not want
non-account holders to access the data"). Three scheduled GitHub jobs read the LIVE forecast routes without any
identity, and would all start failing at the flip (each step now carries the secret):
  forecast-calibration-census.yml  step 4  verify_point_spot_reference.py   /api/weather/point
  nearshore-validation.yml                 run_nearshore_validation.py      /api/weather/point
  sim-parity-monitor.yml                   sim_health_probe.py              /api/weather/* (sim reads)
Two operator probes that the ingest workflows only cite (same_model_parity_probe.py, tier_resolution_delta.py) send it
too when run with the key in the environment. marine-nightly's harnesses answer from an offline mock and never reach
the live box.

THE KEY. A shared secret, by NAME only (this repository is public): env WEATHER_SERVICE_KEY, set in Render (the server)
and as the GitHub Actions secret of the same name (the jobs). A job sends it in the X-Raw-Service-Key header
(scripts/_service_auth.py). The middleware compares it in constant time; a match is the identity SERVICE_UID at
SERVICE_TIER. No key configured on the server = no service identity at all (fail closed), and a configured key shorter
than MIN_KEY_LEN is ignored the same way, so an empty or placeholder value can never open the door.

WHY PREMIUM AND NOT RATE-LIMITED. The jobs measure what paying users are served (tier_resolution_delta compares tiers;
the parity probes read EURO and ICON), and they ran unthrottled before the flip; a premium identity keeps their numbers
identical. The per-account limit is for human accounts: a job's call volume is fixed by its own code and reviewed in git.
LEAK BOUND: a leaked key reads what a premium account reads, no more (no writes, no admin routes: only the clamp
consults it). Rotate it in both places to revoke.
"""
import hmac
import os
from typing import Optional, Tuple

ENV = "WEATHER_SERVICE_KEY"
HEADER = b"x-raw-service-key"
SERVICE_UID = "service:scheduled-jobs"
SERVICE_TIER = "premium"
MIN_KEY_LEN = 32


def configured_key() -> Optional[str]:
    key = (os.environ.get(ENV) or "").strip()
    return key if len(key) >= MIN_KEY_LEN else None


def from_headers(headers) -> Optional[Tuple[str, str]]:
    """(SERVICE_UID, SERVICE_TIER) when the ASGI headers carry the configured key; else None. Never raises."""
    key = configured_key()
    if key is None:
        return None
    sent = next((v for k, v in headers or [] if k == HEADER), None)
    if not sent:
        return None
    try:
        return (SERVICE_UID, SERVICE_TIER) if hmac.compare_digest(sent.strip(), key.encode("latin-1")) else None
    except (TypeError, UnicodeEncodeError):
        return None


def is_service(uid: Optional[str]) -> bool:
    return uid == SERVICE_UID
