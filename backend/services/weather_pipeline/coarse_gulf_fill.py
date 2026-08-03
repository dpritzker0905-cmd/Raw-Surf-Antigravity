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

⬆ WIDENED 2026-08-01 BEYOND `waves`, AND THE MODULE NAME IS NOW TOO NARROW. It fills `waves`,
`swell_1`, `swell_2` and `wind_waves`, and most of what it repairs is POLAR, not an enclosed sea
(25 of 76 `swell_1` holes and 42 of 107 `wind_waves` holes sit at lat <= -60). The names
(`coarse_gulf_fill`, `fill_coarse_enclosed_sea_from_gfs_served`, `_load_gfs_coarse_waves`) are kept
deliberately: a rename's blast radius is a recorded wound here — **grep the OLD NAME** — and a stale
name with an accurate docstring is cheaper than a rename that misses a call site.

★ RELATIONSHIP TO QUEUE ITEM #25 (`1a1134ec`, "coastal/polar marine no-data holes", never merged,
35 days old). #25 fixes the same SYMPTOM at INGEST via `build_regular_nn_valid`, wired into
`dwd_gwam_fetcher` (ICON/GWAM) and `noaa_gfs_wave_fetcher` (GFS-Wave). Measured 2026-08-01, those
are the two models that no longer exhibit it: **ICON has ZERO holes on all three layers and GFS has
1-3**, while the live defect is **EURO's Copernicus CMEMS partition layers** — an upstream #25 does
not touch. ⇒ porting #25 would repair ~3 cells. **Its symptom moved; the queue's ranking of it
rests on models that measure clean.** The ingest fix remains the more general shape and is still
worth porting on its own merits, but not as a fix for what users see today.

Kill switch: MARINE_COARSE_GULF_FILL=0.
"""
import asyncio
import logging
import os

logger = logging.getLogger(__name__)

# Only the 10° coarse global tier of the enclosed-sea-masking models. GFS is the donor, never a
# recipient.
#
# ⛔⛔ THE LAYER LIST WAS `("waves",)` UNTIL 2026-08-01, AND THE COMMENT HERE CLAIMED
# "swells/wind_waves ride the same fill via the total's validity flag". THAT WAS MEASURED FALSE.
# Live at the 10° tier, counting only cells INVALID in EURO but VALID in BOTH GFS and ICON (so a
# genuine land/ice cell cannot be counted — land is land for every model):
#
#     layer         EURO holes    ICON holes    GFS holes
#     waves              0             0            3
#     swell_1           76             0            2
#     wind_waves       107             0            1
#
# ★★★ ONE CONDITION — `layer != "waves"` → return unchanged — was the entire difference between 0
# and 107 holes on the SAME model at the SAME tier. The Jacobian variable is the LAYER, not the
# model. ⚠️ 4th instance in this repo of a code comment asserting the opposite of reality.
#
# ★ WHY EURO AND NOT ICON: the layers come from DIFFERENT UPSTREAMS. EURO `waves` is ECMWF WAM via
# open-meteo; EURO `swell_1`/`wind_waves` are Copernicus CMEMS
# (`cmems_mod_glo_wav_anfc_0.083deg`, vars VHM0_SW1 / VHM0_WW), which masks far more aggressively.
# ⚠️ These are REAL CMEMS partitions, NOT the fabricated ECMWF partitions that were gated off in
# `81c7bcb5` — checked by provenance before treating the holes as a defect, because "EURO swell is
# fiction" would have made this a false positive.
_RECIPIENT_MODELS = ("EURO", "ICON")
_FILLABLE_LAYERS = ("waves", "swell_1", "swell_2", "wind_waves")
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
        if not product or (domain or "").lower() != "marine":
            return product
        layer_l = (layer or "").lower()
        if layer_l not in _FILLABLE_LAYERS:
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
        # ⛔ THE DONOR MUST BE THE SAME LAYER. Filling a `swell_1` hole from a `waves` donor would
        # substitute the TOTAL significant height for a single train's height — two different
        # quantities in the same units, which is exactly the class `5ae2d267` closed at the infobox
        # ("when two quantities share units the LABEL is the entire correctness surface"). Measured:
        # GFS carries 506/629 valid `swell_1` and 541/629 valid `wind_waves` cells at this tier, so
        # a same-layer donor genuinely exists and no substitution across quantities is needed.
        gfs = await asyncio.to_thread(_load_gfs_coarse_waves, store, vt, layer_l)
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
            # ★★ PROVENANCE — A SUBSTITUTED CELL USED TO BE INDISTINGUISHABLE FROM A NATIVE ONE.
            # The fill sets `is_valid = True` and copies GFS values onto a EURO/ICON vector, so the
            # served product claimed to be EURO at cells whose numbers came from GFS, and NOTHING
            # downstream could tell. In a repo where **every recurring defect is PROVENANCE or
            # COMPOSITION, never physics**, widening this fill without saying so would have widened
            # a silent lie from 0 cells to 183.
            # ⚠️ PRODUCT-LEVEL, NOT PER-VECTOR, deliberately: `2e81bcf5` measured a raw per-item
            # provenance stamp at **+30.1%** on an object every client downloads and interned it for
            # exactly this reason. This answers "did this product receive substituted data, which
            # layer, from whom, and how much" in O(1) bytes; a per-cell flag can follow if a
            # consumer ever needs to know WHICH cells.
            # ⛔⛔ THIS `except` USED TO BE A BARE `pass`, AND IT SWALLOWED EVERY WRITE.
            # `NormalizedProduct` declared no `coarse_fill`, so pydantic raised `ValueError` on
            # every single assignment from 2026-07-23 until the field was declared (2026-08-03).
            # The fill ran, the values were substituted, and `"coarse_fill" in model_dump_json()`
            # was False on 100% of served products. A silent swallow made a TOTAL failure
            # indistinguishable from "nothing was filled" — the exact PROVENANCE class this repo
            # names as its recurring root, hiding inside the fix written to cure it.
            # The route still must not break over a best-effort stamp, so the catch stays — but it
            # is now LOUD. A provenance write that fails is a defect, not a no-op.
            try:
                product.coarse_fill = {"donor_model": "GFS", "layer": layer_l,
                                       "cells_filled": filled, "cells_masked": len(masked),
                                       "cells_total": len(grid.vectors)}
            except Exception as e:
                logger.error(
                    f"[Coarse Fill] PROVENANCE LOST: substituted {filled} {layer_l} cells into "
                    f"{model} from GFS but could not stamp `coarse_fill` on "
                    f"{type(product).__name__} ({type(e).__name__}: {e}). The served product now "
                    f"claims to be {model} at cells whose numbers came from GFS."
                )
            logger.info(
                f"[Coarse Fill] {model} coarse {layer_l}: filled {filled} masked cells "
                f"from served GFS coarse (of {len(masked)} masked / {len(grid.vectors)} total)."
            )
        return product
    except Exception as e:  # never break the grid route over a best-effort fill
        logger.warning(f"[Coarse Gulf Fill] skipped ({type(e).__name__}: {e})")
        return product


def _load_gfs_coarse_waves(store, valid_time, layer="waves"):
    """Find + load the GFS global-coarse marine product for `layer` nearest `valid_time`.

    ⚠️ `layer` is a PARAMETER, not a constant, since 2026-08-01: the donor must carry the SAME
    quantity as the recipient. It defaults to `waves` so the pre-existing call shape is
    unchanged, and the name keeps `_waves` only because renaming a symbol has blast radius
    this repo has been bitten by (grep the OLD NAME)."""
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
                or getattr(p, "layer", "").lower() != layer):
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
