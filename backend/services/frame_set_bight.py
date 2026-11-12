"""GFS waves static frames with the SoCal Bight composition baked in (Fable audit SRV-2, 2026-11-10).

WHY. `/grid`, `/grid_series` and `/point` serve GFS marine waves through the serving view
(`consensus_serve.ServedStore.load_product`), which applies SURF_BIGHT_HS_CONSENSUS (ON since 2026-11-04): inside the frozen
Bight polygon the served Hs is the GFS+EURO mean (`bight_hs_consensus.compose`). The static frame publisher read the RAW
stored products, and both client static paths default ON (`staticFrames.js`, `staticRegional.js`), so the map wash in the
Bight was raw GFS while the infobox, glyphs and /grid said the mean: 120 nodes on the 0.25 deg SoCal lattice, 2 on the
2 deg world lattice (research: +0.077 m mean Hs). The 2026-11-03 log called the static path "dark"; it was not.

WHAT. Exactly as `frame_set_fill.py` bakes the targeted Gulf fill: a GFS waves frame whose grid touches the Bight is run
through the SAME `bight_hs_consensus.compose` the serving view runs, with the SAME EURO chooser (`euro_chooser`: the point
resolver's own selection, authoritative EURO only), reading EURO from this runner's disk. So the frame equals what /grid
serves node for node, and the publisher's own parity gate (`frame_set.build_frame`) then checks the quantised frame against
that composed product.

IDENTITY. For an entry whose coverage touches the Bight box (and only those: every other set's identities are unchanged),
the frame's source identity carries the polygon version and the EURO candidates for that valid time (filename + run), read
from the manifest alone, so a new EURO run rebuilds the frame and an unchanged one is carried.

REFUSALS (the frame is listed unbuilt and the client asks /grid for that hour, which composes it correctly):
  * a EURO file the chooser picks is not on this runner's disk, or the disk copy is not the run the manifest names;
  * CONSENSUS_SERVE is on (the view then serves the consensus twin, which this publisher does not build);
  * compose itself raises.
Never a half-composed frame. With SURF_BIGHT_HS_CONSENSUS off this module is a no-op and the publisher is unchanged.
"""
from __future__ import annotations

import json
import os
from typing import Callable, Optional

from services.weather_pipeline import bight_hs_consensus as bight


def applies(target, entry) -> bool:
    """A GFS marine waves entry whose coverage touches the Bight box, with the composition on. Publisher-only kill:
    FRAME_BIGHT_BAKE=0 (today's raw frames; /grid keeps its blend, so the two disagree again in the Bight)."""
    if os.environ.get("FRAME_BIGHT_BAKE", "1") == "0":
        return False
    if (target or {}).get("model") != "GFS" or target.get("domain") != "marine" or target.get("layer") != "waves":
        return False
    cov = (entry or {}).get("coverage") or {}
    try:
        south, north, west, east = bight.BIGHT_BBOX
        touches = (float(cov["south"]) <= north and float(cov["north"]) >= south
                   and float(cov["west"]) <= east and float(cov["east"]) >= west)
    except (KeyError, TypeError, ValueError):
        return False
    return touches and bight.enabled()


class ManifestView:
    """The runner manifest's products as the models `manifest_point_selection` reads, built once per publish."""

    def __init__(self, products):
        from services.weather_pipeline.schemas import ManifestProduct
        items = []
        for p in products or []:
            if isinstance(p, dict) and (p.get("model") or "").upper() == "EURO":
                try:
                    items.append(ManifestProduct.model_validate(p))
                except Exception:
                    continue
        self.products = items
        self._by_name = {p.filename: p for p in items}

    def entry(self, filename):
        return self._by_name.get(filename)


def _vt(valid_time):
    from datetime import datetime, timezone
    t = datetime.fromisoformat(str(valid_time).replace("Z", "+00:00"))
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def identity(view: ManifestView, valid_time) -> dict:
    """The Bight part of a frame's source identity: polygon version, weight and the authoritative EURO waves candidates whose
    coverage touches the Bight box at this valid time (filename + run), all from the manifest."""
    from services.weather_pipeline.manifest_point_selection import point_candidates
    south, north, west, east = bight.BIGHT_BBOX
    auth, _ = point_candidates(view, "EURO", "marine", "waves", _vt(valid_time))
    euro = sorted({(p.filename, p.run_time.isoformat() if p.run_time else None) for p, _d, b in auth
                   if b is None or (b.south <= north and b.north >= south and b.west <= east and b.east >= west)})
    return {"polygon": bight.POLYGON_VERSION, "euro_weight": bight.euro_weight(), "euro": [list(e) for e in euro]}


def dependency_reader(source) -> Callable[[str], Optional[bytes]]:
    """The runner's disk, then (when the source can: publish_frame_images.TailDownloads under FRAME_TAIL_DOWNLOAD, the one
    bounded egress exception, cap shared with the tails) the stored product from the bucket. The EURO global_mid frames
    the Bight cells read are the core lane's, never on the pilots runner's disk."""
    fetch = getattr(source, "fetch_dependency", None)

    def read(filename):
        raw = source.product_bytes(filename)
        return raw if raw is not None or fetch is None else fetch(filename)
    return read


def bake(product: dict, view: ManifestView, product_bytes: Callable[[str], Optional[bytes]]):
    """(product dict as /grid serves it, blended cell count). The stored dict is returned unchanged when no cell blends.
    Raises ValueError for every refusal in the module docstring."""
    from services.weather_pipeline import consensus_serve
    from services.weather_pipeline.schemas import NormalizedProduct
    if consensus_serve.enabled():
        raise ValueError("CONSENSUS_SERVE is on: the view serves the consensus twin, which this publisher does not build")
    gfs = NormalizedProduct.model_validate(product)
    cells = bight.bight_cells(gfs)
    if not cells:
        return product, 0

    def load(filename):
        raw = product_bytes(filename)
        if raw is None:
            raise ValueError(f"EURO {filename} is not on this runner's disk")
        euro = NormalizedProduct.model_validate(json.loads(raw))
        named = view.entry(filename)
        if named is None or (named.run_time and euro.run_time and euro.run_time != named.run_time):
            raise ValueError(f"EURO {filename} on disk is not the run its manifest entry names")
        return euro

    choose = bight.euro_chooser(view, gfs.valid_time, load, {})
    composed = bight.compose(gfs, choose, cells)
    if composed is None:
        return product, 0
    return composed.model_dump(mode="json"), composed.grid.diagnostics["bight_hs_consensus"]["cells"]["blended"]
