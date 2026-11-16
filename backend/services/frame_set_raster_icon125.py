"""ICON on the 0.125-degree lattice by a supersampled area mean (G2, 2026-11-16; the owner, 22:13 EST 11-15, via the director).

WHY. ICON global's cells are ~13 km; Open-Meteo's `dwd_icon` and DWD's own regular-grid products are 0.125 degree, both by
NEAREST cell (DWD's official CDO weights `ICON_GLOBAL2WORLD_0125_EASY`, read 2026-11-16: map_method "Nearest neighbor", one
link per target point). Our ICON precipitation set was a 0.25-degree box mean of the cells whose centres fall in each box:
mass kept to ~1 %, cell peaks 19-26 % low (log/2026-11-13-fable-precip-icon.md). At 0.125 degree that centre assignment leaves
boxes EMPTY (about 1.1 cells per box at the equator, 0.55 at 60N), and an empty box was filled along its row: neither
conservative nor sharp (log/2026-11-16-opus-icon-precip-0p125-cloud-temp.md, the design risk named before building).

WHAT. Each 0.125-degree box is split into k x k sub-points; each sub-point takes the native cell NEAREST it on the unit sphere;
the box value is the mean over its sub-points. A box then takes each cell in proportion to the share of the box that cell covers
(approximately: nearest-centre regions stand for ICON's triangles), so no box is empty and a shower filling a box keeps its value.
The nearest cell of a sub-point is searched among the cells whose centres lie in the 3 x 3 boxes around it plus those nodes'
nearest cells, read from DWD's own nearest-neighbour map (no KD-tree, no new dependency).
DWD's map has 2879 columns (it stops at 179.75E); our lattice has the
full 2880 (179.875E is computed from its two neighbouring columns), so the frame wraps the globe like every other set.
The pick map depends only on the grid (R3B7, grid 0026, unchanged since 2017): built once per publish, then each hour is a
gather and a mean.
"""
from __future__ import annotations

import io
import tarfile

ROWS, COLS, STEP = 1441, 2880, 0.125                        # the lattice: lat -90..90, lon -180..179.875
DWD_COLS = 2879                                              # DWD's target grid stops at 179.75E
EASY_URL = "https://opendata.dwd.de/weather/lib/cdo/ICON_GLOBAL2WORLD_0125_EASY.tar.bz2"
EASY_MEMBER = "ICON_GLOBAL2WORLD_0125_EASY/weights_icogl2world_0125.nc"
K = 3                                                        # sub-points per box side (G2 gate: try 5 before anything else)


def _unit(lat_deg, lon_deg):
    import numpy as np
    la, lo = np.broadcast_arrays(np.radians(lat_deg), np.radians(lon_deg))
    return np.stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)], -1)


def read_dwd_nn(nc_bytes):
    """(nn (ROWS, DWD_COLS) 0-based cell index per target node, src lat, src lon in degrees) from DWD's SCRIP weights file."""
    import netCDF4
    import numpy as np
    d = netCDF4.Dataset("dwd_nn", memory=nc_bytes)
    try:
        if "nearest" not in str(getattr(d, "map_method", "")).lower():
            raise RuntimeError(f"DWD weights are not nearest-neighbour: {getattr(d, 'map_method', None)!r}")
        dims = tuple(int(x) for x in d["dst_grid_dims"][:])
        if dims != (DWD_COLS, ROWS):
            raise RuntimeError(f"DWD target grid {dims}, expected {(DWD_COLS, ROWS)}")
        dst = np.asarray(d["dst_address"][:], dtype=np.int64) - 1
        src = np.asarray(d["src_address"][:], dtype=np.int64) - 1
        if dst.size != ROWS * DWD_COLS or not np.array_equal(dst, np.arange(dst.size)):
            raise RuntimeError("DWD weights do not list every target node once, in order")
        slat = np.degrees(np.asarray(d["src_grid_center_lat"][:], dtype=float))
        slon = np.degrees(np.asarray(d["src_grid_center_lon"][:], dtype=float))
    finally:
        d.close()
    return src.reshape(ROWS, DWD_COLS).astype(np.int32), slat, slon


def fetch_dwd_nn(http):
    """DWD's nearest-neighbour map, downloaded (about 50 MB) and read in memory."""
    r = http.get(EASY_URL, timeout=300)
    if r.status_code != 200 or not r.content:
        raise RuntimeError(f"GET {EASY_URL} -> HTTP {r.status_code}")
    with tarfile.open(fileobj=io.BytesIO(r.content), mode="r:bz2") as tar:
        member = tar.getmember(EASY_MEMBER)
        if not member.isfile():
            raise RuntimeError(f"{EASY_MEMBER} is not a file")
        return read_dwd_nn(tar.extractfile(member).read())


def same_grid(slat, slon, clat, clon, tol_deg=0.01):
    """The weights' source cells are the GRIB's cells, in the same order (else every pick would be another cell). The GRIB's
    CLAT / CLON are packed: measured 2026-11-16 against DWD's map and the grid-0026 file, every cell within 0.00195 deg of
    latitude and 0.0039 of longitude. Cells are ~0.12 deg apart, so 0.01 deg still refuses any other cell or order."""
    import numpy as np
    if slat.shape != clat.shape:
        return False
    dlon = np.abs(((slon - clon) + 180.0) % 360.0 - 180.0)
    return bool(np.nanmax(np.abs(slat - clat)) <= tol_deg and np.nanmax(dlon) <= tol_deg)


def extend_nn(nn, cell_xyz, rows=ROWS, cols=COLS, step=STEP):
    """(rows, cols) nearest-cell grid from DWD's (rows, cols - 1): the last column (179.875E) takes the nearer of its neighbours'."""
    import numpy as np
    if nn.shape[1] == cols:
        return nn
    lat = -90.0 + step * np.arange(rows)
    node = _unit(lat, np.full(rows, -180.0 + step * (cols - 1)))
    cands = np.stack([nn[np.clip(np.arange(rows) + dr, 0, rows - 1), c] for dr in (-1, 0, 1) for c in (cols - 2, 0)], 1)
    best = np.argmax(np.einsum("rx,rnx->rn", node, cell_xyz[cands]), 1)
    return np.concatenate([nn, cands[np.arange(rows), best][:, None]], 1).astype(np.int32)


def box_cells(cell_lat, cell_lon, rows=ROWS, cols=COLS, step=STEP, cap=12):
    """(rows, cols, m) int32: the cells whose centre rounds to each node (-1 pads), m = the fullest box's count (at most cap)."""
    import numpy as np
    r = np.clip(np.rint((np.asarray(cell_lat) + 90.0) / step).astype(np.int64), 0, rows - 1)
    c = np.rint(((np.asarray(cell_lon) + 180.0) % 360.0) / step).astype(np.int64) % cols
    node = r * cols + c
    order = np.argsort(node, kind="stable")
    sorted_node = node[order]
    start = np.searchsorted(sorted_node, sorted_node, side="left")
    rank = np.arange(node.size) - start                                                      # position within its box
    m = int(min(cap, max(1, rank.max() + 1)))
    table = np.full((rows * cols, m), -1, dtype=np.int32)
    keep = rank < m
    table[sorted_node[keep], rank[keep]] = order[keep]
    return table.reshape(rows, cols, m)


def subpoint_pick(nn_full, cell_xyz, cell_lat, cell_lon, k=K, rows=ROWS, cols=COLS, step=STEP, chunk=48):
    """(rows, cols, k*k) int32: for each sub-point of each box, the nearest cell among the candidates of the 3 x 3 nodes around
    it: every cell whose centre lies in one of those boxes, plus each node's nearest cell (DWD's map; it is the only candidate
    where boxes are smaller than cells, near the poles). A cell that is no node's nearest still competes for its sub-points."""
    import numpy as np
    off = (np.arange(k) - (k - 1) / 2.0) * (step / k)
    pick = np.empty((rows, cols, k * k), dtype=np.int32)
    col_idx = (np.arange(cols)[:, None] + np.array([-1, 0, 1])[None, :]) % cols            # (cols, 3), wraps the date line
    lon = -180.0 + step * np.arange(cols)
    per_node = np.concatenate([nn_full[:, :, None], box_cells(cell_lat, cell_lon, rows, cols, step)], 2)   # (rows, cols, 1+m)
    m1 = per_node.shape[2]
    for r0 in range(0, rows, chunk):
        r = np.arange(r0, min(rows, r0 + chunk))
        row_idx = np.clip(r[:, None] + np.array([-1, 0, 1])[None, :], 0, rows - 1)          # (nr, 3)
        cands = per_node[row_idx[:, :, None, None], col_idx[None, None, :, :]]             # (nr, 3, cols, 3, 1+m)
        cands = cands.transpose(0, 2, 1, 3, 4).reshape(r.size, cols, 9 * m1)               # (nr, cols, 9(1+m)); -1 = none
        cands = np.where(cands < 0, cands[:, :, :1], cands)                                 # a pad repeats the first (a nearest)
        slat = np.clip((-90.0 + step * r)[:, None] + off[None, :], -90.0, 90.0)            # (nr, k)
        slon = lon[:, None] + off[None, :]                                                   # (cols, k)
        sxyz = _unit(slat[:, None, :, None], slon[None, :, None, :])                         # (nr, cols, k, k, 3)
        sxyz = sxyz.reshape(r.size, cols, k * k, 3).astype(np.float32)
        dots = np.einsum("rcsx,rcnx->rcsn", sxyz, cell_xyz[cands])                           # (nr, cols, k*k, 9(1+m))
        pick[r] = np.take_along_axis(cands, np.argmax(dots, 3), 2)                         # (nr, cols, k*k)
    return pick


def area_mean(values, pick):
    """(rows, cols) plane: each box the mean of its sub-points' cell values; NaN cells are left out (all NaN -> NaN)."""
    import numpy as np
    v = np.asarray(values, dtype=np.float32)[pick]                                           # (rows, cols, k*k)
    good = np.isfinite(v)
    n = good.sum(2)
    s = np.where(good, v, 0.0).sum(2, dtype=np.float64)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(n > 0, s / np.maximum(n, 1), np.nan)
