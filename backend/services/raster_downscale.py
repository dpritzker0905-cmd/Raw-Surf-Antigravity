"""raster_downscale.py - the elevation-difference asset for the air-temperature downscale (2026-10-25).

WHY. The owner, 2026-10-25 (relayed by the lead): "Go with your recommendation if that is state of the art". The
recommendation was temperature on the 0.5-deg frames plus elevation (lapse-rate) downscaling. GFS's 0.5-deg terrain smooths
the mountains away, so the frames read 4-7 C too cold in valleys and too warm on peaks. Against METAR 2 m temperature at 31
airports (102 mountain station-hours, five valid times), the standard lapse rate (-6.5 K/km) applied to the elevation
difference cut the mountain mean absolute error from 2.87 to 2.07 C (Open-Meteo's 13 km field: 2.46). The model's own local
lapse rate did worse (2.42). Flat stations did not move. Log: 2026-10-25-claude-raster-temp-downscale.

WHAT. One static asset per model terrain, built offline and published once: dz = DEM - model terrain, on a fine lat/lon lattice.
- DEM: NOAA NCEI ETOPO 2022 (15 arc-second, public domain), every 16th point = 1/15 deg, via NOAA's ERDDAP.
- Model terrain: GFS 0p25 HGT surface at every second point (the frames' 0.5-deg lattice), bilinear onto the fine lattice,
  exactly as the shader samples the frames.
The client draws T + LAPSE * dz. Frames do not grow, so the scrub step is unchanged.
- Sea (DEM <= 0) has dz = 0: no downscale over water.
- Stored as uint8 = round(dz / 25 m) + 128, clipped to 1..255: +-0.08 C at 6.5 K/km. The real dz never clipped
  (p99 |dz| = 660 m, max well under 3175 m).
- Cut into longitude tiles of at most MAX_TILE_COLS columns, because many GPUs cap a texture at 4096. Each tile carries one
  overlap column (the next tile's first; the last tile wraps to column 0), so linear filtering never seams at a tile edge.
- Gzipped, content-addressed and immutable.
- One small descriptor at a fixed, versioned path names the lattice, the encoding and the tiles.

At 1/15 deg (5400 x 2701) the asset is two tiles, 1.88 MB gzipped. At 2/15 deg (stride 32) it is one tile, 0.48 MB. The
resolution is STRIDE below.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import math
import re

DESCRIPTOR_PATH = "v1/gfs/weather/temperature/static/elevation_dz_v1.json"
TILE_PREFIX = "v1/gfs/weather/temperature/static/elevation_dz_v1"
LAPSE_K_PER_M = -0.0065
STEP_M = 25.0
OFFSET = 128
MAX_TILE_COLS = 4096
STRIDE = 16                      # every 16th 15" point = 1/15 deg (32 = 2/15 deg, one tile)
DEM_DATASET = "ETOPO_2022_v1_15s"
DEM_URL = ("https://coastwatch.pfeg.noaa.gov/erddap/griddap/" + DEM_DATASET +
           ".dods?z%5B(-90):{s}:(90)%5D%5B(-180):{s}:(180)%5D")
CREDIT = "Elevation: NOAA NCEI ETOPO 2022 (public domain), via NOAA CoastWatch ERDDAP; terrain difference vs NOAA GFS"
LICENSE = "ETOPO 2022: U.S. Government work, public domain; NOAA GFS via NODD: no restrictions, attribution requested"


def parse_dods_grid(raw):
    """(values (rows, cols) float array, lat (rows,), lon (cols,)) from an ERDDAP binary DAP2 response for one grid variable
    with latitude and longitude maps. After 'Data:\\n': the array (two int32 lengths, then big-endian values: float32 for a
    float variable, int32 for a short), then each map (two lengths, float64 values)."""
    import numpy as np
    i = raw.index(b"Data:\n") + len(b"Data:\n")
    header = raw[:i].decode("latin-1")
    m = re.search(r"(Float32|Float64|Int16|Int32|Byte)\s+\w+\[latitude = (\d+)\]\[longitude = (\d+)\]", header)
    if not m:
        raise ValueError("not a latitude x longitude grid response")
    kind, ny, nx = m.group(1), int(m.group(2)), int(m.group(3))
    width, dtype = {"Float32": (4, ">f4"), "Float64": (8, ">f8"), "Int16": (4, ">i4"), "Int32": (4, ">i4"), "Byte": (1, "u1")}[kind]
    n = int.from_bytes(raw[i:i + 4], "big")
    if n != ny * nx:
        raise ValueError(f"grid of {n} values, header says {ny} x {nx}")
    j = i + 8
    vals = np.frombuffer(raw[j:j + n * width], dtype=dtype).astype(np.float64).reshape(ny, nx)
    j += n * width

    def read_map(j, count):
        k = int.from_bytes(raw[j:j + 4], "big")
        if k != count:
            raise ValueError(f"map of {k} values, expected {count}")
        return np.frombuffer(raw[j + 8:j + 8 + 8 * k], dtype=">f8").astype(np.float64), j + 8 + 8 * k

    lat, j = read_map(j, ny)
    lon, j = read_map(j, nx)
    return vals, lat, lon


def model_terrain_on(lat, lon, zs):
    """The model terrain at (lat, lon) the way the shader samples a frame: bilinear on the 0.5-deg lattice (361 x 720, row 0 =
    90S, column 0 = 180W, wrapping in longitude). `lat` (rows,), `lon` (cols,) -> (rows, cols)."""
    import numpy as np
    zs = np.asarray(zs, dtype=float)
    rows, cols = zs.shape
    fy = np.clip((np.asarray(lat, dtype=float) + 90.0) / 0.5, 0.0, rows - 1.0)
    fx = ((np.asarray(lon, dtype=float) + 180.0) / 0.5) % cols
    y0 = np.minimum(np.floor(fy).astype(int), rows - 2)
    ty = (fy - y0)[:, None]
    x0 = np.floor(fx).astype(int) % cols
    x1 = (x0 + 1) % cols
    tx = (fx - np.floor(fx))[None, :]
    a, b = zs[y0][:, x0], zs[y0][:, x1]
    c, d = zs[y0 + 1][:, x0], zs[y0 + 1][:, x1]
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty


def elevation_dz(dem, lat, lon, zs):
    """dz = DEM - model terrain (m) on the DEM's lattice; sea (DEM <= 0) is 0 (no downscale over water)."""
    import numpy as np
    dem = np.asarray(dem, dtype=float)
    dz = dem - model_terrain_on(lat, lon, zs)
    return np.where(dem > 0.0, dz, 0.0)


def quantise(dz):
    """uint8 = round(dz / STEP_M) + OFFSET, clipped to 1..255 (+-3175 m)."""
    import numpy as np
    return np.clip(np.round(np.asarray(dz, dtype=float) / STEP_M) + OFFSET, 1, 255).astype(np.uint8)


def dequantise(q):
    import numpy as np
    return (np.asarray(q, dtype=float) - OFFSET) * STEP_M


def tiles(q, max_cols=MAX_TILE_COLS):
    """[(col0, tile)] splitting (rows, cols) into the fewest equal-ish longitude tiles of at most max_cols columns INCLUDING one
    overlap column (the next tile's first column; the last tile's overlap wraps to column 0)."""
    import numpy as np
    rows, cols = q.shape
    k = max(1, math.ceil(cols / (max_cols - 1)))
    bounds = [round(i * cols / k) for i in range(k + 1)]
    out = []
    for i in range(k):
        c0, c1 = bounds[i], bounds[i + 1]
        overlap = q[:, c1 % cols][:, None]
        out.append((c0, np.ascontiguousarray(np.concatenate([q[:, c0:c1], overlap], axis=1))))
    return out


def build(dem, lat, lon, zs, built_at, terrain_source, max_cols=MAX_TILE_COLS):
    """(descriptor dict, [(path, gzip bytes)]) for a DEM on a regular lattice (lat ascending from the south, lon ascending
    from 180W; a repeated 180E column is dropped) and the model terrain zs (361 x 720 frame lattice)."""
    import numpy as np
    dem = np.asarray(dem, dtype=float)
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    if lat[0] > lat[-1]:
        dem, lat = dem[::-1], lat[::-1]
    if len(lon) > 1 and abs((lon[-1] - lon[0]) - 360.0) < 1e-6:
        dem, lon = dem[:, :-1], lon[:-1]                         # 180E repeats 180W
    dlat = float((lat[-1] - lat[0]) / (len(lat) - 1))
    dlon = float((lon[-1] - lon[0]) / (len(lon) - 1))
    q = quantise(elevation_dz(dem, lat, lon, zs))
    files, entries = [], []
    for i, (c0, t) in enumerate(tiles(q, max_cols)):
        gz = gzip.compress(t.tobytes(), 9)
        sha = hashlib.sha256(t.tobytes()).hexdigest()
        path = f"{TILE_PREFIX}/tile-{i}-{sha[:12]}.bin"
        files.append((path, gz))
        entries.append({"path": path, "col0": int(c0), "cols": int(t.shape[1]), "rows": int(t.shape[0]), "sha256": sha,
                        "bytes": len(gz)})
    land = dem > 0
    dz_m = dequantise(q)
    descriptor = {
        "version": 1, "kind": "elevation_dz", "model": "GFS", "layer": "temperature", "lapse_K_per_m": LAPSE_K_PER_M,
        "lattice": {"south": float(lat[0]), "west": float(lon[0]), "dlat": dlat, "dlon": dlon, "rows": int(q.shape[0]),
                    "cols": int(q.shape[1]), "row0": "south", "col0": "west", "wrap": True},
        "encoding": {"dtype": "uint8", "offset": OFFSET, "step_m": STEP_M, "gzip": True, "overlap_cols": 1},
        "tiles": entries,
        "stats": {"land_cells": int(land.sum()), "abs_dz_p99_m": round(float(np.percentile(np.abs(dz_m[land]), 99)), 1) if land.any() else 0.0,
                  "clipped_cells": int(np.sum((q == 1) | (q == 255)))},
        "dem": f"NOAA NCEI ETOPO 2022 15 arc-second, every {STRIDE}th point, via ERDDAP {DEM_DATASET}",
        "model_terrain": terrain_source, "credit": CREDIT, "license": LICENSE, "built_at": built_at,
    }
    return descriptor, files


def descriptor_bytes(descriptor):
    return json.dumps(descriptor, sort_keys=True, separators=(",", ":")).encode()
