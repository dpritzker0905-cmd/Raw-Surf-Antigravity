"""A surf spot's IANA civil time zone, from the offline table backend/data/spot_timezones.json (2026-11-10).

Every surface that named a spot's local time used the nautical zone round(lng / 15) (spot_hub_composition.solar_utc_offset_hours,
surf_alert_windows, weather_point_tide's tz_offset_h): an hour off at Pipeline, Hainan and Mar del Plata all year, 30 minutes off
in Goa, and blind to DST. This module only NAMES the zone (`spot_timezone`), as a new additive field beside those offsets: no
served number, label or local day changes here; consumers adopt it separately (the hub's daily rows ship dark: they move a
served number).

The table is built offline by backend/scripts/build_spot_timezones.py (no polygon library in the web process: the box is 2 GiB).
Lookup: the cell key "lat,lng" at 2 decimals exactly as Postgres prints round(x::numeric, 2) (half away from zero), then the 8
neighbouring cells (a rounding disagreement at a .xx5 edge), else None: an unknown location never gets a guessed zone.

Kill: env SPOT_TIMEZONE_FIELD=0 (read at call time) makes `spot_timezone` return None everywhere.
"""
import json
import logging
import os
from decimal import Decimal, ROUND_HALF_UP
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional

logger = logging.getLogger(__name__)
TABLE = Path(__file__).resolve().parents[2] / "data" / "spot_timezones.json"
_CENT = Decimal("0.01")


def enabled() -> bool:
    return os.environ.get("SPOT_TIMEZONE_FIELD", "1") != "0"


def _round2(x: float) -> Decimal:
    # Postgres float8::numeric keeps 15 significant digits, then round(.., 2) rounds half away from zero.
    d = Decimal(format(float(x), ".15g")).quantize(_CENT, rounding=ROUND_HALF_UP)
    return d if d != 0 else Decimal("0.00")


def cell_key(lat: float, lng: float) -> str:
    return f"{_round2(lat)},{_round2(lng)}"


@lru_cache(maxsize=1)
def _zones() -> Dict[str, Optional[str]]:
    try:
        return json.loads(TABLE.read_text(encoding="utf-8")).get("zones") or {}
    except Exception as e:   # a missing or broken table names no zone; it never breaks the payload
        logger.warning(f"[spot-timezone] table unavailable: {e}")
        return {}


def spot_timezone(lat, lng) -> Optional[str]:
    """The IANA zone of the spot cell at (lat, lng), its neighbours' if the exact cell is absent, else None."""
    if not enabled():
        return None
    try:
        la, ln = float(lat), float(lng)
    except (TypeError, ValueError):
        return None
    zones = _zones()
    if not zones:
        return None
    z = zones.get(cell_key(la, ln))
    if z:
        return z
    rla, rln = _round2(la), _round2(ln)
    for dla in (-_CENT, Decimal(0), _CENT):
        for dln in (-_CENT, Decimal(0), _CENT):
            if dla == 0 and dln == 0:
                continue
            nla, nln = rla + dla, rln + dln
            z = zones.get(f"{nla if nla != 0 else Decimal('0.00')},{nln if nln != 0 else Decimal('0.00')}")
            if z:
                return z
    return None
