"""G4 rules (docs/weather-program/log/2026-11-15-claude-tide-m1.md: G4 DRAFT 22:22 EST 2026-11-17, addendum 1 23:41,
item 6 23:59, and the advisor's FINAL edits of 2026-11-18 07:25Z). numpy only; no I/O, so every rule is tested
(tests/test_tide_g4_rules.py).

Two jobs live here, both started on the owner's word ("Yes, move forward on the path toward SOTA", 2026-11-18):
- the POWER CHECK (design only, on G3t's SEEN window): its ONLY output is the pass share, the fraction of 56-day
  stretches whose (A+M) - D upper end is <= -0.02 m. No other arm is scored in it.
- the daily REFERENCE ARCHIVE: Open-Meteo C (latest run) and D (previous_day1/2) at the 26 gauge positions, from the
  committed START, re-uploaded CUMULATIVELY each day as a plain Actions artifact (retention 90 days, the repo maximum).
  References only, never observed water: it cannot break the G4 embargo.
"""
from datetime import datetime, timedelta, timezone

import numpy as np

REGISTRATION = "G4"
# The START is a committed UTC timestamp in G4 FINAL (addendum 1, change 4). None until FINAL commits it: until then
# the archive job does nothing. LEN_DAYS is fixed in FINAL from the power check (56, or 84 if the share < 0.8).
START = None
LEN_DAYS = None
SCORING_LAG_DAYS = 3                    # CO-OPS verified data lag: the gate runs after window end + 3 days

# The gauges (G3t's 26 CO-OPS stations, fixed) and the reported rows (addendum 1, change 2; enter no item).
GAUGES = ("1612340", "1615680", "1617760", "1611400", "9410230", "9410660", "9413450", "9415020", "9419750", "9435380",
          "9443090", "8443970", "8452660", "8531680", "8534720", "8651370", "8658163", "8665530", "8720030", "8722670",
          "8723214", "8726724", "8729840", "8771510", "9755371", "9751639")
REPORTED_GAUGES = ("8679598", "8760922", "8770822")     # Kings Bay, Pilots Station East, Texas Point

# ---------------------------------------------------------------- power check (design only; addendum 1, change 1)
POWER_LEN_DAYS = 56
POWER_LONG_DAYS = 84
POWER_SHARE_MIN = 0.8
POWER_LINE_M = -0.02                    # item 1's line for P4 - D
POWER_STEP_DAYS = 1


def stretches(hours, held_out, len_days=POWER_LEN_DAYS, step_days=POWER_STEP_DAYS):
    """Index arrays into `hours` (aware UTC, hourly, held-out hours already removed), one per stretch of `len_days`
    consecutive CALENDAR days starting at each 00Z (every `step_days`) whose span touches no held-out hour and whose
    every hour is present. A stretch never bridges a held-out week, so each is a contiguous hourly run like the real
    G4 window."""
    if not hours:
        return []
    pos = {t: i for i, t in enumerate(hours)}
    n = len_days * 24
    out = []
    d = hours[0].replace(hour=0, minute=0, second=0, microsecond=0)
    if d < hours[0]:
        d += timedelta(days=1)
    last = hours[-1]
    while d + timedelta(hours=n - 1) <= last:
        span_end = d + timedelta(hours=n)
        clean = not any(a < span_end and d < b for a, b in held_out)
        if clean:
            idx = [pos.get(d + timedelta(hours=k)) for k in range(n)]
            if all(i is not None for i in idx):
                out.append(np.asarray(idx, dtype=int))
        d += timedelta(days=step_days)
    return out


def stretch_passes(upper_end):
    """One stretch passes when (A+M) - D's upper end is finite and <= -0.02 m."""
    try:
        u = float(upper_end)
    except (TypeError, ValueError):
        return False
    return bool(np.isfinite(u) and u <= POWER_LINE_M)


def pass_share(upper_ends):
    """(share, n): the fraction of stretches that pass. A stretch with no finite upper end counts as NOT passing."""
    n = len(upper_ends)
    if n == 0:
        return float("nan"), 0
    return sum(stretch_passes(u) for u in upper_ends) / n, n


def window_length(share):
    """FINAL's length from the power check: 56 days unless the share is below 0.8 (or not a number), then 84."""
    try:
        s = float(share)
    except (TypeError, ValueError):
        return POWER_LONG_DAYS
    return POWER_LEN_DAYS if np.isfinite(s) and s >= POWER_SHARE_MIN else POWER_LONG_DAYS


# ---------------------------------------------------------------- reference archive (item 6)
ARCHIVE_NAME = "tide-g4-reference-archive"
ARCHIVE_VARS = ("sea_level_height_msl", "sea_level_height_msl_previous_day1", "sea_level_height_msl_previous_day2")
ARCHIVE_LOOKBACK_DAYS = 3               # each run re-asks the last 3 UTC days, so one missed run loses nothing
DATUM_DAYS = 365                        # D's datum: the 365-day previous_day1 mean before the START (as in G3t)


def archive_phase(now, start=START, len_days=LEN_DAYS):
    """'not-started' before the committed START (or while START / LEN_DAYS are unset), 'archiving' from START until
    window end + 3 days (C's 72 h means need the days after the window), then 'complete'."""
    if start is None or len_days is None:
        return "not-started"
    if now < start:
        return "not-started"
    end = start + timedelta(days=len_days) + timedelta(days=SCORING_LAG_DAYS)
    return "archiving" if now <= end else "complete"


def archive_days(now, start=START, lookback=ARCHIVE_LOOKBACK_DAYS):
    """The complete UTC days to ask for on this run: the last `lookback` days before today, none before the START."""
    today = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    first = today - timedelta(days=lookback)
    if start is not None:
        first = max(first, start.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0))
    out, d = [], first
    while d < today:
        out.append(d)
        d += timedelta(days=1)
    return out


def fresh_archive_allowed(now, start=START, lookback=ARCHIVE_LOOKBACK_DAYS):
    """A new (empty) archive may be started only within the first `lookback` days after START; later, a missing
    previous archive means a failed download, and the run must fail rather than replace history with a part of it."""
    return start is not None and now <= start + timedelta(days=lookback)


def merge_first_seen(archive_var, fetched, fetched_at):
    """Add hourly values to one station-variable archive {iso hour: [value, fetched_at]}. The FIRST value seen for an
    hour is kept (a later fetch never overwrites it); returns how many hours were new."""
    new = 0
    for hour, value in fetched.items():
        if value is None or hour in archive_var:
            continue
        archive_var[hour] = [float(value), fetched_at]
        new += 1
    return new


def utc(y, mo, d, h=0):
    return datetime(y, mo, d, h, tzinfo=timezone.utc)
