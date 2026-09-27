"""mop_nearshore.py — CDIP MOP, the nearshore model roadmap stage 4 serves for California (2026-09-27).

WHY. The nearshore judge (#124) graded CDIP's MOP beside our parametric chain at the CDIP buoys, on the
same hours and from the same offshore model (WaveWatch III): MAE 0.101 m against 0.246 m, MOP closer on
every hour at every covered station. A spectral refraction model run over real bathymetry is what the
parametric transform approximates, so where MOP exists it should be the input to the breaking step.

WHICH MOP PRODUCT. CDIP's THREDDS (cdip/model/MOP_grids) publishes, per coastal region, gridded forecasts
at 0.001-0.002 deg (100-200 m), 16 six-hourly steps (~91 h), with Hs, peak period and direction and each
cell's water depth (land -999.99). Two variants, and the choice matters:
  * `<R>_<res>_forecast.nc`   is SWELL ONLY   (net_model `-i ECMWF_swell.INPUT -b fc_swell`)
  * `<R>_<res>_seaswellfc.nc` is SEA + SWELL  (net_model `-i ECMWF_forecast.INPUT`)
Only the sea+swell grids describe the waves that break on a windy day, so they are the product. The
California-wide `CA_0.01_forecast.nc` is swell-only (and 1 km, which turns Malibu's coast to land), so it
is not used. ⚠️ These grids are ECMWF-driven, not the WW3-driven buoy series #124 graded, and hold only
future hours, so their own skill is established by archiving each run (the ingest) and grading it later.

THIS MODULE holds the grid geometry and the cell choice, PURE: which cell of which regional grid stands
for a catalogue spot. The geometry is discovered from the files and committed with the spot table
(scripts/build_mop_spot_cells.py, data/mop_spot_cells.json); nothing here touches the network.
"""
import math

MOP_GRIDS_URL = "https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/model/MOP_grids"
MOP_GRIDS_CATALOG = "https://thredds.cdip.ucsd.edu/thredds/catalog/cdip/model/MOP_grids/catalog.html"
SEASWELL_SUFFIX = "_seaswellfc.nc"

# A cell stands for a spot when it is WET, in the depth band the breaking step can start from, and close.
# 5 m: shallower cells sit inside the surf zone MOP does not model. 25 m: deeper is offshore of the
# refraction MOP exists to capture. 1.5 km: past that the cell describes a different stretch of coast.
# MOP's land value (-999.99) falls outside any depth band, so the band also rejects land.
CELL_MIN_DEPTH_M, CELL_MAX_DEPTH_M = 5.0, 25.0
CELL_MAX_KM = 1.5
PREFERRED_DEPTH_M = 10.0     # MOP's own reference depth (its alongshore points sit on the 10 m contour)
# PREFER the 8-15 m band over mere closeness. At 100-200 m resolution the nearest wet cell hugs the
# shore at ~5 m, and on a big day 5 m is already inside the surf zone MOP does not model; the breaking
# step should start from where MOP is valid. Measured on the first build: every nearest cell was 5-6 m.
PREFERRED_BAND_M = (8.0, 15.0)


def _km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2
         + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def grid_index(grid, lat, lng):
    """(i, j) of the cell of `grid` ({lat0, lng0, step, nlat, nlng}) containing (lat, lng), or None."""
    i = int(round((float(lat) - grid["lat0"]) / grid["step"]))
    j = int(round((float(lng) - grid["lng0"]) / grid["step"]))
    return (i, j) if 0 <= i < grid["nlat"] and 0 <= j < grid["nlng"] else None


def cell_center(grid, i, j):
    return round(grid["lat0"] + i * grid["step"], 5), round(grid["lng0"] + j * grid["step"], 5)


def search_window(grid, lat, max_km=CELL_MAX_KM):
    """(di, dj): the cell half-widths that cover max_km around a point at `lat`."""
    step = grid["step"]
    di = int(math.ceil(max_km / 111.0 / step)) + 1
    dj = int(math.ceil(max_km / (111.0 * max(0.2, math.cos(math.radians(float(lat))))) / step)) + 1
    return di, dj


def grids_containing(grids, lat, lng):
    """The regional grids whose extent contains the point, finest first (overlaps take the finest)."""
    return sorted((g for g in grids if grid_index(g, lat, lng) is not None), key=lambda g: g["step"])


def nearest_cell(grid, depth_at, lat, lng, max_km=CELL_MAX_KM, min_depth=CELL_MIN_DEPTH_M,
                 max_depth=CELL_MAX_DEPTH_M):
    """The cell of `grid` that stands for (lat, lng): the closest wet cell in [min_depth, max_depth]
    within max_km, preferring cells in PREFERRED_BAND_M (then closest, then depth nearest
    PREFERRED_DEPTH_M). `depth_at(i, j)` returns the cell's depth
    (None when unknown). None when no cell qualifies, and the spot keeps the parametric chain."""
    c = grid_index(grid, lat, lng)
    if c is None:
        return None
    ci, cj = c
    di, dj = search_window(grid, lat, max_km)
    best = None
    for i in range(max(0, ci - di), min(grid["nlat"], ci + di + 1)):
        for j in range(max(0, cj - dj), min(grid["nlng"], cj + dj + 1)):
            d = depth_at(i, j)
            if d is None or d != d or not (min_depth <= d <= max_depth):
                continue
            clat, clng = cell_center(grid, i, j)
            km = _km(float(lat), float(lng), clat, clng)
            if km > max_km:
                continue
            tier = 0 if PREFERRED_BAND_M[0] <= d <= PREFERRED_BAND_M[1] else 1
            key = (tier, round(km, 6), abs(d - PREFERRED_DEPTH_M))
            if best is None or key < best[0]:
                best = (key, {"i": i, "j": j, "lat": clat, "lng": clng, "depth_m": round(float(d), 2),
                              "km": round(km, 3)})
    return best[1] if best else None
