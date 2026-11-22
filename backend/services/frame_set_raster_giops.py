"""Canada GIOPS ocean surface currents for the raster frames (2026-11-22): the Currents layer's own source under the ICON picker.

WHY. GFS, EURO and ICON are atmosphere / wave models with no open surface-current forecast, so the Currents layer showed
Copernicus under all three pickers. Each picker now reads an INDEPENDENT ocean model: GFS -> NOAA Global RTOFS, EURO ->
Copernicus Marine (frame_set_raster_currents), ICON -> Environment and Climate Change Canada's GIOPS (Global Ice Ocean
Prediction System; Germany / DWD runs no global ocean model). GIOPS is credited under its own name, never "ICON".

SOURCE (checked against the live server 2026-11-22). MSC Datamart, dated tree, kept for days:
  https://dd.weather.gc.ca/{YYYYMMDD}/WXO-DD/model_giops/netcdf/lat_lon/2d/{HH}/{FFF}/
  CMC_giops_{vozocrtx|vomecrty}_depth_0.5_latlon0.2x0.2_3h-mean_{YYYYMMDDHH}_P{FFF}.nc
GIOPS 10.0.0: 0.2-degree regular lat-lon grid (850 rows lat -80..89.8, 1800 columns lon 0..359.8), NetCDF-4 (HDF5), float32
m/s, fill 1e20 (land). Runs 00Z and 12Z, 2-D fields every 3 h, P003..P240; the files are MEANS over the 3 h ENDING at the
validity time (the ECCC GIOPS Datamart page), so a frame here is a 3-hour mean, not an instantaneous value as CMEMS's is.
P000 is an analysis file without the currents. One field-hour is ~2.5 MB; this set reads 2 x 40 of them (~200 MB) per run.
One cycle a day (00Z), as the Copernicus set.

COMPONENTS. vozocrtx / vomecrty are named "sea_water_x/y_velocity" on the lat-lon grid. Treated as EASTWARD / NORTHWARD:
checked 2026-11-22 against Copernicus at the same valid time, band by band including north of 60N where GIOPS's native ORCA
grid is rotated (log 2026-11-22-opus-giops-currents.md); grid-relative components would decorrelate there.

LICENCE (checked 2026-11-22). The GIOPS record in the Government of Canada open-data catalogue (open.canada.ca dataset
dc3a7022-95e8-45a7-bf63-3d45b6cda0dc, publisher ECCC) is under the Open Government Licence - Canada, whose attribution
statement is "Contains information licensed under the Open Government Licence - Canada." The MSC Datamart's own page names
the ECCC Data Servers End-use Licence v2.1.1 (Aug 2026), which asks for "Data Source: Environment and Climate Change Canada".
Both: free incl. commercial use, attribution required, no ECCC names / logos and nothing suggesting endorsement. Every index
carries both statements (CREDIT, LICENSE; the advisor's pass condition).

REGRID. Bilinear onto the 0.25-degree lattice, u and v separately (a vector interpolation), weights renormalised over the
ocean corners only; a node with no ocean corner, or south of 80S / north of 89.8N, is no data. Same frame layout as the
Copernicus set (frame_set_raster_currents.speed_direction): speed in KNOTS + direction the water flows TOWARD.
"""
from __future__ import annotations

from datetime import timedelta, timezone

try:
    from frame_set_raster_currents import speed_direction
except ImportError:  # services is a package when imported, a directory when run as a script
    from services.frame_set_raster_currents import speed_direction

BASE = "https://dd.weather.gc.ca"
SRC_ROWS, SRC_COLS = 850, 1800                 # lat -80 + 0.2 i, lon 0.2 j
SRC_LAT0, SRC_STEP = -80.0, 0.2
LAND = 1e19                                    # the fill value is 1e20
VARS = ("vozocrtx", "vomecrty")
HOURS = tuple(range(6, 241, 6))                # the Copernicus cadence; P000 holds no currents
RETRY_WAITS_S = (2.0, 6.0)                     # back-offs between the three tries of one file GET
OGL = "Contains information licensed under the Open Government Licence – Canada."   # the licence's own statement
CREDIT = (f"{OGL} Data Source: Environment and Climate Change Canada (GIOPS); modified (3 h mean currents at 0.5 m, "
          "bilinear onto 0.25 deg, knots)")
LICENSE = ("Open Government Licence – Canada (https://open.canada.ca/en/open-government-licence-canada), the licence of "
           "the GIOPS record in the Government of Canada open-data catalogue "
           "(https://open.canada.ca/data/en/dataset/dc3a7022-95e8-45a7-bf63-3d45b6cda0dc); served from the MSC Datamart under "
           "the ECCC Data Servers End-use Licence v2.1.1 (https://eccc-msc.github.io/open-data/licence/readme_en/). Both: free "
           "incl. commercial, attribution required, no endorsement implied")
SET = "currents_giops"
SPEC = {
    "target": {"model": "GIOPS", "domain": "marine", "layer": "currents", "region_id": "global_0p25"},
    "field": None, "fields": None, "band_field": None,      # filled from frame_binary in register()
    "uv_convention": 1, "idx": VARS, "grid": "0p25",
    "frame_plane": True, "convert": lambda a: a, "valid": (0.0, 20.0), "clip": None,
    "env": "FRAME_RASTER_CURRENTS_GIOPS", "default_on": False, "strict": True,   # strict: any failed frame turns the run red
    "value_kind": "sea_surface_current_3h_mean", "value_unit": "kn",
    "source_dataset": "ECCC GIOPS 10 lat_lon 0.2 deg 2d vozocrtx/vomecrty at 0.5 m (3 h mean ending at the valid time), "
                      "bilinear onto 0.25 deg; speed kn + direction toward",
    "hours": HOURS, "source": "giops_currents", "upstream_provider": "eccc",
    "credit": CREDIT, "license": LICENSE,
    "source_url": "https://eccc-msc.github.io/open-data/msc-data/nwp_giops/readme_giops-datamart_en/",
}


def register(specs, grids, sources):
    """Add the set and its source kind to frame_set_raster's tables (kept here: that module is at its line limit)."""
    try:
        import frame_binary as fb
    except ImportError:
        from services import frame_binary as fb
    sp = dict(SPEC, field=fb.SPEED, fields=(fb.SPEED, fb.DIRECTION), band_field=fb.CURRENT_KN_BAND)
    base = specs.get("currents") or {}                 # the frame layout follows the Copernicus set's (its band, a direction byte)
    sp.update({k: base[k] for k in ("field", "fields", "band_field", "uv_convention", "dir_byte_field") if k in base})
    specs.setdefault(SET, sp)
    sources.setdefault(SPEC["source"], GiopsCurrentsSource)


def file_url(cycle, f, var):
    c = cycle.astimezone(timezone.utc)
    return (f"{BASE}/{c:%Y%m%d}/WXO-DD/model_giops/netcdf/lat_lon/2d/{c:%H}/{f:03d}/"
            f"CMC_giops_{var}_depth_0.5_latlon0.2x0.2_3h-mean_{c:%Y%m%d%H}_P{f:03d}.nc")


def regrid_quarter(a):
    """(721, 1440) lattice (row 0 = 90S, column 0 = 180W) from a (850, 1800) GIOPS field (row 0 = 80S, column 0 = 0E):
    bilinear, weights renormalised over the finite (ocean) corners; NaN where none is finite or outside 80S..89.8N."""
    import numpy as np
    a = np.asarray(a, dtype=float)
    if a.shape != (SRC_ROWS, SRC_COLS):
        raise ValueError(f"expected the 0.2-deg GIOPS grid {(SRC_ROWS, SRC_COLS)}, got {a.shape}")
    lat = -90.0 + 0.25 * np.arange(721)
    lon = (-180.0 + 0.25 * np.arange(1440)) % 360.0
    fi = (lat - SRC_LAT0) / SRC_STEP
    fj = lon / SRC_STEP
    inside = (fi >= -1e-9) & (fi <= SRC_ROWS - 1 + 1e-9)
    i0 = np.clip(np.floor(fi + 1e-9).astype(int), 0, SRC_ROWS - 1)
    i1 = np.minimum(i0 + 1, SRC_ROWS - 1)
    wi = np.clip(fi - i0, 0.0, 1.0)
    j0 = np.floor(fj + 1e-9).astype(int) % SRC_COLS
    j1 = (j0 + 1) % SRC_COLS
    wj = np.clip(fj - np.floor(fj + 1e-9), 0.0, 1.0)
    total = np.zeros((721, 1440))
    weight = np.zeros((721, 1440))
    for rows, rw in ((i0, 1.0 - wi), (i1, wi)):
        for cols, cw in ((j0, 1.0 - wj), (j1, wj)):
            blk = a[rows][:, cols]
            w = rw[:, None] * cw[None, :]
            ok = np.isfinite(blk) & (w > 0)
            total += np.where(ok, blk * w, 0.0)
            weight += np.where(ok, w, 0.0)
    with np.errstate(invalid="ignore", divide="ignore"):
        out = np.where(weight > 1e-12, total / np.maximum(weight, 1e-12), np.nan)
    out[~inside] = np.nan
    return out


def read_field(content, var):
    """(850, 1800) float field from one GIOPS NetCDF file's bytes; land (fill) is NaN. Checks the grid it was promised."""
    import numpy as np
    import netCDF4
    with netCDF4.Dataset("giops.nc", mode="r", memory=bytes(content)) as d:
        lat, lon = np.asarray(d["latitude"][:], float), np.asarray(d["longitude"][:], float)
        ok = lat.size == SRC_ROWS and lon.size == SRC_COLS \
            and np.allclose(lat, SRC_LAT0 + SRC_STEP * np.arange(SRC_ROWS), atol=1e-3) \
            and np.allclose(lon, SRC_STEP * np.arange(SRC_COLS), atol=1e-3)   # float32 axes: 0.2 steps read as 0.200003
        if not ok:
            raise RuntimeError(f"GIOPS {var}: grid changed (lat {lat[:2]}..., lon {lon[:2]}...)")
        v = d[var]
        v.set_auto_mask(False)
        arr = np.asarray(v[:], dtype=float).reshape(SRC_ROWS, SRC_COLS)
    arr[~(np.abs(arr) < LAND)] = np.nan
    return arr


class GiopsCurrentsSource:
    """One GIOPS 3-hour-mean surface-current step per frame from the MSC Datamart (module docstring)."""

    def __init__(self, spec, session=None):
        self.spec = spec
        if session is None:
            try:
                from services._fetch_common import http_session
            except ImportError:  # pragma: no cover
                from _fetch_common import http_session
            session = http_session()
        self.http = session
        self.bytes_pulled = 0                          # bytes read from the Datamart this run (the advisor's stated size)

    def _exists(self, url):
        try:
            r = self.http.head(url, timeout=30)
            return r.status_code == 200
        except Exception:
            return False

    def complete_cycle(self, now):
        """The newest 00Z run whose first and last frames (both components) are on the Datamart, or None."""
        hours = self.spec["hours"]
        day = now.astimezone(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        for back in range(3):
            cyc = day - timedelta(days=back)
            if all(self._exists(file_url(cyc, f, var)) for f in (hours[0], hours[-1]) for var in VARS):
                return cyc
        return None

    def url(self, cycle, f):
        return file_url(cycle, f, "{" + ",".join(VARS) + "}")

    def _get(self, url, sleep=None):
        """GET with RETRY_WAITS_S back-offs: the Datamart dropped 1 of 80 GETs per run at six hours in flight (measured
        2026-11-22, 'Remote end closed connection'); a 404 is final (that file is not published)."""
        import time
        sleep = sleep or time.sleep
        for wait in RETRY_WAITS_S + (None,):
            try:
                r = self.http.get(url, timeout=120)
                if r.status_code == 404 or wait is None:
                    r.raise_for_status()
                if r.status_code == 200:
                    self.bytes_pulled += len(r.content)
                    return r.content
            except Exception as e:  # noqa: BLE001 - connection drops, 5xx
                if wait is None or "404" in str(e):
                    raise
            sleep(wait)
        raise RuntimeError(f"unreachable: {url}")  # pragma: no cover

    def fetch(self, cycle, f):
        """{field id: (721, 1440) plane on the 0.25-degree lattice}: speed (kn) and direction toward (deg)."""
        try:
            import frame_binary as fb
        except ImportError:
            from services import frame_binary as fb
        u = regrid_quarter(read_field(self._get(file_url(cycle, f, VARS[0])), VARS[0]))
        v = regrid_quarter(read_field(self._get(file_url(cycle, f, VARS[1])), VARS[1]))
        spd, to = speed_direction(u, v)
        return {fb.SPEED: spd, fb.DIRECTION: to}
