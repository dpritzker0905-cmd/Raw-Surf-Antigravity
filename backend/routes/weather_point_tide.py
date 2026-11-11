"""GET /api/weather/point-tide - the map infobox's tide readout for ANY coordinate (2026-11-07).

`/tides/{spot_id}` needs a catalogued spot; the infobox can sit on any GPS point. This reads the SAME
cached Open-Meteo `sea_level_height_msl` cell the hub and the rating use (`tide.fetch_tide_hourly`, TTL
cached per 0.1 degree cell, bounded by its own acquisition budget), so it adds NO upstream call beyond
that cached fetch. It is MODELED sea-level height relative to MSL: not MLLW, no station, not an official tide table.
A miss or an Open-Meteo 429 cooldown answers 200 with `available:false`, never an error.
Its own module because `routes/weather.py` sits at the 800-line cap.
"""
import logging
import math
from datetime import datetime, timedelta, timezone

from typing import Optional

from fastapi import APIRouter, HTTPException, Query, Response

from services.weather_pipeline import location_time as _lt
from services.weather_pipeline import tide as _tide

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/weather")

CELL_KM = 11
SOURCE = "model-msl"


def _event(e):
    return {"time": e["time"].strftime("%Y-%m-%dT%H:%M:%SZ"), "height_m": round(e["level_m"], 3)}


def build_point_tide(series, lat, lng, now):
    """PURE: shape the readout from an hourly series. None when the series cannot answer."""
    times, levels = (series or {}).get("time"), (series or {}).get("level")
    if not isinstance(times, list) or not isinstance(levels, list) or len(times) != len(levels):
        return None
    pts, segments, segment = [], [], []
    previous = None
    broken = False  # a skipped (unparsable / duplicate / out-of-order) sample is a GAP, not a verdict on the cell
    for t, h in zip(times, levels):
        dt = _tide._parse_iso(t) if isinstance(t, str) else None
        if dt is not None:
            dt = dt.astimezone(timezone.utc)  # every instant below is UTC, whatever offset the feed used
        if dt is None or (previous is not None and dt <= previous):
            broken = True
            continue
        valid = isinstance(h, (int, float)) and not isinstance(h, bool) and math.isfinite(h)
        if not valid or broken or (previous is not None and dt - previous != timedelta(hours=1)):
            if segment:
                segments.append(segment)
            segment = []
        broken = False
        pts.append({"t": dt.strftime("%Y-%m-%dT%H:%M:%SZ"), "h": round(h, 3) if valid else None})
        if valid:
            segment.append((dt, h))
        previous = dt
    if segment:
        segments.append(segment)
    usable = [part for part in segments if len(part) >= 2]
    if not usable:
        return None
    events = []
    state = None
    selected_end = None
    for part in usable:
        events.extend(_tide.tide_extrema([t.isoformat() for t, _ in part], [h for _, h in part]))
        for (a, h0), (b, h1) in zip(part, part[1:]):
            if a <= now < b or (now == b == part[-1][0]):
                selected_end = part[-1][0]
                rate = h1 - h0
                state = {"height_m": round(h0 + rate * (now - a).total_seconds() / 3600, 3),
                         "trend": "rising" if rate > 0.02 else "falling" if rate < -0.02 else "slack",
                         "rate_m_per_h": round(rate, 3)}
                break
    nxt = {t: next((_event(e) for e in events if selected_end is not None and e["type"] == t and now < e["time"] <= selected_end), None)
           for t in ("High", "Low")}
    return {
        # Availability describes the returned series; the client must test the selected instant.
        "available": True, **(state or {"height_m": None, "trend": None, "rate_m_per_h": None}),
        "selected_time_available": state is not None,
        "next_high": nxt["High"], "next_low": nxt["Low"], "series": pts,
        "events": [dict(_event(e), type=e["type"]) for e in events],
        "now": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "coverage": [{"start": part[0][0].strftime("%Y-%m-%dT%H:%M:%SZ"),
                      "end": part[-1][0].strftime("%Y-%m-%dT%H:%M:%SZ")} for part in usable],
        "timezone": "UTC", "datum": "MSL", "quantity": "modeled_sea_level",
        "provider": "Open-Meteo Marine", "source_url": _tide.OPEN_METEO_MARINE_API,
        # Retained for older clients. New clients use explicit UTC, never a guessed civil zone.
        "tz_offset_h": round(float(lng) / 15.0), "tz_approx": True,
        "source": SOURCE, "cell_km": CELL_KM,
    }


def _with_location_time(out, lat, lng, now):
    """Add the civil zone (location_time phase 1; presentation only). Absent when the flag is off; a failure is a
    reason inside the field, never a lost tide readout."""
    try:
        lt = _lt.describe(lat, lng, now)
    except Exception as e:  # noqa: BLE001
        logger.warning("[point-tide] location_time failed at (%s, %s): %s", lat, lng, e)
        lt = None
    if lt is not None:
        out["location_time"] = lt
    return out


@router.get("/point-tide")
async def get_point_tide(response: Response,
                         lat: float = Query(..., ge=-90, le=90),
                         lng: float = Query(..., ge=-180, le=180)):
    response.headers["Cache-Control"] = "public, max-age=300"
    now = datetime.now(timezone.utc)
    try:
        series = await _tide.fetch_tide_hourly(lat, lng)
        out = build_point_tide(series, lat, lng, now)
    except Exception as e:  # a lookup that threw is "unavailable", never a 5xx the client toasts
        logger.warning("[point-tide] lookup failed: %s", e)
        out = None
    if out is None:
        response.headers["Cache-Control"] = "public, max-age=30"
        return _with_location_time({"available": False, "source": SOURCE, "cell_km": CELL_KM}, lat, lng, now)
    return _with_location_time(out, lat, lng, now)


@router.get("/location-time")
async def get_location_time(response: Response,
                            lat: float = Query(..., ge=-90, le=90),
                            lng: float = Query(..., ge=-180, le=180),
                            at: Optional[str] = Query(None, description="UTC instant, e.g. 2026-11-10T18:00:00Z")):
    """The civil time zone at ANY coordinate for one instant (location_time phase 1): the infobox and other
    any-coordinate surfaces label the SELECTED time with it. In-process grid lookup, no upstream call."""
    when = None
    if at:
        try:
            when = datetime.fromisoformat(at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=422, detail="at must be an ISO-8601 instant")
        if when.tzinfo is None:
            raise HTTPException(status_code=422, detail="at must carry a UTC offset or Z")
    lt = _lt.describe(lat, lng, when)
    if lt is None:
        response.headers["Cache-Control"] = "no-store"
        return {"location_time": None, "reason": "disabled"}
    if not lt.get("iana"):                               # a reason (grid missing/corrupt) must not outlive its fix
        response.headers["Cache-Control"] = "no-store"
    else:
        response.headers["Cache-Control"] = "public, max-age=3600" if at else "public, max-age=60"
    return {"location_time": lt}
