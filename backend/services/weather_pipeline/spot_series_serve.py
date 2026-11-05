"""spot_series_serve.py: the READ side of the per-spot chart series (spot-hub phase 4, 2026-11-04).

WHY. Phase 3 (`spot_series.py`, `spot-series.yml`) rates every spot in CI with `rate_one_spot` and writes 64 gzipped
hash shards per model to the PRIVATE `weather-products` bucket under `spot_series/v1/`. The hub charts need one spot's
series, trimmed to the user's tier. This module is the proxy: the bucket stays private (no storage policy, no signed
URL handed to a browser), and a client is only ever SENT the frames its tier opens.

THE CHAIN IS NOT RE-DERIVED HERE. Every number served is a number `rate_one_spot` wrote in CI (ONE FORECAST
COMPOSITION). This file slices columns; it never computes a height, a score or a level.

COST ON THE ONE 1-CPU BOX (the binding constraint):
  - `index.json` is read at most once per `SPOT_SERIES_INDEX_TTL_S` (300 s) per process; an absent index is
    remembered for 60 s, so an unpublished series costs one storage GET a minute, not one per view.
  - a shard is read at most ONCE per (model, shard, generation): the generation is the index's
    `base_time|generated_at`, so the cache key is immutable (a republish is a new key, never a stale hit), and the
    GET carries it as a cache-buster so no CDN edge can answer with the previous generation.
  - concurrent misses on one key share one download (an asyncio lock per key); downloads run in a thread.
  - parsed shards are an LRU of `SPOT_SERIES_SHARD_CACHE` (24, ~0.5 MB each); the whole catalogue is 192 shards.
  - a request that hits the cache is a dict lookup plus a slice of ~58 integers per column.

TIER. `forecast_tier_window.tier_horizon_hours` (the server echo of `LayerAccessResolver.resolveForecastWindow`):
free = rolling 72 h, basic = 7 days, premium = 14 days, each clamped by the model's capability row; a model the tier
may not use falls back to the tier's first model, as the map's picker does. Days beyond the window are named by their
local date only (`locked_dates`), never sent. ⚠️ The tier is client-asserted (`?subscription_tier=`), exactly as the
hub routes take it: this trims what an honest client is sent; it is not entitlement enforcement.

Kill switch: `SPOT_HUB_CHARTS=0` (env, or the runtime manifest) makes the route answer `disabled` (404), and the
client falls back to the hub's previous daily rows.
"""
import asyncio
import gzip
import json
import logging
import os
import time
from collections import OrderedDict
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, Optional, Tuple

from services import runtime_flags as _rf
from services.forecast_tier_window import TIER_FORECAST_DAYS, allowed_models, canonical_tier, tier_horizon_hours
from services.weather_pipeline import spot_series as SS

logger = logging.getLogger(__name__)

FLAG = "SPOT_HUB_CHARTS"
SERVE_SCHEMA = "raw-surf/spot-series-serve/1"
INDEX_KEY = f"{SS.L2_PREFIX}/index.json"
# The columns a client is sent. `r` (the UNGATED score) stays in CI: the hub shows the gated verdict, as the glyph does.
SERVED_COLS = ("t", "h", "s", "l", "lo", "hi", "w", "wd", "sw", "td")
NEGATIVE_TTL_S = 60.0

# (key, cache_buster) -> bytes, or None when the object does not exist. Tests inject; None = the private bucket.
_fetcher: Optional[Callable[[str, str], Optional[bytes]]] = None
_state: Dict[str, Any] = {"index": None, "index_at": 0.0, "index_absent_until": 0.0}
_shards: "OrderedDict[tuple, Optional[dict]]" = OrderedDict()
_locks: Dict[Any, asyncio.Lock] = {}
_stats = {"index_reads": 0, "shard_reads": 0, "shard_hits": 0}


def charts_enabled() -> bool:
    return _rf.flag(FLAG, "1") != "0"


def _env_f(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def index_ttl_s() -> float:
    return _env_f("SPOT_SERIES_INDEX_TTL_S", 300.0)


def shard_cache_max() -> int:
    return max(1, int(_env_f("SPOT_SERIES_SHARD_CACHE", 24)))


def _bucket_get(key: str, cache_buster: str) -> Optional[bytes]:
    """Authenticated GET of one private object (the service key stays on the box). None on 400/404 (absent)."""
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not secret:
        return None
    import requests
    from urllib.parse import quote
    from services.weather_pipeline.l2_retry import read_with_retry
    from services.weather_pipeline.store import WEATHER_BUCKET
    url = f"{base}/storage/v1/object/{WEATHER_BUCKET}/{key}?cb={quote(cache_buster)}"

    def read():
        resp = requests.get(url, headers={"Authorization": f"Bearer {secret}", "apikey": secret}, timeout=10)
        if resp.status_code in (400, 404):
            return None
        resp.raise_for_status()
        return resp.content
    return read_with_retry(read, key)


def _fetch(key: str, cache_buster: str) -> Optional[bytes]:
    return (_fetcher or _bucket_get)(key, cache_buster)


def _lock(key) -> asyncio.Lock:
    lk = _locks.get(key)
    if lk is None:
        lk = _locks[key] = asyncio.Lock()
    return lk


def generation_of(index: Dict[str, Any]) -> str:
    return f"{index.get('base_time')}|{index.get('generated_at')}"


async def get_index(clock: Callable[[], float] = time.monotonic) -> Optional[Dict[str, Any]]:
    """The published index, refreshed at most once per TTL; None while none is published (remembered 60 s)."""
    now = clock()
    if _state["index"] is not None and now - _state["index_at"] < index_ttl_s():
        return _state["index"]
    if _state["index"] is None and now < _state["index_absent_until"]:
        return None
    async with _lock("index"):
        now = clock()
        if _state["index"] is not None and now - _state["index_at"] < index_ttl_s():
            return _state["index"]
        if _state["index"] is None and now < _state["index_absent_until"]:
            return None
        _stats["index_reads"] += 1
        try:
            raw = await asyncio.to_thread(_fetch, INDEX_KEY, str(int(time.time() // max(1.0, index_ttl_s()))))
            doc = json.loads(raw.decode("utf-8")) if raw else None
            if doc is not None and doc.get("schema") != SS.SCHEMA:
                logger.warning(f"[spot-series] index schema {doc.get('schema')!r} != {SS.SCHEMA!r}; ignored")
                doc = None
        except Exception as e:   # a storage outage keeps the last good index; never raises into the route
            logger.warning(f"[spot-series] index read failed: {type(e).__name__}: {e}")
            if _state["index"] is not None:
                _state["index_at"] = now
                return _state["index"]
            doc = None
        if doc is None:
            _state["index"], _state["index_absent_until"] = None, now + NEGATIVE_TTL_S
            return None
        _state["index"], _state["index_at"] = doc, now
        return doc


async def get_shard(model: str, shard: int, generation: str) -> Optional[Dict[str, Any]]:
    """One parsed shard, read at most once per (model, shard, generation) per process (LRU-bounded)."""
    key = (model, shard, generation)
    if key in _shards:
        _shards.move_to_end(key)
        _stats["shard_hits"] += 1
        return _shards[key]
    try:
        async with _lock(key):
            if key in _shards:
                _stats["shard_hits"] += 1
                return _shards[key]
            _stats["shard_reads"] += 1
            try:
                raw = await asyncio.to_thread(_fetch, SS.shard_key(model, shard), generation)
                body = json.loads(gzip.decompress(raw).decode("utf-8")) if raw else None
            except Exception as e:
                logger.warning(f"[spot-series] shard {model}/{shard:02d} read failed: {type(e).__name__}: {e}")
                return None     # not cached: the next view retries
            _shards[key] = body
            while len(_shards) > shard_cache_max():
                _shards.popitem(last=False)
    finally:
        _locks.pop(key, None)
    return body


def _parse(vt: str) -> datetime:
    return datetime.fromisoformat(str(vt).replace("Z", "+00:00"))


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def trim_spot(rec: Dict[str, Any], base_time: str, horizon_h: int, premium_days: int,
              now: Optional[datetime] = None) -> Dict[str, Any]:
    """One spot's columns, cut to [the latest frame at or before now, now + horizon_h]. PURE.
    Daily columns: local day 0 (today, partial) .. days-1 are open (each ends inside the rolling window, so every
    frame of an open day is sent); later days up to the premium window are named by date only."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    base = _parse(base_time)
    off = int(rec.get("off") or 0)
    ts = list(rec.get("t") or [])
    valid = [base + timedelta(hours=int(t)) for t in ts]
    limit = now + timedelta(hours=horizon_h)
    first = 0
    for i, v in enumerate(valid):
        if v <= now:
            first = i
    keep = [i for i in range(first, len(valid)) if valid[i] <= limit and (i == first or valid[i] > now)]
    cols = {c: [(rec.get(c) or [None] * len(ts))[i] for i in keep] for c in SERVED_COLS}
    today = (now + timedelta(hours=off)).date()
    days = max(1, horizon_h // 24)
    tide_idx = [i for i in keep if (rec.get("td") or [None] * len(ts))[i] is not None]
    return {
        "utc_offset_hours": off,
        "frames": cols,
        "valid_times": [_iso(valid[i]) for i in keep],
        "daily_dates": [(today + timedelta(days=d)).isoformat() for d in range(days)],
        "locked_dates": [(today + timedelta(days=d)).isoformat() for d in range(days, max(days, premium_days))],
        "window_end": _iso(limit),
        "tide_until": _iso(valid[tide_idx[-1]]) if tide_idx else None,
    }


async def spot_series_payload(spot_id: Any, model: str = "GFS", tier: Any = "free",
                              now: Optional[datetime] = None) -> Tuple[int, Dict[str, Any]]:
    """(HTTP status, body) for one spot. 404 bodies say why (`disabled`, `unpublished`, `model_unavailable`,
    `spot_not_found`), so the client can fall back to the hub's daily rows without guessing."""
    if not charts_enabled():
        return 404, {"status": "disabled", "flag": FLAG}
    t = canonical_tier(tier)
    requested = str(model or "GFS").upper()
    allowed = allowed_models(t)
    eff = requested if requested in allowed else allowed[0]
    index = await get_index()
    if index is None:
        return 404, {"status": "unpublished"}
    if eff not in (index.get("models") or []):
        return 404, {"status": "model_unavailable", "model": eff}
    shard = SS.shard_of(spot_id)
    if f"{shard:02d}" not in ((index.get("shards") or {}).get(eff) or {}):
        return 404, {"status": "spot_not_found", "model": eff}
    body = await get_shard(eff, shard, generation_of(index))
    rec = ((body or {}).get("spots") or {}).get(str(spot_id))
    if not rec:
        return 404, {"status": "spot_not_found", "model": eff}
    horizon_h = tier_horizon_hours(t, eff)
    premium_days = tier_horizon_hours("premium", eff) // 24
    base_time = body.get("base_time") or index.get("base_time")
    out = {"status": "ok", "schema": SERVE_SCHEMA, "spot_id": str(spot_id), "model": eff,
           "requested_model": requested, "model_allowed": requested in allowed, "tier": t,
           "base_time": base_time, "generated_at": index.get("generated_at"),
           "levels": body.get("levels") or SS.LEVELS, "wind_words": body.get("wind_words") or SS.WIND_WORDS,
           "horizon_hours": horizon_h, "days_allowed": horizon_h // 24, "premium_days": premium_days,
           "tier_days": dict(TIER_FORECAST_DAYS),
           **trim_spot(rec, base_time, horizon_h, premium_days, now)}
    return 200, out


def stats() -> Dict[str, Any]:
    return {**_stats, "shards_cached": len(_shards), "index_loaded": _state["index"] is not None}


def _reset_for_tests(fetcher: Optional[Callable[[str, str], Optional[bytes]]] = None) -> None:
    global _fetcher
    _fetcher = fetcher
    _state.update({"index": None, "index_at": 0.0, "index_absent_until": 0.0})
    _shards.clear()
    _locks.clear()
    _stats.update({"index_reads": 0, "shard_reads": 0, "shard_hits": 0})
