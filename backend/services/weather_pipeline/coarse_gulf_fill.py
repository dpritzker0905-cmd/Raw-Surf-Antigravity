"""
coarse_gulf_fill.py — SERVE-TIME enclosed-sea fill for the 10° global_coarse marine tier.

THE ROOT FIX (2026-07-23) for the persistent USER report "EURO marine shows WRONG COLORS zooming
out". The 10° `global_coarse` `waves` product for EURO (ECMWF-WAM / CMEMS) STRUCTURALLY MASKS the
Gulf of Mexico + other enclosed seas (Med, Black Sea, Sea of Japan, Gulf of California): those cells
serve `is_valid=False` and the frontend inflates the holes from distant open-ocean cells = the wrong
colors. GFS's coarse `waves` carries a VALID Gulf (its land-sea mask includes it, and the normalizer
reconstructs the total from partitions) — which is why GFS/ICON render correctly.

WHY SERVE-TIME, NOT INGEST: the intended ingest fill (fill_masked_waves_from_gfs) filled 0 across 6
bakes. Bake DIAG (run 29959504226): cell_hit=612, time_miss=0, but gfs_masked=4615, filled=0 — the
ingest reads the RAW stashed GFS grid whose Gulf partitions don't reconstruct, while the SERVED GFS
product (post-normalizer) DOES carry the valid Gulf (probe: GFS coarse Gulf waves=1.08m valid). So
the only data that works is the served product — read at serve time. Cheap: the GFS coarse product is
a small resident (629 cells) and the store LRU-caches it.

Kill switch: MARINE_COARSE_GULF_FILL=0.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# Only the 10° coarse global tier of the enclosed-sea-masking models, height layer only. GFS is the
# donor (never a recipient); swells/wind_waves ride the same fill via the total's validity flag.
_RECIPIENT_MODELS = ("EURO", "ICON")
_MAX_FILL_DIST_DEG = 8.0   # half a 10° cell + slop: only fill a hole that has a GFS ocean cell near it


def _is_masked(v):
    s = getattr(v, "speed", None)
    return (not getattr(v, "is_valid", False)) or s is None


async def fill_coarse_enclosed_sea_from_gfs_served(product, store, model, domain, layer):
    """If `product` is a EURO/ICON 10° global-coarse marine `waves` grid with masked enclosed-sea
    cells, fill them from the SERVED GFS global-coarse `waves` product (valid Gulf). Mutates + returns
    `product` (returns it unchanged on any guard miss / missing donor — never raises into the route)."""
    try:
        if os.environ.get("MARINE_COARSE_GULF_FILL", "1") == "0":
            return product
        if not product or (domain or "").lower() != "marine" or (layer or "").lower() != "waves":
            return product
        if (model or "").upper() not in _RECIPIENT_MODELS:
            return product
        grid = getattr(product, "grid", None)
        if not grid or not getattr(grid, "vectors", None):
            return product
        # Coarse-global only: a ~360° span product (the 10° world tier). Regional/mid grids are fine.
        b = getattr(grid, "bounds", None)
        span = (b.east - b.west) if (b and b.east >= b.west) else ((b.east + 360.0 - b.west) if b else 0.0)
        if span < 350.0:
            return product
        masked = [v for v in grid.vectors if _is_masked(v)]
        if not masked:
            return product

        # Load the SERVED GFS global-coarse waves product at this product's valid_time.
        vt = getattr(product, "valid_time", None) or getattr(product, "served_valid_time", None)
        gfs = await asyncio.to_thread(_load_gfs_coarse_waves, store, vt)
        if not gfs or not getattr(gfs, "grid", None) or not gfs.grid.vectors:
            return product
        gvalid = [g for g in gfs.grid.vectors if not _is_masked(g)]
        if not gvalid:
            return product

        # Nearest-GFS-cell fill (grids can differ 25 vs 37 cols → match by distance, not exact key).
        # Bucket the GFS cells on a 2° grid so each lookup scans only the local neighbourhood.
        buckets = {}
        for g in gvalid:
            buckets.setdefault((round(g.lat / 2.0), round(g.lng / 2.0)), []).append(g)

        filled = 0
        for v in masked:
            best, bestd = None, _MAX_FILL_DIST_DEG
            bl, bo = round(v.lat / 2.0), round(v.lng / 2.0)
            for dla in (-2, -1, 0, 1, 2):
                for dlo in (-2, -1, 0, 1, 2):
                    for g in buckets.get((bl + dla, bo + dlo), ()):  # local cells only
                        d = abs(g.lat - v.lat) + abs(g.lng - v.lng)
                        if d < bestd:
                            bestd, best = d, g
            if best is None:
                continue  # no GFS ocean cell nearby → genuine land, leave masked (nothing paints on land)
            v.speed = best.speed
            if getattr(best, "direction", None) is not None:
                v.direction = best.direction
            if getattr(best, "u", None) is not None:
                v.u = best.u
            if getattr(best, "v", None) is not None:
                v.v = best.v
            if getattr(best, "period", None) is not None:
                v.period = best.period
            v.is_valid = True
            filled += 1

        if filled:
            logger.info(
                f"[Coarse Gulf Fill] {model} coarse waves: filled {filled} masked enclosed-sea cells "
                f"from served GFS coarse (of {len(masked)} masked / {len(grid.vectors)} total)."
            )
        return product
    except Exception as e:  # never break the grid route over a best-effort fill
        logger.warning(f"[Coarse Gulf Fill] skipped ({type(e).__name__}: {e})")
        return product


def _load_gfs_coarse_waves(store, valid_time):
    """Find + load the GFS global-coarse marine `waves` product nearest `valid_time` from the manifest."""
    try:
        manifest = store.get_manifest()
        items = getattr(manifest, "products", None) or []
    except Exception:
        return None
    from datetime import datetime, timezone

    def _dt(t):
        if t is None:
            return None
        if isinstance(t, datetime):
            return t if t.tzinfo else t.replace(tzinfo=timezone.utc)
        try:
            d = datetime.fromisoformat(str(t).replace("Z", "+00:00"))
            return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            return None

    want = _dt(valid_time)
    best, bestdiff = None, None
    for p in items:
        if (getattr(p, "model", "").upper() != "GFS" or getattr(p, "domain", "").lower() != "marine"
                or getattr(p, "layer", "").lower() != "waves"):
            continue
        if getattr(p, "region_id", None) != "global_coarse":
            continue
        pvt = _dt(getattr(p, "valid_time_start", None))
        if want is None or pvt is None:
            best = p
            break
        diff = abs((pvt - want).total_seconds())
        if bestdiff is None or diff < bestdiff:
            bestdiff, best = diff, p
    if best is None:
        return None
    # Match tolerance: within 3h (coarse products are 3-hourly); else no honest donor for this frame.
    if want is not None and bestdiff is not None and bestdiff > 3 * 3600 + 60:
        return None
    return store.load_product(best.filename)
