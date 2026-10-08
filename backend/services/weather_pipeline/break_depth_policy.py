"""PJ-01 dark hypothesis: reject unusable samples and infer a bounded cap depth.

30m is the existing audit/oversize plausibility threshold, not a universal
breaking law. A 200km median with >=3 distinct donors is a regional PRIOR,
not a measured depth at the pin. Sparse regions use the plausible asset-wide
median. Both priors require owner/field validation before activation.
The committed asset alone defines priors; runtime overlays never change them.
"""
import json
import math
from functools import lru_cache
from statistics import median

MAX_DEPTH_M = 30.0
REGION_RADIUS_KM = 200.0
MIN_REGIONAL_DONORS = 3


def usable_depth(value):
    try:
        value = float(value)
        return math.isfinite(value) and 0 < value <= MAX_DEPTH_M
    except (TypeError, ValueError):
        return False


@lru_cache(maxsize=1)
def _donors():
    from services.weather_pipeline.shore_normal_asset import _ASSET
    with open(_ASSET, encoding='utf-8') as handle:
        doc = json.load(handle)
    rows = {}
    for section, column in (('entries', 4), ('land_present', 3)):
        for row in doc.get(section, []):
            if len(row) > column and usable_depth(row[column]):
                lat, lng = float(row[0]), float(row[1])
                if math.isfinite(lat) and math.isfinite(lng) and -90 <= lat <= 90 and -180 <= lng <= 180:
                    rows.setdefault((lat, lng), float(row[column]))
    return tuple((lat, lng, depth) for (lat, lng), depth in sorted(rows.items()))


@lru_cache(maxsize=4096)
def default_depth(lat, lng):
    from services.weather_pipeline.shore_normal_asset import _haversine_km
    rows = _donors()
    local = [d for y, x, d in rows if _haversine_km(lat, lng, y, x) <= REGION_RADIUS_KM]
    if len(local) >= MIN_REGIONAL_DONORS:
        return float(median(local)), 'regional_prior'
    if rows:
        return float(median(d for _, _, d in rows)), 'global_prior'
    return None, 'unavailable'


def resolve_depth(lat, lng, depth):
    """Preserve plausible measured depths; unavailable priors retain missingness."""
    if usable_depth(depth):
        return float(depth), 'measured'
    try:
        return default_depth(lat, lng)
    except (OSError, ValueError, TypeError, KeyError):
        return None, 'unavailable'
