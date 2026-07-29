"""sim_daylight.py — can you actually surf that hour?

WHY THIS EXISTS
---------------
`find_best_window` ranked the forecast horizon purely on the 0-100 surf quality, and quality has no
opinion about whether the sun is up. Measured 2026-07-29 against the live app, 17 spots on five
continents, the default 48 h / 3 h scan:

    #1 ranked window was in DARKNESS at   9 of 17 spots (52.9%)
    of every spot's top-5 list,          42 of 85 windows (49.4%) were in darkness
    catalogue-wide, of the 30,141 frames a default scan touches across all 1,773 active spots,
                                         43.2% are dark, 2.4% civil twilight, 54.4% daylit

Nazare's answer was *"Best in range: 2026-07-29T03:00:00Z"* — 4 a.m. local, two and a half hours
before first light. The tool was confidently recommending sessions nobody can paddle out for.

★ AND IT WAS BUYING ALMOST NOTHING. Restricting the ranking to surfable light costs a **median 0.1
quality points** across those spots (max 21.5 at Jeffreys Bay, where an offshore night really is the
best sea state in range). Half the recommendations were unusable to gain a tenth of a point.

WHY THIS IS NOT A RATING FACTOR
-------------------------------
⛔ It deliberately does NOT touch `surf_rating.rating_score`. A groomed 6 ft wave at 3 a.m. is still
a groomed 6 ft wave — the sea state is what the score measures, and CLAUDE.md's ONE FORECAST
COMPOSITION rule requires the sim's number to stay byte-identical to the one the map and the hub
show for the same spot and hour. Darkness is a property of the OBSERVER, not of the swell. So it
lands where the choosing happens (the scan's ranking) and nowhere else, and `quality_rating` is
unchanged by this module.

That also keeps it out of the "second forecast path" trap: this adds no forecast, samples no
product, and makes no network request. It is closed-form arithmetic on (lat, lng, instant).

THE ALGORITHM AND ITS ACCURACY
------------------------------
Low-precision solar position (USNO / NOAA general solar equations). Validated 2026-07-29 against
TWO independent references that share no code with this one — api.sunrise-sunset.org and
Open-Meteo's `daily=sunrise,sunset` — over 8 spots from 64.1 N (Reykjavik) to -34.1 S (Jeffreys
Bay), 32 comparisons:

    worst disagreement 5.0 min (Reykjavik, where a shallow solar path turns a hundredth of a degree
    into minutes); typical 1-2 min; <= 2 min everywhere against Open-Meteo.

Frames are classified on a 1-3 HOUR grid, so a few minutes at the boundary changes no ranking.
"""
import math
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

# The standard sunrise/sunset convention: the sun's UPPER LIMB touching the horizon, plus mean
# atmospheric refraction. Not 0.0 — using the geometric horizon would call the ~4 minutes either
# side of true sunrise "night".
HORIZON_DEG = -0.833

# Civil twilight. Dawn patrol is ordinary surfing, not an edge case: there is enough light to read
# the sets and see other people in the water, so this counts as SURFABLE. Below it, the honest
# answer is that a surfer cannot use the hour.
CIVIL_TWILIGHT_DEG = -6.0

DAY, TWILIGHT, DARK = "day", "twilight", "dark"

# Kill switch: 0 restores the pre-2026-07-29 pure-quality ranking exactly.
def enabled() -> bool:
    return os.environ.get("SIM_WINDOW_DAYLIGHT", "1") != "0"


def solar_elevation_deg(lat: float, lng: float, when: datetime) -> float:
    """The sun's elevation above the horizon in degrees at an instant. Negative is below.

    Pure and allocation-light: a 24-frame scan calls this 24 times and must stay free next to two
    HTTP requests per frame.
    """
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    # Julian day, then days since the J2000.0 epoch.
    n = when.timestamp() / 86400.0 + 2440587.5 - 2451545.0

    mean_lon = (280.460 + 0.9856474 * n) % 360.0
    mean_anom = math.radians((357.528 + 0.9856003 * n) % 360.0)
    ecliptic_lon = math.radians(
        mean_lon + 1.915 * math.sin(mean_anom) + 0.020 * math.sin(2.0 * mean_anom))
    obliquity = math.radians(23.439 - 0.0000004 * n)

    declination = math.asin(math.sin(obliquity) * math.sin(ecliptic_lon))
    right_asc = math.atan2(math.cos(obliquity) * math.sin(ecliptic_lon), math.cos(ecliptic_lon))

    gmst_hours = (18.697374558 + 24.06570982441908 * n) % 24.0
    local_sidereal = math.radians((gmst_hours * 15.0 + lng) % 360.0)
    hour_angle = local_sidereal - right_asc

    phi = math.radians(lat)
    sin_el = (math.sin(phi) * math.sin(declination)
              + math.cos(phi) * math.cos(declination) * math.cos(hour_angle))
    return math.degrees(math.asin(max(-1.0, min(1.0, sin_el))))


def light_state(lat: float, lng: float, when: datetime) -> Tuple[str, float]:
    """(state, sun elevation). state is one of day / twilight / dark."""
    el = solar_elevation_deg(lat, lng, when)
    if el > HORIZON_DEG:
        return DAY, el
    if el > CIVIL_TWILIGHT_DEG:
        return TWILIGHT, el
    return DARK, el


def is_surfable(state: str) -> bool:
    """Can a surfer use this hour? Civil twilight yes, night no."""
    return state != DARK


def parse_hour(valid_time: str) -> Optional[datetime]:
    """The scan's ISO stamps -> an aware UTC datetime, or None.

    Never raises: this module annotates an answer, so a stamp it cannot read must degrade the
    annotation, not the forecast. `sim_window` treats None as "unknown light" and ranks that frame
    as if it were surfable — the pre-existing behaviour — rather than hiding it.
    """
    try:
        return datetime.strptime(valid_time, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
    except Exception:
        try:
            return datetime.fromisoformat(
                (valid_time or "").replace("Z", "+00:00")).astimezone(timezone.utc)
        except Exception:
            return None


def annotate(lat: float, lng: float, valid_time: str) -> Dict[str, Any]:
    """The light block for one hour at one coordinate. Empty dict when it cannot be determined."""
    if not enabled():
        return {}
    when = parse_hour(valid_time)
    if when is None or lat is None or lng is None:
        return {}
    state, el = light_state(float(lat), float(lng), when)
    return {"light": state, "sun_elevation_deg": round(el, 1), "surfable_light": is_surfable(state)}


def describe(state: Optional[str]) -> str:
    """A phrase a caller can put in a sentence without knowing the vocabulary."""
    return {DAY: "in daylight",
            TWILIGHT: "at civil twilight (dawn/dusk)",
            DARK: "in DARKNESS — before first light or after last light"}.get(state or "", "")
