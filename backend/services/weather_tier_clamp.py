"""weather_tier_clamp.py: server-side tier enforcement on forecast reads (O5 / TIER-1, 2026-11-11).

WHY. Tier gating lived only in the client (`LayerAccessResolver.js`). `/grid_series` accepted any model and any hour, so a
guest could ask for EURO at hour 336 directly, and `window.__FORCE_PREMIUM_TIER__` (TIER-2) unlocked everything with one
console line. The server now resolves the caller's tier from a VERIFIED JWT (`core.security.get_optional_user_id` ->
`profiles.subscription_tier`; no or bad token = guest) and clamps the request to that tier's window before any route
sees it.

⛔ NOT A SECOND LADDER. Every number comes from `services/forecast_tier_window.py`, the backend's one pinned echo of the
resolver (`canonical_tier` = getUserTier, `allowed_models` = TIER_ACCESS[*].models, `tier_horizon_hours` =
resolveForecastWindow * 24, clamped by /capabilities). `tests/test_forecast_tier_window.py` pins those to the JS;
`tests/test_weather_tier_clamp.py` pins that this module adds no number of its own. The locked 14-day horizon contract
is untouched: premium's window is still 14 days clamped only by the model's own capability rows.

ACCOUNTS ONLY (owner 2026-11-12, #782): "we do not want non-account holders to access the data". A caller with no
VERIFIED JWT gets 401 and no data on every forecast read below (ACCOUNT_PATHS: the clamped reads plus /point-tide and
/wind_lane); the guest window is EMPTY. Any verified account is at least `free` (GFS, 3 days), even when its profile has
no tier, no row, or the lookup fails, so a signed-in user is never sent back to sign-in by a database hiccup.
/capabilities, /status, /products and the diagnostics routes stay public: the client reads the switch from them.
The scheduled jobs are the one non-human identity: X-Raw-Service-Key = env WEATHER_SERVICE_KEY reads as premium, exempt
from the per-account limit (weather_service_identity.py). Without the key configured, there is no such identity.

THE CLAMP for an account (a CLAMPED ANSWER, never a 403, so an older client keeps drawing):
  model        not in the tier's models -> GFS (the model every tier has). CONSENSUS (/point's shadow product, which
               the frontend never requests) is left alone: the nearshore judge calls it, and it is not a tier model.
  hours        (/grid_series) each offset beyond the window -> the window's last hour, de-duplicated.
  valid_time   (/grid, /point, /spot-ratings, /point-rating) beyond now + window -> now + window, on the hour.
  subscription_tier (/spot-series) -> the RESOLVED tier: the query value was client-asserted.

⚠️ SHARED CACHES. /api/* is proxied by Netlify and some weather responses are `Cache-Control: public`. With the clamp
on, EVERY gated answer depends on who asked (a signed-out caller gets nothing), so none may sit in a shared cache keyed
by URL: `public` becomes `private` (the browser may still keep it for its max-age). A URL beyond the FREE window
differs by tier as well, so it is `private, no-store`. `Vary: Authorization` is added to every gated route.
COST, for the owner: an edge cache that served one URL to many users no longer does (the box computes per user).

⚠️ HELD OFF (D-065): GUARDED["WEATHER_TIER_CLAMP"] = '0'. The map's weather fetches did not send the session token,
so ON before the client ships would make every paying user a guest. Rollout: (1) deploy the client half of this PR
(`frontend/src/lib/weatherAuthFetch.js`), (2) confirm requests carry the token, (3) flip the runtime manifest 'on'.
Kill: runtime manifest 'off' or env WEATHER_TIER_CLAMP=0.
⚠️ NOT ENFORCED HERE: the static weather-frames bucket is public (frame_set.py). Its paid tail stays a CDN GET until
it is split into a free public set plus signed URLs (owner decision, TIER-1).
"""
import logging
import math
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Callable, List, Optional, Tuple
from urllib.parse import parse_qsl, urlencode

from services import forecast_tier_window as FTW
from services import runtime_flags as _rf
from services import weather_account_rate_limit as _RL
from services import weather_service_identity as _SVC

logger = logging.getLogger(__name__)

FLAG = "WEATHER_TIER_CLAMP"
TIER_MODELS = ("GFS", "EURO", "ICON")       # the models the resolver gates; anything else is not a tier model
FALLBACK_MODEL = "GFS"                       # in every tier's TIER_MODELS
PREFIX = "/api/weather/"
# path (after PREFIX) -> which parameters it carries. spot-series is matched by prefix (it has a path parameter).
ROUTES = {
    "grid_series": ("model", "hours"),
    "grid": ("model", "valid_time"),
    "point": ("model", "valid_time"),
    "spot-ratings": ("model", "valid_time"),
    "point-rating": ("model", "valid_time"),
}
SPOT_SERIES = "spot-series/"
# Forecast reads with nothing to clamp that are still ACCOUNTS ONLY (owner 2026-11-12: "/point, /spot-ratings, tide and
# the wind lane follow the same rule"). The wind LAYER's data is /grid and /grid_series, already above.
ACCOUNT_ONLY = ("point-tide", "wind_lane")
ACCOUNT_FLOOR = "free"          # what a verified account is at least, whatever its profile says
SIGN_IN_REQUIRED = b"account"   # X-Raw-Tier-Clamp on the 401: the client's expired-session prompt keys on it
# ONE SWITCH FOR BOTH HALVES (owner 2026-11-11 "Yes, hold both"): while the clamp is on, every /api/weather/ response
# says so, and /capabilities rows carry `tier_clamp`; the client (lib/weatherAuthFetch.js) sends its token ONLY then,
# so with the clamp off no Authorization header and no CORS preflight ever leave the browser. Exposed in server.py CORS.
ON_HEADER = b"x-raw-tier-clamp-on"
# Parameters this module gates. Each is collapsed to ONE value before it is judged (security review 2026-11-11: with
# `model=GFS&model=EURO` the clamp read the first and FastAPI serves the LAST, a guest got EURO).
GATED = ("model", "hours", "valid_time", "base_time", "subscription_tier")
# MIRROR of grid_series_helper.SERIES_ANCHOR_MAX_SKEW_HOURS (Codex-reserved file; pinned by a test): /grid_series
# honours a client `base_time` up to this far from the server clock, so a FUTURE anchor moves every hour offset later.
ANCHOR_MAX_SKEW_H = 26
TIER_CACHE_TTL_S = 60.0     # LongCat review: an upgrade (or downgrade) takes effect within a minute
TIER_CACHE_MAX = 4096


def enabled() -> bool:
    return _rf.flag(FLAG, _rf.GUARDED.get(FLAG, "0")) == "1"


def route_params(path: str) -> Optional[Tuple[str, ...]]:
    """The clamped parameters for a request path, or None when the path is not a clamped forecast read."""
    if not path.startswith(PREFIX):
        return None
    rest = path[len(PREFIX):].rstrip("/")
    if rest.startswith(SPOT_SERIES):
        return ("model", "subscription_tier")
    return ROUTES.get(rest)


def account_required(path: str) -> bool:
    """True for a forecast read only an account may make (with the clamp on)."""
    if route_params(path) is not None:
        return True
    return path.startswith(PREFIX) and path[len(PREFIX):].rstrip("/") in ACCOUNT_ONLY


def _parse_time(s: str) -> Optional[datetime]:
    try:
        t = datetime.fromisoformat(str(s).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return t.replace(tzinfo=timezone.utc) if t.tzinfo is None else t.astimezone(timezone.utc)


def clamp_params(params: List[Tuple[str, str]], names: Tuple[str, ...], tier: str,
                 now: Optional[datetime] = None) -> Tuple[List[Tuple[str, str]], List[str]]:
    """PURE. (params clamped to `tier`'s window, names of what changed). Unknown or malformed values are left for the
    route's own validation to reject: this only ever narrows a request, it never invents one."""
    now = now or datetime.now(timezone.utc)
    tier = FTW.canonical_tier(tier)
    out = _single_valued(params)
    changed: List[str] = ["duplicate"] if out != list(params) else []
    model = next((v for k, v in out if k == "model"), FALLBACK_MODEL)
    if "model" in names and str(model).upper() in TIER_MODELS and str(model).upper() not in FTW.allowed_models(tier):
        out = [(k, FALLBACK_MODEL if k == "model" else v) for k, v in out]
        model = FALLBACK_MODEL
        changed.append("model")
    horizon = FTW.tier_horizon_hours(tier, model if str(model).upper() in TIER_MODELS else FALLBACK_MODEL)
    if "hours" in names:
        new = []
        for k, v in out:
            if k != "hours":
                new.append((k, v))
                continue
            try:
                hs = [int(x) for x in str(v).split(",") if x.strip() != ""]
            except ValueError:
                new.append((k, v))                       # the route rejects it, exactly as before
                continue
            cap = max(0, horizon - _anchor_ahead_h(out, now))     # a future base_time shifts every offset later
            capped = list(dict.fromkeys(min(h, cap) for h in hs))
            if capped != hs:
                changed.append("hours")
            new.append((k, ",".join(str(h) for h in capped)))
        out = new
    if "valid_time" in names:
        limit = (now + timedelta(hours=horizon)).replace(minute=0, second=0, microsecond=0)
        new = []
        for k, v in out:
            t = _parse_time(v) if k == "valid_time" else None
            if t is not None and t > limit:
                v = limit.strftime("%Y-%m-%dT%H:%M:%SZ")
                changed.append("valid_time")
            new.append((k, v))
        out = new
    if "subscription_tier" in names:
        if any(k == "subscription_tier" and v != tier for k, v in out) or not any(k == "subscription_tier" for k, _ in out):
            changed.append("subscription_tier")
        out = [(k, v) for k, v in out if k != "subscription_tier"] + [("subscription_tier", tier)]
    return out, changed


def _single_valued(params: List[Tuple[str, str]]) -> List[Tuple[str, str]]:
    """Each GATED parameter once, holding its LAST value (what FastAPI reads for a scalar); others untouched."""
    last = {k: v for k, v in params if k in GATED}
    out, seen = [], set()
    for k, v in params:
        if k in GATED:
            if k in seen:
                continue
            seen.add(k)
            v = last[k]
        out.append((k, v))
    return out


def _anchor_ahead_h(params: List[Tuple[str, str]], now: datetime) -> int:
    """Whole hours a client `base_time` sits AHEAD of the server's hour, when /grid_series would honour it (within
    ANCHOR_MAX_SKEW_H of the server clock, as grid_series_helper._resolve_series_anchor accepts); else 0."""
    raw = next((v for k, v in params if k == "base_time"), None)
    at = _parse_time(raw) if raw else None
    # +1 h MARGIN (security review, TOCTOU): the route reads its own clock a moment after this one, so an anchor
    # just past the skew edge here can be inside it there. Treating the edge band as honoured only tightens the cap.
    if at is None or (at - now).total_seconds() > (ANCHOR_MAX_SKEW_H + 1) * 3600:
        return 0
    ahead = (at.replace(minute=0, second=0, microsecond=0)
             - now.replace(minute=0, second=0, microsecond=0)).total_seconds() / 3600.0
    return max(0, int(math.ceil(ahead)))


def beyond_free(params: List[Tuple[str, str]], names: Tuple[str, ...], now: Optional[datetime] = None) -> bool:
    """True when this URL asks for more than the lowest account (free) may see, so its answer depends on WHICH account
    asked (cache: private, no-store)."""
    p = [(k, v) for k, v in params if k != "subscription_tier"]
    return bool(clamp_params(p, tuple(n for n in names if n != "subscription_tier"), ACCOUNT_FLOOR, now)[1])


# ── who is asking ─────────────────────────────────────────────────────────────────────────────────────────────────────
_tier_cache: "OrderedDict[str, Tuple[float, str]]" = OrderedDict()


async def _profile_tier(user_id: str) -> Optional[str]:
    from sqlalchemy import text
    from database import AsyncSessionLocal
    async with AsyncSessionLocal() as s:
        row = (await s.execute(text("SELECT subscription_tier FROM profiles WHERE id = :u"), {"u": user_id})).first()
    return row[0] if row else None


async def resolve_tier(authorization: Optional[str], lookup: Callable = None, clock: Callable[[], float] = time.monotonic) -> str:
    """The caller's canonical tier (see resolve_identity)."""
    return (await resolve_identity(authorization, lookup, clock))[1]


async def resolve_identity(authorization: Optional[str], lookup: Callable = None,
                           clock: Callable[[], float] = time.monotonic) -> Tuple[Optional[str], str]:
    """(verified user id or None, canonical tier). The id keys the per-account rate limit. Strict identity: only a VERIFIED JWT subject counts (get_optional_user_id); no
    token or a bad token is GUEST (no data, fail closed). A verified account is at least ACCOUNT_FLOOR: a profile with
    no tier, no profile row, or a failed lookup is `free` (the lowest window, never a paid one). Cached TIER_CACHE_TTL_S."""
    from core.security import get_optional_user_id
    try:
        uid = await get_optional_user_id(authorization=authorization)
    except Exception:                                    # noqa: BLE001 - any identity failure is a guest
        uid = None
    if not uid:
        return None, "guest"
    hit = _tier_cache.get(uid)
    if hit and clock() - hit[0] < TIER_CACHE_TTL_S:
        _tier_cache.move_to_end(uid)
        return uid, hit[1]
    try:
        raw = await (lookup or _profile_tier)(uid)
    except Exception as e:                               # noqa: BLE001
        logger.warning("[tier-clamp] profile tier lookup failed (free for this request): %s", type(e).__name__)
        return uid, ACCOUNT_FLOOR
    tier = FTW.canonical_tier(raw)
    if tier == "guest":
        tier = ACCOUNT_FLOOR
    _tier_cache[uid] = (clock(), tier)
    while len(_tier_cache) > TIER_CACHE_MAX:
        _tier_cache.popitem(last=False)
    return uid, tier


# ── the ASGI middleware ───────────────────────────────────────────────────────────────────────────────────────────────
class WeatherTierClampMiddleware:
    """Rewrites the query string of a clamped forecast read BEFORE routing, so every route (weather.py,
    weather_point_rating.py, weather_spot_series.py) sees the tier-safe request without any route changing. Off (the
    held default) it costs one cached flag read on /api/weather/ GETs and touches nothing."""
    # Identity is the Authorization header only, as everywhere in this API (core.security is Bearer-only; no cookie
    # sessions), so "no header" really is "no identity" (LongCat finding 1, checked and not applicable).

    def __init__(self, app, tier_fn: Callable = None, identity_fn: Callable = None):
        self.app = app
        self.tier_fn = tier_fn                       # tests: a tier only (no id, so no per-account limit)
        self.identity_fn = identity_fn or (None if tier_fn else resolve_identity)

    async def _identify(self, auth):
        if self.identity_fn is not None:
            return await self.identity_fn(auth)
        return None, await self.tier_fn(auth)

    async def __call__(self, scope, receive, send):
        # HEAD too (LongCat review): Starlette routes HEAD to the GET handler; it returns no body, but one rule is simpler.
        if scope.get("type") != "http" or scope.get("method") not in ("GET", "HEAD"):
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if not path.startswith(PREFIX) or not enabled():
            return await self.app(scope, receive, send)
        names = route_params(path)
        gated = names is not None or account_required(path)
        if not gated:                                    # not a forecast read: only announce that the clamp is on
            async def send_on(message):
                if message.get("type") == "http.response.start":
                    message = dict(message, headers=list(message.get("headers", [])) + [(ON_HEADER, b"1")])
                await send(message)
            return await self.app(scope, receive, send_on)
        service = _SVC.from_headers(scope.get("headers"))  # the scheduled jobs' key (weather_service_identity.py)
        if service is not None:
            uid, tier = service
        else:
            auth = next((v.decode("latin-1") for k, v in scope.get("headers") or [] if k == b"authorization"), None)
            uid, tier = await self._identify(auth)
        if tier == "guest":                              # ACCOUNTS ONLY: no verified account, no data
            return await _sign_in_required(scope, send)
        wait = None if service else _RL.retry_after("reads", uid)   # per-account limit; the jobs are exempt; kill: flag '0'
        if wait is not None:
            return await _too_many(scope, send, wait)
        if names is None:                                # accounts-only, nothing to clamp (/point-tide, /wind_lane)
            names = ()
        params = parse_qsl(scope.get("query_string", b"").decode("latin-1"), keep_blank_values=True)
        now = datetime.now(timezone.utc)
        new, changed = clamp_params(params, names, tier, now)
        # /spot-series answers per RESOLVED tier whatever its URL says, so it is never shared-cacheable (security review).
        private = bool(changed) or "subscription_tier" in names or beyond_free(params, names, now)
        if changed:
            scope = dict(scope, query_string=urlencode(new).encode("latin-1"))

        async def send_wrapped(message):
            if message.get("type") == "http.response.start":
                headers = [(k, _no_shared(v) if k.lower() == b"cache-control" else v)
                           for k, v in message.get("headers", [])
                           if not (private and k.lower() == b"cache-control")]
                headers.append((b"vary", b"Authorization"))
                headers.append((ON_HEADER, b"1"))
                if private:
                    headers.append((b"cache-control", b"private, no-store"))
                if changed:
                    headers.append((b"x-raw-tier-clamp", ",".join(sorted(set(changed))).encode()))
                message = dict(message, headers=headers)
            await send(message)

        return await self.app(scope, receive, send_wrapped)


def _no_shared(cache_control: bytes) -> bytes:
    """A route's Cache-Control with `public` (and `s-maxage`) made `private`: an account's answer is never a shared one."""
    parts = [p.strip() for p in cache_control.decode("latin-1").split(",") if p.strip()]
    parts = [p for p in parts if p.lower() != "public" and not p.lower().startswith("s-maxage")]
    if not any(p.lower() in ("private", "no-store") for p in parts):
        parts.insert(0, "private")
    return ", ".join(parts).encode("latin-1")


async def _sign_in_required(scope, send):
    """401 for a forecast read without a verified account. Never cacheable; marked so the client can tell this refusal
    (sign in, or sign in AGAIN when it sent a token) from any other 401. Registered INSIDE CORSMiddleware (server.py),
    so the browser can read it cross-origin."""
    body = b'{"detail":"sign_in_required"}'
    await send({"type": "http.response.start", "status": 401, "headers": [
        (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
        (b"cache-control", b"private, no-store"), (b"vary", b"Authorization"),
        (b"www-authenticate", b'Bearer realm="raw-surf"'), (ON_HEADER, b"1"), (b"x-raw-tier-clamp", SIGN_IN_REQUIRED)]})
    await send({"type": "http.response.body", "body": b"" if scope.get("method") == "HEAD" else body})


async def _too_many(scope, send, retry_after_s: int):
    """429 for an account over its per-account read limit (weather_account_rate_limit.py). Never cacheable."""
    body = _RL.too_many_body(retry_after_s)
    await send({"type": "http.response.start", "status": 429, "headers": [
        (b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()),
        (b"cache-control", b"private, no-store"), (b"vary", b"Authorization"),
        (b"retry-after", str(int(retry_after_s)).encode()), (ON_HEADER, b"1"),
        (b"x-raw-tier-clamp", _RL.RATE_LIMITED.encode())]})
    await send({"type": "http.response.body", "body": b"" if scope.get("method") == "HEAD" else body})
