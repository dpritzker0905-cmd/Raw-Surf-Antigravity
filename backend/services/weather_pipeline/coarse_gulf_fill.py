"""
coarse_gulf_fill.py — SERVE-TIME enclosed-sea fill for the 10° global_coarse marine tier.

THE ROOT FIX (2026-07-23) for the persistent USER report "EURO marine shows WRONG COLORS zooming
out". The 10° `global_coarse` `waves` product for EURO (ECMWF-WAM or CMEMS MFWAM) STRUCTURALLY MASKS the
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

⛔ COPY, NEVER MUTATE (2026-10-01). Until then the fill assigned GFS values onto the vector objects
it was handed. Those objects are not its own: `ProductStore.load_product` hands out a SHALLOW copy
of the L1 entry (vector objects shared) and `filter_grid_to_bbox` re-references them, so the fill
wrote GFS numbers into the CACHED EURO/ICON product while stamping `coarse_fill` on the served copy
only. Measured in `tests/test_coarse_fill_shared_vectors.py` through the real store and route: a
world request (the mid tier's 360-degree clip of `global_mid`) left the cached cell
`is_valid=True, speed=GFS`; a later Gulf clip of the same L1 entry served it as EURO with no stamp;
on the coarse tier the second identical request found nothing masked and lost its stamp. Filled
cells are now copies in a rebound vector list on a copied product and grid; served values and the
stamp are unchanged.
  Live on production the same day (read-only GETs): EURO `swell_1` and `wind_waves` world requests
26 s apart served identical cells, stamped `cells_filled` 95 / 123 the first time and `None` the
second; and a 40° EURO `waves` clip of the US Southeast had 119 of 399 cells flip from masked to
valid between a request just before and one just after a world request (inland Texas, Mississippi,
Georgia among them), unstamped. ⚠️ Those inland cells are filled on the world response itself too:
the 8° reach was sized for 10° cells, and on the 2° world clip it reaches inland. That response is
stamped, and narrowing the reach changes a served number, so it is the owner's call, not done here.

Kill switch: MARINE_COARSE_GULF_FILL=0. Scope to the 10-deg tier only (DARK, owner's call): MARINE_GULF_FILL_MID=0.

THE TARGETED 2-DEG FILL (2026-10-23, DARK; the owner's decision 09:56 EDT: "build the targeted fill dark (only fill EURO/ICON
2-deg cells where GFS 2-deg is sea, stop painting land/ice), then show me the before/after before switching it on").
MARINE_GULF_FILL_MID_TARGETED=1 replaces the 10-deg / 8-deg-reach fill ON THE 2-DEG global_mid ONLY with a node-for-node one: a
masked EURO/ICON cell takes the SAME-LAYER GFS global_mid value at the SAME node (the three models share the 181 x 83 lattice),
and only where that GFS node is valid, i.e. sea. Real enclosed sea that EURO's 2-deg grid masks stays filled; land and ice the
8-deg reach painted stay masked. Measured on the published frames (valid 2026-10-25T00Z, the lead): EURO masks 870 of 10,168
GFS-sea nodes (Gulf of Mexico 15/59, Caribbean 15/102, Mediterranean 44/113, Red Sea 14/25, Persian Gulf 6/12, Baltic 26/45,
Black Sea 2/2, Hudson Bay 13/47, Gulf of California 8/20, Sea of Japan 16/52); ICON 125. The 10-deg coarse tier keeps today's
fill unchanged. Provenance: coarse_fill.mode == "targeted", donor_region global_mid, donor_product.
"""
import asyncio
import copy
import json
import logging
import os
import threading
from collections import OrderedDict, Counter

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


def gulf_fill_mid_mode():
    """How the fill treats the 2-deg global_mid world grid (EURO/ICON marine, served span >= 350 deg), read at call time:

      "legacy"   (default) today's fill: masked cells within 8 deg of a GFS 10-deg ocean cell take its values. It paints coast,
                 land and ice (live 2026-10-22, world /grid coarse_fill: EURO 2,465 of 4,689 masked cells, ICON 1,708 of 3,788),
                 and it also keeps the real enclosed sea EURO's 2-deg grid masks (Gulf, Med, Red Sea, Baltic; module docstring).
      "targeted" MARINE_GULF_FILL_MID_TARGETED=1 (DARK, the owner's decision 2026-10-23): a masked cell takes the same-layer GFS
                 2-deg value at the same node, only where that node is valid.
      "off"      MARINE_GULF_FILL_MID=0 (DARK): the 2-deg world grid is served as stored.
                 CORRECTED 2026-10-23: this docstring said the 2-deg fill "has no enclosed-sea job (EURO's global_mid Gulf is
                 valid)". MEASURED FALSE (the lead, published frames valid 2026-10-25T00Z): EURO's 2-deg grid masks 870 GFS-sea
                 nodes, 15 of 59 in the Gulf of Mexico and 44 of 113 in the Mediterranean, so "off" blanks real sea.
    MARINE_GULF_FILL_MID=0 wins over the targeted flag. /capabilities reports the mode (EURO/ICON marine rows)."""
    if os.environ.get("MARINE_GULF_FILL_MID", "1") == "0":
        return "off"
    if os.environ.get("MARINE_GULF_FILL_MID_TARGETED", "0") == "1":
        return "targeted"
    return "legacy"


def gulf_fill_mid_enabled():
    """Does any fill run on the 2-deg global_mid? (gulf_fill_mid_mode() != "off"; /capabilities `gulf_fill_mid`.) The client
    serves a static ICON/EURO world frame only when this is False, because only then does /grid equal the stored product: the
    targeted fill still substitutes GFS values (at sea), so it keeps the client's guard."""
    return gulf_fill_mid_mode() != "off"


def _is_mid_tier(product, grid):
    """The 2-deg global_mid (the mid tier's world clip), told apart from the 10-deg coarse tier."""
    if getattr(product, "region_id", None) == "global_mid":
        return True
    try:
        cols = int(getattr(grid, "cols", 0) or 0)
        b = grid.bounds
        span = (b.east - b.west) if b.east >= b.west else (b.east + 360.0 - b.west)
        return cols > 1 and span / (cols - 1) < 5.0
    except Exception:
        return False


async def fill_coarse_enclosed_sea_from_gfs_served(product, store, model, domain, layer):
    """If `product` is a EURO/ICON 10° global-coarse marine `waves` grid with masked enclosed-sea
    cells, fill them from the SERVED GFS global-coarse `waves` product (valid Gulf). Returns a NEW
    product whose grid and filled cells are copies; the input product, its grid, its vector list and
    every vector in it are left untouched, because they may be the L1 cache's own objects (module
    docstring). Returns `product` itself on any guard miss / missing donor / nothing filled, and
    never raises into the route."""
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
        # A ~360° span product. ⚠️ CORRECTED 2026-10-01: this said "Coarse-global only (the 10° world
        # tier). Regional/mid grids are fine." Since MARINE_MID_RES_MAX_SPAN=400 (2026-07-23) a world
        # request is served by the mid tier as a 360° clip of the 2° `global_mid`, whose span is
        # >= 350, so the fill runs on that too. Viewport clips of the mid (span < 350) still skip it.
        b = getattr(grid, "bounds", None)
        span = (b.east - b.west) if (b and b.east >= b.west) else ((b.east + 360.0 - b.west) if b else 0.0)
        if span < 350.0:
            return product
        mid_mode = gulf_fill_mid_mode() if _is_mid_tier(product, grid) else None
        if mid_mode == "off":
            return product   # MARINE_GULF_FILL_MID=0: the 2-deg world grid is served as stored (gulf_fill_mid_mode)
        masked = [i for i, v in enumerate(grid.vectors) if _is_masked(v)]
        if not masked:
            return product
        if mid_mode == "targeted":
            return await _targeted_mid_fill(product, grid, store, model, layer_l, masked)

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

        # ⛔ A NEW list, and a copy per filled cell: the input list and its vectors may be the L1
        # cache's own objects (module docstring), so nothing below writes to either.
        vectors = list(grid.vectors)
        filled = 0
        for i in masked:
            v = vectors[i]
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
            v = copy.copy(v)  # BaseModel.__copy__ == model_copy(); same assignments as before, on the copy
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
            vectors[i] = v
            filled += 1

        if filled:
            # Rebind on copies of the product and grid containers too: the caller's product (and its
            # grid) may be shared with a cache just like the vectors, so the new list and the stamp
            # below land on objects this function owns.
            product = copy.copy(product)
            product.grid = copy.copy(grid)
            product.grid.vectors = vectors
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


# ── THE TARGETED DONOR: compact, bounded, shared (2026-10-23 regression review) ─────────────────────────────────────────────
# The first cut loaded the FULL 15,023-vector GFS global_mid product as the donor of EVERY EURO/ICON frame (the legacy donor is
# the 629-vector global_coarse). Measured offline on a 48-frame world /grid_series page (#462 masked store, measure_series.py):
# EURO 48 full GFS loads, 33 L1 evictions, CPU 8.9 s vs 3.3 s legacy, peak RSS +110 MB; ICON 42 / 52. On the 1-CPU box, with
# L1 bounded at ~8 full mid products (PRODUCT_CACHE_VECTOR_BUDGET 120k, the 2026-07-05 OOM root), that churn is the cost.
# Now each GFS file becomes ONE compact donor: its lattice plus five float32 planes (speed, direction, u, v, period; NaN = not sea),
# ~0.3 MB, built from the stored file WITHOUT passing through L1 (a file not yet on disk is fetched to disk by the store's own L2
# download, store_helpers.fetch_l2_to_disk, never parsed into L1), kept in an LRU shared by EURO and ICON frames (default 96 donors,
# ~29 MB: a 48-frame EURO page then a 48-frame ICON page must share, review 2026-10-23), and never written to.
_DONOR_LRU = OrderedDict()                 # (GFS filename, run identity) -> _CompactDonor (a newer run rewrites the same filename)
_DONOR_LOCK = threading.Lock()
_DONOR_BUILDING = {}                       # key -> threading.Lock (one build per key at a time)
TARGETED_NO_FILL = Counter()               # (model, layer, reason) -> frames served unfilled by the targeted mode
_LAST_NO_FILL = {}                         # (model, layer) -> last reason logged (log once per change)
DONOR_STATS = Counter()                    # hits, builds, build_ms, stale_uncached (targeted_fill_stats)


def _donor_cache_size():
    try:
        return max(1, int(os.environ.get("MARINE_TARGETED_DONOR_CACHE", "96")))
    except ValueError:
        return 96


class _CompactDonor:
    """One GFS global_mid layer at one valid time, reduced to what the targeted fill reads. Immutable once built."""
    __slots__ = ("filename", "west", "south", "dlon", "dlat", "cols", "rows", "resolution", "planes")

    def __init__(self, filename, vectors, cols, rows, resolution):
        import numpy as np
        if not vectors:
            raise ValueError(f"{filename}: no vectors")
        lats = [float(v["lat"]) for v in vectors]
        lngs = [float(v["lng"]) for v in vectors]
        self.filename, self.resolution = filename, (float(resolution) if resolution else None)
        self.west, self.south = min(lngs), min(lats)
        # Spacing from the product's resolution (the lattice step), never from the extent: a sparse or clipped product has
        # extent / (cols - 1) != its step. Fallback for a resolution-less product: its own extent over its own cols/rows.
        self.dlon = self.dlat = self.resolution or ((max(lngs) - self.west) / (int(cols) - 1) if cols and int(cols) > 1 else 1.0)
        self.cols = int(round((max(lngs) - self.west) / self.dlon)) + 1
        self.rows = int(round((max(lats) - self.south) / self.dlat)) + 1
        self.planes = {k: np.full(self.cols * self.rows, np.nan, dtype=np.float32) for k in ("speed", "direction", "u", "v", "period")}
        for v, la, lo in zip(vectors, lats, lngs):
            i = self.index(la, lo)
            if i is None or v.get("is_valid", True) is False or v.get("speed") is None:
                continue
            for k, plane in self.planes.items():
                x = v.get(k)
                if x is not None:
                    plane[i] = float(x)

    def aligned(self, lat, lng):
        """Is (lat, lng) a node of this lattice's spacing and origin (inside its extent or not)?"""
        fc, fr = (lng - self.west) / self.dlon, (lat - self.south) / self.dlat
        return abs(fc - round(fc)) <= 1e-3 and abs(fr - round(fr)) <= 1e-3

    def index(self, lat, lng):
        """The flat index of (lat, lng) on this lattice, or None when it is not a node inside the extent (no snapping)."""
        if not self.aligned(lat, lng):
            return None
        c, r = int(round((lng - self.west) / self.dlon)), int(round((lat - self.south) / self.dlat))
        if not (0 <= c < self.cols and 0 <= r < self.rows):
            return None
        return r * self.cols + c

    def has_sea(self):
        import numpy as np
        return bool(np.isfinite(self.planes["speed"]).any())

    def sea_at(self, lat, lng):
        """(speed, direction, u, v, period) at an exact node where GFS is sea, else None."""
        i = self.index(float(lat), float(lng))
        if i is None:
            return None
        s = self.planes["speed"][i]
        if s != s:
            return None
        return tuple(None if x != x else float(x) for x in (self.planes[k][i] for k in ("speed", "direction", "u", "v", "period")))


def _vector_dicts(product):
    return [v.model_dump() if hasattr(v, "model_dump") else dict(vars(v)) for v in product.grid.vectors]


def _run_identity(item):
    return tuple(str(getattr(item, k, None) or "") for k in ("model_run_time", "run_time", "ingested_at"))


def _same_run(item, data):
    """Does a stored JSON carry the run the manifest item names? (Unknown on either side counts as the same.)"""
    for k in ("model_run_time", "run_time"):
        a, b = getattr(item, k, None), data.get(k)
        if a and b and _iso_s(a) != _iso_s(b):
            return False
    return True


def _iso_s(t):
    s = t.isoformat() if hasattr(t, "isoformat") else str(t)
    return s.replace("+00:00", "Z")[:19]


def _compact_donor(store, item):
    """The compact donor of one GFS manifest item (LRU by filename AND run). Raises on an unreadable donor (the caller stamps it).

    With a ProductStore-like store (cache_dir): the file is made local by the store's own L2 download (fetch_l2_to_disk, no parse,
    no L1 insert, so nothing else in L1 is evicted) and read as JSON. A file of another run than the manifest names is used (it is
    what the store would serve) but NOT cached, so the next call sees the refreshed file. A store without cache_dir (tests, mocks)
    is asked through load_product. A donor with no sea node is refused (a parse bug must not look like "nothing to fill")."""
    filename = item.filename
    key = (filename, _run_identity(item))
    with _DONOR_LOCK:
        hit = _DONOR_LRU.get(key)
        if hit is not None:
            _DONOR_LRU.move_to_end(key)
            DONOR_STATS["hits"] += 1
            return hit
        building = _DONOR_BUILDING.setdefault(key, threading.Lock())
    with building:                                   # one build per key; a waiter then finds it in the LRU
        with _DONOR_LOCK:
            hit = _DONOR_LRU.get(key)
            if hit is not None:
                DONOR_STATS["hits"] += 1
                return hit
        import time as _time
        t0 = _time.perf_counter()
        resolution = getattr(item, "resolution", None)
        cache_dir = getattr(store, "cache_dir", None)
        stale = False
        if cache_dir is not None:
            path = cache_dir / filename
            if not path.exists():
                from services.weather_pipeline.store_helpers import fetch_l2_to_disk
                if not fetch_l2_to_disk(store, filename):
                    raise FileNotFoundError(f"{filename}: not on disk and the L2 read did not deliver it")
            with open(path, "r") as fh:
                data = json.load(fh)
            stale = not _same_run(item, data)
            g = data.get("grid") or {}
            donor = _CompactDonor(filename, g.get("vectors") or [], g.get("cols"), g.get("rows"), resolution or data.get("resolution"))
        else:
            prod = store.load_product(filename)
            if prod is None or not getattr(prod, "grid", None) or not prod.grid.vectors:
                raise FileNotFoundError(f"{filename}: the store returned no product")
            donor = _CompactDonor(filename, _vector_dicts(prod), prod.grid.cols, prod.grid.rows,
                                  resolution or getattr(prod, "resolution", None))
        if not donor.has_sea():
            raise ValueError(f"{filename}: the donor has no sea node")
        with _DONOR_LOCK:
            DONOR_STATS["builds"] += 1
            DONOR_STATS["build_ms"] += int((_time.perf_counter() - t0) * 1000)
            DONOR_STATS["stale_uncached"] += int(stale)
        if not stale:
            with _DONOR_LOCK:
                _DONOR_LRU[key] = donor
                _DONOR_LRU.move_to_end(key)
                while len(_DONOR_LRU) > _donor_cache_size():
                    _DONOR_LRU.popitem(last=False)
        with _DONOR_LOCK:
            _DONOR_BUILDING.pop(key, None)
        return donor


def targeted_fill_stats():
    """The targeted fill's process-local counters, for /admin/surf-forecast/status (the dark-deploy baseline and the flip watch):
    the mode, frames served unfilled by reason, and the donor LRU's size, capacity, hits, builds and build time."""
    with _DONOR_LOCK:
        size, stats = len(_DONOR_LRU), dict(DONOR_STATS)
    builds = stats.get("builds", 0)
    return {"mode": gulf_fill_mid_mode(), "donor_lru": {"size": size, "capacity": _donor_cache_size(), "hits": stats.get("hits", 0),
            "builds": builds, "build_ms_total": stats.get("build_ms", 0),
            "build_ms_mean": round(stats.get("build_ms", 0) / builds, 1) if builds else None,
            "stale_uncached": stats.get("stale_uncached", 0)},
            "no_fill": {f"{m}/{layer}/{reason}": n for (m, layer, reason), n in sorted(TARGETED_NO_FILL.items())}}


def _node_key(v):
    """(lat, lng) rounded, with lng in [-180, 180]; the 181-column lattices carry both -180 and 180, kept apart."""
    return round(float(v.lat), 3), round(float(v.lng), 3)


class _VectorDonor:
    """A donor built from vectors (the owner's evidence pack and older callers): same `sea_at` contract as _CompactDonor."""

    def __init__(self, donor_vectors):
        self._d = {_node_key(g): g for g in donor_vectors or () if not _is_masked(g)}

    def sea_at(self, lat, lng):
        g = self._d.get((round(float(lat), 3), round(float(lng), 3)))
        if g is None:
            return None
        return (g.speed, getattr(g, "direction", None), getattr(g, "u", None), getattr(g, "v", None), getattr(g, "period", None))


def targeted_fill_vectors(vectors, donor):
    """(new vector list, cells filled): every masked vector at whose node the donor is sea becomes a copy carrying the donor's
    values (speed, direction, u, v, period) with is_valid True. `donor` is a _CompactDonor or a list of vectors. The inputs are
    never written to. Pure, so the serve path, the tests and the owner's evidence pack run the same rule."""
    if not hasattr(donor, "sea_at"):
        donor = _VectorDonor(donor)
    out, filled = list(vectors), 0
    for i, v in enumerate(out):
        if not _is_masked(v):
            continue
        sea = donor.sea_at(v.lat, v.lng)
        if sea is None:
            continue           # GFS masks this node too (land or ice), or it is not a donor node: left masked
        v = copy.copy(v)
        v.speed = sea[0]
        for attr, x in zip(("direction", "u", "v", "period"), sea[1:]):
            if x is not None:
                setattr(v, attr, x)
        v.is_valid = True
        out[i] = v
        filled += 1
    return out, filled


def _lattice_mismatch(product, grid, donor, masked):
    """Why the recipient cannot be matched node for node with the donor, or None. Exact-node matching assumes EURO_MID_RES ==
    ICON_MID_RES == GFS_MID_RES and one origin; on any drift the fill is skipped, never misaligned."""
    res = getattr(product, "resolution", None)
    if res is not None and donor.resolution is not None and abs(float(res) - float(donor.resolution)) > 1e-6:
        return f"resolution {res} vs GFS {donor.resolution}"
    off = sum(1 for i in masked if not donor.aligned(float(grid.vectors[i].lat), float(grid.vectors[i].lng)))
    if off:
        return f"{off} of {len(masked)} masked nodes are not GFS global_mid lattice nodes"
    return None


def _no_fill(product, model, layer_l, reason, detail, masked, total):
    """Serve the grid as stored, but SAY why (the 2026-10-23 review: a silent missing donor blanks real sea for that frame).
    The product container is copied for the stamp; the grid and its vectors are the caller's, untouched."""
    TARGETED_NO_FILL[(model, layer_l, reason)] += 1
    if _LAST_NO_FILL.get((model, layer_l)) != reason:
        _LAST_NO_FILL[(model, layer_l)] = reason
        logger.warning(f"[Coarse Fill] {model} global_mid {layer_l}: targeted fill skipped ({reason}: {detail}); "
                       f"{masked} masked cells served masked (count {TARGETED_NO_FILL[(model, layer_l, reason)]})")
    out = copy.copy(product)
    try:
        out.coarse_fill = {"donor_model": "GFS", "layer": layer_l, "mode": "targeted", "donor_region": "global_mid",
                           "donor": reason, "detail": detail, "cells_filled": 0, "cells_masked": masked, "cells_total": total}
    except Exception as e:
        logger.error(f"[Coarse Fill] could not stamp the targeted no-fill on {model} ({type(e).__name__}: {e})")
        return product
    return out


async def _targeted_mid_fill(product, grid, store, model, layer_l, masked):
    """MARINE_GULF_FILL_MID_TARGETED=1 on the 2-deg global_mid: the same-layer GFS global_mid at the same valid time (within 3 h,
    as the coarse donor) is the donor, node for node, through the compact LRU donor. A missing or unreadable donor, or a lattice
    mismatch, serves the grid as stored WITH a stamp and a log line (_no_fill)."""
    vt = getattr(product, "valid_time", None) or getattr(product, "served_valid_time", None)
    errors = []
    item = _find_gfs_item(store, vt, layer_l, "global_mid", errors)
    if item is None:
        if errors:
            return _no_fill(product, model, layer_l, "manifest_unreadable", errors[0][:200], len(masked), len(grid.vectors))
        return _no_fill(product, model, layer_l, "missing", "no same-layer GFS global_mid within 3 h", len(masked), len(grid.vectors))
    try:
        donor = await asyncio.to_thread(_compact_donor, store, item)
    except Exception as e:      # a corrupt / truncated / refused donor: served as stored, stamped, counted, logged once
        return _no_fill(product, model, layer_l, "unreadable", f"{item.filename}: {type(e).__name__}: {e}"[:200],
                        len(masked), len(grid.vectors))
    why = _lattice_mismatch(product, grid, donor, masked)
    if why:
        return _no_fill(product, model, layer_l, "lattice_mismatch", why, len(masked), len(grid.vectors))
    _LAST_NO_FILL.pop((model, layer_l), None)
    vectors, filled = targeted_fill_vectors(grid.vectors, donor)
    if not filled:
        return product
    product = copy.copy(product)
    product.grid = copy.copy(grid)
    product.grid.vectors = vectors
    try:
        # filled_period: the donor's period travels with its height (dropping it would leave period=0.0 on a valid vector, the
        # 0b5182436 class). GFS's is the PEAK period (PERPW); ICON's own cells carry tm10, an energy period ~16% shorter (#412).
        product.coarse_fill = {"donor_model": "GFS", "layer": layer_l, "mode": "targeted", "donor_region": "global_mid",
                               "donor_product": item.filename, "filled_period": "GFS peak (PERPW), the donor's",
                               "cells_filled": filled, "cells_masked": len(masked), "cells_total": len(grid.vectors)}
    except Exception as e:
        logger.error(f"[Coarse Fill] PROVENANCE LOST: targeted fill substituted {filled} {layer_l} cells into {model} from GFS "
                     f"global_mid but could not stamp `coarse_fill` ({type(e).__name__}: {e}).")
    logger.info(f"[Coarse Fill] {model} global_mid {layer_l}: targeted {filled} of {len(masked)} masked cells from GFS global_mid")
    return product


def _find_gfs_item(store, valid_time, layer="waves", region_id="global_coarse", errors=None):
    """The manifest item of the GFS marine product for `layer` and `region_id` nearest `valid_time` (within 3 h), or None. No load.

    ⚠️ `layer` is a PARAMETER, not a constant, since 2026-08-01: the donor must carry the SAME
    quantity as the recipient. It defaults to `waves` so the pre-existing call shape is
    unchanged, and the name keeps `_waves` only because renaming a symbol has blast radius
    this repo has been bitten by (grep the OLD NAME)."""
    try:
        manifest = store.get_manifest()
        items = getattr(manifest, "products", None) or []
    except Exception as e:
        if errors is not None:
            errors.append(f"manifest unreadable: {type(e).__name__}: {e}")
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
        if getattr(p, "region_id", None) != region_id:
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
    return best


def _load_gfs_coarse_waves(store, valid_time, layer="waves", region_id="global_coarse"):
    """Find + load the GFS marine product for `layer` (global_coarse by default) nearest `valid_time` (_find_gfs_item)."""
    best = _find_gfs_item(store, valid_time, layer, region_id)
    return store.load_product(best.filename) if best is not None else None

