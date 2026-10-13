"""_hrrr_grid.py — the HRRR CONUS grid, where it ends, and how its winds point (2026-10-09).

The wind map picks its model by PLACE and TIME (`weather_pipeline/wind_lane.py`): inside HRRR's domain and inside HRRR's
horizon it draws HRRR, elsewhere GFS. "Inside the domain" is not a lat/lon box. HRRR runs on a Lambert conformal grid,
so its edge is a curved quadrilateral: the south edge reaches 24.4N at 97.5W but 21.1N at its corners. This module is
that grid, exactly as NOAA's GRIB describes it (template 3.30):

  sphere R = 6371229 m; standard parallels 38.5N/38.5N; LoV 262.5E (97.5W); Nx 1799 x Ny 1059; Dx = Dy = 3 km;
  first point 21.138123N 237.280472E; scan +i +j.

MEASURED 2026-10-09 (Open-Meteo `gfs_hrrr`, queried from a workstation, never the backend): `edge_km` changes sign
exactly where Open-Meteo's HRRR goes null on two transects: 87W between 23.75N (-7.6 km, null) and 24.0N (+20.9 km,
HRRR), and 30N between 69.5W (+13.0 km) and 69.0W (-33.3 km). `gribberish`'s own lat/lon for the decoded f03 message
matched `inverse` to 1e-5 deg at the four corners and the centre.

⛔ HRRR's GRIB winds are GRID-RELATIVE (section 3, resolution and component flags 0b1000). `rotate_to_earth` turns
them to east/north. Measured on the 2026-10-09 12Z f03 message, the signed direction difference against GFS at the
same hour was +9.8 deg (west, alpha -14.3 deg) and -16.4 deg (east, alpha +15.2 deg) UNROTATED, and -4.3 / -2.5 deg
rotated. Open-Meteo's `gfs_hrrr` showed the unrotated bias (+12.0 / -19.5 deg), so it is no reference for direction.

Spawned BY PATH as part of the HRRR fetcher: import as `try: from _hrrr_grid import ... except ImportError: from
services._hrrr_grid import ...` (tests/test_fetcher_script_imports.py). Pure math; numpy only for the array forms.
"""
import math
from datetime import datetime, timedelta, timezone

R_EARTH_M = 6371229.0
LAT_STD_DEG = 38.5
LON_V_DEG = -97.5
NX, NY = 1799, 1059
DX_M = 3000.0
LA1_DEG, LO1_DEG = 21.138123, -122.719528

_N = math.sin(math.radians(LAT_STD_DEG))
_F = math.cos(math.radians(LAT_STD_DEG)) * math.tan(math.pi / 4 + math.radians(LAT_STD_DEG) / 2) ** _N / _N


def _rho(lat_deg):
    return R_EARTH_M * _F / math.tan(math.pi / 4 + math.radians(lat_deg) / 2) ** _N


_RHO0 = _rho(LAT_STD_DEG)


def _theta(lon_deg):
    """n * (lon - LoV) in radians, with the longitude difference wrapped to [-180, 180)."""
    return _N * math.radians(((lon_deg - LON_V_DEG + 180.0) % 360.0) - 180.0)


def _xy(lat_deg, lon_deg):
    th = _theta(lon_deg)
    r = _rho(lat_deg)
    return r * math.sin(th), _RHO0 - r * math.cos(th)


_X0, _Y0 = _xy(LA1_DEG, LO1_DEG)


def grid_ij(lat_deg, lon_deg):
    """Fractional (i, j) of a point on the HRRR grid: i along x (west -> east), j along y (south -> north)."""
    x, y = _xy(lat_deg, lon_deg)
    return (x - _X0) / DX_M, (y - _Y0) / DX_M


def inverse(i, j):
    """(lat, lon) of fractional grid index (i, j); lon in [-180, 180)."""
    x = _X0 + i * DX_M
    yy = _RHO0 - (_Y0 + j * DX_M)
    r = math.hypot(x, yy)
    lat = math.degrees(2.0 * math.atan((R_EARTH_M * _F / r) ** (1.0 / _N)) - math.pi / 2.0)
    lon = LON_V_DEG + math.degrees(math.atan2(x, yy) / _N)
    return lat, ((lon + 180.0) % 360.0) - 180.0


def edge_km(lat_deg, lon_deg):
    """Signed distance to the HRRR domain edge in km, measured on the grid: > 0 inside, <= 0 outside."""
    i, j = grid_ij(lat_deg, lon_deg)
    return (DX_M / 1000.0) * min(i, (NX - 1) - i, j, (NY - 1) - j)


def inside(lat_deg, lon_deg):
    return edge_km(lat_deg, lon_deg) > 0.0


# HRRR is WRF-ARW nested in RAP: its own outer rows are the specified + relaxation zone (spec_bdy_width 5 = 15 km),
# where the field is RAP being nudged, not HRRR. The feather starts inside it.
RELAXATION_KM = 15.0


def space_weight(lat_deg, lon_deg, feather_km, inner_km=RELAXATION_KM):
    """HRRR's weight at a point, 0..1: 0 outside and in HRRR's own relaxation rows, a cos^2 ramp over
    `feather_km` (Davies-style relaxation, smooth in value AND slope at both ends), 1 deeper inside."""
    d = edge_km(lat_deg, lon_deg) - inner_km
    if d <= 0.0:
        return 0.0
    if feather_km <= 0.0 or d >= feather_km:
        return 1.0
    return math.sin(0.5 * math.pi * d / feather_km) ** 2


def edge_km_np(lat_deg, lon_deg):
    """`edge_km` for numpy arrays (same math, vectorized)."""
    import numpy as np
    lat = np.asarray(lat_deg, dtype=float)
    th = _N * np.radians(((np.asarray(lon_deg, dtype=float) - LON_V_DEG + 180.0) % 360.0) - 180.0)
    r = R_EARTH_M * _F / np.tan(np.pi / 4 + np.radians(lat) / 2) ** _N
    i = (r * np.sin(th) - _X0) / DX_M
    j = (_RHO0 - r * np.cos(th) - _Y0) / DX_M
    return (DX_M / 1000.0) * np.minimum(np.minimum(i, (NX - 1) - i), np.minimum(j, (NY - 1) - j))


def space_weight_np(lat_deg, lon_deg, feather_km, inner_km=RELAXATION_KM):
    """`space_weight` for numpy arrays."""
    import numpy as np
    d = edge_km_np(lat_deg, lon_deg) - inner_km
    if feather_km <= 0.0:
        return np.where(d > 0.0, 1.0, 0.0)
    ramp = np.sin(0.5 * np.pi * np.clip(d, 0.0, feather_km) / feather_km) ** 2
    return np.where(d <= 0.0, 0.0, np.where(d >= feather_km, 1.0, ramp))


def rotation_rad(lon_deg):
    """The angle from grid north to true north at `lon_deg` (positive east of LoV)."""
    return _theta(lon_deg)


def rotate_to_earth(u_grid, v_grid, lon_deg):
    """Grid-relative (u, v) -> earth-relative (east, north). Works on floats or numpy arrays."""
    try:
        import numpy as np
        a = _N * np.radians(((np.asarray(lon_deg, dtype=float) - LON_V_DEG + 180.0) % 360.0) - 180.0)
        c, s = np.cos(a), np.sin(a)
    except ImportError:  # pragma: no cover - numpy is present everywhere the fetcher runs
        a = rotation_rad(lon_deg)
        c, s = math.cos(a), math.sin(a)
    return c * u_grid + s * v_grid, -s * u_grid + c * v_grid


# THE TIME SEAM. Open-Meteo's own `gfs_seamless` hands HRRR over to GFS linearly across HRRR's last hours; measured
# 2026-10-09 at 27.5N 87W and 47N 62W against its `gfs_hrrr` and `gfs_global`: HRRR weights 1.0 at H-3 h,
# 0.75 / 0.47-0.5 / 0.24-0.29 at H-2, H-1 and H (the speed-derived weights wobble because it blends vectors), 0 after.
TAPER_HOURS = 3


def time_weight(valid_time, horizon, taper_hours=TAPER_HOURS):
    """HRRR's weight at `valid_time` given its last forecast hour `horizon` (both aware datetimes): 1 up to
    horizon - taper_hours, then linear to 0 one hour after the horizon, so the last HRRR hour still carries
    1/(taper_hours+1). taper_hours=0 is a hard switch at the horizon."""
    if valid_time is None or horizon is None:
        return 0.0
    if valid_time > horizon:
        return 0.0
    if taper_hours <= 0:
        return 1.0
    hours_left = (horizon - valid_time).total_seconds() / 3600.0
    return max(0.0, min(1.0, (hours_left + 1.0) / (taper_hours + 1.0)))


def hrrr_horizon_hours(cycle_hour):
    """HRRR's forecast length for a cycle: 48 h at 00/06/12/18Z, 18 h at the other hours."""
    return 48 if int(cycle_hour) % 6 == 0 else 18


def utc(iso_or_dt):
    if isinstance(iso_or_dt, datetime):
        return iso_or_dt if iso_or_dt.tzinfo else iso_or_dt.replace(tzinfo=timezone.utc)
    dt = datetime.fromisoformat(str(iso_or_dt).replace("Z", "+00:00"))
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def horizon_of(cycle_iso):
    cyc = utc(cycle_iso)
    return cyc + timedelta(hours=hrrr_horizon_hours(cyc.hour))
