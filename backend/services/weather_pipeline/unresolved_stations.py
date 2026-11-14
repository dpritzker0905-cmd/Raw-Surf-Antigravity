"""Stations the served grid cannot represent, BY NAME, each with its reason (2026-11-14, SAMPLER_UNRESOLVED_STATIONS).

A station belongs here only when a MEASUREMENT shows the sampler's answer at its coordinate is another water body's sea.
It is representativeness metadata, the way operational verification handles a station that does not represent the grid:
a named entry with its evidence, not a geometric rule. Two geometric rules were measured for this job and both failed to
separate the one station below from real surf spots (docs/weather-program/log/2026-11-13-fable-strait-fallback.md).

The entry acts ONLY in the sampler's all-land-corner branch (no bracketing cell is wet). A grid that resolves the water
gives the point a wet corner and the entry lapses by itself; nothing here has to be removed when a finer model arrives.

Kill switch: SAMPLER_UNRESOLVED_STATIONS=0 (runtime_flags, D-065 GUARDED) restores the old far-water read exactly.
"""
import math
from typing import Optional

# Half a kilometre of slack on NDBC's published position, far inside one 0.25-degree cell: the STATION, not its
# neighbourhood. No catalogue surf spot sits within 0.6 degrees of the one entry (1,773 spots, 2026-08-12 catalogue).
MATCH_RADIUS_DEG = 0.02

UNRESOLVED_STATIONS = (
    {"id": "NDBC-46267", "name": "Angeles Point, WA (Strait of Juan de Fuca)", "lat": 48.171, "lng": -123.600,
     "reason": "a 0.25-degree global wave model does not resolve the Strait of Juan de Fuca: all four cells around the "
               "station are land on NOAA's native GFS-Wave mask, and the nearest wet cell, 0.729 degrees away, is open "
               "Pacific off Cape Flattery",
     "evidence": "served minus Open-Meteo best_match +1.47..+1.52 m over 14 days (Actions run 43339322792); the same "
                 "model's public copy returns null here; no operational wave forecast resolves the strait (#851)"},
)


def enabled() -> bool:
    from services import runtime_flags as _rf     # lazy: the sampler stays importable without the flag service
    return _rf.on("SAMPLER_UNRESOLVED_STATIONS")


def station_at(lat: float, lng: float) -> Optional[dict]:
    """The named entry whose published position is within MATCH_RADIUS_DEG of (lat, lng), else None."""
    for s in UNRESOLVED_STATIONS:
        if math.hypot(lat - s["lat"], lng - s["lng"]) <= MATCH_RADIUS_DEG:
            return s
    return None
