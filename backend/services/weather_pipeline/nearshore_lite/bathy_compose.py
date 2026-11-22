"""Compose the finest source covering a target's ray domain into one MSL depth grid, and tag its stratum.

Rule (gate section 1): the finest source covering the whole ray domain is used. Priority CUDEM > CRM > EMODNET >
GEBCO, cell by cell on a common grid (resampling is the offline fetch step's job, so every input here is already an
MSL depth grid on the SAME grid, NaN where the source has no data). A target that needs GEBCO anywhere within
COARSE_RADIUS_M of itself is COARSE; every other target is FINE. Strata are fixed at freeze.
"""
import numpy as np

PRIORITY = ("CUDEM", "CRM", "EMODNET", "GEBCO")
COARSE_RADIUS_M = 5000.0
FINE, COARSE = "FINE", "COARSE"


def compose(sources_msl, dx_m, target_xy):
    """sources_msl: {name: 2-D MSL depth array (NaN = no data)} on one grid with spacing dx_m, origin (0, 0).
    Returns (depth, source_index_grid, names_used, stratum). `source_index_grid` indexes PRIORITY (-1 = no data)."""
    names = [n for n in PRIORITY if n in sources_msl]
    if not names:
        raise ValueError("no bathymetry sources supplied")
    shape = sources_msl[names[0]].shape
    depth = np.full(shape, np.nan)
    which = np.full(shape, -1, dtype=np.int8)
    for name in names:
        g = np.asarray(sources_msl[name], dtype=float)
        if g.shape != shape:
            raise ValueError(f"{name}: grid shape {g.shape} != {shape}")
        fill = ~np.isfinite(depth) & np.isfinite(g)
        depth[fill] = g[fill]
        which[fill] = PRIORITY.index(name)
    return depth, which, names, stratum(which, dx_m, target_xy)


def stratum(which, dx_m, target_xy, radius_m=COARSE_RADIUS_M):
    """COARSE when any GEBCO-sourced cell lies within `radius_m` of the target, else FINE."""
    ny, nx = which.shape
    xt, yt = target_xy
    cx, cy = xt / dx_m, yt / dx_m
    r = radius_m / dx_m
    y0, y1 = max(0, int(np.floor(cy - r))), min(ny, int(np.ceil(cy + r)) + 1)
    x0, x1 = max(0, int(np.floor(cx - r))), min(nx, int(np.ceil(cx + r)) + 1)
    yy, xx = np.mgrid[y0:y1, x0:x1]
    near = (yy - cy) ** 2 + (xx - cx) ** 2 <= r * r
    sub = which[y0:y1, x0:x1]
    return COARSE if bool(np.any((sub == PRIORITY.index("GEBCO")) & near)) else FINE
