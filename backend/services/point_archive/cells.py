"""The buoy -> cell rule and the grid hash (gate served-wave-verify-v1 section 5). PURE (numpy).

  * Grid snapshot: per (model, frame set, tier), the frame header's geometry (cols, rows, bounds, node order: row 0 south,
    column 0 west) plus its land / missing mask define `grid_hash` = SHA-256 of the canonical geometry JSON + the packed
    wet bitmap (numpy packbits, big-endian bit order, row-major nodes).
  * Buoy -> cell: the nearest WET node (Hs not missing in the snapshot), by great-circle distance (R = 6371.0 km).
    Tie (equal distance to 1e-6 km): the lower row, then the lower column (= the lower node index).
  * Maximum distance: 0.75 x the cell diagonal of that grid AT THE CHOSEN CELL (the great-circle distance between the cell's
    south-west and north-east corners). Beyond it: `distance_exceeded` and NO substitute cell.
  * Domain: a buoy outside the frame's bounds (the outer node centres; longitude wraps only for a grid spanning the world)
    is `out_of_domain`.
"""
from __future__ import annotations

import math

import numpy as np

from services.point_archive import core

EARTH_R_KM = 6371.0
TIE_KM = 1e-6
MAX_DIAG_FRACTION = 0.75
CELL_RULE = "nearest wet node by great circle (R 6371.0 km); tie 1e-6 km -> lower row, lower column; max 0.75 x cell diagonal"


def geometry(cols, rows, bounds):
    w, s, e, n = (float(x) for x in bounds)
    return {"cols": int(cols), "rows": int(rows), "west": w, "south": s, "east": e, "north": n,
            "row0": "south", "col0": "west"}


def node_lat_lon(geom):
    """(lat[rows], lon[cols]) of the node centres, as frame_binary.node_position places them."""
    r, c = geom["rows"], geom["cols"]
    lats = geom["south"] + np.arange(r) * (geom["north"] - geom["south"]) / (r - 1)
    lons = geom["west"] + np.arange(c) * (geom["east"] - geom["west"]) / (c - 1)
    return lats, lons


def grid_hash(geom, wet):
    """SHA-256 over the canonical geometry and the packed wet bitmap (`wet`: bool array, rows x cols or flat)."""
    bits = np.packbits(np.asarray(wet, dtype=bool).ravel(), bitorder="big").tobytes()
    return core.sha256_hex(core.canon(geom).encode("utf-8") + b"\x00" + bits)


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dp, dl = p2 - p1, np.radians(np.asarray(lon2) - lon1)
    a = np.sin(dp / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 2 * EARTH_R_KM * np.arcsin(np.minimum(1.0, np.sqrt(a)))


def spans_world(geom):
    step = (geom["east"] - geom["west"]) / (geom["cols"] - 1)
    return geom["east"] - geom["west"] + step >= 360.0 - 1e-9


def in_domain(geom, lat, lon):
    if not (geom["south"] - 1e-9 <= lat <= geom["north"] + 1e-9):
        return False
    if spans_world(geom):
        return True
    lo = ((lon - geom["west"] + 180.0) % 360.0) - 180.0 + geom["west"]   # the buoy's longitude nearest the box
    return geom["west"] - 1e-9 <= lo <= geom["east"] + 1e-9


def cell_diagonal_km(geom, lat):
    dlat = (geom["north"] - geom["south"]) / (geom["rows"] - 1)
    dlon = (geom["east"] - geom["west"]) / (geom["cols"] - 1)
    return float(haversine_km(lat - dlat / 2, -dlon / 2, lat + dlat / 2, dlon / 2))


def assign(geom, wet, lat, lon):
    """{status, cell_row, cell_col, cell_lat, cell_lon, distance_km} for one buoy (status ok | distance_exceeded |
    out_of_domain; the cell fields are absent unless a cell was chosen)."""
    if not in_domain(geom, lat, lon):
        return {"status": "out_of_domain"}
    wet = np.asarray(wet, dtype=bool).ravel()
    idx = np.flatnonzero(wet)
    if idx.size == 0:
        return {"status": "distance_exceeded"}
    lats, lons = node_lat_lon(geom)
    cols = geom["cols"]
    d = haversine_km(lat, lon, lats[idx // cols], lons[idx % cols])
    dmin = float(d.min())
    k = int(idx[np.flatnonzero(d <= dmin + TIE_KM)].min())       # ties: lower row, then lower column
    r, c = divmod(k, cols)
    cell = {"cell_row": r, "cell_col": c, "cell_lat": round(float(lats[r]), 6), "cell_lon": round(float(lons[c]), 6),
            "distance_km": round(dmin, 4)}
    limit = MAX_DIAG_FRACTION * cell_diagonal_km(geom, float(lats[r]))
    if dmin > limit:
        return {"status": "distance_exceeded", "distance_km": round(dmin, 4), "limit_km": round(limit, 4)}
    return {"status": "ok", **cell, "limit_km": round(limit, 4)}


def cell_table(geom, wet, stations):
    """{station_id: assign(...)} for stations [{id, lat, lon}] (computed once per grid_hash)."""
    return {s["id"]: assign(geom, wet, float(s["lat"]), float(s["lon"])) for s in stations}


def node_index(geom, cell):
    return cell["cell_row"] * geom["cols"] + cell["cell_col"]


def is_finite(x):
    return x is not None and isinstance(x, (int, float)) and math.isfinite(x)
