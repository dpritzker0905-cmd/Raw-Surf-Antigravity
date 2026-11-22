"""Raster sets that live in their own modules (2026-11-22): one place that loads them, so frame_set_raster.py (at its 800-line
cap) needs a single import and a single source-kind lookup however many ocean sets join.

Each module here has `register(specs, grids[, sources])`, which adds its SPECS entry (and lattice), and names the source class
for its spec's "source" kind. Today: Copernicus currents + water temperature (frame_set_raster_currents / _sst, G4) and
Canada GIOPS currents under the ICON picker (frame_set_raster_giops), and the native 1/12-degree Copernicus currents on the
surf boxes (frame_set_raster_currents_native, dark). NOAA RTOFS under the GFS picker joins the same way:
one import on each branch below and one line in register().

Imports follow the sibling-import rule (CLAUDE.md; tests/test_fetcher_script_imports.py): a package import first, the bare
module when run by path, where `services` is not importable.
"""
from __future__ import annotations

try:
    from services import frame_set_raster_currents_native as _native
    from services import frame_set_raster_giops as _giops
    from services import frame_set_raster_sst as _sst
except ImportError:  # pragma: no cover - run by path (fetcher subprocess)
    import frame_set_raster_currents_native as _native
    import frame_set_raster_giops as _giops
    import frame_set_raster_sst as _sst

# source kind -> source class (frame_set_raster.make_source); register() adds each module's own kinds.
SOURCES = {"cmems_currents": _sst.CmemsCurrentsSource, "cmems_sst": _sst.CmemsSstSource}


def register(specs, grids):
    """Add every own-module set to frame_set_raster's SPECS / GRIDS, and their source kinds to SOURCES."""
    _sst.register(specs, grids)
    _giops.register(specs, grids, SOURCES)
    _native.register(specs, grids, SOURCES)
    return SOURCES
