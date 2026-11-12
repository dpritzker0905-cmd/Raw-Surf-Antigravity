"""GET /api/weather/frame-urls: signed URLs for the static frames a caller's ACCOUNT is entitled to (O6). HELD OFF.

One request per pinned index per session: the client pins a run index from the PUBLIC latest.json (path-free: every
forecast frame is private, owner 2026-11-12 "accounts only"); it asks here once and receives signed URLs for the classes
its JWT tier allows: free = GFS to 3 days (+ margin), basic, premium. No verified account: 401, no URLs (the client's
expired-session prompt keys on `X-Raw-Tier-Clamp: account`, as for the weather reads).

CPU on the 1-CPU box: per request, a JWT check, a cached dict lookup and a JSON response. The FULL index is read from the
private bucket once per path (immutable, content-addressed), and the signatures are minted ONCE per (index, class) for
SIGN_CACHE_S and shared by every entitled user: the Smart CDN keys each signed URL's token separately, so sharing the URL
is what keeps the paid frames' CDN hit rate equal to the public ones'. Signing is one batch call per (index, class) per
SIGN_CACHE_S: at most ~150 sets x 3 classes per cycle, whatever the number of users.

Leak bound: a signed URL is valid SIGN_EXPIRES_S; its cached CDN response outlives the token until retention deletes the
object (about two runs), i.e. it can only ever reveal a forecast that is already being replaced.
"""
import logging
import os
import time
from collections import OrderedDict
from typing import Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.responses import JSONResponse

from services import frame_entitlement as FE

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/weather")

SIGN_EXPIRES_S = 36 * 3600       # every URL handed out keeps >= SIGN_EXPIRES_S - SIGN_CACHE_S of life
SIGN_CACHE_S = 6 * 3600
INDEX_CACHE_MAX = 512
_index_cache: "OrderedDict[str, dict]" = OrderedDict()
_sign_cache: Dict[Tuple[str, str], Tuple[float, Dict[str, str]]] = {}


def _storage():
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    return base, key


def read_paid_index(path: str) -> Optional[dict]:
    """The FULL index from the private bucket (service role), or None."""
    import requests
    base, key = _storage()
    if not base or not key:
        return None
    r = requests.get(f"{base}/storage/v1/object/{FE.PRIVATE_BUCKET}/{path}",
                     headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=10)
    return r.json() if r.status_code == 200 else None


def sign_paths(paths: List[str], expires_s: int) -> Dict[str, str]:
    """{object path: absolute signed URL} via ONE Supabase batch-sign call (createSignedUrls)."""
    import requests
    base, key = _storage()
    if not base or not key or not paths:
        return {}
    r = requests.post(f"{base}/storage/v1/object/sign/{FE.PRIVATE_BUCKET}", json={"expiresIn": int(expires_s), "paths": paths},
                      headers={"Authorization": f"Bearer {key}", "apikey": key}, timeout=15)
    if r.status_code != 200:
        logger.warning("[frame-urls] batch sign HTTP %s", r.status_code)
        return {}
    out = {}
    for item in r.json() or []:
        rel = item.get("signedURL") or item.get("signedUrl")
        if item.get("path") and rel and not item.get("error"):
            out[item["path"]] = rel if rel.startswith("http") else f"{base}/storage/v1{rel}"
    return out


def entitled_urls(index_path: str, tier: str, *, load: Callable = None, sign: Callable = None,
                  clock: Callable[[], float] = time.monotonic) -> dict:
    """PURE but for the injected load/sign. The payload for one (index, tier)."""
    classes = list(FE.allowed_classes(tier))
    if not classes:
        return {"index": index_path, "tier": tier, "frames": []}
    full = _index_cache.get(index_path)
    if full is None:
        full = (load or read_paid_index)(index_path)
        if full is None:
            return {"index": index_path, "tier": tier, "frames": [], "reason": "no_paid_index"}
        _index_cache[index_path] = full
        while len(_index_cache) > INDEX_CACHE_MAX:
            _index_cache.popitem(last=False)
    items = FE.entitled_items(full, classes)
    urls: Dict[str, str] = {}
    for cls in classes:
        hit = _sign_cache.get((index_path, cls))
        if hit is None or clock() - hit[0] >= SIGN_CACHE_S:
            objs = sorted({i["object"] for i in FE.entitled_items(full, [cls])})
            hit = (clock(), (sign or sign_paths)(objs, SIGN_EXPIRES_S) if objs else {})
            _sign_cache[(index_path, cls)] = hit
        urls.update(hit[1])
    # `object` stays: the client keys its bundle cache by it (a path is not a credential; the private bucket needs the token).
    frames = [dict(i, url=urls[i["object"]]) for i in items if i["object"] in urls]
    return {"index": index_path, "tier": tier, "frames": frames, "expires_in_s": SIGN_EXPIRES_S}


@router.get("/frame-urls")
async def get_frame_urls(index: str = Query(..., max_length=200), authorization: Optional[str] = Header(None)):
    if not FE.enabled():
        raise HTTPException(status_code=404, detail="frame entitlement is off")
    if not FE.INDEX_RE.match(index):
        raise HTTPException(status_code=400, detail="not a frame index path")
    from services.weather_tier_clamp import resolve_tier
    import asyncio
    tier = await resolve_tier(authorization)
    if tier == "guest":                                  # accounts only: no verified account, no URLs
        return JSONResponse({"detail": "sign_in_required"}, status_code=401, headers={
            "Cache-Control": "private, no-store", "Vary": "Authorization", "WWW-Authenticate": 'Bearer realm="raw-surf"',
            "X-Raw-Tier-Clamp": "account"})
    body = await asyncio.to_thread(entitled_urls, index, tier)
    return JSONResponse(body, headers={"Cache-Control": "private, max-age=300", "Vary": "Authorization"})
