"""Final tie-break only: verified initialization, then stable product filename."""
from datetime import datetime


def selection_identity(product):
    cycle = getattr(product, 'model_run_time', None)
    known = getattr(product, 'model_run_time_status', None) == 'known'
    if isinstance(cycle, str):
        try:
            cycle = datetime.fromisoformat(cycle.replace('Z', '+00:00'))
        except ValueError:
            cycle = None
    known = known and isinstance(cycle, datetime) and cycle.tzinfo is not None and cycle.utcoffset() is not None
    return (0 if known else 1, -cycle.timestamp() if known else 0,
            str(getattr(product, 'filename', '') or getattr(product, 'product_id', '')))
