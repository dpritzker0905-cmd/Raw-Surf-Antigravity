"""Transactional delivery ownership shared by the scheduled and manual emitters.

This is a delivery cadence, not a scientific quality threshold. Shape, tide and
local-time preference evaluation still needs an explicit producer contract.
"""
from datetime import datetime, timedelta, timezone
import logging
import math
import os

from sqlalchemy import func, or_, update

from models import SurfAlert

logger = logging.getLogger(__name__)
DEFAULT_COOLDOWN_SECONDS = 3600


def cooldown_seconds():
    """One hour by default; bounded operator override from 15 minutes to one day."""
    try:
        value = int(os.environ.get('SURF_ALERT_COOLDOWN_SECONDS', DEFAULT_COOLDOWN_SECONDS))
        if 900 <= value <= 86400:
            return value
    except (TypeError, ValueError):
        pass
    logger.warning('Invalid SURF_ALERT_COOLDOWN_SECONDS; using the one-hour default')
    return DEFAULT_COOLDOWN_SECONDS


def _finite_nonnegative(value):
    return (isinstance(value, (int, float)) and not isinstance(value, bool)
            and math.isfinite(value) and value >= 0)


async def claim_alert_delivery(db, alert, current, *, now=None):
    """Reserve at most one emission in the caller's notification transaction.

UPDATE rechecks eligibility/cooldown in the database, so stale ORM snapshots and
overlapping processes cannot both claim an alert. Rollback restores the claim;
callers must commit the in-app record before attempting external delivery.
"""
    height = current.get('wave_height_ft')
    if not _finite_nonnegative(height) or current.get('status') == 'no_data':
        return False
    low, high = alert.min_wave_height, alert.max_wave_height
    if any(value is not None and not _finite_nonnegative(value) for value in (low, high)):
        return False
    if low is not None and high is not None and low > high:
        return False
    if (low is not None and height < low) or (high is not None and height > high):
        return False
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError('Alert delivery clock must be timezone aware')
    now = now.astimezone(timezone.utc)
    cutoff = now - timedelta(seconds=cooldown_seconds())
    result = await db.execute(
        update(SurfAlert)
        .where(
            SurfAlert.id == alert.id,
            SurfAlert.user_id == alert.user_id,
            SurfAlert.spot_id == alert.spot_id,
            SurfAlert.is_active.is_(True),
            # Reject a configuration changed since the forecast was evaluated.
            SurfAlert.min_wave_height == low,
            SurfAlert.max_wave_height == high,
            or_(SurfAlert.last_triggered.is_(None), SurfAlert.last_triggered <= cutoff),
        )
        .values(last_triggered=now, trigger_count=func.coalesce(SurfAlert.trigger_count, 0) + 1)
        .returning(SurfAlert.id)
        .execution_options(synchronize_session=False)
    )
    return result.scalar_one_or_none() is not None
