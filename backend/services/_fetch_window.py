"""_fetch_window.py — fetch only the forecast steps a wind native recovery asked for (2026-10-09).

⛔ THE DEFECT. The wind native-recovery lane (weather_pipeline/wind_native_recovery.py) fetched EVERY step of the
run for each failed viewport: GFS f000-f384 is 129 steps, each a whole-globe UGRD/VGRD pair downloaded and decoded,
and then 128 more hours normalized and persisted inside the serve process. On 2026-10-09 the Open-Meteo breaker was
open, so every new pan box near the Gulf hurricane failed over to a recovery: instance 4gt6w spawned 10 of them
between 03:07:50Z and 03:09:21Z and ran them back to back until 03:32:28Z on the one CPU that serves production.

A recovery now sends `valid_window` ({"start": iso, "end": iso}, inclusive) and the fetcher keeps only the steps whose
valid time falls inside it. The scheduler's ingest never sends one, so its fetches are unchanged.

Spawned BY PATH: fetchers import this as `try: from _fetch_window import ... except ImportError: from
services._fetch_window import ...` (tests/test_fetcher_script_imports.py).
"""
from datetime import datetime, timedelta, timezone


def _utc(iso):
    dt = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def window_f_hours(f_hours, cycle_dt, valid_window):
    """The steps of `f_hours` (hours after `cycle_dt`) whose valid time lies inside `valid_window`.

    `valid_window` None or empty keeps every step."""
    if not valid_window:
        return list(f_hours)
    start, end = _utc(valid_window["start"]), _utc(valid_window["end"])
    return [f for f in f_hours if start <= cycle_dt + timedelta(hours=f) <= end]
