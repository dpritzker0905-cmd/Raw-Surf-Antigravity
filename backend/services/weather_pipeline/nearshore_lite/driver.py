"""Tile -> frozen-coefficient DRIVER, NetCDF only (director ruling 2026-11-22: netCDF4/xarray via ERDDAP/THREDDS subsets;
no rasterio / pyproj / GDAL). Offline / CI only, never the Render box.

For one target:
  1. read each source's NetCDF subset (`read_netcdf_depth`), sign-normalised to depth positive DOWN in its native datum;
  2. convert to MSL with the recorded `DatumConversion` (gate 1a);
  3. resample onto a local metric grid centred on the target (equirectangular; fine for a ~50 km domain), bilinear, numpy only;
  4. seam-check every adjacent pair of sources over their overlap, or across the join when they do not overlap;
  5. compose the finest source cell by cell and tag FINE / COARSE;
  6. return a `freeze.freeze_targets` target dict and the seam rows.

The seam table must be committed (`freeze.commit_seam_table`) BEFORE `freeze.freeze_targets` is called; this module never
freezes anything itself. A source whose file cannot be read raises: a missing tile is never silently skipped.
"""
import math

import numpy as np

from . import bathy_compose as bc
from . import datum as dt
from . import seam as seam_mod
from .ray_trace import DepthGrid

M_PER_DEG_LAT = 110574.0
M_PER_DEG_LON_EQ = 111320.0
LAT_NAMES = ("lat", "latitude", "y")
LON_NAMES = ("lon", "longitude", "x")


class SourceReadError(RuntimeError):
    """A bathymetry subset could not be read or does not cover the domain."""


def read_netcdf_depth(path, var, sign=-1.0, lat_name=None, lon_name=None):
    """(lat 1-D ascending, lon 1-D ascending, depth positive DOWN, native datum). `sign` converts the stored variable to
    depth: elevation-style (negative below the datum, GEBCO/CUDEM/ETOPO) is sign -1; depth-style (EMODnet `depth` is
    positive down) is +1. Land (depth <= 0 after conversion) becomes NaN."""
    import xarray as xr
    try:
        with xr.open_dataset(path) as ds:
            names = {n.lower(): n for n in list(ds.coords) + list(ds.variables)}
            la = lat_name or next((names[n] for n in LAT_NAMES if n in names), None)
            lo = lon_name or next((names[n] for n in LON_NAMES if n in names), None)
            if la is None or lo is None or var not in ds:
                raise SourceReadError(f"{path}: need lat/lon coordinates and variable {var!r}")
            lat = np.asarray(ds[la].values, dtype=float)
            lon = np.asarray(ds[lo].values, dtype=float)
            z = np.asarray(ds[var].values, dtype=float)
    except SourceReadError:
        raise
    except Exception as e:
        raise SourceReadError(f"{path}: {type(e).__name__}: {e}") from e
    z = np.squeeze(z)
    if z.shape != (lat.size, lon.size):
        raise SourceReadError(f"{path}: variable shape {z.shape} != ({lat.size}, {lon.size})")
    if lat[0] > lat[-1]:
        lat, z = lat[::-1], z[::-1, :]
    if lon[0] > lon[-1]:
        lon, z = lon[::-1], z[:, ::-1]
    depth = sign * z
    depth = np.where(np.isfinite(depth) & (depth > 0.0), depth, np.nan)
    return lat, lon, depth


def local_axes(lat0, lon0, half_extent_m, dx_m):
    """Grid axes in metres east/north of the target, plus the geographic coordinate of every node."""
    n = int(round(2 * half_extent_m / dx_m)) + 1
    xs = (np.arange(n) * dx_m) - half_extent_m
    ys = xs.copy()
    lat = lat0 + ys / M_PER_DEG_LAT
    lon = lon0 + xs / (M_PER_DEG_LON_EQ * math.cos(math.radians(lat0)))
    return xs, ys, lat, lon


def resample_bilinear(lat_src, lon_src, depth_src, lat_q, lon_q):
    """Bilinear sample of a (lat, lon) grid at the query axes -> (len(lat_q), len(lon_q)). NaN if any corner is NaN or the
    node lies outside the source (so a source with no data there simply does not fill that cell)."""
    fy = np.interp(lat_q, lat_src, np.arange(lat_src.size), left=-1.0, right=-1.0)
    fx = np.interp(lon_q, lon_src, np.arange(lon_src.size), left=-1.0, right=-1.0)
    iy = np.clip(np.floor(fy).astype(int), 0, max(lat_src.size - 2, 0))
    ix = np.clip(np.floor(fx).astype(int), 0, max(lon_src.size - 2, 0))
    ty, tx = (fy - iy)[:, None], (fx - ix)[None, :]
    iy2, ix2 = np.minimum(iy + 1, lat_src.size - 1), np.minimum(ix + 1, lon_src.size - 1)
    a = depth_src[np.ix_(iy, ix)]
    b = depth_src[np.ix_(iy, ix2)]
    c = depth_src[np.ix_(iy2, ix)]
    d = depth_src[np.ix_(iy2, ix2)]
    out = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty
    outside = (fy < 0)[:, None] | (fx < 0)[None, :]
    return np.where(outside, np.nan, out)


def build_target(target_id, lat0, lon0, sources, half_extent_m=25000.0, dx_m=100.0, seam_join="auto"):
    """sources: list of dict(name, path, var, sign, native_datum, volume, offset_m, method, version, tile_sha256).
    Returns (target_dict, seam_rows). `target_dict` plugs into `freeze.freeze_targets`; the target sits at the grid centre."""
    xs, ys, lat_q, lon_q = local_axes(lat0, lon0, half_extent_m, dx_m)
    msl, records, shas = {}, [], {}
    for s in sources:
        lat, lon, depth = read_netcdf_depth(s["path"], s["var"], s.get("sign", -1.0))
        conv = dt.resolve(s["name"], s.get("volume", s["name"]), s["native_datum"], s.get("offset_m"),
                          s.get("method"), s.get("version", ""))
        grid = resample_bilinear(lat, lon, dt.to_msl(depth, conv), lat_q, lon_q)
        msl[s["name"]] = grid
        records.append(conv.as_dict())
        if s.get("tile_sha256"):
            shas[s["name"]] = s["tile_sha256"]
    if not any(np.isfinite(g).any() for g in msl.values()):
        raise SourceReadError(f"{target_id}: no source has data inside the domain")
    rows = seam_rows(target_id, msl)
    c = half_extent_m / dx_m
    depth, which, names, stratum = bc.compose(msl, dx_m, (half_extent_m, half_extent_m))
    tags = sorted({r.tag for r in rows if r.tag} | {t for rec in records for t in (rec.get("tags") or [])})
    target = {"id": target_id, "grid": DepthGrid(depth, dx_m, x0_m=0.0, y0_m=0.0),
              "xy": (half_extent_m, half_extent_m), "stratum": stratum, "tags": tags,
              "sources": names, "datum_records": records, "tile_sha256": shas}
    return target, rows


def seam_rows(target_id, msl_by_source):
    """Seam rows for every adjacent pair in PRIORITY order among the sources present: over their overlap where they share
    cells, else across the join (`seam.edge_pairs`, finer = the higher-priority source)."""
    order = [n for n in bc.PRIORITY if n in msl_by_source]
    rows = []
    for fine, coarse in zip(order, order[1:]):
        a, b = msl_by_source[fine], msl_by_source[coarse]
        overlap = np.isfinite(a) & np.isfinite(b)
        join = f"{fine}|{coarse}"
        if overlap.any():
            rows.append(seam_mod.check_join(target_id, join, f"{fine},{coarse}", a[overlap], b[overlap]))
        else:
            f, c = seam_mod.edge_pairs(a, b)
            if len(f):
                rows.append(seam_mod.check_join(target_id, join, f"{fine},{coarse}", f, c))
    return rows
