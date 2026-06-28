"""
bathymetry.py — in-process seafloor-depth sampler for the Option-2 surf transform.

Loads the bundled 0.25° ETOPO1 depth grid (services/weather_pipeline/data/etopo_depth_0p25.npy, built once
by scripts/build_bathymetry_asset.py) ONCE into memory and samples ocean depth at any (lat, lng). No runtime
download — safe on the serve-only box. The grid is ~2 MB int16; load is lazy + cached at module level.

depth_at() prefers the nearest OCEAN cell within a small window when the exact cell is land/no-depth, so a
coastal click returns the shelf depth just offshore (the depth the swell actually crosses) rather than None.
"""
import os
import json
import threading
from typing import Optional

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_NPY = os.path.join(_DATA_DIR, "etopo_depth_0p25.npy")
_META = os.path.join(_DATA_DIR, "etopo_depth_0p25.meta.json")

_lock = threading.Lock()
_grid = None
_meta = None


def _load():
    global _grid, _meta
    if _grid is None:
        with _lock:
            if _grid is None:
                import numpy as np
                with open(_META) as f:
                    _meta = json.load(f)
                _grid = np.load(_NPY, mmap_mode="r")  # memory-map: no full copy held resident
    return _grid, _meta


def is_available() -> bool:
    """True if the bundled depth grid exists (so callers can no-op gracefully if it's absent)."""
    return os.path.exists(_NPY) and os.path.exists(_META)


def depth_at(lat: float, lng: float, search_cells: int = 4) -> Optional[float]:
    """Ocean depth in metres (positive down) at (lat, lng). If the exact 0.25° cell is land/no-depth, return
    the nearest OCEAN cell's depth within ``search_cells`` (the adjacent shelf). Returns None if there is no
    ocean within the window (genuinely inland) or the grid is unavailable."""
    if not is_available():
        return None
    try:
        grid, meta = _load()
    except Exception:
        return None
    nlat, nlon = meta["nlat"], meta["nlon"]
    lat0, lon0, dlat, dlon = meta["lat0"], meta["lon0"], meta["dlat"], meta["dlon"]
    lng = ((float(lng) + 180.0) % 360.0) - 180.0           # normalise to [-180, 180)
    r = int(round((float(lat) - lat0) / dlat))
    c = int(round((lng - lon0) / dlon))
    if r < 0 or r >= nlat or c < 0 or c >= nlon:
        return None
    d = int(grid[r, c])
    if d > 0:
        return float(d)
    # exact cell is land/no-depth -> nearest ocean cell in the window (the shelf just offshore)
    best = None
    best_d2 = None
    for dr in range(-search_cells, search_cells + 1):
        rr = r + dr
        if rr < 0 or rr >= nlat:
            continue
        for dc in range(-search_cells, search_cells + 1):
            cc = c + dc
            if cc < 0 or cc >= nlon:
                continue
            v = int(grid[rr, cc])
            if v > 0:
                dd = dr * dr + dc * dc
                if best is None or dd < best_d2:
                    best, best_d2 = v, dd
    return float(best) if best is not None else None


def shelf_depth_at(lat: float, lng: float, window_cells: int = 2) -> Optional[float]:
    """Representative SHELF depth (m) for the surf transform: the MEDIAN ocean depth in a small window
    (~±0.5° at window_cells=2) around (lat, lng). This distinguishes a WIDE shallow shelf (window stays
    shallow -> swell crosses lots of shallow water -> strong friction, e.g. Florida) from a STEEP shelf
    (window includes the deep water just offshore -> median deep -> little friction, e.g. Mavericks/Nazaré),
    which a single nearest-ocean cell cannot tell apart at 0.25°. Returns None if no ocean in the window."""
    if not is_available():
        return None
    try:
        import numpy as np
        grid, meta = _load()
    except Exception:
        return None
    nlat, nlon = meta["nlat"], meta["nlon"]
    lat0, lon0, dlat, dlon = meta["lat0"], meta["lon0"], meta["dlat"], meta["dlon"]
    lng = ((float(lng) + 180.0) % 360.0) - 180.0
    r = int(round((float(lat) - lat0) / dlat))
    c = int(round((lng - lon0) / dlon))
    if r < 0 or r >= nlat or c < 0 or c >= nlon:
        return None
    r0, r1 = max(0, r - window_cells), min(nlat, r + window_cells + 1)
    c0, c1 = max(0, c - window_cells), min(nlon, c + window_cells + 1)
    sub = np.asarray(grid[r0:r1, c0:c1])
    ocean = sub[sub > 0]
    if ocean.size == 0:
        return None
    return float(np.median(ocean))
