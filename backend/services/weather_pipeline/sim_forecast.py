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
import urllib.error
import urllib.parse
# `urllib.request` pulls `ssl`, whose `_ssl` C extension must load on the MAIN thread. Importing a
# C extension inside a worker thread is what deadlocked the sim MCP server's first tool call on
# 2026-07-27 (see `weather_sim_mcp._warm_hot_path`). Imported HERE, never inside a function.
import urllib.request
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

BASE_URL = os.environ.get(
    "SIM_FORECAST_BASE_URL", "https://raw-surf-antigravity.onrender.com").rstrip("/")
MODEL = os.environ.get("SIM_FORECAST_MODEL", "GFS")
TIMEOUT_S = float(os.environ.get("SIM_FORECAST_TIMEOUT_S", "30"))

# Keyed by (lat, lng, valid_time) — the valid_time is the top of the hour, so entries expire on
# their own as the hour turns. A what-if sweep hits one spot repeatedly and must not re-fetch.
_FORECAST_CACHE: Dict[Any, Any] = {}


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
        return spots
    except Exception as e:
        logger.warning(f"live catalogue fetch failed ({e}); falling back to the local snapshot.")
        return None


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
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        logger.warning(f"live forecast {domain}/{layer} at ({lat},{lng}) failed: {e}")
        return None


def fetch_live_forecast(lat: float, lng: float
                        ) -> Tuple[Optional[Dict[str, float]], Dict[str, Any]]:
    """The app's active forecast at a coordinate. Returns (baseline | None, provenance).

    The provenance always explains itself — on failure it carries a `reason`, so a caller can say
    WHY it has no forecast instead of returning a bare null."""
    if os.environ.get("SIM_LIVE_FORECAST", "1") == "0":
        return None, {"reason": "disabled (SIM_LIVE_FORECAST=0)"}
    valid_time = current_valid_time()
    key = (round(float(lat), 4), round(float(lng), 4), valid_time)
    if key in _FORECAST_CACHE:
        return _FORECAST_CACHE[key]

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
        out = (baseline, {
            "model": MODEL,
            "valid_time": marine.get("valid_time") or valid_time,
            "run_time": marine.get("run_time"),
            "product_id": marine.get("product_id"),
            "is_forecast_authoritative": marine.get("is_forecast_authoritative"),
            "served_surf_height_m": marine.get("surf_height_m"),
            "url": BASE_URL,
        })
    _FORECAST_CACHE[key] = out
    return out
