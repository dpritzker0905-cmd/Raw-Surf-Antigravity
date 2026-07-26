"""
conditions_labels.py

THE canonical `conditions_label` vocabulary — the surf SIZE ladder.

`condition_reports.conditions_label` (and the same column on sessions/gamification) holds a
**size description**, not a quality verdict: "Waist High", "Chest High", "Head High"… The frontend
depends on that: `SpotHubConditionsTab.js` keys a colour map on these exact strings and falls back
to grey for anything unrecognised.

Extracted 2026-07-26 because this function was TRIPLICATED byte-identically across
`routes/surf_data/conditions.py`, `routes/explore_discover/explore.py` and
`routes/explore_discover/spot_details.py`, and a fourth consumer (`weather_sim_mcp.py`, a standalone
MCP server) needed it without paying a ~5.6 s route-module import that boots LiveKit/OneSignal.

This module is intentionally DEPENDENCY-FREE — keep it that way so any process can import it cheaply.
"""

# The complete label set, ascending. Any writer of `conditions_label` must emit one of these, and
# `SpotHubConditionsTab.js`'s `conditionColors` map must stay in sync with it.
CONDITION_LABELS = (
    "Flat",
    "Ankle High",
    "Knee High",
    "Waist High",
    "Chest High",
    "Head High",
    "Overhead",
    "Double Overhead",
    "Triple Overhead+",
)


def get_conditions_label(wave_height_ft: float) -> str:
    """Map a breaking wave height in FEET to the canonical size label."""
    if wave_height_ft < 1:
        return "Flat"
    elif wave_height_ft < 2:
        return "Ankle High"
    elif wave_height_ft < 3:
        return "Knee High"
    elif wave_height_ft < 4:
        return "Waist High"
    elif wave_height_ft < 5:
        return "Chest High"
    elif wave_height_ft < 6:
        return "Head High"
    # Top of the ladder corrected 2026-07-26. The previous 8/10 ft edges were internally impossible:
    # this same ladder sets Head High = 5-6 ft, i.e. one head ~= 5.5 ft, so DOUBLE overhead is ~11 ft
    # and TRIPLE ~16 ft — not 8 and 10. `report_calibration.py:37`, the module that grades forecasts
    # against real logged surfer sessions, already stored the correct anchors all along
    # (("double overhead", 11.0), ("triple overhead", 16.0), ("overhead", 7.0), ("head high", 5.5)),
    # so two modules in this package disagreed and the calibration one was right. Label STRINGS are
    # unchanged, so every frontend colour map keyed on them keeps working.
    elif wave_height_ft < 10:
        return "Overhead"
    elif wave_height_ft < 15:
        return "Double Overhead"
    else:
        return "Triple Overhead+"
