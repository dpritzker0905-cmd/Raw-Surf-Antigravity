"""
FORENSIC PROBE v2 (one-off, bounded) — find a LOW-STRAIN way to fetch a coarse global EURO marine grid.

v1 proved lazy open_dataset (default/geo service, 1024x2048 spatial chunks) OOMs on a coarse-global load.
v2 tests two cheaper ideas:
  TEST A: copernicusmarine.subset of a THIN, FULL-LONGITUDE latitude band (flat bbox). If subset stays
          bbox-efficient when very wide-but-flat, then ~17 such bands = the whole coarse grid for ~600 MB
          total (vs ~27 GB tiled). Measures wall time + output NetCDF size for ONE band.
  TEST B: open_dataset(service="arco-time-series") — print chunks only (metadata, no load). If its spatial
          chunks are SMALL, a lazy coarse-point fetch becomes cheap (alternative path).

RUN ON RENDER:
    <venv-python> backend/scratch_copernicus_probe2.py
Paste the full output.
"""
import os
import sys
import time
import json
import tempfile
import uuid
from pathlib import Path


DATASET_ID = "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
VARS = ["VHM0", "VMDR", "VTM10", "VHM0_SW1", "VMDR_SW1", "VTM01_SW1",
        "VHM0_SW2", "VMDR_SW2", "VTM01_SW2", "VHM0_WW", "VMDR_WW", "VTM01_WW"]


def main():
    user = os.environ.get("COPERNICUSMARINE_SERVICE_USERNAME", "")
    pwd = os.environ.get("COPERNICUSMARINE_SERVICE_PASSWORD", "")
    if not user or not pwd:
        print("ERROR: Copernicus credentials not in env (run on Render).")
        sys.exit(1)

    try:
        import dask
        dask.config.set(scheduler="single-threaded")
    except Exception:
        pass
    import copernicusmarine
    from datetime import datetime, timezone, timedelta

    print(f"copernicusmarine version: {getattr(copernicusmarine, '__version__', '?')}")

    now = datetime.now(timezone.utc)
    start_dt = (now - timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%S")
    end_3d = (now + timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S")
    end_7d = (now + timedelta(days=7)).strftime("%Y-%m-%dT%H:%M:%S")

    # ── TEST A: thin, FULL-LONGITUDE latitude band via subset ──
    tmp = Path(tempfile.gettempdir())
    for label, (lat_lo, lat_hi, end_dt) in [
        ("3day", (27.9, 28.1, end_3d)),
        ("7day", (27.9, 28.1, end_7d)),
    ]:
        out = tmp / f"probe_band_{label}_{uuid.uuid4().hex}.nc"
        try:
            t0 = time.time()
            copernicusmarine.subset(
                dataset_id=DATASET_ID,
                variables=VARS,
                minimum_longitude=-180.0, maximum_longitude=179.9,
                minimum_latitude=lat_lo, maximum_latitude=lat_hi,
                start_datetime=start_dt, end_datetime=end_dt,
                output_directory=str(tmp), output_filename=out.name,
                username=user, password=pwd,
                force_download=True,
            )
            dt = time.time() - t0
            sz = out.stat().st_size / 1e6 if out.exists() else -1
            # peek dims
            try:
                import netCDF4
                nc = netCDF4.Dataset(out, "r")
                dims = {k: len(v) for k, v in nc.dimensions.items()}
                nc.close()
            except Exception as de:
                dims = f"<dim read err: {de}>"
            print(f"TEST A [{label}] thin full-lon band (lat {lat_lo}-{lat_hi}): "
                  f"{dt:.1f}s, file={sz:.1f} MB, dims={dims}")
        except Exception as e:
            print(f"TEST A [{label}] FAILED: {type(e).__name__}: {e}")
        finally:
            try:
                if out.exists():
                    out.unlink()
            except Exception:
                pass

    # ── TEST B: time-series ARCO service chunking (metadata only) ──
    for svc in ("arco-time-series", "arco-geo-series"):
        try:
            ds = copernicusmarine.open_dataset(
                dataset_id=DATASET_ID, variables=VARS,
                minimum_longitude=-180.0, maximum_longitude=179.9,
                minimum_latitude=-80.0, maximum_latitude=85.0,
                username=user, password=pwd, service=svc,
            )
            try:
                ch = ds.chunks
            except Exception as ce:
                ch = f"<{ce}>"
            print(f"TEST B service={svc}: sizes={dict(ds.sizes)} chunks={ch}")
        except Exception as e:
            print(f"TEST B service={svc} FAILED: {type(e).__name__}: {e}")

    print("VERDICT INPUT: if TEST A 7day band is small (<~80 MB) and fast (<~15s), the thin-band approach "
          "fetches the whole coarse grid in ~17 such calls (~0.6 GB, ~2-4 min) = low strain. If TEST B "
          "time-series shows SMALL spatial chunks, a lazy coarse fetch via that service is also viable.")
    print("SUCCESS")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"PROBE2 ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
