"""Resolve one known served instant for real forecast quality; never infer UTC."""
from datetime import datetime, timezone
import os


def forecast_gate_time(hour, provenance, payload):
    if os.environ.get('SIM_FORECAST_SERVED_GATE', '0') != '1':
        return hour or None, True
    instant = served_gate_time(provenance)
    if instant is None:
        payload['quality_status'] = 'unavailable_served_time'
    return instant, instant is not None


def served_gate_time(provenance):
    identity = provenance.get('product_identity')
    if isinstance(identity, dict):
        raw = [(identity.get(domain) or {}).get('served_valid_time') for domain in ('marine', 'wind')]
    else:
        raw = [provenance.get('served_valid_time') or provenance.get('valid_time')]
    times = []
    for value in raw:
        try:
            dt = datetime.fromisoformat(value.replace('Z', '+00:00'))
        except (AttributeError, TypeError, ValueError):
            return None
        if dt.tzinfo is None:
            return None
        times.append(dt.astimezone(timezone.utc))
    if not times or any(t != times[0] for t in times):
        return None
    return times[0].isoformat().replace('+00:00', 'Z')
