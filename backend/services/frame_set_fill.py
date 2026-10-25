"""EURO / ICON world frames with the TARGETED Gulf fill baked in (2026-10-24, after D-050 switched it on).

WHY: a world /grid of EURO or ICON marine is not the stored product. The route runs coarse_gulf_fill on every grid whose served
span is 350 deg or more, so the client's world-fill guard (staticWorldFillGuard.js) sends those world boxes to /grid, and the EURO
toggle waits ~1 s on the box. Viewport crops (span < 350) get no fill, and their static frames stay as they are.

WHAT: a second world set per EURO/ICON marine layer, `<model>/marine/<layer>/global_mid_filled`, built from the SAME stored
products as `global_mid` with the SAME code /grid runs: coarse_gulf_fill.targeted_fill_vectors over a coarse_gulf_fill._CompactDonor
built from the same-layer GFS global_mid product nearest the frame's valid time (coarse_gulf_fill._find_gfs_item, within 3 h),
the lattice checked by coarse_gulf_fill._lattice_mismatch, and the frame's `coarse_fill` meta stamped exactly as
_targeted_mid_fill stamps the /grid response. A SEPARATE set, not a rewrite of `global_mid`: the crops cut from `global_mid` must stay
unfilled, as /grid serves them, and a separate key keeps them apart in every client cache with no un-fill step.

ONLY THE TARGETED MODE IS BAKED. The publisher reads the mode as the box does (coarse_gulf_fill.gulf_fill_mid_mode: the pilots
workflow passes MARINE_GULF_FILL_MID and MARINE_GULF_FILL_MID_TARGETED from the repository variables). In "legacy" or "off" it
publishes no filled set, and the latest.json record of each set carries `fill_mode`, so the client serves these frames only while
/capabilities reports the same mode (gulf_fill_mid_mode, EURO/ICON marine rows). Any other combination keeps today's /grid path.

DONOR IDENTITY is part of each frame's source identity (`fill_donor`: the GFS file, its model run, run time and ingested_at), so a
new GFS run rebuilds the frames whose donor changed. A frame whose donor is not on this runner's disk, or whose donor's run is not
the one its manifest names, is listed unbuilt (the client asks /grid for that hour): an unfilled frame is never published here.

KNOWN GAP (the same one every world set has): the box and the runner can hold different GFS runs for a while after an ingest; the
frame then carries the runner's donor run. The client pins one index per scrub session either way.
"""
from __future__ import annotations

import json
from types import SimpleNamespace

from services.weather_pipeline import coarse_gulf_fill as cgf

VARIANT = "filled"
FILLED_SETS = tuple({"model": m, "domain": "marine", "layer": l, "region_id": "global_mid", "variant": VARIANT} for m, l in (
    ("ICON", "waves"), ("EURO", "waves"), ("ICON", "swell_1"), ("ICON", "wind_waves"),
))


def is_filled(target):
    return (target or {}).get("variant") == VARIANT


def publish_mode():
    """The mode the box serves the 2-deg world grid in, read the way the box reads it (env at call time)."""
    return cgf.gulf_fill_mid_mode()


class _ManifestStore:
    """coarse_gulf_fill._find_gfs_item's store: a get_manifest() whose items carry attributes. The runner's manifest is dicts."""

    def __init__(self, products):
        self._items = [SimpleNamespace(**p) for p in products or [] if isinstance(p, dict)]

    def get_manifest(self):
        return SimpleNamespace(products=self._items)


def donor_entry(products, valid_time, layer, store=None):
    """The manifest entry (dict) of the same-layer GFS global_mid product /grid would take as the donor at `valid_time`, or None."""
    store = store or _ManifestStore(products)
    item = cgf._find_gfs_item(store, valid_time, layer, "global_mid")
    return dict(vars(item)) if item is not None else None


def donor_identity(entry):
    if not entry:
        return None
    return {k: entry.get(k) for k in ("filename", "model_run_time", "run_time", "ingested_at")}


def _ns(vectors):
    return [SimpleNamespace(**v) for v in vectors]


def apply_fill(product, donor_entry_, donor_bytes, layer):
    """The product with the targeted fill applied as /grid applies it, or raise ValueError (the frame is then listed unbuilt).

    `product` is the stored product JSON (dict); it is not modified. Returns (new product dict, cells filled)."""
    if donor_bytes is None:
        raise ValueError(f"donor {donor_entry_['filename']} is not on this runner's disk")
    data = json.loads(donor_bytes)
    if not cgf._same_run(SimpleNamespace(**donor_entry_), data):
        raise ValueError(f"donor {donor_entry_['filename']} on disk is not the run its manifest entry names")
    g = data.get("grid") or {}
    donor = cgf._CompactDonor(donor_entry_["filename"], g.get("vectors") or [], g.get("cols"), g.get("rows"),
                              donor_entry_.get("resolution") or data.get("resolution"))
    if not donor.has_sea():
        raise ValueError(f"donor {donor_entry_['filename']} has no sea node")
    grid = product.get("grid") or {}
    vectors = _ns(grid.get("vectors") or [])
    masked = [i for i, v in enumerate(vectors) if cgf._is_masked(v)]
    out = dict(product, grid=dict(grid))
    if not masked:
        return out, 0
    why = cgf._lattice_mismatch(SimpleNamespace(resolution=product.get("resolution")), SimpleNamespace(vectors=vectors), donor, masked)
    if why:
        raise ValueError(f"lattice mismatch: {why}")
    filled_vectors, filled = cgf.targeted_fill_vectors(vectors, donor)
    if not filled:
        return out, 0                       # /grid returns the product unchanged (no stamp) when nothing is filled
    out["grid"]["vectors"] = [dict(vars(v)) for v in filled_vectors]
    out["coarse_fill"] = cgf._with_filled_idx(
        {"donor_model": "GFS", "layer": layer, "mode": "targeted", "donor_region": "global_mid",
         "donor_product": donor_entry_["filename"], "filled_period": "GFS peak (PERPW), the donor's",
         "cells_filled": filled, "cells_masked": len(masked), "cells_total": len(vectors)},
        [i for i in masked if filled_vectors[i] is not vectors[i]])
    return out, filled
