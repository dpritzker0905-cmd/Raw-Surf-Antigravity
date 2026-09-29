"""consensus_serve.py — THE serving switch for the equal-mean consensus (D-009's "one switch, instant rollback").

WHAT. With CONSENSUS_SERVE=1, every surface that serves GFS marine waves serves the equal GFS/EURO/ICON mean
instead: a GFS `regional_tile` frame is answered by its CONSENSUS shadow twin (consensus_ingest: same region, valid
time, run and grid), and a cell the three members could not all answer (`is_valid=False`, the shadow's
`unblended="mask"`) keeps GFS's own value. Default "0": nothing changes.

⭐ WHERE, AND WHERE NOT. The swap happens in a serving VIEW of the store, `ServedStore`, handed to the serving code
only: `routes.weather.store` (the default store of every PointResolutionService and ViewportService, and the store
/grid and /grid_series resolve with) and `spot_ratings_precompute._make_point_resolver` (the glyph precompute, the
buoy and report calibrations, the skill ledger). Selection is untouched (same candidates, tie-breaks and coverage
policy); only what a selected GFS frame LOADS as changes, so all seven serving load sites (point resolution,
the grid resolver's three, far-edge hold, dynamic supersession) move together and none can be missed.
  ⛔ NOT in `ProductStore.load_product`: ingest reads through it too. consensus_ingest builds the consensus from
  the GFS member loaded there, and the EURO-wind / ICON-marine extensions and lattice_fill anchor on GFS. Swapped
  there, the consensus would be rebuilt from itself. Ingest uses its own ProductStore
  (WeatherPipelineScheduler.store), so it never sees this view.

FRESHNESS. A twin must carry the SAME run as the GFS frame: a consensus of an older run next to a newer GFS is
stale, so that frame serves GFS until the pilots lane builds the new run's twin.

BASELINE (D-009). After the flip the primary ledger lane `raw_surf` scores what is served, the consensus. The raw
GFS stays measurable: `serve_raw()` makes a ServedStore answer raw, and the skill ledger runs a `GFS_RAW` lane under
it (forecast_skill.compare_models).

Flip: CONSENSUS_SERVE '1' in forecast-ingest.yml and precompute.yml (both write spot ratings and run the ledger)
AND the live service's env, together. Kill: '0' in all three.
"""
import contextvars
import logging
import os
import threading
from collections import OrderedDict
from contextlib import contextmanager
from typing import Dict, Optional

logger = logging.getLogger(__name__)

SERVE_FLAG = "CONSENSUS_SERVE"
_RAW = contextvars.ContextVar("consensus_serve_raw", default=False)


def enabled() -> bool:
    return os.environ.get(SERVE_FLAG, "0") == "1" and not _RAW.get()


@contextmanager
def serve_raw():
    """Inside, every ServedStore answers the raw product (the ledger's GFS_RAW baseline lane). Context-local, and
    asyncio.to_thread copies the context, so the loads a resolver runs in threads see it too."""
    token = _RAW.set(True)
    try:
        yield
    finally:
        _RAW.reset(token)


_index = None   # (products list object, length, {GFS filename: CONSENSUS manifest item})


def twin_index(manifest) -> Dict[str, object]:
    """{GFS marine waves regional_tile filename: its CONSENSUS twin}: same region, valid time and run. Keyed by the
    products list's identity plus its length (manifest_view's rule, for the same reasons)."""
    global _index
    from services.weather_pipeline.consensus_ingest import CONSENSUS_MODEL
    from services.weather_pipeline.manifest_view import products_for
    products = manifest.products
    cached = _index
    if cached is not None and cached[0] is products and cached[1] == len(products):
        return cached[2]
    twins = {}
    for c in products_for(manifest, CONSENSUS_MODEL, "marine", "waves"):
        if c.region_id:
            twins[(c.region_id, c.valid_time_start, c.run_time)] = c
    out = {}
    for g in products_for(manifest, "GFS", "marine", "waves"):
        if (g.coverage_mode or "") != "regional_tile" or not g.region_id:
            continue
        t = twins.get((g.region_id, g.valid_time_start, g.run_time))
        if t is not None:
            out[g.filename] = t
    _index = (products, len(products), out)
    return out


def merge(gfs, consensus):
    """The served frame: `gfs` with the consensus vector at every cell the consensus answered (valid) and GFS's own
    elsewhere, as a NEW product (the store hands out shallow copies; never mutate what it cached). None when the two
    grids are not the same grid, which the builder guarantees and this refuses to assume. PURE."""
    gg, cg = gfs.grid, consensus.grid
    if gg is None or cg is None or len(gg.vectors) != len(cg.vectors) or (gg.rows, gg.cols) != (cg.rows, cg.cols):
        return None
    if any(abs(a.lat - b.lat) > 1e-6 or abs(a.lng - b.lng) > 1e-6 for a, b in zip(gg.vectors, cg.vectors)):
        return None
    vectors = [c if c.is_valid else g for g, c in zip(gg.vectors, cg.vectors)]
    served_gfs = sum(1 for c in cg.vectors if not c.is_valid)
    diagnostics = dict(gg.diagnostics or {})
    diagnostics["served_consensus"] = {"twin_product": consensus.product_id, "cells": len(vectors),
                                       "cells_served_gfs": served_gfs}
    grid = gg.model_copy(update={"vectors": vectors, "diagnostics": diagnostics})
    return gfs.model_copy(update={"grid": grid, "upstream_model": consensus.upstream_model,
                                  "source_dataset": consensus.source_dataset})


MERGED_CACHE_MAX = 64   # merged frames kept; a spot hub resolves ~22 points against a handful of frames


class ServedStore:
    """A serving view of a ProductStore: every attribute is the store's own, except `load_product`, which answers a
    GFS regional waves frame with its merged consensus twin while CONSENSUS_SERVE is on (module docstring).

    Attribute WRITES go to the store (code and tests that set e.g. `cache_dir` must reach it), except the view's own
    names: a test that monkeypatches `load_product` replaces the view's, and its undo cannot loop back into itself.
    Merged frames are cached (filenames are immutable per run) and each caller gets a shallow copy, as the store's
    own cache hands out."""
    _OWN = frozenset({"load_product"})

    def __init__(self, store):
        object.__setattr__(self, "_raw", store)
        object.__setattr__(self, "_merged", OrderedDict())
        object.__setattr__(self, "_lock", threading.Lock())

    @property
    def raw(self):
        return self._raw

    def __getattr__(self, name):
        return getattr(self._raw, name)

    def __setattr__(self, name, value):
        if name in self._OWN:
            object.__setattr__(self, name, value)
        else:
            setattr(self._raw, name, value)

    def __delattr__(self, name):
        if name in self._OWN:
            object.__delattr__(self, name)
        else:
            delattr(self._raw, name)

    def load_product(self, filename: str, stride: Optional[int] = None):
        kw = {} if stride is None else {"stride": stride}
        product = self._raw.load_product(filename, **kw)
        if product is None or not enabled() or (product.model or "").upper() != "GFS" or product.layer != "waves":
            return product
        try:
            twin = twin_index(self._raw.get_manifest()).get(filename)
            if twin is None:
                return product
            key = (filename, twin.filename, stride)
            with self._lock:
                hit = self._merged.get(key)
                if hit is not None:
                    self._merged.move_to_end(key)
                    return hit.model_copy()
            consensus = self._raw.load_product(twin.filename, **kw)
            served = merge(product, consensus) if consensus is not None else None
        except Exception as e:           # a serving view must never cost the frame it wraps
            logger.warning("[consensus-serve] %s: serving GFS (%s)", filename, e)
            return product
        if served is None:
            return product
        with self._lock:
            self._merged[key] = served
            while len(self._merged) > MERGED_CACHE_MAX:
                self._merged.popitem(last=False)
        return served.model_copy()


def served_store(store):
    """The serving view of `store` (idempotent)."""
    return store if isinstance(store, ServedStore) else ServedStore(store)
