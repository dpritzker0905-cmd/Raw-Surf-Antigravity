"""Where the skill ledger's scored rows live, and how every reader finds them.

Stdlib only, on purpose: `scripts/forecast_accuracy_monitor.py` imports this with no dependency installed.

★ WHY (2026-10-16). Scored rows used to go to ONE object per month, re-uploaded whole by every pass.
`calibration/skill/scored-2026-10.json` reached 52,404,041 B against Supabase Storage's 50 MiB object limit
(52,428,800 B), and from 2026-10-13 16:47Z 49 of 57 passes failed `HTTP 400 {"statusCode":"413",
"code":"EntityTooLarge"}`. The ledger writes its archive BEFORE `pending.json`, so a failed archive write also
skipped the pending write: the new forecasts of every failed pass were never recorded. October was the first
month at the volume the lanes added on 09-26..09-30 (about 4.1 MB a day), so a month's object could not last a
month, and a November rollover would only have bought about twelve days.

THE RULE. A target in a month before `DAY_SEGMENTS_FROM` is archived in that month's object, as it always was
(August 47 MB and September 34 MB stay exactly where readers expect them). From `DAY_SEGMENTS_FROM` on, a row is
archived in one object per UTC DAY of its target: about 4 MB, a tenth of the limit. The monthly object of a
segmented month (`scored-2026-10.json`) is FROZEN: it is still READ, so its rows still count and still dedupe,
and it is never written again.

Readers must go through `read_month`, which lists the objects a month can live in and reads all of them.
"""
import calendar
from datetime import date, datetime, timezone
from typing import Callable, List, Mapping, Optional, Tuple

SCORED_PREFIX = "calibration/skill/scored-"
DAY_SEGMENTS_FROM = "2026-10"     # first month whose new rows go to one object per UTC day


def segmented(month: str) -> bool:
    """True when `month` ("YYYY-MM") archives into day objects. Such strings order like the months they name."""
    return month >= DAY_SEGMENTS_FROM


def month_key(month: str) -> str:
    return f"{SCORED_PREFIX}{month}.json"


def day_key(day: str) -> str:
    return f"{SCORED_PREFIX}{day}.json"


def key_for_target(target: datetime) -> str:
    """The object a scored row with this target time is archived in."""
    when = target.astimezone(timezone.utc)
    month = when.strftime("%Y-%m")
    return day_key(when.strftime("%Y-%m-%d")) if segmented(month) else month_key(month)


def month_object_of(key: str) -> Optional[str]:
    """For a DAY key, the monthly object of the same month (frozen, but still part of the archive); None for a
    monthly key."""
    name = key[len(SCORED_PREFIX):-len(".json")]
    return month_key(name[:7]) if len(name) == 10 else None


def keys_for_month(month: str, through: date) -> List[str]:
    """Every object that can hold `month`'s rows, oldest first: the monthly object, then (segmented months only)
    one object per day up to and including `through`. A month before the switch gets no day keys: every one
    would be a round trip to an object that cannot exist."""
    keys = [month_key(month)]
    if segmented(month):
        year, number = int(month[:4]), int(month[5:7])
        for day in range(1, calendar.monthrange(year, number)[1] + 1):
            if date(year, number, day) > through:
                break
            keys.append(day_key(f"{month}-{day:02d}"))
    return keys


def read_month(month: str, through: date,
               load: Callable[[str], Tuple[List[dict], bool]],
               override: Optional[Mapping[str, List[dict]]] = None) -> Tuple[List[dict], bool]:
    """(rows, any_object_exists) for the month. `load(key)` returns (rows, exists) and RAISES when an object
    cannot be read: that propagates, because an unread object is never an empty one. `override` maps a key to
    rows already in hand (what a pass just wrote), so they are not read back."""
    rows: List[dict] = []
    exists = False
    for key in keys_for_month(month, through):
        if override and key in override:
            part, there = override[key], True
        else:
            part, there = load(key)
        rows.extend(part)
        exists = exists or there
    return rows, exists
