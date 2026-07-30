"""In-band lattice gap fill — interpolated frames where a source's cadence is coarser than the scrub grid.

THE DEFECT CLASS (2026-07-30, the "blank day" family, user-reported): the scrubber walks a uniform
3-hourly lattice, but ECMWF open-data serves 3-hourly steps only to +144h and 6-hourly from there to
+240h. Every odd-3 slot in that band has NO product at any tier — the extended-estimates jobs only
generate PAST the last native (they gate on a HORIZON when this defect is a CADENCE). Measured live:
EURO marine waves 12–14 gap slots per global tier, EURO wind 16 per tier, all served today as
±3h-substituted repeats of a neighbour frame.

THE FIX: for every lattice slot whose two bracketing products are close together (≤6h), synthesize
the missing frame by TIME INTERPOLATION between them — real model data on both sides, honestly
labeled is_estimated with a named basis. Wide gaps are deliberately NOT interpolated: a 46h dead
hole (the ICON wind purge defect) is a data-loss condition that must stay visible and be fixed at
its source, not painted over with a two-day straight line.

Runs in the decoupled cron after the extended-estimates jobs (compute-only, no upstream fetch).
Kill switch: LATTICE_INBAND_FILL=0. Bracket cap: LATTICE_FILL_MAX_BRACKET_H (default 6).
"""
import asyncio
import logging
import math
import os
from datetime import datetime, timedelta, timezone
from typing import Any, List, Optional, Tuple

from services.weather_pipeline.schemas import NormalizedProduct, NormalizedGrid, GridVector
from services.weather_pipeline.estimator import blend_direction, blend_period

logger = logging.getLogger(__name__)

LATTICE_STEP_H = 3.0

# Every (domain, layer) lane that renders on the scrub timeline, swept for all three models over
# the global tiers. Lanes with clean 3-hourly cadence (GFS everywhere, CMEMS-fed partitions)
# no-op — the sweep finds no qualifying gaps.
_LANES = [
    ("marine", "waves"),
    ("marine", "swell_1"),
    ("marine", "swell_2"),
    ("marine", "wind_waves"),
    ("wind", "wind"),
]
_MODELS = ("EURO", "ICON", "GFS")
_REGIONS = ("global_coarse", "global_mid")


def _coerce_utc(dt: Optional[datetime]) -> Optional[datetime]:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _on_lattice(dt: datetime, step_h: float = LATTICE_STEP_H) -> bool:
    return dt.minute == 0 and dt.second == 0 and dt.hour % int(step_h) == 0


def _vector_direction(v: GridVector) -> Optional[float]:
    """Direction extraction mirroring estimator.estimate_euro_grid: derive from u/v when present
    (products store direction=0.0 for 'none', so the stored field alone is ambiguous)."""
    if v.u != 0.0 or v.v != 0.0:
        val = math.atan2(-v.u, -v.v) * 180.0 / math.pi
        return (val + 360.0) % 360.0
    return None


def _grids_compatible(a: NormalizedProduct, b: NormalizedProduct) -> bool:
    ga, gb = getattr(a, "grid", None), getattr(b, "grid", None)
    if not ga or not gb or not ga.vectors or not gb.vectors:
        return False
    if ga.cols != gb.cols or ga.rows != gb.rows or len(ga.vectors) != len(gb.vectors):
        return False
    ba, bb = ga.bounds, gb.bounds
    if not ba or not bb:
        return False
    return (
        abs(ba.west - bb.west) < 1e-6 and abs(ba.south - bb.south) < 1e-6
        and abs(ba.east - bb.east) < 1e-6 and abs(ba.north - bb.north) < 1e-6
    )


def interpolate_between(a: NormalizedProduct, b: NormalizedProduct,
                        slot_dt: datetime) -> Optional[NormalizedProduct]:
    """One interpolated frame at slot_dt, strictly between products a and b (same lane, same grid
    geometry). Height and period blend linearly in time; direction blends circularly (height-
    weighted vector mean, the estimator's own convention). A cell is valid only when BOTH sides
    are — an interpolation with one made-up endpoint would be invention, not interpolation."""
    ta, tb = _coerce_utc(a.valid_time), _coerce_utc(b.valid_time)
    slot = _coerce_utc(slot_dt)
    if ta is None or tb is None or not (ta < slot < tb):
        return None
    if not _grids_compatible(a, b):
        return None
    w = (slot - ta).total_seconds() / (tb - ta).total_seconds()

    vectors: List[GridVector] = []
    valid_cells = 0
    for va, vb in zip(a.grid.vectors, b.grid.vectors):
        if not (va.is_valid and vb.is_valid):
            vectors.append(GridVector(lat=va.lat, lng=va.lng, speed=0.0, direction=0.0,
                                      u=0.0, v=0.0, period=None, is_valid=False))
            continue
        ha, hb = va.speed or 0.0, vb.speed or 0.0
        h = (1.0 - w) * ha + w * hb
        period = blend_period([va.period, vb.period], [1.0 - w, w])
        direction = blend_direction([ha, hb], [_vector_direction(va), _vector_direction(vb)],
                                    [1.0 - w, w])
        u = v_ = 0.0
        if h > 0.0 and direction is not None:
            rad = direction * math.pi / 180.0
            u = -h * math.sin(rad)
            v_ = -h * math.cos(rad)
        vectors.append(GridVector(
            lat=va.lat, lng=va.lng,
            speed=round(h, 4),
            direction=round(direction, 2) if direction is not None else 0.0,
            u=round(u, 4), v=round(v_, 4),
            period=round(period, 2) if period is not None else None,
            is_valid=True,
        ))
        valid_cells += 1

    if valid_cells == 0:
        return None

    grid = NormalizedGrid(
        bounds=a.grid.bounds, cols=a.grid.cols, rows=a.grid.rows, vectors=vectors,
        diagnostics={"vectorCount": len(vectors), "interpolationWeight": round(w, 4)},
    )
    # Grid contract (house rule: assert vec == cols*rows BEFORE anything ships)
    if len(vectors) != grid.cols * grid.rows:
        logger.error(
            "[Lattice Fill] Grid contract violation: %d vectors vs cols*rows=%d for %s/%s/%s@%s",
            len(vectors), grid.cols * grid.rows, a.model, a.domain, a.layer, slot.isoformat(),
        )
        return None

    run_a, run_b = _coerce_utc(getattr(a, "run_time", None)), _coerce_utc(getattr(b, "run_time", None))
    if run_a is None and run_b is None:
        return None  # run_time is a required product field; brackets without one are malformed
    run_time = max(t for t in (run_a, run_b) if t is not None)

    return NormalizedProduct(
        model=a.model,
        provider="estimated",
        domain=a.domain,
        layer=a.layer,
        run_time=run_time,
        valid_time=slot,
        is_forecast_authoritative=False,
        is_estimated=True,
        estimate_basis={
            "type": "native_time_interpolation",
            "bracket_a_product_id": a.product_id or "",
            "bracket_b_product_id": b.product_id or "",
            "bracket_a_valid_time": ta.isoformat(),
            "bracket_b_valid_time": tb.isoformat(),
            "weight": round(w, 4),
        },
        coverage=a.coverage,
        grid=grid,
        value_kind=a.value_kind,
        value_unit=a.value_unit,
        display_unit_hint=a.display_unit_hint,
        region_id=a.region_id,
        coverage_mode=a.coverage_mode,
        tile_id=a.tile_id,
        source_variables=a.source_variables,
        freshness_sec=a.freshness_sec,
        source_dataset="estimated_interpolation",
    )


def _lane_items(products, model: str, domain: str, layer: str, region_id: str):
    return [
        p for p in products
        if p.model.upper() == model and p.domain.lower() == domain
        and p.layer.lower() == layer and (p.region_id or "") == region_id
    ]


def find_fill_slots(items, max_bracket_h: float) -> List[Tuple[Any, Any, datetime]]:
    """(bracket_a_item, bracket_b_item, slot_dt) for every missing on-lattice slot whose bracketing
    products are ≤ max_bracket_h apart. Items are manifest entries (need valid_time_start). Slots
    off the lattice are never generated, and existing product times are never duplicated."""
    by_time = {}
    for it in items:
        t = _coerce_utc(it.valid_time_start)
        if t is None:
            continue
        prev = by_time.get(t)
        # Prefer the newest run at a duplicated valid_time (mirror of the duplicate sweep's rule)
        if prev is None or (_coerce_utc(getattr(it, "run_time", None)) or datetime.min.replace(tzinfo=timezone.utc)) \
                > (_coerce_utc(getattr(prev, "run_time", None)) or datetime.min.replace(tzinfo=timezone.utc)):
            by_time[t] = it
    times = sorted(by_time.keys())
    out: List[Tuple[Any, Any, datetime]] = []
    for ta, tb in zip(times, times[1:]):
        gap_h = (tb - ta).total_seconds() / 3600.0
        if gap_h <= LATTICE_STEP_H or gap_h > max_bracket_h:
            continue
        slot = ta + timedelta(hours=LATTICE_STEP_H)
        while slot < tb:
            if _on_lattice(slot):
                out.append((by_time[ta], by_time[tb], slot))
            slot += timedelta(hours=LATTICE_STEP_H)
    return out


async def fill_inband_lattice_gaps_impl(scheduler) -> bool:
    """Decoupled-cron job: sweep the global-tier lanes, interpolate every qualifying missing slot.
    Compute-only (store-fed). Idempotent — a slot that gained a product since the last sweep is
    simply no longer a gap."""
    if os.environ.get("LATTICE_INBAND_FILL", "1") == "0":
        logger.info("[Lattice Fill] LATTICE_INBAND_FILL=0 — skipping in-band lattice gap fill.")
        return False
    try:
        max_bracket_h = float(os.environ.get("LATTICE_FILL_MAX_BRACKET_H", "6"))
    except ValueError:
        max_bracket_h = 6.0

    manifest = await asyncio.to_thread(scheduler.store.get_manifest)
    to_save: List[Tuple[NormalizedProduct, Any]] = []
    wide_gaps = 0

    for model in _MODELS:
        for domain, layer in _LANES:
            for region_id in _REGIONS:
                items = _lane_items(manifest.products, model, domain, layer, region_id)
                if len(items) < 2:
                    continue
                # Visibility for the NON-fillable holes (the ICON purge class): count brackets
                # wider than the cap so a data-loss condition shows in cron logs instead of
                # disappearing behind "0 filled".
                times = sorted({t for t in (_coerce_utc(i.valid_time_start) for i in items) if t})
                for ta, tb in zip(times, times[1:]):
                    if (tb - ta).total_seconds() / 3600.0 > max_bracket_h:
                        wide_gaps += 1
                        logger.info(
                            "[Lattice Fill] NON-fillable hole %s/%s/%s/%s: %s .. %s (%.0fh) — "
                            "needs its source fixed, not interpolation.",
                            model, domain, layer, region_id, ta.isoformat(), tb.isoformat(),
                            (tb - ta).total_seconds() / 3600.0,
                        )
                slots = find_fill_slots(items, max_bracket_h)
                for item_a, item_b, slot in slots:
                    prod_a = await asyncio.to_thread(scheduler.store.load_product, item_a.filename)
                    prod_b = await asyncio.to_thread(scheduler.store.load_product, item_b.filename)
                    if not prod_a or not prod_b:
                        continue
                    est = interpolate_between(prod_a, prod_b, slot)
                    if est is not None:
                        to_save.append((est, getattr(item_a, "resolution", None)))

    saved = 0
    if to_save:
        try:
            saved = await asyncio.to_thread(scheduler.store.save_products_batch, to_save)
        except Exception as e:
            logger.error(f"[Lattice Fill] Batch save failed: {e}", exc_info=True)
    logger.info(
        f"[Lattice Fill] In-band lattice fill complete: {saved} interpolated frames saved "
        f"({len(to_save)} candidates, {wide_gaps} non-fillable wide holes)."
    )
    return saved > 0
