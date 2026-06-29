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
import math
import threading
from functools import lru_cache
from typing import Optional

# Water deeper than this is treated as "off the shelf" (the shelf break is ~150-200 m worldwide). Used to
# measure shelf WIDTH = how far swell crosses the dissipative shelf before it reaches the surf zone.
SHELF_BREAK_DEPTH_M = 200.0
_KM_PER_DEG = 111.0

_DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
_NPY = os.path.join(_DATA_DIR, "etopo_depth_0p25.npy")
_META = os.path.join(_DATA_DIR, "etopo_depth_0p25.meta.json")

# Optional FINER bed-slope asset (built by build_bathymetry_asset.py --slope from a finer ETOPO stride). Absent
# by default → bed_slope_at returns None → the Iribarren breaker-type rating factor stays neutral (we do NOT
# derive slope from the coarse 0.25° depth — a 28 km baseline is shelf-scale and would misclassify breaker type).
_SLOPE_NPY = os.path.join(_DATA_DIR, "etopo_slope_0p1.npy")
_SLOPE_META = os.path.join(_DATA_DIR, "etopo_slope_0p1.meta.json")
_SLOPE_SCALE = 10000.0   # int16 storage: slope (m/m) × 1e4 (so 0..3.2767 m/m fits int16)

_lock = threading.Lock()
_grid = None
_meta = None
_slope_grid = None
_slope_meta = None
_slope_missing = False


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


@lru_cache(maxsize=200_000)
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


@lru_cache(maxsize=200_000)
def is_coastal(lat: float, lng: float, radius_cells: int = 3) -> bool:
    """True if there is LAND **and** open ocean within ~radius_cells (~0.25° each ≈ ±0.75° at the default 3)
    of (lat, lng) — i.e. a shoreline for waves to break on.

    Surf (a breaking wave) is a COASTLINE property: it only exists where swell meets a shore. An open-ocean
    point carries swell but has no surf. This check is GEOGRAPHY ONLY (model-independent), so every forecast
    model agrees which points are surfable — that's what makes the infobox surf row consistent across
    GFS/EURO/ICON. Steep coasts whose nearest 0.25° wet cell is deep (e.g. Oahu) still register as coastal
    because land is in the window even though the depth is large.

    Fail-OPEN (returns True) if the bundled bathymetry grid is unavailable, so surf is never silently
    suppressed when we simply can't tell."""
    if not is_available():
        return True
    try:
        import numpy as np
        grid, meta = _load()
    except Exception:
        return True
    nlat, nlon = meta["nlat"], meta["nlon"]
    lat0, lon0, dlat, dlon = meta["lat0"], meta["lon0"], meta["dlat"], meta["dlon"]
    lng = ((float(lng) + 180.0) % 360.0) - 180.0
    r = int(round((float(lat) - lat0) / dlat))
    c = int(round((lng - lon0) / dlon))
    if r < 0 or r >= nlat or c < 0 or c >= nlon:
        return False
    r0, r1 = max(0, r - radius_cells), min(nlat, r + radius_cells + 1)
    c0, c1 = max(0, c - radius_cells), min(nlon, c + radius_cells + 1)
    sub = np.asarray(grid[r0:r1, c0:c1])
    has_land = bool((sub <= 0).any())     # land / no-depth cells are <= 0 (ocean depth is positive-down)
    has_ocean = bool((sub > 0).any())
    return has_land and has_ocean


@lru_cache(maxsize=200_000)
def shelf_width_km(lat: float, lng: float, max_cells: int = 8) -> float:
    """Approx distance (km) from (lat, lng) to the SHELF BREAK — the nearest water deeper than
    SHELF_BREAK_DEPTH_M. This is a proxy for how far swell crosses the dissipative shelf before it reaches
    the surf zone, which is THE control on bottom-friction energy loss: a wide gentle shelf (Florida ~100 km)
    bleeds far more energy than a narrow steep one (Hawaii ~few km) [Kurian 1987; Ardhuin 2003].

    Returns 0.0 if the point's own cell is already deep (steep drop-off — no shelf to cross), or
    ``max_cells * ~28 km`` if no deep water is found within the search (a very wide shelf / shallow sea).
    Returns 0.0 if the grid is unavailable (caller then applies no shelf friction)."""
    if not is_available():
        return 0.0
    try:
        grid, meta = _load()
    except Exception:
        return 0.0
    nlat, nlon = meta["nlat"], meta["nlon"]
    lat0, lon0, dlat, dlon = meta["lat0"], meta["lon0"], meta["dlat"], meta["dlon"]
    lng = ((float(lng) + 180.0) % 360.0) - 180.0
    r = int(round((float(lat) - lat0) / dlat))
    c = int(round((lng - lon0) / dlon))
    if r < 0 or r >= nlat or c < 0 or c >= nlon:
        return 0.0
    if int(grid[r, c]) > SHELF_BREAK_DEPTH_M:
        return 0.0                                   # already off the shelf -> steep drop-off
    km_lat = dlat * _KM_PER_DEG
    km_lng = dlon * _KM_PER_DEG * math.cos(math.radians(float(lat)))
    best = None
    for rad in range(1, max_cells + 1):
        for dr in range(-rad, rad + 1):
            for dc in range(-rad, rad + 1):
                if max(abs(dr), abs(dc)) != rad:     # only the new ring at this radius
                    continue
                rr, cc = r + dr, c + dc
                if rr < 0 or rr >= nlat or cc < 0 or cc >= nlon:
                    continue
                if int(grid[rr, cc]) > SHELF_BREAK_DEPTH_M:
                    dist = math.hypot(dr * km_lat, dc * km_lng)
                    if best is None or dist < best:
                        best = dist
        if best is not None:
            return float(best)
    return float(max_cells * km_lat)                  # no deep water within search -> very wide shelf


def _seaward_bearing(sub, dlat, dlon):
    """Pure: seaward compass bearing (deg, 0=N, 90=E) from a 2D depth window (ocean depth > 0, land <= 0),
    as the vector from the land centroid to the ocean centroid (i.e. land -> sea). Returns None if the
    window is all-ocean or all-land (no shoreline in view) or the centroids coincide. ``dlat``/``dlon`` give
    the grid's row/col orientation (ETOPO is stored north-down, so dlat < 0)."""
    import numpy as np
    ocean_mask = sub > 0
    n_ocean = int(ocean_mask.sum())
    if n_ocean == 0 or n_ocean == sub.size:
        return None
    rows, cols = np.indices(sub.shape)
    land_mask = ~ocean_mask
    d_row = float(rows[ocean_mask].mean() - rows[land_mask].mean())
    d_col = float(cols[ocean_mask].mean() - cols[land_mask].mean())
    north = d_row * (1.0 if dlat > 0 else -1.0)       # +row is +lat only when dlat > 0
    east = d_col * (1.0 if dlon > 0 else -1.0)         # +col is +lng only when dlon > 0
    if east == 0.0 and north == 0.0:
        return None
    return math.degrees(math.atan2(east, north)) % 360.0


def _load_slope():
    """Lazy-load the optional finer slope asset. Sets _slope_missing so we only stat the disk once."""
    global _slope_grid, _slope_meta, _slope_missing
    if _slope_grid is None and not _slope_missing:
        with _lock:
            if _slope_grid is None and not _slope_missing:
                if not (os.path.exists(_SLOPE_NPY) and os.path.exists(_SLOPE_META)):
                    _slope_missing = True
                    return None, None
                import numpy as np
                with open(_SLOPE_META) as f:
                    _slope_meta = json.load(f)
                _slope_grid = np.load(_SLOPE_NPY, mmap_mode="r")
    return _slope_grid, _slope_meta


def slope_available() -> bool:
    """True if the finer bed-slope asset is bundled (so the breaker-type rating factor can activate)."""
    grid, _ = _load_slope()
    return grid is not None


@lru_cache(maxsize=200_000)
def bed_slope_at(lat: float, lng: float) -> Optional[float]:
    """Nearshore bed SLOPE (rise/run, m/m) at a coastal point, for the Iribarren breaker-type factor. Reads the
    FINER slope asset only — returns None when it's absent (the breaker-type factor then stays neutral). We
    deliberately do NOT fall back to the coarse 0.25° depth grid: a 28 km baseline slope is shelf-scale, not the
    surf-zone beach slope the Iribarren needs, and would systematically misclassify breaker type."""
    grid, meta = _load_slope()
    if grid is None or meta is None:
        return None
    nlat, nlon = meta["nlat"], meta["nlon"]
    lat0, lon0, dlat, dlon = meta["lat0"], meta["lon0"], meta["dlat"], meta["dlon"]
    lng = ((float(lng) + 180.0) % 360.0) - 180.0
    r = int(round((float(lat) - lat0) / dlat))
    c = int(round((lng - lon0) / dlon))
    if r < 0 or r >= nlat or c < 0 or c >= nlon:
        return None
    v = int(grid[r, c])
    if v <= 0:
        # exact cell has no slope (land/no-data) → nearest cell with a slope in a small window (coastal offset)
        best = 0
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                rr, cc = r + dr, c + dc
                if 0 <= rr < nlat and 0 <= cc < nlon:
                    vv = int(grid[rr, cc])
                    if vv > best:
                        best = vv
        v = best
    return (v / _SLOPE_SCALE) if v > 0 else None


@lru_cache(maxsize=200_000)
def shore_normal_at(lat: float, lng: float, window_cells: int = 3) -> Optional[float]:
    """Seaward bearing (deg, 0=N, 90=E) at a coastal point — the direction pointing OUT TO SEA (toward ocean,
    away from land), from the land/ocean centroid vector in a ~±window_cells window. Drives offshore-vs-onshore
    wind in the surf-quality rating ([[surf_rating]]). Returns None if there's no shoreline in the window
    (all ocean / all land) or the grid is unavailable (rating then grades wind on speed alone)."""
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
    return _seaward_bearing(sub, dlat, dlon)
