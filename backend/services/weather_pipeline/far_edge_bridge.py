"""
far_edge_bridge.py — past the end of an ICON / EURO 2-deg blend, bridge to the stored GFS 2-deg field instead of holding a
frame or dropping to the 10-deg fill (2026-10-26, DARK: FAR_EDGE_BRIDGE=1; Render env; registered in _RATING_FLAGS).

WHY (measured on real CDN frames 2026-10-26, log/2026-10-24-claude-day14-end.md "Research: the seam"). The scrubber ends at
now + 336 h; the ICON and EURO 2-deg blends (persistence of the model's anchor + the GFS trend, LOCKED) end at their run + 336 h
ceiling, a few hours to a day earlier. GFS 2-deg is stored to run + 384 h. At ICON's last blend frame the blend differs from
GFS by MAE 0.98 m (p95 3.4 m): it carries ICON's own departure from GFS to the end. A hard switch to GFS would jump 0.973 m
MAE in one 3 h step, 10x GFS's own step there (0.096 m). Carrying that departure and letting it decay keeps the worst step
at 0.146 m (24 h decay; 12 h: 0.252, 36 h: 0.122).

THE BRIDGE, at a target t past the lane's last 2-deg frame T0, on the shared 2-deg lattice:
    w      = max(0, 1 - (t - T0) / L)                                      L = FAR_EDGE_BRIDGE_DECAY_H (default 24)
    height = max(0, GFS(t) + w * (Blend(T0) - GFS(T0)))                     equals Blend(T0) at t = T0, GFS(t) once w = 0
    dir    = unit-circle blend of Blend(T0) (weight w) and GFS(t) (1 - w)  never a degree average
    period = Blend(T0)'s while w >= 0.5, then GFS(t)'s                     a period is never blended (dominant-system switch)
A node GFS marks invalid (land) is invalid; a node with no usable anchor or GFS(T0) value takes GFS(t) as it is.
Same method as the blend itself (an anchor's departure carried on the GFS trend), carried past its ceiling with a weight that
decays: a fixed linear ramp, as operational nowcast-to-NWP handoffs use (INCA); a skill-weighted ramp (STEPS) needs skill
measured at these leads, which nobody has yet.

RAILS (the far-edge hold's): marine, ICON / EURO only; only PAST the model's 2-deg lane (no 2-deg frame of the model at or
beyond the target: a mid-range hole is never bridged); bounded by FAR_EDGE_BRIDGE_MAX_H (default 72 h) past T0; needs the
GFS 2-deg frames at T0 and at t (each within 1.5 h) on the same lattice, else None and the existing chain answers (the hold
stays the fallback below). Values up to T0 are never touched: the locked blend is not rebuilt. Served relabelled: model as
asked, provider "estimated", is_estimated true, estimate_basis {type far_edge_bridge, anchor, GFS frames, weight, decay},
warning far_edge_bridge:+Nh. Kill: FAR_EDGE_BRIDGE=0 (default).
"""
import asyncio
import logging
import math
import os
from datetime import timedelta

logger = logging.getLogger(__name__)

MID_REGION = "global_mid"
BRIDGED_MODELS = ("ICON", "EURO")
MATCH_WINDOW = timedelta(minutes=90)


def bridge_enabled() -> bool:
    return os.environ.get("FAR_EDGE_BRIDGE", "0") == "1"


def _env_hours(name, default):
    try:
        return max(0.0, float(os.environ.get(name, str(default))))
    except (TypeError, ValueError):
        return float(default)


def decay_hours() -> float:
    return _env_hours("FAR_EDGE_BRIDGE_DECAY_H", 24.0) or 24.0


def bridge_weight(gap_h: float, decay_h: float) -> float:
    """The anchor's share at `gap_h` hours past T0: 1 at T0, falling linearly to 0 at `decay_h`."""
    if decay_h <= 0:
        return 0.0
    return max(0.0, min(1.0, 1.0 - gap_h / decay_h))


def _finite(x):
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)


def _usable(vec):
    return vec is not None and getattr(vec, "is_valid", True) and _finite(getattr(vec, "speed", None))


def bridge_vectors(anchor, gfs_t0, gfs_t, w: float):
    """The bridged vectors (new GridVector objects, inputs untouched) on GFS(t)'s lattice. The three lists must be the same
    lattice in the same order (checked by the caller). GridVector-like objects with model_copy (pydantic v2)."""
    out = []
    for a, g0, gt in zip(anchor, gfs_t0, gfs_t):
        if not _usable(gt):
            out.append(gt.model_copy())
            continue
        if not (_usable(a) and _usable(g0) and _finite(a.direction)):
            out.append(gt.model_copy())          # no anomaly to carry: GFS as it is
            continue
        h = max(0.0, gt.speed + w * (a.speed - g0.speed))
        ra, rt = math.radians(a.direction), math.radians(gt.direction or 0.0)
        s = w * math.sin(ra) + (1.0 - w) * math.sin(rt)
        c = w * math.cos(ra) + (1.0 - w) * math.cos(rt)
        d = gt.direction if (abs(s) < 1e-12 and abs(c) < 1e-12) else math.degrees(math.atan2(s, c)) % 360.0
        period = a.period if (w >= 0.5 and _finite(a.period)) else gt.period
        rad = math.radians(d)
        conf = gt.dir_confidence if w < 0.5 else a.dir_confidence
        out.append(gt.model_copy(update={
            "speed": round(h, 4), "direction": round(d, 2), "period": period,
            "u": round(-h * math.sin(rad), 4), "v": round(-h * math.cos(rad), 4),   # production convention: u = -h sin d
            "is_valid": True, "dir_confidence": conf,
        }))
    return out


def _same_lattice(*grids) -> bool:
    g0 = grids[0]
    for g in grids[1:]:
        if (g.cols, g.rows, len(g.vectors)) != (g0.cols, g0.rows, len(g0.vectors)):
            return False
        for i in (0, len(g.vectors) // 2, len(g.vectors) - 1):
            if abs(g.vectors[i].lat - g0.vectors[i].lat) > 1e-6 or abs(g.vectors[i].lng - g0.vectors[i].lng) > 1e-6:
                return False
    return True


def _nearest(items, when):
    best = None
    for p in items:
        dt = abs(p.valid_time_start - when)
        if dt <= MATCH_WINDOW and (best is None or dt < best[0]
                                   or (dt == best[0] and not getattr(p, "is_estimated", False))):
            best = (dt, p)
    return best[1] if best else None


def _lane(manifest, model, domain, layer):
    return [p for p in manifest.products
            if str(getattr(p, "model", "")).upper() == model and str(getattr(p, "domain", "")).lower() == domain
            and str(getattr(p, "layer", "")).lower() == layer and getattr(p, "region_id", None) == MID_REGION
            and getattr(p, "valid_time_start", None) is not None]


def _global_span(product) -> bool:
    g = getattr(product, "grid", None)
    b = getattr(g, "bounds", None) if g is not None else None
    if b is None:
        return False
    span = (b.east - b.west) if b.west <= b.east else (180.0 - b.west) + (b.east + 180.0)
    return span >= 350.0


async def try_far_edge_bridge(store, model: str, domain: str, layer: str, target_dt, current_product=None):
    """The bridged product for `target_dt`, or None (flag off, not past the 2-deg lane, a regional / finer product already
    chosen, frames missing, lattices differ). Never raises: any failure falls through to the existing chain."""
    if not bridge_enabled():
        return None
    model, domain, layer = str(model).upper(), str(domain).lower(), str(layer).lower()
    if model not in BRIDGED_MODELS or domain != "marine":
        return None
    if current_product is not None and not _global_span(current_product):
        return None                              # a regional / clipped product was chosen: never replaced
    try:
        manifest = await asyncio.to_thread(store.get_manifest)
        lane = _lane(manifest, model, domain, layer)
        if not lane:
            return None
        t0 = max(p.valid_time_start for p in lane)
        if t0 >= target_dt:
            return None                          # inside the 2-deg lane (or a mid-range hole): the stored chain serves it
        gap_h = (target_dt - t0).total_seconds() / 3600.0
        if gap_h > _env_hours("FAR_EDGE_BRIDGE_MAX_H", 72.0):
            return None
        anchor_item = _nearest([p for p in lane if p.valid_time_start == t0], t0)
        gfs_lane = _lane(manifest, "GFS", domain, layer)
        g0_item, gt_item = _nearest(gfs_lane, t0), _nearest(gfs_lane, target_dt)
        if anchor_item is None or g0_item is None or gt_item is None:
            return None
        anchor, g0, gt = await asyncio.gather(*(asyncio.to_thread(store.load_product, it.filename)
                                                for it in (anchor_item, g0_item, gt_item)))
        if not all(p is not None and p.grid is not None and p.grid.vectors for p in (anchor, g0, gt)):
            return None
        if not _same_lattice(gt.grid, anchor.grid, g0.grid):
            logger.warning(f"[Grid Resolver] far-edge bridge: lattices differ for {model}/{layer} ({anchor_item.filename} vs "
                           f"{gt_item.filename}); falling through")
            return None
        decay = decay_hours()
        w = bridge_weight(gap_h, decay)
        vectors = bridge_vectors(anchor.grid.vectors, g0.grid.vectors, gt.grid.vectors, w)
        grid = gt.grid.model_copy(update={"vectors": vectors, "diagnostics": dict(gt.grid.diagnostics or {})})
        basis = {
            "type": "far_edge_bridge", "method": "anchor_departure_decay_to_gfs",
            "anchor_product_id": anchor_item.filename, "anchor_valid_time": t0.isoformat(),
            "anchor_estimate_basis_type": (getattr(anchor, "estimate_basis", None) or {}).get("type"),
            "gfs_anchor_product_id": g0_item.filename, "gfs_target_product_id": gt_item.filename,
            "gfs_target_valid_time": gt_item.valid_time_start.isoformat(),
            "weight_anchor": round(w, 4), "decay_hours": decay, "gap_hours": round(gap_h, 2),
        }
        prod = gt.model_copy(update={
            "model": model, "provider": "estimated", "is_estimated": True, "is_forecast_authoritative": False,
            "estimate_basis": basis, "grid": grid, "product_id": f"far_edge_bridge:{anchor_item.filename}|{gt_item.filename}",
            "warnings": list(gt.warnings or []) + [f"far_edge_bridge:+{gap_h:.1f}h:w={w:.2f}"],
            "source_dataset": "estimated_blend", "upstream_provider": None, "upstream_model": None,
            "region_id": MID_REGION, "coverage_mode": "global_tile", "coverage_scope": "far_edge_bridge",
            "model_run_time": getattr(anchor, "model_run_time", None),
            "model_run_time_status": getattr(anchor, "model_run_time_status", "missing"),
        })
        logger.info(f"[Grid Resolver] FAR-EDGE BRIDGE: {model}/{layer}@{target_dt.isoformat()} = GFS {gt_item.filename} + "
                    f"{w:.2f} x ({anchor_item.filename} - {g0_item.filename}) (+{gap_h:.1f}h past the 2-deg lane; kill "
                    f"FAR_EDGE_BRIDGE=0)")
        return prod
    except Exception as e:  # strictly additive: the existing chain answers
        logger.warning(f"[Grid Resolver] far-edge bridge failed (falling through): {e}")
        return None
