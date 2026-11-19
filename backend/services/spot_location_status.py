"""Spots whose LOCATION nobody has verified yet, and whether the public sees them.

Owner, 2026-11-18: "ones that arent verified could be a different color, or different border color to the spot pin
circle", confirmed as "Yes, dashed ring"; and "Unverified spots we should have an admin toggle to make them visible
or not."

WHICH SPOTS. Only a spot ADDED from the holding table and not yet verified by a person: `accuracy_flag ==
NEW_UNVERIFIED_FLAG`. The roughly 1,300 existing rows whose `accuracy_flag` is the old default `'unverified'` are
NOT in this set: the owner's decision was that today's pins do not change. Nothing writes this value yet; the
promote action (a later change) will. Until then this module changes nothing anyone can see.

THE SWITCH. One feature flag, key `show_unverified_spots`, in the existing `feature_flags` table (no schema change;
an admin flips it without a deploy). OFF or missing means the public list leaves these spots out. ON means they are
listed, with `location_unverified: true`, and the map draws them with a dashed ring and the words "Unverified
location". It reads as OFF whenever in doubt.

`surf_rating` confidence is untouched: `spot_ratings.spot_confidence` gives this flag "medium", as it does any value
it does not know.
"""
import time
from typing import Optional

from sqlalchemy import or_, select

NEW_UNVERIFIED_FLAG = "new_unverified"
FLAG_KEY = "show_unverified_spots"
FLAG_TTL_SECONDS = 30.0          # the same order as the public spot list's own cache

_cached: Optional[bool] = None
_cached_at = 0.0


def location_unverified(accuracy_flag) -> bool:
    """True for a spot added from the holding table whose position no person has verified."""
    return (accuracy_flag or "").strip().lower() == NEW_UNVERIFIED_FLAG


def hidden_clause(spot_model):
    """A WHERE clause that leaves the unverified-location spots out (NULL-safe)."""
    return or_(spot_model.accuracy_flag.is_(None), spot_model.accuracy_flag != NEW_UNVERIFIED_FLAG)


def reset_cache() -> None:
    global _cached, _cached_at
    _cached, _cached_at = None, 0.0


async def show_unverified_spots(db) -> bool:
    """Whether the public is shown unverified-location spots. Cached for 30 s; False on any doubt."""
    global _cached, _cached_at
    now = time.monotonic()
    if _cached is not None and now - _cached_at < FLAG_TTL_SECONDS:
        return _cached
    value = False
    try:
        from models import FeatureFlag
        flag = (await db.execute(select(FeatureFlag).where(FeatureFlag.key == FLAG_KEY))).scalar_one_or_none()
        value = bool(flag is not None and flag.is_enabled and not flag.kill_switch_enabled)
    except Exception:
        value = False
        # A failed statement leaves a Postgres transaction ABORTED: without this rollback, the caller's next query
        # on the same session (the spot list itself) fails too, and an unreadable flag table would turn the public
        # spot list into a 500. Callers read the flag BEFORE any other work on the session, so nothing is lost.
        try:
            await db.rollback()
        except Exception:
            pass
    _cached, _cached_at = value, now
    return value
