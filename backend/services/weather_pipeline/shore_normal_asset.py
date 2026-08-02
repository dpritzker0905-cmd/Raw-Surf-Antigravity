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
  * ★ THE RADIUS IS PER QUANTITY, not per module: the shore normal borrows out to
    `BEARING_RADIUS_KM` (3 km) and the break depth only to `MATCH_RADIUS_KM` (1 km). Both go
    through the SAME search — see `_nearest` for why there must never be two copies of it — but
    with different defaults, because a coastline's orientation and one peak's bottom depth do not
    have the same spatial correlation length. The measurement is at the constants.

Kill switches: SHORE_NORMAL_ASSET=0 -> lookups return (None, None) without touching the file.
               SHORE_NORMAL_BEARING_RADIUS_KM=1.0 -> restores the pre-2026-08-02 single radius.
"""
import json
import math
import os
import threading
from functools import lru_cache
from typing import Optional, Tuple

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_ASSET = os.path.join(_DATA_DIR, "shore_normals.json")

# ── TWO RADII, BECAUSE THESE ARE TWO DIFFERENT KINDS OF QUANTITY ────────────────────────────────
#
# ★★★ Until 2026-08-02 a single 1.0 km radius served BOTH accessors, because `_nearest` returns ONE
# tuple and `shore_normal_at` reads element 2 while `break_depth_at` reads element 4. The comment
# here used to say "a kilometre out we stop guessing" — a stated intuition that was never measured.
# It was measured. Hold-out over all 1,386 gate-passed entries (borrow the nearest OTHER entry,
# grade against the held-out one):
#
#     borrowed at 3 km      shore normal            break depth
#     p50 error             4.3 deg                 25.7% relative
#     bad tail              >45 deg at 0.6%         >2x off at 7.6%
#     at 1 km                                       9.1% relative  <- correctly calibrated
#
# A coastline's ORIENTATION is smooth over kilometres. The depth a wave BREAKS in is a property of
# one peak's bottom — a reef and a sandbar 2 km apart are unrelated. So the one constant was
# calibrated for the DEPTH and starved the BEARING, which is the #1 Jacobian variable (7.4 rating
# points at the median coarse error, 28.1 at +45 deg). 779 of 1,587 catalogue spots were falling
# back to the 0.25 deg grid — a bearing decided from a 194.6 km window — and 229 of those have a
# gate-passed entry between 1 and 3 km away.
#
# ⚠️ THE HOLD-OUT ABOVE IS SELF-CONSISTENCY, and `scripts/validate_shore_normals_osm.py` exists
# because a fit graded against another fit cannot detect a systematically wrong bearing. Graded
# against OSM coastline winding — land-on-left, sharing nothing with ETOPO — over 113 of the
# affected spots:
#
#                       p50      p90     mean    >45deg   >90deg
#     COARSE (before)   38.7     112.9   49.2     43.4%    16.8%
#     BORROWED (after)  12.6      86.8   31.7     21.2%     9.7%      borrowed better 73.5%
#
# ★ The RANKING held under the independent instrument; the MAGNITUDE did not. Quote 12.6, never 4.3
# — the ETOPO hold-out flatters itself. And 30 of the 113 got WORSE: borrowing is not free, it is
# better on the median and in both tails.
# ★ By distance: 1-2 km wins 71% (31.3 -> 15.2), 2-3 km wins 76% (44.0 -> 10.7). The far band is
# the BETTER one, so there is no case for a tighter cap.
#
# ⚠️ Widening is INERT for spots that already had an entry: lookup is nearest-wins, so a larger
# radius can only ADD candidates that are farther than any incumbent. Measured over the live
# catalogue: 0 of the 808 already-covered spots change which entry answers them.

# The DEPTH radius. Measured-correct — do not widen it. Deliberately tighter than the hand-verified
# overrides' 2 km radius: those are human ground truth, these are derived.
MATCH_RADIUS_KM = 1.0

# The BEARING radius. Kill: SHORE_NORMAL_BEARING_RADIUS_KM=1.0 restores the single-radius behaviour
# exactly. Declared at its default in every lane so `test_flag_lane_parity` can see it — a flag with
# a different value per lane makes the same spot two different beaches.
BEARING_RADIUS_KM = 3.0
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
def _bucket_span(lat: float, max_km: float):
    """How many 0.1° buckets must be walked in each axis to be SURE of covering ``max_km``.

    ★ DERIVED, NOT HARDCODED, and that is load-bearing. This used to be a fixed ±1, with the
    comment "the 9 neighbouring buckets cover MATCH_RADIUS_KM" — true at 1.0 km. One bucket of
    LONGITUDE shrinks with latitude: 5.6 km at 60°, 3.8 km at 70°, 2.9 km at 75°. So ±1 covered
    the old 1 km radius out to ~84°, but covers a 3 km radius only to ~73°. Widening the radius
    with the span still hardcoded would have silently narrowed the correct band, and a far-north
    spot would drop back to the coarse bearing INVISIBLY — the exact defect being fixed,
    reappearing where nobody looks.

    Latent today (the asset reaches 68.27°, the catalogue 58.62°, 0 spots above 66°) — derived
    anyway because the failure mode is silence, and because the next radius change should not have
    to rediscover this. The cos() is floored so a coordinate at the pole yields a bounded span
    rather than a division by zero."""
    lat_span = math.ceil(max_km / (_BUCKET_DEG * 111.19))
    km_per_lng_bucket = _BUCKET_DEG * 111.32 * max(math.cos(math.radians(lat)), 1e-3)
    lng_span = math.ceil(max_km / km_per_lng_bucket)
    return max(1, lat_span), max(1, min(lng_span, 180))


def _scan(idx, lat: float, lng: float, max_km: float):
    """Nearest entry to (lat, lng) within ``max_km`` in one index as ``(entry, km)``, or None.

    ★ THE DISTANCE IS RETURNED, not discarded, and that is the whole point of the 2026-08-02
    change. It was computed here and thrown away, which is why a bearing taken from 2.9 km could
    reach `resolve_surf_geometry` labelled `etopo` — identical to one measured at the spot's own
    coordinate — and grade `full` with nothing missing. The information needed to tell those apart
    always existed at this line; it simply never left the function."""
    if not idx:
        return None
    b_lat, b_lng = _bucket(lat, lng)
    lat_span, lng_span = _bucket_span(lat, max_km)
    best = best_km = None
    for d_lat in range(-lat_span, lat_span + 1):
        for d_lng in range(-lng_span, lng_span + 1):
            for entry in idx.get((b_lat + d_lat, b_lng + d_lng), ()):  # noqa: B905
                km = _haversine_km(lat, lng, entry[0], entry[1])
                if km <= max_km and (best_km is None or km < best_km):
                    best, best_km = entry, km
    return None if best is None else (best, best_km)


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


def _bearing_radius_km() -> float:
    """The bearing radius, resolved PER CALL so a lane can override it without a code change.

    Read at call time rather than import time for the same reason every other switch here is: a
    module-level read freezes whatever the environment happened to be when the process started, and
    this repo's recorded scar is a flag that had a different value in each lane. A malformed value
    falls back to the constant rather than raising — nothing in this module may make a rating worse
    than it is today."""
    try:
        return float(os.environ.get("SHORE_NORMAL_BEARING_RADIUS_KM", BEARING_RADIUS_KM))
    except (TypeError, ValueError):
        return BEARING_RADIUS_KM


def shore_normal_at(lat: float, lng: float,
                    max_km: Optional[float] = None) -> Tuple[Optional[float], Optional[float]]:
    """Nearest gate-passing shore normal within ``max_km`` (default: the BEARING radius, 3 km).

    Returns (bearing_deg, spread_deg), or (None, None) when there is no entry nearby, the asset is
    absent, or the kill switch is set. Never raises."""
    hit = _nearest(lat, lng, _bearing_radius_km() if max_km is None else max_km)
    return (None, None) if hit is None else (hit[0][2], hit[0][3])


def break_depth_at(lat: float, lng: float,
                   max_km: float = MATCH_RADIUS_KM) -> Optional[float]:
    """Nearshore water depth (m, positive down) at the nearest asset entry, or None.

    This is the depth a wave BREAKS in, for `surf_transform`'s depth-limited cap — not the shelf
    depth that drives cross-shelf friction. See `shore_normal_fit.nearshore_depth_m` for why the two
    cannot be the same number. Same kill switch as the bearing: SHORE_NORMAL_ASSET=0.

    ⛔ DO NOT "align" this with `BEARING_RADIUS_KM`. The 1 km here is not an oversight left behind
    when the bearing was widened — it is the measured answer for THIS quantity (p50 9.1% relative
    error at 1 km, 25.7% at 3 km, and 7.6% of borrows off by more than 2x). A depth borrowed too
    shallow caps the breaking height at a number the spot never sees, and `surf_transform`'s
    shallow end is the UNGUARDED one. Widening both was the obvious version of this fix and it is
    the wrong one."""
    hit = _nearest(lat, lng, max_km)
    return None if hit is None else hit[0][4]


def match_km_at(lat: float, lng: float, max_km: Optional[float] = None) -> Optional[float]:
    """How far away the entry that answered the BEARING lookup actually is, in km. None on a miss.

    ★★ THIS IS THE PROVENANCE THE 3 km BORROW RADIUS MADE NECESSARY. Once a bearing may come from
    up to 3 km away, "the asset answered" stops being one fact and becomes two: measured AT this
    coordinate, or inferred from a neighbour. Without the distance those are indistinguishable —
    and they were, from 2026-08-02 until this function existed: a bearing borrowed from 2.9 km
    reported `shore_normal_src="etopo"` and graded `full` with nothing missing, exactly like one
    fitted at the spot itself. `scripts/seed_geometry_columns.py` writes a DB row only where the
    source is "etopo", so it would have frozen borrowed bearings into the database as measured
    geometry.

    ⚠️ Goes through the SAME `_nearest` as the bearing, at the SAME radius, so the answer always
    describes the entry the caller actually got. A second search here could disagree with the first
    — the precise failure `_nearest`'s docstring was written to prevent."""
    hit = _nearest(lat, lng, _bearing_radius_km() if max_km is None else max_km)
    return None if hit is None else hit[1]


def source_at(lat: float, lng: float, max_km: Optional[float] = None) -> Optional[str]:
    """Which store answered for this coordinate: 'asset' | 'overlay' | None.

    Diagnostic only — nothing in the rating chain branches on it. It exists because a spot silently
    served by a runtime-resolved entry and one served by the committed build are operationally very
    different things (the overlay can be lost on a redeploy), and `spot_geometry_readiness` should
    be able to say which one a spot is living on.

    ⚠️ SINCE THE RADII SPLIT, ONE ANSWER CAN NO LONGER DESCRIBE BOTH QUANTITIES. A spot may take its
    bearing from the committed asset 2 km away and its depth from an overlay entry at its own
    coordinate — that combination is the split's whole purpose, not an anomaly. This defaults to the
    BEARING radius because that is the quantity readiness reporting is about; pass
    ``max_km=MATCH_RADIUS_KM`` to ask the same question about the depth."""
    radius = _bearing_radius_km() if max_km is None else max_km
    if _nearest(lat, lng, radius) is None:
        return None
    return "asset" if _scan(_load(), float(lat), float(lng), radius) is not None else "overlay"


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
