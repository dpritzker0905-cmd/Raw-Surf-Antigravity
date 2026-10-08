"""Cheap request admission shared by the grid resolver and every series build path.

These bounds refuse impossible work; they do not select frames, change forecast
values or restrict stored historical replay. Horizons come from the public catalog.
"""
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from services.weather_pipeline.capabilities import WEATHER_CAPABILITIES


def validate_bbox_latitudes(west, south, east, north):
    # Longitudes are cyclic: MapLibre can send unwrapped world copies, and west
    # greater than east is a legitimate dateline crossing. Existing normalization
    # owns those semantics; latitude never wraps.
    if not (-90 <= south <= north <= 90):
        raise ValueError('latitude bounds must satisfy -90 <= south <= north <= 90')


def _future_limit(model, domain, layer, now=None):
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    entries = WEATHER_CAPABILITIES
    entry = next((c for c in entries if c['model'].upper() == model.upper()
                  and c['domain'].lower() == domain.lower() and c['layer'].lower() == layer.lower()), None)
    # Preserve existing handling of unlisted combinations, but do not let them
    # fetch thousands of hours beyond any advertised model's largest horizon.
    horizon = entry['max_forecast_hours'] if entry else max(c['max_forecast_hours'] for c in entries)
    # A browser rounds its anchor up at :30; the server floors it. Admit the
    # rounded final hourly slot too, without sliding the limit with client skew.
    latest_anchor = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    if now.minute or now.second or now.microsecond:
        latest_anchor += timedelta(hours=1)
    return latest_anchor + timedelta(hours=horizon)


def validate_grid_time(model, domain, layer, target, now=None):
    target = target.replace(tzinfo=timezone.utc) if target.tzinfo is None else target.astimezone(timezone.utc)
    if target > _future_limit(model, domain, layer, now):
        raise HTTPException(400, 'Requested valid_time exceeds the advertised forecast horizon')


def validated_series_hours(model, domain, layer, hours, base, max_frames):
    base = base.replace(tzinfo=timezone.utc) if base.tzinfo is None else base.astimezone(timezone.utc)
    try:
        selected = sorted({int(h) for h in hours.split(',') if h.strip()})[:max_frames]
    except ValueError:
        raise HTTPException(400, 'hours must be comma-separated integers')
    if not selected:
        raise HTTPException(400, 'no valid hours provided')
    latest = _future_limit(model, domain, layer)
    # Validate the whole selected page before dispatch, including fast paths.
    # Comparing offsets first avoids overflowing timedelta on adversarial ints.
    max_offset = (latest - base).total_seconds() / 3600
    if any(hour > max_offset for hour in selected):
        raise HTTPException(400, 'Requested hours exceed the advertised forecast horizon')
    try:
        for hour in selected:
            base + timedelta(hours=hour)
    except (OverflowError, ValueError):
        raise HTTPException(400, 'Requested hours are outside the datetime range')
    return selected
