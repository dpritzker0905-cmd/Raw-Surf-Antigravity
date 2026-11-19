"""_coastal_band.py: WHICH 0.25 degree cells are the world coastal band, and a count of them on a model's own field.

WHY (owner, 2026-11-18: "Cover with agency data, start the coastal band"; D-082). 728 of 1,769 active spots have no
0.25 degree regional tile. They are answered from a 2 or 10 degree world grid, and where that sample is land-masked
the point path falls to Open-Meteo. The agencies' fetchers already decode the WHOLE world at 0.25 degrees on every
pass, so the cover is a matter of keeping the coastal cells. This module says which cells those are.

WHAT IT IS. A pure definition and a logging-only census. Nothing is stored, served or read from it yet.

  band cell   an OCEAN cell of the world 0.25 degree lattice with LAND within `width` cells of it (a square
              neighbourhood, longitude wrapping), between LAT_MIN and LAT_MAX. Land and ocean are the repo's own
              ETOPO grid (`weather_pipeline/data/etopo_depth_0p25.npy`, 0 == land), the grid `bathymetry` reads.
  lattice     ROWS x COLS = 721 x 1440; row r is latitude -90 + 0.25 r, column c is longitude -180 + 0.25 c.

THE WIDTH IS NOT DECIDED (advisor's red-team, item 5). ETOPO's coast is not a wave model's coast: some band cells are
land in a model and carry no value. `census` counts, on a model's own decoded field, the band cells with no value at
each candidate width, so the width is fixed from a number and not from the map.

A SIBLING OF THE FETCHERS. They are spawned by path, where `services` is not importable (see
tests/test_fetcher_script_imports.py), so they import this as `try: from _coastal_band ... except ImportError:
from services._coastal_band ...`. It imports nothing of the app.
Kill: COASTAL_BAND_CENSUS=0 (the fetcher then does no census work at all)."""
import os
import sys

import numpy as np

STEP = 0.25
ROWS, COLS = 721, 1440
LAT_MIN, LAT_MAX = -60.0, 72.0          # poleward of these the world grids keep answering
WIDTHS = (1, 2, 3)                      # candidate band widths in cells (about 28, 55 and 83 km at the equator)
CENSUS_FLAG = "COASTAL_BAND_CENSUS"
_NPY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "weather_pipeline", "data", "etopo_depth_0p25.npy")
_GRID_TOL_DEG = 0.01                    # a model grid further than this from the lattice is not a 0.25 degree grid


def lattice_lats():
    return -90.0 + STEP * np.arange(ROWS)


def lattice_lons():
    return -180.0 + STEP * np.arange(COLS)


def ocean_grid():
    """ETOPO ocean cells on the lattice (True = ocean). The file carries a duplicate +180 column; it is dropped."""
    depth = np.load(_NPY, mmap_mode="r")
    if depth.shape[0] != ROWS or depth.shape[1] < COLS:
        raise ValueError("etopo_depth_0p25.npy is %r, expected (%d, >=%d)" % (depth.shape, ROWS, COLS))
    return np.asarray(depth[:, :COLS]) > 0


def band_mask(width, ocean=None, lat_min=LAT_MIN, lat_max=LAT_MAX):
    """The band at `width` cells: ocean cells with land inside the (2*width+1) square, within the latitude limits.
    PURE given `ocean`. Longitude wraps; latitude does not (a pole is not next to the other pole)."""
    width = int(width)
    if width < 1:
        raise ValueError("width must be at least 1 cell")
    ocean = ocean_grid() if ocean is None else np.asarray(ocean, dtype=bool)
    land = ~ocean
    rows = land.shape[0]
    near = np.zeros_like(land)
    for dy in range(-width, width + 1):
        src = slice(max(0, -dy), rows - max(0, dy))          # rows that have a neighbour dy rows away
        dst = slice(max(0, dy), rows - max(0, -dy))
        for dx in range(-width, width + 1):
            near[dst] |= np.roll(land[src], dx, axis=1)
    band = ocean & near
    lats = -90.0 + STEP * np.arange(rows)
    band[(lats < lat_min) | (lats > lat_max), :] = False
    return band


def _nearest_index(axis, wanted):
    """For each wanted coordinate, the index of the nearest value on a model axis, and the worst distance."""
    axis = np.asarray(axis, dtype=float)
    idx = np.abs(axis[None, :] - np.asarray(wanted, dtype=float)[:, None]).argmin(axis=1)
    return idx, float(np.abs(axis[idx] - wanted).max())


def on_lattice(valid, lat1d, lon1d):
    """A model's 2-D `valid` mask (True = the model has a value) re-indexed onto the lattice, or None when the
    model grid is not this 0.25 degree lattice. Handles north-first rows and 0..360 longitudes. PURE."""
    valid = np.asarray(valid, dtype=bool)
    lon1d = np.asarray(lon1d, dtype=float)
    lons = lattice_lons()
    if lon1d.max() > 180.0:
        lons = lons % 360.0
    rmap, lat_err = _nearest_index(lat1d, lattice_lats())
    cmap, lon_err = _nearest_index(lon1d, lons)
    if lat_err > _GRID_TOL_DEG or lon_err > _GRID_TOL_DEG:
        return None
    return valid[np.ix_(rmap, cmap)]


def census(valid, lat1d, lon1d, widths=WIDTHS, ocean=None):
    """{width: (band cells, band cells where the model has NO value)} on a model's own field, or None when the grid
    is not the lattice. PURE given `ocean`. Counts only."""
    model_valid = on_lattice(valid, lat1d, lon1d)
    if model_valid is None:
        return None
    ocean = ocean_grid() if ocean is None else ocean
    out = {}
    for w in widths:
        band = band_mask(w, ocean=ocean)
        out[int(w)] = (int(band.sum()), int((band & ~model_valid).sum()))
    return out


def census_line(model, layer, result):
    """One log line. Counts and shares only: no coordinate, no value."""
    if result is None:
        return "[coastal-band census] %s %s: the field is not on the 0.25 degree lattice; nothing counted" % (model, layer)
    parts = ["width %d: %d cells, %d with no value (%.1f%%)" % (w, n, miss, 100.0 * miss / n if n else 0.0)
             for w, (n, miss) in sorted(result.items())]
    return "[coastal-band census] %s %s, band cells on the model's own field: %s" % (model, layer, "; ".join(parts))


def log_census(model, layer, field, lat1d, lon1d, stream=None):
    """Called once per fetch pass with one decoded 2-D field (NaN = no value). Writes one line to stderr (the
    fetcher's stdout is its JSON result). Never raises: a census fault must not cost a forecast pass."""
    if os.environ.get(CENSUS_FLAG, "1") == "0":
        return None
    try:
        line = census_line(model, layer, census(np.isfinite(np.asarray(field, dtype=float)), lat1d, lon1d))
    except Exception as exc:                                   # noqa: BLE001 - logging only
        line = "[coastal-band census] %s %s: skipped (%r)" % (model, layer, exc)
    (stream or sys.stderr).write(line + "\n")
    return line
