"""
shore_normal_asset.py — runtime lookup for the ETOPO-derived per-spot shore normals.

Reads the asset built by `scripts/build_shore_normals.py` (data/shore_normals.json) and answers
"which way does the coast face at this point?" from a ~463 m source instead of the bundled 0.25°
grid's 194.6 km window. See `shore_normal_fit` for why the coarse grid is wrong and how the
confidence gate was validated.

CONTRACT
  * Load is lazy, cached, and fail-safe: a missing or corrupt asset yields (None, None) forever
    after, and the caller keeps whatever `bathymetry.shore_normal_at()` gave it. Nothing here can
    make a rating worse than it is today.
  * Only spots that PASSED the build-time confidence gate are in the file, so a hit is already
    known-trustworthy — this module does no quality judgement of its own.
  * Lookup is nearest-within-radius. Adjacent named peaks are legitimately close (Rincón has five
    breaks inside 3 km, and four pairs in the catalog sit under 50 m apart), so nearest wins rather
    than first-match.

Kill switch: SHORE_NORMAL_ASSET=0 -> lookups return (None, None) without touching the file.
"""
import json
import math
import os
import threading
from functools import lru_cache
from typing import Optional, Tuple

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_ASSET = os.path.join(_DATA_DIR, "shore_normals.json")

# Entries are keyed at each spot's own coordinate. A click a few hundred metres away is the same
# break and should share its geometry; a kilometre out we stop guessing. Deliberately tighter than
# the hand-verified overrides' 2 km radius — those are human ground truth, these are derived.
MATCH_RADIUS_KM = 1.0
_BUCKET_DEG = 0.1                # spatial hash cell (~11 km) so lookup never scans all entries
_EARTH_KM = 6371.0

_lock = threading.Lock()
_index = None                    # {(bucket_lat, bucket_lng): [(lat, lng, normal, spread), ...]}
_meta = None
_load_failed = False


def _bucket(lat: float, lng: float):
    return (int(math.floor(lat / _BUCKET_DEG)), int(math.floor(lng / _BUCKET_DEG)))


def _load():
    """Build the spatial index once. Any failure is latched so we stat the disk a single time."""
    global _index, _meta, _load_failed
    if _index is not None or _load_failed:
        return _index
    with _lock:
        if _index is not None or _load_failed:
            return _index
        try:
            with open(_ASSET) as fh:
                doc = json.load(fh)
            idx = {}
            for row in doc.get("entries", []):
                lat, lng, normal, spread = float(row[0]), float(row[1]), float(row[2]), float(row[3])
                idx.setdefault(_bucket(lat, lng), []).append((lat, lng, normal, spread))
            _meta = {k: v for k, v in doc.items() if k != "entries"}
            _index = idx
        except Exception:
            _load_failed = True
            return None
    return _index


def is_available() -> bool:
    """True if the asset loaded and holds at least one entry."""
    idx = _load()
    return bool(idx)


def asset_meta() -> Optional[dict]:
    """Provenance/gate settings of the loaded asset (None if unavailable) — for diagnostics."""
    _load()
    return _meta


def _haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_KM * math.asin(math.sqrt(a))


# Measured, not copied from the neighbouring bathymetry helpers: an uncached lookup is 13 us (it
# scans 9 spatial-hash buckets), and caching saves only 2.5 us of that. At the 200_000 those helpers
# use, the cache would hold ~30 MB — a bad trade for microseconds on a 512 MB Render box with a
# documented OOM history. 20_000 costs ~3 MB and still exceeds the real working set (1516 spots).
@lru_cache(maxsize=20_000)
def shore_normal_at(lat: float, lng: float,
                    max_km: float = MATCH_RADIUS_KM) -> Tuple[Optional[float], Optional[float]]:
    """Nearest gate-passing shore normal within ``max_km``.

    Returns (bearing_deg, spread_deg), or (None, None) when there is no entry nearby, the asset is
    absent, or the kill switch is set. Never raises."""
    if os.environ.get("SHORE_NORMAL_ASSET", "1") == "0":
        return None, None
    idx = _load()
    if not idx:
        return None, None
    if lat is None or lng is None:
        return None, None
    b_lat, b_lng = _bucket(float(lat), float(lng))
    best = None
    best_km = None
    for d_lat in (-1, 0, 1):                       # the 9 neighbouring buckets cover MATCH_RADIUS_KM
        for d_lng in (-1, 0, 1):
            for entry in idx.get((b_lat + d_lat, b_lng + d_lng), ()):  # noqa: B905
                km = _haversine_km(float(lat), float(lng), entry[0], entry[1])
                if km <= max_km and (best_km is None or km < best_km):
                    best, best_km = entry, km
    if best is None:
        return None, None
    return best[2], best[3]


def _reset_for_tests():
    """Drop the cached index + memoised lookups so a test can point at a different asset."""
    global _index, _meta, _load_failed
    with _lock:
        _index = None
        _meta = None
        _load_failed = False
    shore_normal_at.cache_clear()
