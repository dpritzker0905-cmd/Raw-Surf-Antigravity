"""Per-spot geometry as DB state — the staleness contract (2026-07-30, owner-approved schema).

The shore normal is the highest-leverage input in the rating (measured: its median error moves
the score 6.0 pts, +45° moves 23.6; the rating LEVEL changes on 45.8% of evaluations) and was the
only per-spot input NOT on the spot row — it lived in a git-committed asset keyed by coordinate,
with no staleness guard for moved pins (290 moved, 197 beyond the 1 km match radius).

The columns (all nullable) make geometry durable, queryable and self-invalidating:
  shore_normal_deg / shore_normal_spread_deg / break_depth_m   the fit
  geometry_source                                              'etopo' | 'override:<n>' (fine only
                                                               — a coarse bearing is derivable at
                                                               runtime and must never be frozen)
  geometry_resolved_at                                         when the fit was taken
  geometry_lat / geometry_lng                                  WHERE the fit was taken — the guard
  geometry_reject_reason                                       the gate's verdict, as product state

SERVING IS UNCHANGED: the hot path stays asset/overlay-backed and DB-free (a DB coupling there
once zeroed every rating). The DB is the system of record + the reconcile queue; a moved or new
pin is found by `needs_geometry_refresh`, re-fitted off-path, and the overlay/asset carry it to
serving. Pure helpers here; I/O stays in the scripts."""
import math
from datetime import datetime, timezone
from typing import Optional

# A pin this far from where its fit was taken has MOVED — the fit no longer describes it. The
# asset match radius is 1 km and measured moves cluster at 2.5 km median; 150 m is far above
# float jitter and far below any real relocation's intent.
MOVED_THRESHOLD_M = 150.0


def _haversine_m(lat1, lng1, lat2, lng2) -> float:
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = math.radians(lat2 - lat1)
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def needs_geometry_refresh(row: dict) -> Optional[str]:
    """Why this spot row needs (re-)resolution, or None if its geometry is current.

    'never_resolved'  — no fit has ever been recorded (new pin, or pre-schema spot)
    'moved'           — the pin sits > MOVED_THRESHOLD_M from where the fit was taken
    A row with a geometry_reject_reason and no fit is NOT re-queued ('rejected' spots need a
    HUMAN action — usually moving the pin — before re-fitting can succeed; re-running the gate
    reproduces the rejection, measured 24/24)."""
    lat, lng = row.get("latitude"), row.get("longitude")
    if lat is None or lng is None:
        return None
    if row.get("geometry_resolved_at") is None:
        if row.get("geometry_reject_reason"):
            return None
        return "never_resolved"
    glat, glng = row.get("geometry_lat"), row.get("geometry_lng")
    if glat is None or glng is None:
        return "never_resolved"
    if _haversine_m(float(lat), float(lng), float(glat), float(glng)) > MOVED_THRESHOLD_M:
        return "moved"
    return None


def geometry_row_from_resolution(lat: float, lng: float, normal, src: str, spread, break_depth,
                                 now: Optional[datetime] = None) -> Optional[dict]:
    """The column payload for a FINE resolution, or None when the source is not worth freezing.
    Coarse/none bearings are runtime-derivable and median-22.3°-wrong — freezing one into the row
    would outlive the coarse grid's own improvements."""
    fine = src == "etopo" or (isinstance(src, str) and src.startswith("override"))
    if not fine or normal is None:
        return None
    return {
        "shore_normal_deg": round(float(normal), 2),
        "shore_normal_spread_deg": round(float(spread), 2) if spread is not None else None,
        "break_depth_m": round(float(break_depth), 2) if break_depth is not None else None,
        "geometry_source": src,
        "geometry_resolved_at": (now or datetime.now(timezone.utc)).isoformat(),
        "geometry_lat": float(lat),
        "geometry_lng": float(lng),
    }
