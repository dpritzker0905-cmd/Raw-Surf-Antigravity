"""GET /api/weather/spot-ratings-url: a signed URL for the precomputed spot ratings of the caller's TIER (flip blocker 3).

Accounts only, and only while the tier clamp is on (until then the client keeps the anon lane and this answers 404).
CPU per request: a cached JWT/tier check, the per-account signing limit and a dict lookup; Supabase is asked at most once
per tier per SIGN_CACHE_S (services/spot_ratings_entitlement.py).
"""
import asyncio
from typing import Optional

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse

from services import spot_ratings_entitlement as SRE

router = APIRouter(prefix="/weather")

_PRIVATE = {"Cache-Control": "private, no-store", "Vary": "Authorization"}


@router.get("/spot-ratings-url")
async def get_spot_ratings_url(authorization: Optional[str] = Header(None)):
    from services import weather_account_rate_limit as RL
    from services import weather_tier_clamp as C
    if not C.enabled():
        raise HTTPException(status_code=404, detail="tier clamp is off")
    uid, tier = await C.resolve_identity(authorization)
    if tier == "guest":                                  # accounts only: no verified account, no URL
        return JSONResponse({"detail": "sign_in_required"}, status_code=401, headers=dict(
            _PRIVATE, **{"WWW-Authenticate": 'Bearer realm="raw-surf"', "X-Raw-Tier-Clamp": "account"}))
    wait = RL.retry_after("frame-urls", uid)             # the per-account SIGNING limit (owner 2026-11-12)
    if wait is not None:
        return JSONResponse({"detail": RL.RATE_LIMITED, "retry_after_s": wait}, status_code=429, headers=dict(
            _PRIVATE, **{"Retry-After": str(wait), "X-Raw-Tier-Clamp": RL.RATE_LIMITED}))
    url = await asyncio.to_thread(SRE.signed_url, tier)
    if not url:
        raise HTTPException(status_code=503, detail="ratings object unavailable")
    return JSONResponse({"tier": tier, "url": url, "expires_in_s": SRE.SIGN_EXPIRES_S - SRE.SIGN_CACHE_S},
                        headers={"Cache-Control": "private, max-age=300", "Vary": "Authorization"})
