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
                # 5th element (nearshore break depth) added 2026-07-27; a 4-element entry from an
                # older asset is still valid and simply carries no depth.
                depth = float(row[4]) if len(row) > 4 and row[4] is not None else None
                idx.setdefault(_bucket(lat, lng), []).append((lat, lng, normal, spread, depth))
            _meta = {k: v for k, v in doc.items() if k != "entries"}
            _index = idx
        except Exception:
            _load_failed = True
            return None
    return _index


# ── THE OVERLAY: geometry resolved AFTER the committed asset was built ──────────────────────────
#
# ★★★ THE PROBLEM IT EXISTS FOR. Everything else in the chain already follows a new pin — spot
# membership, the marine and wind points, the precompute (it reads the live spot list every run),
# the hub (computed per request). Fine per-coordinate geometry does not: it lives ONLY in the
# git-committed `shore_normals.json`, rebuilt by a `workflow_dispatch`-ONLY GitHub workflow whose
# own header says "RE-RUN THIS whenever spots are added, moved, or re-placed". So the sync between
# "a spot exists" and "the spot has geometry" was a human remembering to click a button.
#
# Measured cost of a fresh pin (1,360 spots x 8 swell directions = 10,880 evaluations):
#     shore-normal error inherited from the coarse fallback   median 22.3 deg, p90 81.4, max 179.4
#     spots off by more than 45 deg                           26.6%
#     RATING LEVEL CHANGES                                    45.8% of evaluations, median 2 levels
#     depth-limited breaking cap lost                          78.4% of spots
# ★★ And virginity is the DEFAULT, not an edge case: 69.6% of catalogued spots have BOTH along-shore
# neighbours outside the 1 km match radius, so pinning a second peak one beach down loses it.
#
# ⚠️ The overlay does NOT lower the bar. Entries are produced by `build_shore_normals.measure()` and
# must pass the SAME `accepted()` gate as the committed build — see `resolve_spot_geometry.py`. It
# is a delivery mechanism, not a second quality standard.
#
# ⚠️ It is a CACHE, not a source of record: an ephemeral filesystem loses it on redeploy and the
# spot falls back to the coarse normal exactly as it does today. The committed asset remains the
# durable store, and the overlay's job is to close the window between pinning a spot and the next
# full build.
_OVERLAY = os.environ.get("SHORE_NORMAL_OVERLAY_PATH",
                          os.path.join(_DATA_DIR, "shore_normals_overlay.json"))
_overlay_index = None
_overlay_load_failed = False


def _load_overlay():
    """Build the overlay's spatial index once. Missing file is the NORMAL state, not an error."""
    global _overlay_index, _overlay_load_failed
    if _overlay_index is not None or _overlay_load_failed:
        return _overlay_index
    with _lock:
        if _overlay_index is not None or _overlay_load_failed:
            return _overlay_index
        try:
            with open(_OVERLAY) as fh:
                doc = json.load(fh)
            idx = {}
            for row in doc.get("entries", []):
                lat, lng = float(row[0]), float(row[1])
                # ⚠️ normal/spread may be None — a DEPTH-ONLY entry. See `add_overlay_entry`.
                normal = float(row[2]) if row[2] is not None else None
                spread = float(row[3]) if row[3] is not None else None
                depth = float(row[4]) if len(row) > 4 and row[4] is not None else None
                idx.setdefault(_bucket(lat, lng), []).append((lat, lng, normal, spread, depth))
            _overlay_index = idx
        except Exception:
            _overlay_load_failed = True
            return None
    return _overlay_index


def add_overlay_entry(lat: float, lng: float, normal: Optional[float], spread: Optional[float],
                      break_depth_m: Optional[float] = None) -> None:
    """Publish one resolved entry into the live overlay index.

    ★★ `normal`/`spread` MAY BE None — a DEPTH-ONLY entry. The quality gate is all-or-nothing, but
    the two measurements are not: `shore_normal_fit.nearshore_depth_m` takes only the elevation grid
    and the coordinate — it never sees the bearing fit — and it already self-gates, returning None
    below `_MIN_TRUSTWORTHY_DEPTH_M`. So an `ambiguous_coastline` rejection (a verdict on the
    BEARING's angular spread) says nothing about the depth, and discarding the row threw away a
    usable break depth. That matters: **break_depth is missing at 707 of 1,773 spots (39.9%)**, the
    single largest gap in the catalogue, and it is what the oversize gate's capacity tier needs.

    ⚠️ A depth-only entry is SAFE precisely because `surf_point.resolve_surf_geometry` only
    overwrites the coarse bearing when the asset returns a NON-None one. So the spot keeps its
    coarse normal and gains a real depth. That ordering is load-bearing: a `None` normal disables
    the directional gate entirely and scores every swell head-on (mean LEVEL error 4.12 vs 1.04 for
    a merely-coarse bearing). **A wrong bearing is bad; no bearing is far worse.**

    ⚠️ INVALIDATES THE MEMOISED LOOKUP, and that is not optional. `_nearest` is `lru_cache`d, so a
    spot asked about BEFORE its geometry was resolved has `None` cached against its coordinate —
    without the clear, resolving it would change nothing until the process restarted, and the job
    would report success while the spot stayed blind.

    Callers are responsible for the quality gate; this does no judging (same contract as the
    committed asset, whose entries are all gate-passed before they are written)."""
    global _overlay_index
    # ⚠️ LOAD BEFORE TAKING THE LOCK. `_load_overlay` acquires `_lock` itself and
    # `threading.Lock` is NOT reentrant, so calling it from inside the lock deadlocks the process —
    # which is exactly what the first version of this function did, and what the suite caught by
    # hanging rather than failing.
    _load_overlay()
    with _lock:
        if _overlay_index is None:
            _overlay_index = {}
        _overlay_index.setdefault(_bucket(float(lat), float(lng)), []).append(
            (float(lat), float(lng),
             None if normal is None else float(normal),
             None if spread is None else float(spread),
             None if break_depth_m is None else float(break_depth_m)))
    _nearest.cache_clear()


def overlay_entries() -> list:
    """Every overlay entry as [lat, lng, normal, spread, depth] — for persisting the index."""
    idx = _load_overlay() or {}
    return [list(e) for bucket in idx.values() for e in bucket]


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
def _scan(idx, lat: float, lng: float, max_km: float):
    """Nearest entry to (lat, lng) within ``max_km`` in one index, or None."""
    if not idx:
        return None
    b_lat, b_lng = _bucket(lat, lng)
    best = best_km = None
    for d_lat in (-1, 0, 1):                       # the 9 neighbouring buckets cover MATCH_RADIUS_KM
        for d_lng in (-1, 0, 1):
            for entry in idx.get((b_lat + d_lat, b_lng + d_lng), ()):  # noqa: B905
                km = _haversine_km(lat, lng, entry[0], entry[1])
                if km <= max_km and (best_km is None or km < best_km):
                    best, best_km = entry, km
    return best


@lru_cache(maxsize=20_000)
def _nearest(lat: float, lng: float, max_km: float = MATCH_RADIUS_KM):
    """THE nearest-entry lookup. Both public accessors go through it, and that is the point.

    ★★ `shore_normal_at` and `break_depth_at` used to carry SEPARATE copies of this search. The
    2026-07-29 audit named that as a blocker for adding any new geometry source: wiring one copy and
    not the other leaves the depth-limited breaking cap dead while the bearing looks fixed — a
    half-resolved spot that reports as resolved. With one function there is nothing to wire twice.

    PRECEDENCE — the committed asset ALWAYS wins, and the overlay only fills gaps:

    ★★ This is what makes a runtime-resolved entry incapable of DISPLACING a correct neighbour, the
    second blocker the audit found. Lookup is nearest-wins within 1 km, and adjacent named peaks are
    legitimately close (Rincón has five breaks inside 3 km), so a newly-measured entry that happened
    to sit nearer to some query point could otherwise take over from a gate-passed committed one.
    Because the overlay is consulted ONLY when the committed asset returned nothing at all, that
    cannot happen by construction rather than by tuning a radius. The cost is that a new pin within
    1 km of a committed entry keeps using its neighbour's geometry — which is exactly the
    "adjacent peaks share geometry" case this module's own header endorses.
    """
    if os.environ.get("SHORE_NORMAL_ASSET", "1") == "0":
        return None
    if lat is None or lng is None:
        return None
    lat, lng = float(lat), float(lng)
    hit = _scan(_load(), lat, lng, max_km)
    if hit is not None:
        return hit
    if os.environ.get("SHORE_NORMAL_OVERLAY", "1") == "0":
        return None
    return _scan(_load_overlay(), lat, lng, max_km)


def shore_normal_at(lat: float, lng: float,
                    max_km: float = MATCH_RADIUS_KM) -> Tuple[Optional[float], Optional[float]]:
    """Nearest gate-passing shore normal within ``max_km``.

    Returns (bearing_deg, spread_deg), or (None, None) when there is no entry nearby, the asset is
    absent, or the kill switch is set. Never raises."""
    best = _nearest(lat, lng, max_km)
    return (None, None) if best is None else (best[2], best[3])


def break_depth_at(lat: float, lng: float,
                   max_km: float = MATCH_RADIUS_KM) -> Optional[float]:
    """Nearshore water depth (m, positive down) at the nearest asset entry, or None.

    This is the depth a wave BREAKS in, for `surf_transform`'s depth-limited cap — not the shelf
    depth that drives cross-shelf friction. See `shore_normal_fit.nearshore_depth_m` for why the two
    cannot be the same number. Same kill switch as the bearing: SHORE_NORMAL_ASSET=0."""
    best = _nearest(lat, lng, max_km)
    return None if best is None else best[4]


def source_at(lat: float, lng: float, max_km: float = MATCH_RADIUS_KM) -> Optional[str]:
    """Which store answered for this coordinate: 'asset' | 'overlay' | None.

    Diagnostic only — nothing in the rating chain branches on it. It exists because a spot silently
    served by a runtime-resolved entry and one served by the committed build are operationally very
    different things (the overlay can be lost on a redeploy), and `spot_geometry_readiness` should
    be able to say which one a spot is living on."""
    if _nearest(lat, lng, max_km) is None:
        return None
    return "asset" if _scan(_load(), float(lat), float(lng), max_km) is not None else "overlay"


def _reset_for_tests():
    """Drop the cached index + memoised lookups so a test can point at a different asset."""
    global _index, _meta, _load_failed, _overlay_index, _overlay_load_failed
    with _lock:
        _index = None
        _meta = None
        _load_failed = False
        _overlay_index = None
        _overlay_load_failed = False
    _nearest.cache_clear()
