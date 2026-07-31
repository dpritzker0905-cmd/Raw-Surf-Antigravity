"""sim_forecast.py — the app's OWN active forecast at a coordinate, for callers outside the API.

WHY THIS EXISTS
---------------
Until 2026-07-27 the weather simulation MCP could only answer `get_weather_forecast` for THREE
hand-tuned spots; every one of the other 1544 catalog spots returned `forecast: null`, because that
server stored no forecast and did no network I/O. A forecast tool that cannot forecast 99.8% of the
catalog is not a sandbox limitation, it is the missing feature.

The app already serves exactly this at `/api/weather/point`, sampled from the same cached product
grid the heatmaps use, so an out-of-process caller ASKS IT rather than modelling a second forecast.

THE MAPPING IS COPIED FROM `spot_ratings.rate_one_spot`
------------------------------------------------------
That function is the production consumer of the same endpoint, so mirroring it is what keeps a
second caller from drifting into a private interpretation of the same payload:

    swell height  <- marine point.speed      OFFSHORE Hs in metres, NOT the breaking height
    period        <- marine point.period
    swell dir     <- marine point.direction
    wind knots    <- wind point.speed        this endpoint reports wind in KNOTS
    wind dir      <- wind point.direction

`surf_height_m` on the marine response is the BREAKING height the app itself serves. It is returned
in the provenance so a caller computing its own can report PARITY instead of hiding a divergence —
that divergence is the defect `cf2efb48` was written to end.

CONTRACT
  * Never raises. A forecast is an ENRICHMENT: the app being unreachable must degrade the answer,
    never break the caller.
  * Both legs are required. With marine but no wind the vector would have to invent a wind, and an
    invented wind is exactly how a blown-out day reads clean.
  * Kill: SIM_LIVE_FORECAST=0 disables the lane entirely.
"""
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.parse
# `urllib.request` pulls `ssl`, whose `_ssl` C extension must load on the MAIN thread. Importing a
# C extension inside a worker thread is what deadlocked the sim MCP server's first tool call on
# 2026-07-27 (see `weather_sim_mcp._warm_hot_path`). Imported HERE, never inside a function.
import urllib.request
from collections import OrderedDict
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get(
    "SIM_FORECAST_BASE_URL", "https://raw-surf-antigravity.onrender.com").rstrip("/")
MODEL = os.environ.get("SIM_FORECAST_MODEL", "GFS")

# ⚠️ A LIVE-DATA ENRICHMENT MUST NEVER DOMINATE THE RESPONSE TIME.
# This was 30 s, and measured 2026-07-27 against an unreachable app that made `get_surf_spots` block
# 42.2 s and `get_weather_forecast` 42.1 s — past the point where an MCP client reports a TIMEOUT
# instead of an answer. The sim then looks broken while being merely patient. The host is a free
# Render instance that cold-starts in ~50 s, so "slow" is a NORMAL state here, not an exceptional
# one. 8 s is longer than a warm request needs (0.5-1.1 s measured) and short enough that two of
# them still fit inside any sane client budget.
TIMEOUT_S = float(os.environ.get("SIM_FORECAST_TIMEOUT_S", "8"))

# After a failure, stop dialling for a while. Without this every tool call re-pays the full timeout
# — the same pile-up the 429 circuit breaker was added for on 2026-07-24. `get_weather_forecast`
# makes TWO requests, so an unbreakered outage costs double.
DOWN_COOLDOWN_S = float(os.environ.get("SIM_FORECAST_COOLDOWN_S", "60"))
_down_until = 0.0


def _is_down() -> bool:
    return time.monotonic() < _down_until


def _mark_down() -> None:
    global _down_until
    _down_until = time.monotonic() + DOWN_COOLDOWN_S


def _mark_up() -> None:
    global _down_until
    _down_until = 0.0

# Keyed by (lat, lng, valid_time), the valid_time being the top of the hour. A what-if sweep hits
# one spot repeatedly and must not re-fetch.
# ⚠️ Entries do NOT expire on their own as the hour turns — the KEY changes, so a stale entry merely
# becomes unreachable and is never freed. A server sweeping the 1818-spot catalogue hour after hour
# would grow this without bound. `_remember` is what keeps that true.
#
# ★ IT USED TO KEEP EXACTLY ONE HOUR, dropping every other hour on each store. That bounded it, but
# it made a TIME SERIES the one access pattern the cache actively defeats: each frame evicted the
# previous one, so walking forward through hours re-fetched every step AND re-fetched all of them
# again on a second pass. Measured 2026-07-30 at Mavericks, 16 frames at a 3-h step: 19.8 s cold,
# and a second identical pass still cost 6.2 s having cached nothing reusable. `valid_time` is what
# makes these tools a FORECAST rather than a nowcast, so the series is the point, not an edge case.
#
# Bounded FIFO instead: insertion-ordered, oldest evicted first (NOT an LRU — a read does not
# refresh position; saying so because a comment in this repo once claimed LRU for a FIFO and cost a
# session to disprove). Fetching a series forward in time therefore evicts the past hours first,
# which is exactly the right order. ~1 KB an entry, so the default cap is well under a megabyte.
_FORECAST_CACHE_MAX = int(os.environ.get("SIM_FORECAST_CACHE_MAX", "256"))
# ⚠️ A TTL IS NOW LOAD-BEARING AND WAS NOT BEFORE. Wiping every other hour on each store gave
# freshness by accident: nothing could outlive the hour it was fetched in. Holding many hours means
# an entry for a FUTURE hour would otherwise survive the next ingest and serve a forecast from a
# superseded model run — the provenance block would even stamp it with the old `run_time`, which is
# worse than a miss because it looks authoritative. Core ingest is every 4 h; an hour is well inside
# that and a forecast does not meaningfully move within one.
_FORECAST_CACHE_TTL_S = float(os.environ.get("SIM_FORECAST_CACHE_TTL_S", "3600"))
_FORECAST_CACHE: "OrderedDict[Any, Any]" = OrderedDict()


def _remember(key: Any, out: Any) -> None:
    """Store an answer, stamped, and keep the cache bounded — see the warning above."""
    _FORECAST_CACHE[key] = (time.monotonic(), out)
    _FORECAST_CACHE.move_to_end(key)
    while len(_FORECAST_CACHE) > max(1, _FORECAST_CACHE_MAX):
        _FORECAST_CACHE.popitem(last=False)


def _recall(key: Any):
    """The cached answer for this key, or None when absent or expired. Drops what it expires, so a
    coordinate that is asked about once and never again cannot pin an entry forever."""
    hit = _FORECAST_CACHE.get(key)
    if hit is None:
        return None
    stamped_at, out = hit
    if time.monotonic() - stamped_at > _FORECAST_CACHE_TTL_S:
        del _FORECAST_CACHE[key]
        return None
    return out


# ── THE CATALOGUE, from the app rather than a local snapshot ─────────────────────────────────
# The sim read its spot list from `dev.db`, a SQLite snapshot that has drifted from production.
# Measured 2026-07-27, the drift is not cosmetic — it is wrong COORDINATES:
#     Bethune Beach          dev.db 28.998,-80.926   production 28.950892,-80.83899  (~7 km)
#     New Smyrna Beach Inlet dev.db is_active=1      production is_active=false (inland duplicate)
#     row counts             dev.db 1547 active      production 1515 active
# Bethune's dev.db coordinate is the exact one the owner caught by eye and the one production was
# corrected away from. Every geometry lookup, and now every live forecast sample, would be taken at
# a point 7 km from the spot — and reported with full confidence. A stale catalogue is worse than a
# missing one once the forecast is real.
# Kill: SIM_LIVE_CATALOG=0 falls back to dev.db exactly as before.
_CATALOG_CACHE: Dict[str, Any] = {}


def fetch_catalog() -> Optional[list]:
    """The app's active spot catalogue, or None. Never raises; cached for the process.

    Uses the PUBLIC `/api/surf-spots`, which returns every active spot with coordinates (1515 as of
    2026-07-27) and needs no credentials — the same reason the forecast lane asks the app instead of
    modelling one."""
    if os.environ.get("SIM_LIVE_CATALOG", "1") == "0":
        return None
    if "spots" in _CATALOG_CACHE:
        return _CATALOG_CACHE["spots"]
    if _is_down():
        return None                      # fail FAST while the app is known unreachable
    try:
        req = urllib.request.Request(f"{BASE_URL}/api/surf-spots",
                                     headers={"User-Agent": "raw-surf-weather-sim"})
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        spots = [{"id": r.get("id"), "name": r.get("name"), "region": r.get("region"),
                  "latitude": float(r["latitude"]), "longitude": float(r["longitude"])}
                 for r in rows
                 if r.get("is_active") and r.get("latitude") is not None
                 and r.get("longitude") is not None]
        if not spots:
            logger.warning("live catalogue returned no usable spots; falling back")
            return None
        _CATALOG_CACHE["spots"] = spots
        _mark_up()
        return spots
    except Exception as e:
        _mark_down()
        logger.warning(f"live catalogue fetch failed ({e}); falling back to the local snapshot "
                       f"and pausing live lookups for {DOWN_COOLDOWN_S:g}s.")
        return None


def prefetch_catalog_async() -> Optional[threading.Thread]:
    """Warm the catalogue OFF the request path, at server start.

    The first tool call would otherwise pay the whole round trip — and on a cold Render instance
    that is the difference between an answer and a client-side timeout. Done in a daemon thread so
    a slow or dead app delays NOTHING: the tool simply falls back until the warm-up lands.
    ⚠️ Safe to run off the main thread only because `urllib`/`ssl` are imported at MODULE scope
    above — a C-extension import inside a worker thread is what deadlocked this server once already.
    """
    if os.environ.get("SIM_LIVE_CATALOG", "1") == "0":
        return None
    t = threading.Thread(target=fetch_catalog, name="sim-catalog-prefetch", daemon=True)
    t.start()
    return t


def current_valid_time() -> str:
    """The forecast hour to sample: the current UTC hour, top of the hour."""
    return datetime.now(timezone.utc).replace(
        minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def fetch_point(domain: str, layer: str, lat: float, lng: float,
                valid_time: str) -> Optional[Dict[str, Any]]:
    """One `/api/weather/point` sample, or None. Never raises."""
    qs = urllib.parse.urlencode({
        "model": MODEL, "domain": domain, "layer": layer,
        "lat": lat, "lng": lng, "valid_time": valid_time})
    url = f"{BASE_URL}/api/weather/point?{qs}"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as resp:
            out = json.loads(resp.read().decode("utf-8"))
        _mark_up()
        return out
    except Exception as e:
        _mark_down()
        logger.warning(f"live forecast {domain}/{layer} at ({lat},{lng}) failed: {e}")
        return None


def _sane_partitions(raw):
    """Network partitions validated + coerced to the engine's shape, or None.

    The engine's partition guards (`h <= 0` in dominant_swell_period / effective_swell_exposure /
    sea_cleanliness) assume NUMERIC h/tp and raise TypeError on a JSON string — fail-closed
    per item here so a malformed train from a skewed server is dropped, never propagated. NaN is
    rejected the same way (it passes both `not x` and `x <= 0`). An unknown `kind` degrades to
    'swell' (the neutral reading: only 'windsea' is penalized)."""
    if not isinstance(raw, list):
        return None
    out = []
    for p in raw:
        if not isinstance(p, dict):
            continue
        try:
            h, tp = float(p.get("h")), float(p.get("tp"))
        except (TypeError, ValueError):
            continue
        if h != h or tp != tp or h <= 0 or tp <= 0:
            continue
        d = p.get("dir")
        try:
            d = float(d) if d is not None else None
        except (TypeError, ValueError):
            d = None
        if d is not None and d != d:
            d = None
        out.append({"h": h, "tp": tp, "dir": d,
                    "kind": "windsea" if p.get("kind") == "windsea" else "swell"})
    return out or None


def baseline_partitions(baseline: Optional[Dict[str, Any]],
                        resolved: Optional[Dict[str, Any]] = None):
    """The baseline's swell trains — IF they still describe the sea being rated, else None.

    Partitions describe the FORECAST sea (the live lane carries the trains the server's own height
    ran on). A what-if that changes any swell field is rating a DIFFERENT sea, so they must be
    dropped; a wind-only what-if keeps them, because the trains already in the water do not change
    when the local wind is hypothesized differently. The test is VALUE equality, not
    omitted-ness — a caller who types the forecast's own numbers back is still rating the
    forecast sea. Lives HERE beside the baseline producer (weather_sim_mcp is at the 800-line
    ratchet); the MCP module aliases it."""
    parts = (baseline or {}).get("partitions")
    if not parts:
        return None
    if resolved is None:
        return parts
    for k in ("swell_height_m", "swell_period_sec", "swell_direction_deg"):
        try:
            if abs(float(baseline[k]) - float(resolved[k])) > 1e-9:
                return None
        except (KeyError, TypeError, ValueError):
            return None
    return parts


def peek_live_forecast(lat: float, lng: float, valid_time: Optional[str] = None
                       ) -> Optional[Tuple[Optional[Dict[str, float]], Dict[str, Any]]]:
    """The cached forecast for this coordinate/hour, or None. NEVER dials.

    ★ Exists so a caller can enrich an answer with the real forecast when it is already in hand,
    WITHOUT taking on a network dependency it did not previously have. `simulate_weather_change`
    used to make zero requests; putting an unconditional fetch on that path is precisely the
    regression `576dcbdd` fixed (measured 42.2 s of blocking, past where an MCP client reports a
    TIMEOUT rather than an answer). A cache peek costs nothing and is a hit on the common flow,
    because asking for the forecast and then asking a what-if about it share this key."""
    if os.environ.get("SIM_LIVE_FORECAST", "1") == "0":
        return None
    key = (round(float(lat), 4), round(float(lng), 4), valid_time or current_valid_time())
    return _recall(key)


def fetch_live_forecast(lat: float, lng: float, valid_time: Optional[str] = None
                        ) -> Tuple[Optional[Dict[str, float]], Dict[str, Any]]:
    """The app's forecast at a coordinate, for `valid_time` or the current hour.

    Returns (baseline | None, provenance). The provenance always explains itself — on failure it
    carries a `reason`, so a caller can say WHY it has no forecast instead of returning a bare null.

    ⚠️ `valid_time` is what makes this a FORECAST rather than a nowcast. Measured 2026-07-28, the
    app serves authoritative frames out to at least +168 h at this coordinate, so "is tomorrow
    morning better?" — the question a surfer actually asks — is answerable and was not being asked.
    """
    if os.environ.get("SIM_LIVE_FORECAST", "1") == "0":
        return None, {"reason": "disabled (SIM_LIVE_FORECAST=0)"}
    valid_time = valid_time or current_valid_time()
    key = (round(float(lat), 4), round(float(lng), 4), valid_time)
    cached = _recall(key)
    if cached is not None:
        return cached
    if _is_down():
        # NOT cached: the app is down now, not wrong about this coordinate.
        return None, {"reason": "the app is not reachable right now", "valid_time": valid_time}

    marine = fetch_point("marine", "waves", lat, lng, valid_time)
    wind = fetch_point("wind", "wind", lat, lng, valid_time)
    mp = (marine or {}).get("point") or {}
    wp = (wind or {}).get("point") or {}
    missing = [name for name, ok in (("marine", mp.get("speed") is not None),
                                     ("wind", wp.get("speed") is not None)) if not ok]
    if missing:
        out = (None, {"reason": f"no {' and '.join(missing)} data at this coordinate",
                      "valid_time": valid_time, "model": MODEL})
    else:
        baseline = {
            "swell_height_m": float(mp["speed"]),          # OFFSHORE Hs, metres
            "swell_period_sec": float(mp.get("period") or 0.0),
            "swell_direction_deg": float(mp.get("direction") or 0.0),
            "wind_speed_knots": float(wp["speed"]),        # this endpoint reports knots
            "wind_direction_deg": float(wp.get("direction") or 0.0),
        }
        # The reconciled swell/windsea trains the SERVER's own height ran on (response.partitions;
        # present only when the serve side runs SURF_PARTITIONS=1). Carried so the sim grades the
        # SAME sea state the app served — the sim itself adds no fetches and no flag of its own.
        # Consumers iterate the fixed 5-key vocabulary above, so an extra key is additive.
        # ⚠️ TRUST BOUNDARY: this is json.loads of a REMOTE deploy, so item shapes are validated
        # and coerced HERE, at the one entry point — a version-skewed server sending h as a string
        # would otherwise raise TypeError out of `rating_score` and cost the caller its whole
        # tool answer (the engine's `h <= 0` guards are not str-safe).
        _parts = _sane_partitions((marine or {}).get("partitions"))
        if _parts:
            baseline["partitions"] = _parts
        out = (baseline, {
            "model": MODEL,
            "valid_time": marine.get("valid_time") or valid_time,
            "run_time": marine.get("run_time"),
            # ⚠️ WIND HAS ITS OWN RUN, always. The two domains are ingested by different jobs and
            # shared a run at 0 of 4 spots measured 2026-07-31 (Mavericks 07:27 vs 08:10, Bells
            # Beach 04:07 vs 14:44). Carrying only the marine one left half the score's inputs
            # unattributable, which is exactly the gap that made a sim↔glyph divergence need a live
            # re-compute to explain.
            "wind_run_time": (wind or {}).get("run_time"),
            "product_id": marine.get("product_id"),
            "is_forecast_authoritative": marine.get("is_forecast_authoritative"),
            "served_surf_height_m": marine.get("surf_height_m"),
            "url": BASE_URL,
        })
    _remember(key, out)
    return out
