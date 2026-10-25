"""
far_edge_hold.py — serve the last covered frame at the scrubber's far edge instead of a 404 blank
(2026-07-11, safeguards report S4 / the EURO-marine h336 `no_copernicus_coverage` class).

WHY: capabilities (and therefore the timeline scrubber) offer max_forecast_hours=336 from NOW, but
stored+estimated coverage ends at (newest run + ~336h) ≈ now+330h and decays until the next ingest
cycle — so the last few slider hours are STRUCTURALLY uncovered, worst just before new model runs
land. Live-caught 07-11: EURO marine h336 → 404 → the client's conformed safe-zero cleared the
engine (and pre-#29 kept re-driving it). The estimated tail is a persistence+trend product; holding
its LAST frame a few more hours is the same scientific basis, honestly labeled — strictly better
than a blank map.

TRUTH + SAFETY RAILS:
  * Engages ONLY past the lane's tail: if ANY product of the lane has valid_time_start beyond the
    target, this is a MID-RANGE hole (an ingest failure the pipeline must heal) — never masked.
  * Bounded overshoot: FAR_EDGE_HOLD_MAX_H (default 24h) past the tail; beyond that, honest 404.
  * Served RELABELED: is_estimated=True, is_forecast_authoritative=False, estimate_basis
    {type: far_edge_hold, held_from, gap_hours} + a warnings marker — the provenance system and
    infobox see an estimate, never a fake native frame.
  * Marine only (wind has its own gates/fallback rails — wind_gates fail-fast semantics predate
    this and must not silently change).
  * Global-tile products only: the far tail is only ever produced at the global tier, and a global
    frame covers any viewport; regional candidates would re-open the zoom-out clamp class.
Kill: FAR_EDGE_HOLD=0. Tune: FAR_EDGE_HOLD_MAX_H.

DAY-14 END (2026-10-24, both DARK, default '0', registered in _RATING_FLAGS; they move served numbers):
  * FAR_EDGE_HOLD_PREFER_MID=1 holds the newest 2-deg `global_mid` frame inside the bound before any 10-deg
    `global_coarse` one. Both tiers carry the same tail (ICON/EURO estimated to the same hour), and the
    plain rule took whichever the manifest listed first: live at now+336 h ICON and EURO served the 37x17
    coarse frame where a 181x83 mid frame of the same hour was stored.
  * FAR_EDGE_HOLD_BEFORE_UPSTREAM=1 (hold_before_upstream below) tries the hold BEFORE /grid's on-demand
    upstream fetch when that fetch would be coarser than FAR_EDGE_HOLD_UPSTREAM_MIN_RES (default 2 deg, the
    mid spacing). The marine fetch targets ~200 points whatever the box, so a world box past the GFS tail got
    19x9 = 171 vectors (20 deg) instead of the stored 2-deg frame a few hours back: the "empty" day 14.
"""
import asyncio
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

MID_REGION = "global_mid"


def _flag(name: str) -> bool:
    return os.environ.get(name, "0") == "1"


def _better(p, best) -> bool:
    """Newest valid time first; on a tie the authoritative product before the estimated one."""
    if best is None:
        return True
    vt, bvt = p.valid_time_start, best.valid_time_start
    return vt > bvt or (vt == bvt and not getattr(p, "is_estimated", False) and getattr(best, "is_estimated", False))


async def try_far_edge_hold(store, model: str, domain: str, layer: str, target_dt) -> Optional[object]:
    if os.environ.get("FAR_EDGE_HOLD", "1") == "0":
        return None
    if str(domain).lower() != "marine":
        return None
    try:
        max_h = float(os.environ.get("FAR_EDGE_HOLD_MAX_H", "24"))
    except (TypeError, ValueError):
        max_h = 24.0

    try:
        manifest = await asyncio.to_thread(store.get_manifest)
        best = None
        best_mid = None
        lane_max_vt = None
        for p in manifest.products:
            if str(getattr(p, "model", "")).upper() != str(model).upper():
                continue
            if str(getattr(p, "domain", "")).lower() != str(domain).lower():
                continue
            if str(getattr(p, "layer", "")).lower() != str(layer).lower():
                continue
            if getattr(p, "coverage_mode", None) != "global_tile":
                continue
            vt = getattr(p, "valid_time_start", None)
            if vt is None:
                continue
            if lane_max_vt is None or vt > lane_max_vt:
                lane_max_vt = vt
            if vt > target_dt:
                continue
            if (best is None or vt > best.valid_time_start
                    or (vt == best.valid_time_start and not getattr(p, "is_estimated", False))):
                best = p
            if getattr(p, "region_id", None) == MID_REGION and _better(p, best_mid):
                best_mid = p

        if best is None:
            return None
        # Tail-only guard: coverage beyond the target exists → mid-range hole, not the far edge.
        if lane_max_vt is not None and lane_max_vt > target_dt:
            return None
        if best_mid is not None and _flag("FAR_EDGE_HOLD_PREFER_MID"):
            mid_gap = (target_dt - best_mid.valid_time_start).total_seconds() / 3600.0
            if 0 <= mid_gap <= max_h:
                best = best_mid            # the 2-deg field inside the bound beats any 10-deg one
        gap_h = (target_dt - best.valid_time_start).total_seconds() / 3600.0
        if gap_h < 0 or gap_h > max_h:
            return None

        prod = await asyncio.to_thread(store.load_product, best.filename)
        if not prod or not prod.grid or not prod.grid.vectors:
            return None

        prod.product_id = best.filename
        prod.is_estimated = True
        prod.is_forecast_authoritative = False
        if not getattr(prod, "estimate_basis", None):
            prod.estimate_basis = {
                "type": "far_edge_hold",
                "held_from": best.valid_time_start.isoformat(),
                "gap_hours": round(gap_h, 1),
            }
        try:
            prod.warnings = list(getattr(prod, "warnings", None) or []) + [f"far_edge_hold:+{gap_h:.1f}h"]
        except Exception:
            pass
        if not getattr(prod, "coverage_scope", None):
            prod.coverage_scope = "coarse_global"
        logger.info(
            f"[Grid Resolver] FAR-EDGE HOLD: serving last covered frame {best.filename} "
            f"(+{gap_h:.1f}h past the tail) for {model}/{layer}@{target_dt.isoformat()} "
            f"(kill FAR_EDGE_HOLD=0)"
        )
        return prod
    except Exception as e:
        # The hold is strictly additive — any failure falls through to the pre-existing terminals.
        logger.warning(f"[Grid Resolver] far-edge hold lookup failed (falling through): {e}")
        return None


def upstream_resolution(req_w, req_s, req_e, req_n) -> Optional[float]:
    """The grid spacing (deg) viewport_service.fetch_viewport_grid_upstream fetches a MARINE box at: its ~200-point target
    over the span, a box wider than 180 x 90 deg taken as the whole world (its rule, on the unsnapped request box; the
    snap widens a span by at most 2 deg)."""
    if None in (req_w, req_s, req_e, req_n):
        return None
    from services.weather_pipeline.route_helpers import choose_adaptive_resolution
    span_lng = (req_e - req_w) if req_w <= req_e else ((180.0 - req_w) + (req_e + 180.0))
    span_lat = abs(req_n - req_s)
    if span_lng > 180.0 or span_lat > 90.0:
        span_lng, span_lat = 360.0, 165.0
    return choose_adaptive_resolution(span_lng, span_lat, 200.0)


async def hold_before_upstream(store, model: str, domain: str, layer: str, target_dt, req_w, req_s, req_e, req_n):
    """FAR_EDGE_HOLD_BEFORE_UPSTREAM (dark): the far-edge hold, tried before the on-demand upstream fetch when that fetch
    would be COARSER than the stored mid tier (FAR_EDGE_HOLD_UPSTREAM_MIN_RES, default 2 deg). None otherwise, and the
    hold keeps every rail of its own (past the lane's tail only, bounded, relabelled estimated)."""
    if not _flag("FAR_EDGE_HOLD_BEFORE_UPSTREAM") or str(domain).lower() != "marine":
        return None
    try:
        floor = float(os.environ.get("FAR_EDGE_HOLD_UPSTREAM_MIN_RES", "2.0"))
    except (TypeError, ValueError):
        floor = 2.0
    res = upstream_resolution(req_w, req_s, req_e, req_n)
    if res is None or res <= floor:
        return None                        # the live fetch is at least as fine as the stored field
    prod = await try_far_edge_hold(store, model, domain, layer, target_dt)
    if prod is not None:
        try:
            prod.warnings = list(prod.warnings or []) + [f"far_edge_hold_before_upstream:{res:g}deg"]
        except Exception:
            pass
    return prod
