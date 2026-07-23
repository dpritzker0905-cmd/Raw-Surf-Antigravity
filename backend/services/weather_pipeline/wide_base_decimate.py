"""wide_base_decimate.py — SERVE-TIME mean-pool of the 2° global base to a lighter wide-zoom tier.

WHY (2026-07-23, USER + deep-research): the far-zoom fix serves the FULL 2° global_mid (~15k vectors)
as the wide-zoom base. That is 24× the old 10° coarse the wide-zoom pipeline was tuned for, so its
cold-fetch (~2-4s) widened the fast-zoom-out "rectangle" window, and the world series/memory ballooned.
Research (Windy renders one model field + BILINEAR interpolation; our shader samples gl.LINEAR too;
a TC's true Hs peak is sub-cell at 2°/3°/4° alike) shows a lighter, INTERPOLATED base reads as a smooth
storm blob — visually ~indistinguishable at continental zoom — while loading ~2.3× faster at 3°.

WHAT: when the mid tier is about to serve the WORLD base (served span >= 350°), mean-pool it from 2° to
MARINE_WIDE_BASE_RES (default 3°). Viewport CLIPS (span < 350°, the z5-8 storm-watch tier) are untouched
— they stay full 2° so close/mid zoom is crisp. The pool is honest: `speed` (Hs) is the scalar block-mean
over VALID/ocean sub-cells; u/v are re-derived to magnitude == mean-Hs at the vector-mean (dominant)
direction so the animation stays consistent with the height. Kill / A-B: MARINE_WIDE_BASE_RES=2.0 (no
pool → the deployed full-2° behavior). Telemetry: product.grid.diagnostics['wide_base_res'].
"""
import logging
import math
import os

from services.weather_pipeline.schemas import GridVector, NormalizedGrid

logger = logging.getLogger(__name__)

_WORLD_SPAN_MIN = 350.0  # only the world/global base; viewport clips (< 350°) stay full 2°


def _span(bounds):
    if not bounds:
        return 0.0
    return (bounds.east - bounds.west) if bounds.east >= bounds.west else (bounds.east + 360.0 - bounds.west)


def _valid(v):
    return bool(getattr(v, "is_valid", True)) and getattr(v, "speed", None) is not None


def mean_pool_global_grid(grid, target_res):
    """Mean-pool a global NormalizedGrid to `target_res`° cells. Honest: Hs = scalar mean over VALID
    sub-cells; u/v re-derived to |Hs| at the vector-mean direction; a bin with no valid sub-cell stays
    masked. Returns a NEW NormalizedGrid (never mutates the input)."""
    b = grid.bounds
    src = grid.vectors or []
    if not src or target_res <= 0:
        return grid
    bins = {}
    for v in src:
        ri = int(math.floor((v.lat - b.south) / target_res))
        ci = int(math.floor((v.lng - b.west) / target_res))
        bins.setdefault((ri, ci), []).append(v)

    out = []
    for (ri, ci), cell in sorted(bins.items()):
        clat = b.south + (ri + 0.5) * target_res
        clng = b.west + (ci + 0.5) * target_res
        valid = [x for x in cell if _valid(x)]
        if not valid:
            out.append(GridVector(lat=clat, lng=clng, speed=0.0, u=0.0, v=0.0, direction=0.0, is_valid=False))
            continue
        n = len(valid)
        # ENERGY-mean Hs = sqrt(mean(H^2)): wave energy ∝ H^2, so this is the physically-correct block
        # average (matches the coarse ingest's energy_mean_height) AND preserves compact-storm peaks far
        # better than a linear mean — a linear mean smeared a 1-cell 3.1m storm to 1.3m (< the 10° coarse
        # that made Bertha vanish); the energy mean keeps it a visible blob.
        sp = math.sqrt(sum((x.speed or 0.0) ** 2 for x in valid) / n)
        um = sum((x.u or 0.0) for x in valid) / n
        vm = sum((x.v or 0.0) for x in valid) / n
        mag = math.hypot(um, vm)
        if mag > 1e-6:
            u_out = sp * um / mag                                 # magnitude == mean Hs, dominant dir
            v_out = sp * vm / mag
            direction = math.degrees(math.atan2(-u_out, -v_out)) % 360.0  # matches source convention
        else:
            u_out = v_out = 0.0
            direction = sum((x.direction or 0.0) for x in valid) / n
        prs = [x.period for x in valid if getattr(x, "period", None) is not None]
        dcs = [x.dir_confidence for x in valid if getattr(x, "dir_confidence", None) is not None]
        out.append(GridVector(
            lat=clat, lng=clng, speed=sp, u=u_out, v=v_out, direction=direction,
            period=(sum(prs) / len(prs) if prs else None),
            dir_confidence=(sum(dcs) / len(dcs) if dcs else None),
            is_valid=True,
        ))

    span_lng = _span(b)
    span_lat = abs(b.north - b.south)
    cols = max(1, int(round(span_lng / target_res)))
    rows = max(1, int(round(span_lat / target_res)))
    return NormalizedGrid(bounds=b, cols=cols, rows=rows, vectors=out, diagnostics=grid.diagnostics)


def maybe_decimate_wide_base(product):
    """If `product` is the WORLD base (served span >= 350°) and MARINE_WIDE_BASE_RES < the source
    spacing, mean-pool it to that resolution. Best-effort — returns `product` unchanged on any guard
    miss / error (never raises into the route)."""
    try:
        target = float(os.environ.get("MARINE_WIDE_BASE_RES", "3.0"))
        if target <= 0:
            return product
        grid = getattr(product, "grid", None)
        if not grid or not getattr(grid, "vectors", None) or not getattr(grid, "bounds", None):
            return product
        if _span(grid.bounds) < _WORLD_SPAN_MIN:
            return product  # viewport clip → keep full 2°
        cols = grid.cols or 0
        src_res = (_span(grid.bounds) / cols) if cols else 0.0
        # Only pool DOWN (target coarser than source) and only if it actually reduces the grid.
        if src_res <= 0 or target <= src_res + 1e-6:
            return product
        pooled = mean_pool_global_grid(grid, target)
        if pooled is grid or not pooled.vectors:
            return product
        if pooled.diagnostics is None:
            pooled.diagnostics = {}
        pooled.diagnostics["wide_base_res"] = target
        product.grid = pooled
        # keep served_bbox / bounds consistent (bounds unchanged — still world)
        logger.info(
            f"[Wide Base Decimate] pooled world base {cols}c/{src_res:.2f}° → "
            f"{pooled.cols}c/{target:.1f}° ({len(grid.vectors)}→{len(pooled.vectors)} vec)."
        )
        return product
    except Exception as e:  # never break the grid route
        logger.warning(f"[Wide Base Decimate] skipped ({type(e).__name__}: {e})")
        return product
