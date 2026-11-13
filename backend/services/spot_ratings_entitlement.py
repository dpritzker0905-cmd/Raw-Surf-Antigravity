"""spot_ratings_entitlement.py: the precomputed spot ratings, per tier, behind signed URLs (flip blocker 3, 2026-11-12).

WHY. The map reads the precomputed ratings straight off Supabase (`spotRatingsCdn.js`): one object,
`weather-products/spot_ratings/latest.json`, readable with the PUBLIC anon key by a scoped storage policy
(`supabase_scripts/storage_rls_spot_ratings_scoped_read.sql`). With the accounts-only clamp on (owner 2026-11-12: "we
do not want non-account holders to access the data"), that policy is a way around it for anyone, and the object holds
every model, so a free account could read the paid models' ratings too. The app's login tokens are NOT Supabase tokens,
so no storage policy can tell an account from a guest: the backend has to decide, as it does for the static frames
(#783, weather_frame_urls.py).

THE SHAPE.
  * The precompute writes one object PER TIER beside latest.json (TIER_KEYS): each holds only the frames that tier may
    see, by the ONE ladder (forecast_tier_window: allowed_models + tier_horizon_hours, pinned to the JS resolver).
    Premium sees everything, so premium's object IS latest.json (no third copy).
  * GET /api/weather/spot-ratings-url (routes/weather_spot_ratings_url.py) answers an ACCOUNT with a signed URL for its
    tier's object. Signed once per tier per SIGN_CACHE_S and shared by every account of that tier: one Supabase call per
    tier per 10 minutes, whatever the traffic.
  * The client uses it only while the clamp is on; until then it keeps the anon lane, unchanged.
  * AT THE FLIP the anon policy is dropped (supabase_scripts/storage_rls_spot_ratings_drop_anon.sql, an owner action),
    so the object is service-role only and every read goes through a signature.
LEAK BOUND: a signed URL is valid SIGN_EXPIRES_S; whoever holds one reads that tier's ratings until then (the same bound
as the frame URLs).
"""
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, List, Optional, Tuple

from services import forecast_tier_window as FTW
from services.weather_pipeline.spot_ratings import SPOT_RATINGS_L2_KEY

logger = logging.getLogger(__name__)

BUCKET = "weather-products"
TIER_KEYS = {
    "free": "spot_ratings/tier/free.json",
    "basic": "spot_ratings/tier/basic.json",
    "premium": SPOT_RATINGS_L2_KEY,          # everything: the object the precompute already writes
}
WRITTEN = ("free", "basic")                  # the per-tier copies the precompute adds
SIGN_EXPIRES_S = 1800
SIGN_CACHE_S = 600                           # re-signed well before expiry: a cached URL always has >= 20 min left


def _parse(ts) -> Optional[datetime]:
    try:
        t = datetime.fromisoformat(str(ts).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def tier_object(obj: dict, tier: str, now: Optional[datetime] = None) -> dict:
    """PURE. `obj` with only the frames `tier` may see: a model the tier has, a valid_time inside its window from `now`
    (the object's own generated_at when not given). A frame with no parseable time is left out (fail closed)."""
    tier = FTW.canonical_tier(tier)
    now = now or _parse(obj.get("generated_at")) or datetime.now(timezone.utc)
    allowed = set(FTW.allowed_models(tier))
    frames = []
    for f in obj.get("frames") or []:
        model = str((f or {}).get("model") or "").upper()
        vt = _parse((f or {}).get("valid_time"))
        if model in allowed and vt is not None and vt <= now + timedelta(hours=FTW.tier_horizon_hours(tier, model)):
            frames.append(f)
    return dict(obj, frames=frames, tier=tier)


def upload_tier_objects(store, obj: dict) -> List[str]:
    """Write each WRITTEN tier's copy beside latest.json. Never raises: a failed copy leaves the client on its fallback
    (the clamped /spot-ratings endpoint), never on another tier's object."""
    done = []
    for tier in WRITTEN:
        try:
            data = json.dumps(tier_object(obj, tier), separators=(",", ":")).encode("utf-8")
            store._upload_to_supabase(TIER_KEYS[tier], data)
            done.append(TIER_KEYS[tier])
        except Exception as e:                              # noqa: BLE001
            logger.warning("[spot-ratings] tier copy %s failed: %s", tier, type(e).__name__)
    return done


def _storage() -> Tuple[str, str]:
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    return base, key


def sign_object(path: str, expires_s: int) -> Optional[str]:
    """An absolute signed URL for one object of BUCKET (service role), or None."""
    import requests
    base, key = _storage()
    if not base or not key:
        return None
    r = requests.post(f"{base}/storage/v1/object/sign/{BUCKET}/{path}", json={"expiresIn": int(expires_s)},
                      headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=10)
    if r.status_code != 200:
        logger.warning("[spot-ratings-url] sign HTTP %s", r.status_code)
        return None
    rel = (r.json() or {}).get("signedURL") or (r.json() or {}).get("signedUrl")
    if not rel:
        return None
    return rel if rel.startswith("http") else f"{base}/storage/v1{rel}"


_sign_cache: Dict[str, Tuple[float, str]] = {}


def signed_url(tier: str, *, sign: Callable = None, clock: Callable[[], float] = time.monotonic) -> Optional[str]:
    """The signed URL for `tier`'s object, cached SIGN_CACHE_S per tier. Guest (or anything unknown) gets None."""
    tier = FTW.canonical_tier(tier)
    if tier not in TIER_KEYS:
        return None
    hit = _sign_cache.get(tier)
    if hit and clock() - hit[0] < SIGN_CACHE_S:
        return hit[1]
    url = (sign or sign_object)(TIER_KEYS[tier], SIGN_EXPIRES_S)
    if url:
        _sign_cache[tier] = (clock(), url)
    return url
