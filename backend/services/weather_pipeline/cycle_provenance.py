"""Verified forecast-cycle identity, separate from legacy storage timestamps."""
from datetime import datetime, timezone


def cycle_from_points(points):
    """Require a consistent, timezone-qualified cycle on every contributing point.

    Never infer it from receipt time, forecast valid time, or a publication schedule.
    Unknown/partial/conflicting batches remain usable data but do not claim a model cycle.
    """
    values = [p.get('__model_run_time') if isinstance(p, dict) else None for p in points]
    if not any(v is not None for v in values):
        return {'model_run_time': None, 'model_run_time_status': 'missing'}
    parsed = set()
    for value in values:
        if value is None:
            continue
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
            if dt.tzinfo is None or dt.utcoffset() is None:
                raise ValueError('cycle must specify timezone')
            parsed.add(dt.astimezone(timezone.utc))
        except (AttributeError, TypeError, ValueError):
            return {'model_run_time': None, 'model_run_time_status': 'invalid'}
    if len(parsed) > 1:
        return {'model_run_time': None, 'model_run_time_status': 'conflicting'}
    if any(v is None for v in values):
        return {'model_run_time': None, 'model_run_time_status': 'incomplete'}
    return {'model_run_time': parsed.pop(), 'model_run_time_status': 'known'}


def time_provenance(product):
    """Carry provenance at serialization boundaries, including legacy products/doubles."""
    return {key: getattr(product, key, default) for key, default in (
        ('model_run_time', None), ('model_run_time_status', 'missing'), ('ingested_at', None))}
