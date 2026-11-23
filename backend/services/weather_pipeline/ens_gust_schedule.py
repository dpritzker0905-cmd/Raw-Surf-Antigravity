"""ens_gust_schedule.py - the ENS gust step schedule, thresholds and member count, with NO numpy (2026-11-23).

Split out of ens_gust_risk_core (which re-exports every name here) so that loading the raster frame-set tables
(services/frame_set_raster -> frame_set_raster_plugins -> frame_set_raster_gust_risk) never imports numpy. The data-health
monitor's freshness check (scripts/raster_set_freshness.py) runs on the runner's bare python3, and #1202's top-level import of
the numpy core crashed it before any set was checked (data-health-monitor run 45187283647). Guard:
tests/test_raster_tables_import_without_numpy.py.
"""
from typing import List

KN_TO_MS = 1852.0 / 3600.0
THRESHOLDS_KN = (25, 34, 48)
THRESHOLDS_MS = tuple(round(k * KN_TO_MS, 3) for k in THRESHOLDS_KN)     # 12.861, 17.491, 24.693
MEMBERS = 50


def gust_param(step: int) -> str:
    """The open-data parameter that carries the gust at `step`."""
    return "10fg3" if 93 <= int(step) <= 144 else "10fg"


def gust_window_h(step: int) -> int:
    """Hours in the gust window ending at `step` (measured; the collector checks every message against this)."""
    s = int(step)
    if s <= 0:
        raise ValueError("step 0 has no gust")
    return 1 if s <= 90 else (3 if s <= 144 else 6)


def native_steps(max_h: int = 360) -> List[int]:
    """Every ENS step that carries a gust: 3-144 h by 3, 150-`max_h` by 6."""
    return list(range(3, 145, 3)) + list(range(150, int(max_h) + 1, 6))
