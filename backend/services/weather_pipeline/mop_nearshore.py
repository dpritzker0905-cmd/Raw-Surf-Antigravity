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
import re
from datetime import datetime, timezone

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
                 max_depth=CELL_MAX_DEPTH_M, preferred_band=PREFERRED_BAND_M, preferred_depth=PREFERRED_DEPTH_M):
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
            tier = 0 if preferred_band[0] <= d <= preferred_band[1] else 1
            key = (tier, round(km, 6), abs(d - preferred_depth))
            if best is None or key < best[0]:
                best = (key, {"i": i, "j": j, "lat": clat, "lng": clng, "depth_m": round(float(d), 2),
                              "km": round(km, 3)})
    return best[1] if best else None



# ── A BUOY'S CELL (the ingest archives MOP at the CDIP buoys too, so the served product can be graded) ──
STATION_MAX_KM = 1.0
STATION_DEPTH_TOLERANCE = 0.3      # a buoy moored at 20 m is compared with a 14-26 m cell, nearest 20 m


def station_cell(grid, depth_at, lat, lng, depth_m):
    """The cell that stands for a CDIP buoy: within STATION_MAX_KM, depth within +-30% of the buoy's,
    preferring the closest depth. The MOP value there is comparable to what the buoy measures."""
    lo, hi = depth_m * (1 - STATION_DEPTH_TOLERANCE), depth_m * (1 + STATION_DEPTH_TOLERANCE)
    return nearest_cell(grid, depth_at, lat, lng, max_km=STATION_MAX_KM, min_depth=lo, max_depth=hi,
                        preferred_band=(depth_m * 0.9, depth_m * 1.1), preferred_depth=depth_m)


# ── THE INGEST'S PURE PIECES ─────────────────────────────────────────────────────────────────────────
LAND_OR_MISSING = -900.0           # MOP writes -999.99 where a value is absent


def run_stamp(das_txt: str):
    """The MOP run a grid file holds, from its net_model history (`-s YYYYMMDDHH`), as ISO; None if absent."""
    m = re.search(r"-s (\d{10})\b", das_txt or "")
    if not m:
        return None
    return datetime.strptime(m.group(1), "%Y%m%d%H").replace(tzinfo=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_cell_series(txt: str) -> dict:
    """One cell's forecast from an OPeNDAP ascii `waveTime,waveHs[..][i][j],waveTp[..],waveDp[..]` reply:
    {times: [ISO], hs, tp, dp}, with MOP's -999.99 as None. PURE."""
    t = re.search(r"^waveTime\[\d+\]\n([^\n]+)", txt, re.M)
    times = [datetime.fromtimestamp(int(float(v)), tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
             for v in (t.group(1).split(",") if t else []) if v.strip()]
    out = {"times": times}
    for var, key in (("waveHs", "hs"), ("waveTp", "tp"), ("waveDp", "dp")):
        sec = re.search(rf"^{var}\.{var}\[[^\n]*\n((?:\[\d+\]\[\d+\], [^\n]+\n?)+)", txt, re.M)
        vals = [float(v) for v in re.findall(r"\], ([^\n]+)", sec.group(1))] if sec else []
        out[key] = [None if v < LAND_OR_MISSING or v != v else round(v, 4) for v in vals]
    return out


def series_blob(table: dict, series: dict, runs: dict, generated_at: str) -> dict:
    """The L2 blob: every spot and buoy with its cell's forecast. `series` maps (grid file, i, j) to a parsed
    cell series; `runs` maps grid file to {run, created}. Rows whose cell was not fetched are left out, so a
    partial ingest publishes what it has and says how much that is. PURE."""
    def rows(entries, key):
        out = {}
        for e in entries or []:
            s = series.get((e["grid"], e["cell"]["i"], e["cell"]["j"]))
            if s and s.get("times"):
                out[e[key]] = {"grid": e["grid"], **{k: e["cell"][k] for k in ("i", "j", "lat", "lng", "depth_m")}, **s}
        return out
    spots, stations = rows(table.get("cells"), "spot_id"), rows(table.get("stations"), "station")
    return {"version": 1, "generated_at": generated_at, "product": "MOP_grids sea+swell forecast",
            "grids": runs, "spots": spots, "stations": stations,
            "coverage": {"spots": f"{len(spots)}/{len(table.get('cells') or [])}",
                         "stations": f"{len(stations)}/{len(table.get('stations') or [])}"}}
