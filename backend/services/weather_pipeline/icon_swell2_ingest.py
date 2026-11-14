"""Stage: store ICON swell_2 as a derived product (2026-11-13, move 3, option B; director: a stored product every surface reads).

For each global tier (global_coarse, global_mid) and each stored GFS swell_2 product, pair the EURO swell_2 product of the same tier
nearest in time (within 3 h, /grid's candidate window), blend them with the browser's exact math (icon_swell2_blend.blend_vectors,
proven equal to iconSwell2Blend.js), and save an ICON swell_2 product labelled estimated with the browser's basis. A time with no
EURO within 3 h blends GFS alone (weights 1/0), as the browser does when EURO answers nothing.

Storing serves nothing by itself: /grid and /point keep answering "unsupported" for ICON swell_2 until their own flag is turned on.
Compute-only, store-fed (no fetch). DARK by default (arm ICON_SWELL2_STORED=1): measured 256 ms CPU and 2.75 MB per mid-tier product,
so a full mid rebuild (113 frames, every new GFS run) is ~29 s and ~310 MB of uploads that nothing reads until serving is approved;
it is armed together with the serve flag (director's decision, owner's word for the served change).
"""
import asyncio
import logging
import os

from services.weather_pipeline.icon_swell2_blend import blend_vectors

logger = logging.getLogger(__name__)

TIERS = ("global_coarse", "global_mid")
PAIR_WINDOW_H = 3.0


def enabled() -> bool:
    return os.environ.get("ICON_SWELL2_STORED", "0") == "1"


def _tier_regions(tier):
    # global_coarse products were historically also stamped 'global'/None (icon_marine_extension._gfs_regions_for)
    return ("global_coarse", "global", None) if tier == "global_coarse" else (tier,)


def _stored_vector(v):
    """A blend output cell as a stored GridVector dict. The browser's unavailable cell (direction null) is stored as direction 0 with
    is_valid False: an invalid cell is never drawn, so the two are the same frame. `height` (= speed) and `isOcean` are not fields."""
    return {"lat": v["lat"], "lng": v["lng"], "speed": v["speed"], "direction": v["direction"] if v["direction"] is not None else 0.0,
            "u": v["u"], "v": v["v"], "period": v["period"], "is_valid": bool(v["is_valid"])}


def _source(item):
    """An input's identity for the carry: its file and ingest time (a re-ingest of the same file is a new input)."""
    return f"{item.filename}@{item.ingested_at.isoformat() if getattr(item, 'ingested_at', None) else ''}" if item else None


def build_product(gfs, euro, sources=(None, None)):
    """The ICON swell_2 product for one GFS product (a NormalizedProduct) and its EURO pair (or None). None when nothing blends."""
    from services.weather_pipeline.schemas import NormalizedGrid, NormalizedProduct
    gv = [v.model_dump() if hasattr(v, "model_dump") else dict(v) for v in (gfs.grid.vectors if gfs.grid else [])]
    ev = [v.model_dump() if hasattr(v, "model_dump") else dict(v) for v in (euro.grid.vectors if euro and euro.grid else [])]
    got = blend_vectors(gv, ev)
    if not got:
        return None
    vectors, gfs_w, euro_w = got
    anchor = gfs if len(gv) >= len(ev) else euro          # the browser anchors bounds/cols/rows on the fuller grid
    basis = {"type": "icon_swell_2_gfs_euro_blend", "method": "weighted_average", "gfs_weight": gfs_w, "euro_weight": euro_w,
             "gfs_vectors": len(gv), "euro_vectors": len(ev),
             "source_model": f"{gfs.source_dataset or 'ncep_gfswave025'}+{(euro.source_dataset if euro else None) or 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i'}",
             "gfs_product_id": gfs.product_id, "euro_product_id": euro.product_id if euro else None,
             "euro_valid_time": euro.valid_time.isoformat() if euro else None, "euro_is_estimated": bool(euro.is_estimated) if euro else None,
             "gfs_source": sources[0], "euro_source": sources[1], "stored_by": "icon_swell2_ingest"}
    return NormalizedProduct(
        model="ICON", provider="estimated", domain=gfs.domain, layer="swell_2", run_time=gfs.run_time,
        model_run_time=gfs.model_run_time, model_run_time_status=gfs.model_run_time_status, valid_time=gfs.valid_time,
        is_forecast_authoritative=False, is_estimated=True, estimate_basis=basis, coverage=anchor.coverage,
        grid=NormalizedGrid(bounds=anchor.grid.bounds, cols=anchor.grid.cols, rows=anchor.grid.rows, vectors=[_stored_vector(v) for v in vectors]),
        value_kind=gfs.value_kind, value_unit=gfs.value_unit, display_unit_hint=gfs.display_unit_hint, region_id=gfs.region_id,
        coverage_mode=gfs.coverage_mode, tile_id=gfs.tile_id, source_variables=gfs.source_variables, freshness_sec=gfs.freshness_sec,
        source_dataset="estimated_blend")


async def ingest_icon_swell2_blend_impl(scheduler) -> bool:
    if not enabled():
        return False
    from services.weather_pipeline.scheduler_helpers import find_nearest_manifest_product
    manifest = await asyncio.to_thread(scheduler.store.get_manifest)
    to_save = []
    carried = 0
    for tier in TIERS:
        regions = _tier_regions(tier)
        # CARRY: an ICON swell_2 product already stored for this tier and time from the SAME two inputs is not rebuilt or re-uploaded.
        have = {p.valid_time_start: (p.estimate_basis or {}) for p in manifest.products
                if p.model == "ICON" and p.domain == "marine" and p.layer == "swell_2" and p.region_id in regions and p.is_estimated}
        gfs_items = sorted((p for p in manifest.products if p.model == "GFS" and p.domain == "marine" and p.layer == "swell_2"
                            and p.region_id in regions and not p.is_estimated), key=lambda p: p.valid_time_start)
        for item in gfs_items:
            euro_item = None
            for region in regions:
                euro_item = find_nearest_manifest_product(manifest, "EURO", "marine", "swell_2", region, item.valid_time_start,
                                                          max_delta_hours=PAIR_WINDOW_H)
                if euro_item:
                    break
            sources = (_source(item), _source(euro_item))
            old = have.get(item.valid_time_start)
            if old and old.get("gfs_source") == sources[0] and old.get("euro_source") == sources[1]:
                carried += 1
                continue
            try:
                gfs = await asyncio.to_thread(scheduler.store.load_product, item.filename)
                euro = await asyncio.to_thread(scheduler.store.load_product, euro_item.filename) if euro_item else None
                prod = build_product(gfs, euro, sources) if gfs else None
            except Exception as e:   # one bad pair must not lose the batch (the extension jobs' isolation)
                logger.error(f"[Pipeline Scheduler] ICON swell_2 blend failed @{item.valid_time_start.isoformat()} {tier}: "
                             f"{type(e).__name__}: {e}", exc_info=True)
                continue
            if prod:
                to_save.append((prod, float(getattr(item, "resolution", 10.0) or 10.0)))
    total = 0
    if to_save:
        try:
            total = await asyncio.to_thread(scheduler.store.save_products_batch, to_save)
        except Exception as e:
            logger.error(f"[Pipeline Scheduler] ICON swell_2 blend batch save failed: {e}", exc_info=True)
    logger.info(f"[Pipeline Scheduler] ICON swell_2 blend job completed. Saved {total} estimated product files, carried {carried}.")
    return total > 0
