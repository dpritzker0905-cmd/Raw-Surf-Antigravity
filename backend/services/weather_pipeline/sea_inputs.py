"""sea_inputs.py - ONE resolver for the two per-hour nearshore inputs of `surf_point.estimate_surf_at` (Fable audit CMP-2).

`estimate_surf_at` takes two inputs that belong to the HOUR, not the spot:
  * `water_level_m`: the tide (SURF_TIDE_DEPTH), which moves the depth-limited cap by about 8.5% per 0.5 m where it binds
    (Cocoa, 4 m / 12 s head-on: eta -0.5 -> 4.374 m, 0 -> 4.779, +0.5 -> 5.184);
  * `nearshore`: CDIP MOP's modelled nearshore sea (SURF_NEARSHORE_MOP, EURO member only).
Until 2026-11-10 only `/point` (`point_surf_augment`) passed them. The spot hub's legacy path, `/api/conditions` forecast
rows, `/api/surf-conditions` and the weather sim each called the chain without them, so the same coordinate and hour
showed a different height on those surfaces than on the map's glyph. This module is the one place both inputs are
resolved, with `/point`'s exact gates, so every caller gets the same pair.

No new physics: the blocks below moved here verbatim from `point_surf_augment` (where they were introduced, with their
reasoning). `/point` always resolves through `resolve`. The other callers do so under SURF_SEA_INPUTS_EVERY_CALLER
(D-065, code default ON); with that flag '0' they pass (0.0, None) exactly as before.

Never raises: a failure leaves eta at 0 and the nearshore sea at None (the parametric chain), as `/point` always did.
"""
import logging
from typing import Optional, Tuple

from services import runtime_flags as _rf

logger = logging.getLogger(__name__)

EVERY_CALLER_FLAG = "SURF_SEA_INPUTS_EVERY_CALLER"
EVERY_CALLER_DEFAULT = "1"
NEUTRAL: Tuple[float, None] = (0.0, None)


def every_caller_enabled() -> bool:
    """The kill switch for the callers other than `/point` (which has always resolved both inputs)."""
    return _rf.flag(EVERY_CALLER_FLAG, EVERY_CALLER_DEFAULT) == "1"


async def resolve(lat, lng, valid_time_str, model) -> Tuple[float, Optional[dict]]:
    """(water_level_m, nearshore) for a coordinate and valid time, with `/point`'s gates. Never raises.

    `valid_time_str`: ISO-8601 UTC. `model`: the member whose sea this is ('GFS', 'EURO', 'ICON'; None or any other
    source, e.g. Open-Meteo, gets no MOP sea, because MOP is the EURO member's nearshore)."""
    eta = 0.0
    if _rf.flag("SURF_TIDE_DEPTH") != "0":
        try:
            from services.weather_pipeline.tide import tide_norm_at
            ts = await tide_norm_at(lat, lng, valid_time_str)
            if ts and ts.get("height_m") is not None:
                eta = float(ts["height_m"])
        except Exception as te:
            logger.debug(f"[Sea Inputs] tide resolve failed at ({lat},{lng}); eta=0: {te!r}")
    near = None
    from services.weather_pipeline import mop_serving as _mop
    if _rf.on("SURF_NEARSHORE_MOP") and _mop.applies_to(model):
        try:
            near = await _mop.nearshore_for_point(lat, lng, valid_time_str)
        except Exception as ne:
            logger.warning(f"[Sea Inputs] MOP nearshore unavailable at ({lat},{lng}); parametric kept: {ne!r}")
    return eta, near


async def resolve_for_caller(lat, lng, valid_time_str, model) -> Tuple[float, Optional[dict]]:
    """`resolve` for a caller other than `/point`: NEUTRAL (today's inputs) when the kill switch is off or the
    time is unknown."""
    if not valid_time_str or not every_caller_enabled():
        return NEUTRAL
    try:
        return await resolve(lat, lng, valid_time_str, model)
    except Exception as e:                       # `resolve` never raises; belt and braces for the flag read
        logger.debug(f"[Sea Inputs] unavailable at ({lat},{lng}): {e!r}")
        return NEUTRAL


def iso_z(dt) -> Optional[str]:
    """A datetime (naive = UTC) or ISO string as the `...Z` string the tide and MOP readers take; None if unreadable."""
    try:
        from datetime import datetime, timezone
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    except Exception:
        return None
