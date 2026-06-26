"""
FORENSIC PROBE (one-off, read-only) — determine whether a fast global-coarse EURO marine fetch from
Copernicus via lazy open_dataset is FEASIBLE on this box, and how the dataset is chunked.

WHY: moving EURO marine ingestion onto Copernicus needs a coarse (~10°) global grid. The cheap way is
copernicusmarine.open_dataset (lazy/zarr) + xarray .isel(stride) + .load() — but that's only memory-safe
and fast if the dataset is TIME-SERIES chunked. If it's MAP chunked (full globe per timestep), a strided
load still pulls full-res global data and could OOM. This probe inspects ds.chunks/sizes (metadata only,
no data fetch) FIRST, then does ONE tiny bounded load (1 timestep) to measure latency — so it cannot OOM.

RUN ON RENDER (where COPERNICUSMARINE_SERVICE_USERNAME/PASSWORD are set):
    python backend/scratch_copernicus_probe.py
Paste the full output back.
"""
import os
import sys
import time
import json


def main():
    user = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", "")
    pwd = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", "")
    if not user or not pwd:
        print("ERROR: Copernicus credentials not in env (run this on Render).")
        sys.exit(1)

    try:
        import dask
        dask.config.set(scheduler="single-threaded")
    except Exception:
        pass
    import copernicusmarine
    import numpy as np

    DATASET_ID = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    VARS = ["VHM0", "VMDR", "VTM10", "VHM0_SW1", "VMDR_SW1", "VTM01_SW1",
            "VHM0_SW2", "VMDR_SW2", "VTM01_SW2", "VHM0_WW", "VMDR_WW", "VTM01_WW"]

    print(f"copernicusmarine version: {getattr(copernicusmarine, '__version__', '?')}")

    # ── Step 1: LAZY open of the GLOBAL bbox (metadata only — no data fetched) ──
    t0 = time.time()
    ds = copernicusmarine.open_dataset(
        dataset_id=DATASET_ID,
        variables=VARS,
        minimum_longitude=-180.0, maximum_longitude=180.0,
        minimum_latitude=-80.0, maximum_latitude=85.0,
        username=user, password=pwd,
    )
    print(f"open_dataset (lazy) returned in {time.time()-t0:.1f}s")
    print(f"dims/sizes: {dict(ds.sizes)}")
    print(f"coords: {list(ds.coords)}")
    print(f"data_vars: {list(ds.data_vars)}")
    try:
        print(f"chunks: {ds.chunks}")  # THE key datum: spatial vs time chunking
    except Exception as e:
        print(f"chunks: <unavailable: {e}>")
    try:
        print(f"lazy total nbytes (full dataset): {ds.nbytes/1e9:.2f} GB")
    except Exception:
        pass

    # detect coord names
    lat_name = "latitude" if "latitude" in ds.coords else ("lat" if "lat" in ds.coords else None)
    lon_name = "longitude" if "longitude" in ds.coords else ("lon" if "lon" in ds.coords else None)
    print(f"lat_name={lat_name} lon_name={lon_name} time_size={ds.sizes.get('time')}")
    if not lat_name or not lon_name:
        print("ERROR: could not detect lat/lon coord names — STOP.")
        return

    native_lat_step = abs(float(ds[lat_name].values[1] - ds[lat_name].values[0]))
    print(f"native lat step ≈ {native_lat_step:.4f}°")
    stride = max(1, int(round(10.0 / native_lat_step)))
    print(f"stride for ~10° coarse grid: {stride}")

    coarse = ds.isel({lat_name: slice(None, None, stride), lon_name: slice(None, None, stride)})
    print(f"coarse grid sizes (all-time): {dict(coarse.sizes)}  (expect ~36 lon x ~17 lat)")

    # ── Step 2: ONE tiny bounded load — 1 timestep only — to measure real fetch latency ──
    t1 = time.time()
    one = coarse.isel(time=0).load()
    dt = time.time() - t1
    npts = one.sizes.get(lat_name, 0) * one.sizes.get(lon_name, 0)
    try:
        vhm0 = np.asarray(one["VHM0"].values, dtype=float)
        nonnan = int(np.sum(vhm0 == vhm0))
        sample_max = float(np.nanmax(vhm0)) if nonnan else None
    except Exception as e:
        nonnan, sample_max = -1, f"err:{e}"
    print(f"LOADED 1 timestep of coarse grid ({npts} pts, 12 vars) in {dt:.1f}s "
          f"| VHM0 non-nan={nonnan} max={sample_max}")

    print("VERDICT: if the 1-timestep coarse load was fast (<~5s) and chunks show small spatial chunks, "
          "a full coarse-global lazy fetch (~80 timesteps) is feasible. If it was slow or chunks are "
          "full-globe-per-timestep, prefer tiled subset or a coarser cadence.")
    print("SUCCESS")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"PROBE ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
