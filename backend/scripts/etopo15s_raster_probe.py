"""etopo15s_raster_probe.py - PROOF that a 15s raster ingest resolves what the 0.25 deg grid cannot.

The chain that led here (each step closed by measurement, see the commits of 2026-08-09):
  the rating's left spike -> the swell_exposure floor -> the floor proxies for absent refraction ->
  refraction needs headland geometry -> no shipped signal supplies it -> the 0.25 deg bathymetry
  asset DOES NOT CONTAIN Cape St Francis -> the "finer asset" is a per-spot TABLE, not a raster.
This probe answers the last open question: would a raster ingest actually see the headland?

MEASURED, live against NOAA ERDDAP (the SAME source build_shore_normals.py already uses):
    request : ETOPO_2022_v1_15s.csv, box lat -34.30..-33.95, lon 24.70..25.10, stride 4
    response: HTTP 200, 20,718 bytes, 525 samples, 21 x 25 grid, cell 0.01667 deg (~1.85 km)

    -34.148 #########................
    -34.165 #########................
    -34.181 ##########...............   <- the landmass bulges back OUT
    -34.198 .....####................   <- CAPE ST FRANCIS: land with ocean on BOTH sides
    -34.215 .........................   <- open ocean south of the cape
    (# = land z>=0, . = ocean)

For comparison, the SHIPPED 0.25 deg asset over the same latitudes:
    -34.25   .........      <- all ocean; the cape does not exist
    -34.00   ####..#..      <- J-Bay row

=> The headland IS resolvable, at 1.85 km -- which is 15x COARSER than full 15s and still 15x FINER
   than the 28 km grid. So the wrapping problem is a DATA INGEST task, not a physics or algorithm
   task, and it does not even need the full 463 m resolution to become tractable.

⚠️ SCOPE, stated because it decides the design: a GLOBAL 15s raster is 86,400 x 43,200 = 3.7e9 cells
(~7.5 GB) and cannot be bundled. What this proves is that a COASTAL-BAND or per-region raster is
both sufficient and cheap -- this box cost ONE request and 20 KB. build_shore_normals.py already
fetches this exact endpoint per spot, so the ingest path exists; what is missing is emitting the
LAND MASK alongside the fitted per-spot values instead of discarding it.

⛔ This probe proves RESOLVABILITY ONLY. It does not model wrapping, and nothing here is wired.
   SURF_EXPOSURE_RECONCILED remains OFF.

Usage:  cd backend && python scripts/etopo15s_raster_probe.py
"""
import csv
import io
import sys

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.csv"
# The J-Bay / Cape St Francis box: the one case where the coarse asset is provably blind.
BOX = dict(la0=-34.30, la1=-33.95, lo0=24.70, lo1=25.10, stride=4)


def fetch(la0, la1, lo0, lo1, stride):
    import requests
    q = (f"?z%5B({la0:.6f}):{stride}:({la1:.6f})%5D"
         f"%5B({lo0:.6f}):{stride}:({lo1:.6f})%5D")
    r = requests.get(ERDDAP + q, timeout=180)
    r.raise_for_status()
    rows = list(csv.reader(io.StringIO(r.text)))
    pts = []
    for d in rows[2:]:                      # row 0 = header, row 1 = units
        try:
            pts.append((float(d[0]), float(d[1]), float(d[2])))
        except (ValueError, IndexError):
            continue
    return pts, len(r.text)


def main():
    pts, nbytes = fetch(**BOX)
    if not pts:
        print("REFUSE: ERDDAP returned no samples - cannot conclude anything about resolvability")
        return 2
    lats = sorted({p[0] for p in pts})
    lons = sorted({p[1] for p in pts})
    cell = abs(lats[1] - lats[0]) if len(lats) > 1 else 0.0
    g = {(p[0], p[1]): p[2] for p in pts}
    print(f"bytes {nbytes}  samples {len(pts)}  grid {len(lats)}x{len(lons)}  "
          f"cell {cell:.5f} deg (~{cell * 111:.2f} km)")
    for la in reversed(lats):
        row = "".join("#" if (g.get((la, lo), -1) or -1) >= 0 else "." for lo in lons)
        tag = ""
        if abs(la - (-34.035)) < 0.02:
            tag = "  <- J-Bay"
        if abs(la - (-34.198)) < 0.02:
            tag = "  <- Cape St Francis tip"
        print(f"  {la:7.3f} {row}{tag}")
    # The control that makes this a proof rather than a picture: the cape band must contain BOTH
    # land and ocean. All-ocean means unresolved (the coarse asset's failure); all-land means the
    # box missed the sea and the comparison is meaningless.
    band = [la for la in lats if -34.23 <= la <= -34.15]
    cells = [(g.get((la, lo), -1) or -1) >= 0 for la in band for lo in lons]
    if not band or not any(cells):
        print("\nREFUSE: no land in the cape band - the headland is NOT resolved at this stride")
        return 1
    if all(cells):
        print("\nREFUSE: the cape band is entirely land - the box is mis-placed, not a proof")
        return 1
    print(f"\nRESOLVED: the cape band ({len(band)} rows) contains land AND ocean "
          f"-> the headland exists at ~{cell * 111:.2f} km where the 0.25 deg asset shows none.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
