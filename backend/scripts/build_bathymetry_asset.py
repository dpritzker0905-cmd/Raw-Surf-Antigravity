"""
build_bathymetry_asset.py — ONE-TIME asset builder for the Option-2 surf transform.

Fetches ETOPO1 global relief from NOAA ERDDAP (server-side strided to 0.25°), and writes a COMPACT,
version-controlled depth grid that the serve-only box loads in-process (no runtime fetch):

  backend/services/weather_pipeline/data/etopo_depth_0p25.npy        int16 ocean depth in metres
                                                                      (0 = land / no depth)
  backend/services/weather_pipeline/data/etopo_depth_0p25.meta.json  grid geometry (regular lat/lon)

ETOPO1 is 1 arc-min (10801 x 21601); stride 15 -> 0.25° (~721 x 1441, ~2 MB int16). Re-run to refresh.
Run from backend/:  python scripts/build_bathymetry_asset.py
"""
import os
import sys
import json

STRIDE = 15  # 1 arc-min ETOPO1 -> 0.25 deg
URL = (
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.nc"
    f"?altitude[0:{STRIDE}:10800][0:{STRIDE}:21600]"
)
# Finer stride for the bed-SLOPE asset: 3 arc-min source -> 0.05° (~5.5 km gradient baseline), downsampled to
# a 0.1° slope grid. Far finer than the 0.25° depth grid (the 28 km baseline is shelf-scale, useless for the
# Iribarren breaker type). Run:  python scripts/build_bathymetry_asset.py --slope
SLOPE_STRIDE = 3
SLOPE_URL = (
    "https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.nc"
    f"?altitude[0:{SLOPE_STRIDE}:10800][0:{SLOPE_STRIDE}:21600]"
)
SLOPE_SCALE = 10000.0   # int16 storage: slope (m/m) × 1e4
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                       "services", "weather_pipeline", "data")


def main() -> int:
    import tempfile
    import requests
    import numpy as np
    import xarray as xr

    os.makedirs(OUT_DIR, exist_ok=True)
    tmp_nc = os.path.join(tempfile.gettempdir(), "etopo1_0p25.nc")
    print(f"Downloading ETOPO1 @0.25° from ERDDAP -> {tmp_nc} ...")
    r = requests.get(URL, timeout=180)
    if r.status_code != 200 or not r.content:
        print(f"ERROR: ERDDAP returned {r.status_code} ({len(r.content)} bytes)")
        return 1
    with open(tmp_nc, "wb") as f:
        f.write(r.content)
    print(f"Downloaded {len(r.content)/1e6:.1f} MB")

    ds = xr.open_dataset(tmp_nc)
    alt = np.asarray(ds["altitude"].values)          # (lat, lon), metres, +up
    lats = np.asarray(ds["latitude"].values, dtype=float)
    lons = np.asarray(ds["longitude"].values, dtype=float)

    # Ocean depth in metres (positive down). Land / >=0 elevation -> 0 (the "no depth" sentinel).
    depth = np.where(alt < 0, -alt, 0)
    depth = np.clip(depth, 0, 32000).astype(np.int16)

    np.save(os.path.join(OUT_DIR, "etopo_depth_0p25.npy"), depth)
    meta = {
        "source": "NOAA ERDDAP etopo180 (ETOPO1), strided to 0.25°",
        "units": "metres, positive down; 0 == land/no-depth",
        "nlat": int(depth.shape[0]), "nlon": int(depth.shape[1]),
        "lat0": float(lats[0]), "lat1": float(lats[-1]),
        "lon0": float(lons[0]), "lon1": float(lons[-1]),
        "dlat": float((lats[-1] - lats[0]) / (len(lats) - 1)),
        "dlon": float((lons[-1] - lons[0]) / (len(lons) - 1)),
    }
    with open(os.path.join(OUT_DIR, "etopo_depth_0p25.meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    ocean = int((depth > 0).sum())
    print(f"Wrote {depth.shape} int16 grid ({depth.nbytes/1e6:.1f} MB), {ocean} ocean cells.")
    print(f"meta: {meta}")
    return 0


def build_slope() -> int:
    """Build the finer bed-SLOPE asset for the Iribarren breaker type. Downloads ETOPO1 at SLOPE_STRIDE (0.05°),
    computes the seabed slope |∇depth| (m/m, shoreline depth=0 → slope is the rise into deeper water),
    downsamples 2×2 with a MAX pool to 0.1° (keep the steepest nearshore drop), and stores int16 = slope×1e4."""
    import tempfile
    import requests
    import numpy as np
    import xarray as xr

    os.makedirs(OUT_DIR, exist_ok=True)
    tmp_nc = os.path.join(tempfile.gettempdir(), "etopo1_0p05.nc")
    print(f"Downloading ETOPO1 @0.05° (stride {SLOPE_STRIDE}) from ERDDAP -> {tmp_nc} ...")
    r = requests.get(SLOPE_URL, timeout=600)
    if r.status_code != 200 or not r.content:
        print(f"ERROR: ERDDAP returned {r.status_code} ({len(r.content)} bytes)")
        return 1
    with open(tmp_nc, "wb") as f:
        f.write(r.content)
    print(f"Downloaded {len(r.content)/1e6:.1f} MB")

    ds = xr.open_dataset(tmp_nc)
    alt = np.asarray(ds["altitude"].values, dtype=np.float64)   # (lat, lon), metres +up
    lats = np.asarray(ds["latitude"].values, dtype=float)
    lons = np.asarray(ds["longitude"].values, dtype=float)
    depth = np.where(alt < 0, -alt, 0.0)                        # ocean depth (m, +down); land/shore = 0

    dlat_deg = abs((lats[-1] - lats[0]) / (len(lats) - 1))
    dlon_deg = abs((lons[-1] - lons[0]) / (len(lons) - 1))
    m_per_deg = 111000.0
    dlat_m = dlat_deg * m_per_deg
    # gradient: rows=lat, cols=lon; lon spacing shrinks with latitude (cos φ)
    gy, gx = np.gradient(depth)                                  # per-cell Δdepth (m) in row/col steps
    coslat = np.cos(np.radians(lats)).clip(0.05, 1.0)[:, None]
    slope = np.sqrt((gy / dlat_m) ** 2 + (gx / (dlon_deg * m_per_deg * coslat)) ** 2)
    slope = np.where(depth > 0, slope, 0.0)                      # only meaningful over ocean cells

    # 2×2 MAX pool -> 0.1° (trim to even dims first); keep the steepest sub-cell drop.
    h, w = slope.shape
    slope = slope[: h - (h % 2), : w - (w % 2)]
    pooled = slope.reshape(slope.shape[0] // 2, 2, slope.shape[1] // 2, 2).max(axis=(1, 3))
    out = np.clip(pooled * SLOPE_SCALE, 0, 32767).astype(np.int16)

    np.save(os.path.join(OUT_DIR, "etopo_slope_0p1.npy"), out)
    meta = {
        "source": f"NOAA ERDDAP etopo180 (ETOPO1) stride {SLOPE_STRIDE}=0.05°, |grad(depth)| max-pooled to 0.1°",
        "units": f"slope (rise/run, m/m) × {int(SLOPE_SCALE)}; 0 == land/no-slope",
        "nlat": int(out.shape[0]), "nlon": int(out.shape[1]),
        "lat0": float(lats[0]), "lon0": float(lons[0]),
        "dlat": float((lats[-1] - lats[0]) / (out.shape[0] - 1)),
        "dlon": float((lons[-1] - lons[0]) / (out.shape[1] - 1)),
    }
    with open(os.path.join(OUT_DIR, "etopo_slope_0p1.meta.json"), "w") as f:
        json.dump(meta, f, indent=2)
    nz = int((out > 0).sum())
    print(f"Wrote slope {out.shape} int16 ({out.nbytes/1e6:.1f} MB), {nz} sloped cells, "
          f"max slope {out.max()/SLOPE_SCALE:.3f} m/m. meta: {meta}")
    return 0


if __name__ == "__main__":
    if "--slope" in sys.argv:
        sys.exit(build_slope())
    sys.exit(main())
