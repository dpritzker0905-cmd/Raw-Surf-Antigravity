"""GET /api/weather/point-tide - the map infobox's tide readout for ANY coordinate (2026-11-07).

`/tides/{spot_id}` needs a catalogued spot; the infobox can sit on any GPS point. This reads the SAME
cached Open-Meteo `sea_level_height_msl` cell the hub and the rating use (`tide.fetch_tide_hourly`, TTL
cached per 0.1 degree cell, bounded by its own acquisition budget), so it adds NO upstream call beyond
that cached fetch. It is a MODEL of mean sea level: not MLLW, no station, not an official tide table.
A miss or an Open-Meteo 429 cooldown answers 200 with `available:false`, never an error.
Its own module because `routes/weather.py` sits at the 800-line cap.
"""
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Query, Response

from services.weather_pipeline import tide as _tide

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/weather")

CELL_KM = 11
SOURCE = "model-msl"
_BACK_H, _AHEAD_H = 6, 30   # curve window: a few hours back, through the rest of today and into tomorrow


def _event(e):
    return {"time": e["time"].strftime("%Y-%m-%dT%H:%M:%SZ"), "height_m": round(e["level_m"], 3)}


def build_point_tide(series, lat, lng, now):
    """PURE: shape the readout from an hourly series. None when the series cannot answer."""
    times, levels = (series or {}).get("time"), (series or {}).get("level")
    state = _tide.tide_state_at(times, levels, now)
    if state is None:
        return None
    events = _tide.tide_extrema(times, levels)
    nxt = {t: next((_event(e) for e in events if e["type"] == t and e["time"] > now), None)
           for t in ("High", "Low")}
    lo, hi = now - timedelta(hours=_BACK_H), now + timedelta(hours=_AHEAD_H)
    pts = []
    for t, h in zip(times, levels):
        dt = _tide._parse_iso(t)
        if dt is not None and h is not None and lo <= dt <= hi:
            pts.append({"t": dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "h": round(h, 3)})
    after = _tide.tide_state_at(times, levels, now + timedelta(hours=1))
    rate = round(after["height_m"] - state["height_m"], 3) if after else None  # m per hour, signed
    return {
        "available": True, "height_m": state["height_m"], "trend": state["trend"], "rate_m_per_h": rate,
        "next_high": nxt["High"], "next_low": nxt["Low"], "series": pts,
        # every high/low inside the curve window, so the client can recompute "next" from the cache as time passes
        "events": [dict(_event(e), type=e["type"]) for e in events if lo <= e["time"] <= hi],
        "now": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        # Solar-time offset (longitude / 15): the series is GMT, no tz database is shipped. APPROXIMATE
        # (ignores zones and DST); the client prefers the browser zone when it agrees within 1.5 h.
        "tz_offset_h": round(float(lng) / 15.0), "tz_approx": True,
        "source": SOURCE, "cell_km": CELL_KM,
    }


@router.get("/point-tide")
async def get_point_tide(response: Response,
                         lat: float = Query(..., ge=-90, le=90),
                         lng: float = Query(..., ge=-180, le=180)):
    response.headers["Cache-Control"] = "public, max-age=300"
    try:
        series = await _tide.fetch_tide_hourly(lat, lng)
        out = build_point_tide(series, lat, lng, datetime.now(timezone.utc))
    except Exception as e:  # a lookup that threw is "unavailable", never a 5xx the client toasts
        logger.warning("[point-tide] lookup failed: %s", e)
        out = None
    if out is None:
        response.headers["Cache-Control"] = "public, max-age=30"
        return {"available": False, "source": SOURCE, "cell_km": CELL_KM}
    return out
