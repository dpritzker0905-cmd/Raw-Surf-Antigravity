"""A dark coverage correction; the existing blend's anchor-relative decay stays intact."""
import os
from datetime import datetime, timedelta, timezone


def cycle_ceiling_enabled():
    return os.environ.get('ESTIMATE_CYCLE_CEILING', '0') == '1'


def _aware(value):
    try:
        dt = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
        if dt.tzinfo is None or dt.utcoffset() is None:
            return None
        return dt.astimezone(timezone.utc)
    except (AttributeError, TypeError, ValueError):
        return None


def extension_ceiling(anchor, native_limit, ceiling_hours=336.0):
    """Use a verified native cycle, otherwise the conservative nominal-anchor bound.

    A storage receipt is never a model cycle. A short native anchor still reaches cycle+336
    when that cycle is verified; unknown cycles do not receive extra hours from late ingestion.
    """
    valid = _aware(getattr(anchor, 'valid_time', None))
    if valid is None:
        return None
    cycle = _aware(getattr(anchor, 'model_run_time', None))
    if (getattr(anchor, 'model_run_time_status', None) == 'known' and cycle is not None
            and cycle <= min(valid, datetime.now(timezone.utc))):
        return cycle + timedelta(hours=ceiling_hours)
    return valid + timedelta(hours=ceiling_hours-native_limit)
