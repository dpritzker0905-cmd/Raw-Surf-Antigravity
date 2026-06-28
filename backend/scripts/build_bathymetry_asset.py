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


if __name__ == "__main__":
    sys.exit(main())
