"""wind_lane_skill.py - HRRR's maximum weight in the wind lane, by region and lead (DARK: WIND_LANE_SKILL_WEIGHTS, default 0).

WHY (log 2026-11-12-claude-wind-lane-skill-weights.md; grade log 2026-11-11-claude-hrrr-wind-grade.md). Against 80 NDBC
buoys over 25 days the lane at full HRRR weight (L3-L36) was WORSE than GFS on the West coast at every lead (vector RMSE
+0.41 to +1.49 kn, CIs clear of zero) and tied on the East, while the half-and-half blend on the time taper (L47) beat
both. A constant weight fitted on odd cycles beat both members on the held-out even cycles in 26 of 28 published cells
and in all 8 cells of this table. The NBM weights its members the same way (by lead and place, never 1 for one model).

WHAT IT DOES. With the flag on, `wind_lane.lane_use` caps each node's HRRR weight at
    min(space_weight x time_weight, cap(lon, lead))
so the 200 km space feather and the 3 h time taper still take the weight to 0 smoothly at HRRR's edge and horizon,
and only the interior (where the weight was 1) changes. `cap` comes from the checked-in table
`wind_lane_skill_weights.json` (fit window, split and n recorded there):
  * LEAD: hours from the HRRR cycle to the valid time; linear between the fitted leads (3/12/24/36 h), held flat
    outside them (L0-L3 at the L3 value, L37-L48 at the L36 value). Linear, so no hour steps the drawn field.
  * REGION: `west` (Pacific) and `east` (Atlantic + Gulf), joined by a cos^2 ramp over longitude (`region_ramp_lon`,
    -112 to -106: inland Nevada/Utah/Arizona, no buoy on it), so no meridian steps the drawn field either. Nodes over
    land and the Great Lakes take their side's value; no buoy graded them.
With the flag off nothing here runs and the lane is byte-identical to today (tests/test_wind_lane_skill_weights.py).

SCOPE. It moves only the drawn wind MAP: `apply_wind_lane` runs in the /grid route; stored products, spot points,
ratings and glyphs never pass through it (tests/test_wind_hrrr_lane.py's AST guard). The static wind frames publisher
pins this flag OFF (frame_set_wind.pin_code_defaults), and a box with it on reports `skill_weights` in box_state, so
the client serves the lane's hours from /grid, never from frames blended differently (windStaticFrames.laneVerdict).
"""
import json
import math
import os
from functools import lru_cache

FLAG = "WIND_LANE_SKILL_WEIGHTS"
TABLE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wind_lane_skill_weights.json")


def enabled() -> bool:
    """On only for the exact value "1", read at call time (D-001: served numbers ship dark)."""
    return os.environ.get(FLAG, "0") == "1"


@lru_cache(maxsize=1)
def table() -> dict:
    with open(TABLE_PATH, encoding="utf-8") as fh:
        t = json.load(fh)
    leads = [float(x) for x in t["leads_h"]]
    if leads != sorted(leads) or len(set(leads)) != len(leads):
        raise ValueError("wind lane skill table: leads_h must be strictly increasing")
    for region in ("west", "east"):
        w = t["w_max"][region]
        if len(w) != len(leads) or not all(0.0 <= float(x) <= 1.0 for x in w):
            raise ValueError(f"wind lane skill table: w_max[{region}] needs one weight in [0, 1] per lead")
    lo, hi = (float(x) for x in t["region_ramp_lon"])
    if not lo < hi:
        raise ValueError("wind lane skill table: region_ramp_lon must be [west end, east end]")
    return t


def table_id():
    """The table's id when the flag is on, else None (box_state and the /grid stamp report it)."""
    return table()["id"] if enabled() else None


def west_share(lngs):
    """1 west of the ramp, 0 east of it, cos^2 between (smooth in value and slope, like the space feather)."""
    import numpy as np
    lo, hi = (float(x) for x in table()["region_ramp_lon"])
    x = np.clip((((np.asarray(lngs, dtype=float) + 180.0) % 360.0) - 180.0 - lo) / (hi - lo), 0.0, 1.0)
    return np.cos(0.5 * math.pi * x) ** 2


def lead_cap(region: str, lead_h: float) -> float:
    import numpy as np
    t = table()
    return float(np.interp(float(lead_h), [float(x) for x in t["leads_h"]], [float(x) for x in t["w_max"][region]]))


def cap(lngs, lead_h: float):
    """HRRR's maximum weight at each longitude for one lead (hours from the HRRR cycle)."""
    s = west_share(lngs)
    return s * lead_cap("west", lead_h) + (1.0 - s) * lead_cap("east", lead_h)


def lead_hours(cycle, valid) -> float:
    return (valid - cycle).total_seconds() / 3600.0
